import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Track } from "@dont-fall/shared";
import { DEFAULT_TRACK_SERVICE_PORT, MODULE_LIBRARY, M1_TRACK } from "@dont-fall/shared";
import { openDb, type TrackDb } from "./db.js";
import { generateRandomTrack } from "./generate.js";
import { getAnyTrack, getTrackById, listTracks, saveTrack, seedIfEmpty } from "./store.js";
import { invalidTimeLimitReason, unknownModuleIds } from "./validate.js";

/**
 * track-service (ADR 0028): the single source of truth for Tracks, separate
 * from the ephemeral per-Match `apps/server` (ADR 0002/0011), which never
 * generates or holds Track data itself — it only ever fetches one from here.
 * A hand-built Track from the builder tool (ticket 04) and a randomly
 * assembled one (ticket 06) are both just rows in the same table; this
 * service never distinguishes them.
 */
export { DEFAULT_TRACK_SERVICE_PORT };
export const M1_SEED_TRACK_ID = "m1-playground";

export interface TrackService {
  port: number;
  close: () => Promise<void>;
}

export interface StartTrackServiceConfig {
  port?: number;
  /** SQLite file path. Defaults to `./data/track-service.sqlite` (Docker: a named-volume mount). */
  dbPath?: string;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

/**
 * A browser-based caller (the Track builder tool, ticket 04) is always a
 * different origin from track-service — wide-open CORS is fine for a
 * dev-only, no-auth internal service (Q11/Q15 in the M3 grilling session);
 * there's no credential here for a permissive origin to steal.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};

/** A finite number — rejects NaN and Infinity, neither of which may reach `segmentOrientation`. */
const isFiniteNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

/** Present-and-finite, or absent. `pitch`/`roll` are optional and default to 0 (ADR 0034). */
const isOptionalFiniteNumber = (value: unknown): boolean => value === undefined || isFiniteNumber(value);

const isVec3 = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, z } = value as { x?: unknown; y?: unknown; z?: unknown };
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z);
};

/**
 * Validates the published `Segment[]` contract (ADR 0038 keeps `data` exactly
 * this shape) against `Track.ts`'s `Segment`.
 *
 * Checked properly rather than loosely, because a Revision is immutable
 * (ADR 0032): anything that gets past here is stored forever and only fails
 * much later, somewhere far away. The two holes this closes were both of that
 * kind — `typeof null === "object"` let a null `position` through, and
 * `rotation` was not checked at all, so an absent one reached
 * `segmentOrientation` (`Track.ts`) as `undefined` and produced a NaN
 * quaternion instead of a 400 here.
 */
const isSegment = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as { moduleId?: unknown; position?: unknown; rotation?: unknown; pitch?: unknown; roll?: unknown };
  return (
    typeof segment.moduleId === "string" &&
    isVec3(segment.position) &&
    isFiniteNumber(segment.rotation) &&
    isOptionalFiniteNumber(segment.pitch) &&
    isOptionalFiniteNumber(segment.roll)
  );
};

const isTrack = (value: unknown): value is Track => Array.isArray(value) && value.every(isSegment);

const handle = async (db: TrackDb, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://track-service");

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/tracks") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: "invalid JSON body" });
      return;
    }
    const body = parsed as { id?: unknown; name?: unknown; track?: unknown; timeLimitMs?: unknown };
    if (!isTrack(body.track)) {
      json(res, 400, {
        error:
          "body.track must be a Segment[]: each entry needs a string moduleId, a position with finite x/y/z, " +
          "a finite rotation, and finite pitch/roll if present",
      });
      return;
    }
    const unknown = unknownModuleIds(body.track, MODULE_LIBRARY);
    if (unknown.length > 0) {
      json(res, 400, { error: `unknown Module id(s): ${unknown.join(", ")}` });
      return;
    }
    const badTimeLimit = invalidTimeLimitReason(body.timeLimitMs);
    if (badTimeLimit) {
      json(res, 400, { error: badTimeLimit });
      return;
    }
    // An explicit body.id republishes that same trackId as a new Revision
    // (ADR 0032) instead of creating a fresh one — never mutates Revision 1.
    const saved = saveTrack(db, {
      track: body.track,
      ...(typeof body.id === "string" ? { id: body.id } : {}),
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      // Absent is valid and means "the default" (ADR 0038) — already
      // validated above, so anything still here is a real integer.
      ...(typeof body.timeLimitMs === "number" ? { timeLimitMs: body.timeLimitMs } : {}),
    });
    json(res, 201, saved);
    return;
  }

  if (req.method === "GET" && url.pathname === "/tracks") {
    json(res, 200, listTracks(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/tracks/generate") {
    let body: { name?: unknown; count?: unknown } = {};
    const raw = await readBody(req);
    if (raw) {
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
    }
    const count = typeof body.count === "number" && body.count > 0 ? Math.floor(body.count) : undefined;
    let track: Track;
    try {
      track = generateRandomTrack(MODULE_LIBRARY, count);
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
      return;
    }
    // A randomly-generated Track is saved exactly like a hand-built one
    // (ADR 0028) — no separate runtime path, no flag distinguishing it.
    const saved = saveTrack(db, {
      track,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
    });
    json(res, 201, { ...saved, track });
    return;
  }

  if (req.method === "GET" && url.pathname === "/tracks/any") {
    const stored = getAnyTrack(db);
    if (!stored) {
      json(res, 404, { error: "no Tracks stored" });
      return;
    }
    json(res, 200, stored);
    return;
  }

  const idMatch = /^\/tracks\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && idMatch) {
    // ticket 11: `?revision=` pins an exact Revision (ADR 0032) instead of
    // "latest" — a Match server's WelcomeMessage names one exact Revision, and
    // the client must fetch that same one, not whatever a publish landing
    // mid-Match happened to make latest by the time it asks.
    const revisionParam = url.searchParams.get("revision");
    let revision: number | undefined;
    if (revisionParam !== null) {
      revision = Number(revisionParam);
      if (!Number.isInteger(revision) || revision < 1) {
        json(res, 400, { error: `revision must be a positive integer, got "${revisionParam}"` });
        return;
      }
    }
    const stored = getTrackById(db, idMatch[1]!, revision);
    if (!stored) {
      json(res, 404, {
        error:
          revision === undefined
            ? `no Track with id "${idMatch[1]}"`
            : `no Track with id "${idMatch[1]}" at revision ${revision}`,
      });
      return;
    }
    json(res, 200, stored);
    return;
  }

  json(res, 404, { error: "not found" });
};

export const startTrackService = async (config: StartTrackServiceConfig = {}): Promise<TrackService> => {
  const db = openDb(config.dbPath ?? "./data/track-service.sqlite");
  seedIfEmpty(db, M1_SEED_TRACK_ID, "M1 playground", M1_TRACK);

  const server = createServer((req, res) => {
    handle(db, req, res).catch((err: unknown) => {
      // A single malformed/unlucky request must never take the always-on
      // service down for every other caller (same posture as ADR 0011's
      // per-socket `trySend` in apps/server).
      console.error("track-service request failed:", err);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port ?? DEFAULT_TRACK_SERVICE_PORT, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (config.port ?? DEFAULT_TRACK_SERVICE_PORT);

  return {
    port,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
};

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const service = await startTrackService(process.env.TRACK_DB_PATH ? { dbPath: process.env.TRACK_DB_PATH } : {});
  console.log(`DON'T FALL track-service listening on http://localhost:${service.port}`);

  const shutdown = async (): Promise<void> => {
    await service.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

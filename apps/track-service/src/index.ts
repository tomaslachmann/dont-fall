import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Track } from "@dont-fall/shared";
import { DEFAULT_TRACK_SERVICE_PORT, M1_TRACK } from "@dont-fall/shared";
import { openDb, type TrackDb } from "./db.js";
import { getAnyTrack, getTrackById, saveTrack, seedIfEmpty } from "./store.js";

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

const json = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};

const isTrack = (value: unknown): value is Track =>
  Array.isArray(value) &&
  value.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as { moduleId?: unknown }).moduleId === "string" &&
      typeof (s as { position?: unknown }).position === "object",
  );

const handle = async (db: TrackDb, req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
    const body = parsed as { name?: unknown; track?: unknown };
    if (!isTrack(body.track)) {
      json(res, 400, { error: "body.track must be a Segment[] (moduleId, position, rotation)" });
      return;
    }
    const saved = saveTrack(db, {
      track: body.track,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
    });
    json(res, 201, saved);
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
    const stored = getTrackById(db, idMatch[1]!);
    if (!stored) {
      json(res, 404, { error: `no Track with id "${idMatch[1]}"` });
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

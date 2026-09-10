import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Track } from "@dont-fall/shared";
import {
  ASSET_DEMO_TRACK,
  ASSET_DEMO_TRACK_ID,
  ASSET_PLACEMENT_MODULES,
  DEFAULT_TRACK_SERVICE_PORT,
  MODULE_LIBRARY,
  M1_TRACK,
  randomBearerToken,
  type Module,
} from "@dont-fall/shared";
import {
  createAccountWithPassword,
  createSession,
  deleteSession,
  getAccountBySessionToken,
  invalidDisplayNameReason,
  invalidEmailReason,
  invalidPasswordReason,
  isUniqueConstraintError,
  linkDiscordToAccount,
  linkPasswordToAccount,
  upsertAccountFromDiscord,
  verifyEmailPassword,
} from "./accounts.js";
import { defaultAssetsDir, parseAssetFileName, readAssetFile } from "./assets.js";
import { openDb, type TrackDb } from "./db.js";
import { buildDiscordAuthorizeUrl, exchangeDiscordCode, type DiscordOAuthConfig, type FetchLike } from "./discordAuth.js";
import { generateRandomTrack } from "./generate.js";
import { getAnyTrack, getTrackById, listTracks, saveTrack, seedIfEmpty, seedTrackIfMissing } from "./store.js";
import { invalidSurvivorTargetReason, invalidTimeLimitReason, unknownModuleIds } from "./validate.js";

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

/**
 * Every Module id a publish may reference (M8 ticket 05): the procedural
 * registry composed with the asset defs' placement halves. Publish
 * validation is id-membership only — file geometry is validated at load
 * (match server boot, client track load), never here, so placement halves
 * are the complete input.
 */
export const PUBLISH_MODULES: Record<string, Module> = { ...MODULE_LIBRARY, ...ASSET_PLACEMENT_MODULES };

export interface TrackService {
  port: number;
  close: () => Promise<void>;
}

export interface StartTrackServiceConfig {
  port?: number;
  /** SQLite file path. Defaults to `./data/track-service.sqlite` (Docker: a named-volume mount). */
  dbPath?: string;
  /**
   * Module art dir (M8 ticket 02). Defaults to the repo's `assets/`, located
   * from source (Docker: `/app/assets` via `TRACK_ASSETS_DIR` + a COPY —
   * binaries ride the image, never the database).
   */
  assetsDir?: string;
  /**
   * Discord app credentials (M9 ticket 11, ADR 0052). Defaults to
   * `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_REDIRECT_URI` env
   * vars. Left undefined (no env vars set either), `/auth/discord/*` answers
   * 500 rather than crashing the whole service at boot — every other route
   * (Tracks, assets) has nothing to do with Accounts and must keep working.
   */
  discord?: DiscordOAuthConfig;
  /**
   * Where the browser lands after a successful login — the client app's own
   * `/auth/callback` route, which reads the session token off the URL
   * *fragment* (`#token=...`, never a query param — see the callback
   * handler's comment). Defaults to `PUBLIC_CLIENT_URL` env var, else
   * `http://localhost:5173`.
   */
  clientAppUrl?: string;
  /** Test-only seam: injects a fake Discord (`discordAuth.ts`'s `FetchLike`) instead of the real network. */
  discordFetch?: FetchLike;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

/**
 * Reads and JSON-parses a request body, answering the 400 itself on failure.
 * `undefined` is a safe "already handled, stop" sentinel — valid JSON never
 * parses to `undefined` (the literal input `"undefined"` isn't valid JSON).
 * Shared by every `POST` route with a JSON body, so the invalid-body
 * response (message, status) stays one thing to edit, not four.
 */
const readJsonBody = async (req: IncomingMessage, res: ServerResponse): Promise<unknown> => {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "invalid JSON body" });
    return undefined;
  }
};

/**
 * A browser-based caller (the Track builder tool, ticket 04) is always a
 * different origin from track-service — wide-open CORS is fine for a
 * dev-only, no-auth internal service (Q11/Q15 in the M3 grilling session);
 * there's no credential here for a permissive origin to steal.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const OAUTH_STATE_COOKIE = "df_oauth_state";
/** Set only when `/auth/discord/authorize` is called with a valid session (ADR 0053: linking Discord onto an already-logged-in Account, not a fresh login). */
const OAUTH_LINK_ACCOUNT_COOKIE = "df_oauth_link_account";

/** Everything the `/auth/*` routes need beyond `db` — bundled so `handle`'s signature doesn't grow a parameter per route. */
interface RouteConfig {
  assetsDir: string;
  discord?: DiscordOAuthConfig;
  clientAppUrl: string;
  discordFetch: FetchLike;
}

const parseCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
};

const bearerToken = (req: IncomingMessage): string | undefined => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
};

/** Both `/auth/discord/*` routes need this identical guard; answers the 500 itself and reports whether the caller should stop. */
const requireDiscordConfigured = (config: RouteConfig, res: ServerResponse): config is RouteConfig & { discord: DiscordOAuthConfig } => {
  if (config.discord) return true;
  json(res, 500, { error: "Discord OAuth is not configured on this server" });
  return false;
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

const handle = async (db: TrackDb, req: IncomingMessage, res: ServerResponse, config: RouteConfig): Promise<void> => {
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

  // Served Module art (M8 ticket 02, ADR 0050 as amended) — the one pipe
  // every loader fetches GLB bytes through. Floating revisions, binary
  // body, exact bytes; a missing file is a 404 naming it, never an
  // HTML error page a GLB parser would choke on downstream.
  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    const fileName = parseAssetFileName(url.pathname);
    if (!fileName) {
      json(res, 400, { error: "path must be /assets/<moduleId>.glb" });
      return;
    }
    try {
      const { bytes, contentType } = await readAssetFile(config.assetsDir, fileName);
      res.writeHead(200, { ...CORS_HEADERS, "Content-Type": contentType, "Content-Length": bytes.length });
      res.end(Buffer.from(bytes));
    } catch (err) {
      json(res, 404, { error: (err as Error).message });
    }
    return;
  }

  // Discord OAuth login (M9 ticket 11, ADR 0052). The redirect chain is:
  // client -> here (authorize) -> Discord -> here (callback) -> client, with
  // an HttpOnly `state` cookie (Max-Age 300s, scoped to /auth/discord) as
  // CSRF protection — the callback rejects unless the `state` query param it
  // gets back from Discord matches the cookie this route set.
  //
  // Known limitation, accepted rather than fixed here: the state cookie
  // holds exactly one in-flight attempt. Two concurrent `/authorize` calls
  // (two tabs, a double-click) overwrite each other's cookie, and whichever
  // tab's Discord consent completes second gets rejected with a 400 instead
  // of a real CSRF attempt being caught — a per-attempt state store would
  // fix this properly but is more machinery than a single-flow login needs
  // right now.
  if (req.method === "GET" && url.pathname === "/auth/discord/authorize") {
    if (!requireDiscordConfigured(config, res)) return;
    const state = randomBearerToken(16);
    const cookies = [`${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Max-Age=300; Path=/auth/discord`];
    // Linking mode (ADR 0053): a caller who's already logged in (sends a
    // valid Bearer token to this GET) is linking Discord onto their existing
    // Account, not starting a fresh login — the account id rides its own
    // short-lived cookie so the callback can tell the two cases apart.
    const linkToken = bearerToken(req);
    const linkAccount = linkToken ? getAccountBySessionToken(db, linkToken) : undefined;
    if (linkAccount) cookies.push(`${OAUTH_LINK_ACCOUNT_COOKIE}=${linkAccount.id}; HttpOnly; Max-Age=300; Path=/auth/discord`);
    res.writeHead(302, {
      ...CORS_HEADERS,
      Location: buildDiscordAuthorizeUrl(config.discord, state),
      "Set-Cookie": cookies,
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/discord/callback") {
    if (!requireDiscordConfigured(config, res)) return;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = parseCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
    const linkAccountId = parseCookie(req.headers.cookie, OAUTH_LINK_ACCOUNT_COOKIE);
    if (!code) {
      json(res, 400, { error: "missing ?code" });
      return;
    }
    if (!state || !cookieState || state !== cookieState) {
      json(res, 400, { error: "state mismatch — possible CSRF, or an expired/reused login attempt" });
      return;
    }
    let identity: Awaited<ReturnType<typeof exchangeDiscordCode>>;
    try {
      identity = await exchangeDiscordCode(config.discord, code, config.discordFetch);
    } catch (err) {
      json(res, 502, { error: `Discord login failed: ${(err as Error).message}` });
      return;
    }
    // Clears both single-use cookies now that they've served their purpose, on every exit path below.
    const clearCookies = [
      `${OAUTH_STATE_COOKIE}=; Max-Age=0; Path=/auth/discord`,
      `${OAUTH_LINK_ACCOUNT_COOKIE}=; Max-Age=0; Path=/auth/discord`,
    ];
    const redirectUrl = new URL("/auth/callback", config.clientAppUrl);
    if (linkAccountId) {
      try {
        linkDiscordToAccount(db, linkAccountId, identity);
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        redirectUrl.hash = "error=discord-already-linked";
        res.writeHead(302, { ...CORS_HEADERS, Location: redirectUrl.toString(), "Set-Cookie": clearCookies });
        res.end();
        return;
      }
      // Linking, not a fresh login: the caller already holds a valid session
      // token (that's what put `linkAccountId` on the cookie) — no new one issued.
      redirectUrl.hash = "linked=discord";
    } else {
      const account = upsertAccountFromDiscord(db, identity);
      const { token } = createSession(db, account.id);
      // The token rides the URL *fragment*, not a query param: a fragment is
      // never sent in the request line to the client app's own server, never
      // logged by it or any proxy in front of it, and never forwarded as
      // Referer if that landing page loads a third-party resource — a query
      // param would leak the bearer token into all three. Browser history
      // still holds it either way; the client's `/auth/callback` route must
      // strip it (`history.replaceState`) once read, not leave it sitting in
      // the address bar.
      redirectUrl.hash = `token=${token}`;
    }
    res.writeHead(302, { ...CORS_HEADERS, Location: redirectUrl.toString(), "Set-Cookie": clearCookies });
    res.end();
    return;
  }

  // Email/password signup (ADR 0053) — creates a brand-new Account. A
  // logged-in caller wanting to *add* a password to their existing (likely
  // Discord-first) Account uses `/auth/link/password` below, not this route.
  if (req.method === "POST" && url.pathname === "/auth/signup") {
    const parsed = await readJsonBody(req, res);
    if (parsed === undefined) return;
    const body = parsed as { email?: unknown; password?: unknown; displayName?: unknown };
    const reason = invalidEmailReason(body.email) ?? invalidPasswordReason(body.password) ?? invalidDisplayNameReason(body.displayName);
    if (reason) {
      json(res, 400, { error: reason });
      return;
    }
    let account: ReturnType<typeof createAccountWithPassword>;
    try {
      account = createAccountWithPassword(db, body as { email: string; password: string; displayName: string });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      json(res, 409, { error: "an Account with that email already exists" });
      return;
    }
    const { token } = createSession(db, account.id);
    json(res, 201, { account, token });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/login") {
    const parsed = await readJsonBody(req, res);
    if (parsed === undefined) return;
    const body = parsed as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      json(res, 400, { error: "email and password are required" });
      return;
    }
    const account = verifyEmailPassword(db, body.email, body.password);
    if (!account) {
      // Deliberately the same error for "no such email" and "wrong password" — never lets a caller enumerate registered emails.
      json(res, 401, { error: "invalid email or password" });
      return;
    }
    const { token } = createSession(db, account.id);
    json(res, 200, { account, token });
    return;
  }

  // Links email/password onto the *already-authenticated* caller's Account
  // (ADR 0053) — the Discord-first counterpart to Discord-authorize's
  // linking mode above. Requires a valid Bearer token; unlike `/auth/signup`
  // this never creates a new Account.
  if (req.method === "POST" && url.pathname === "/auth/link/password") {
    const token = bearerToken(req);
    const account = token ? getAccountBySessionToken(db, token) : undefined;
    if (!account) {
      json(res, 401, { error: "not logged in" });
      return;
    }
    const parsed = await readJsonBody(req, res);
    if (parsed === undefined) return;
    const body = parsed as { email?: unknown; password?: unknown };
    const reason = invalidEmailReason(body.email) ?? invalidPasswordReason(body.password);
    if (reason) {
      json(res, 400, { error: reason });
      return;
    }
    let linked: ReturnType<typeof linkPasswordToAccount>;
    try {
      linked = linkPasswordToAccount(db, account.id, body as { email: string; password: string });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      json(res, 409, { error: "an Account with that email already exists" });
      return;
    }
    json(res, 200, linked);
    return;
  }

  // Mandatory-login gate (ADR 0052): every other app entry point calls this
  // to check the bearer token it's holding. 401, not a redirect — this is a
  // JSON API; the client owns navigating to `/auth` on a 401.
  if (req.method === "GET" && url.pathname === "/auth/me") {
    const token = bearerToken(req);
    const account = token ? getAccountBySessionToken(db, token) : undefined;
    if (!account) {
      json(res, 401, { error: "not logged in" });
      return;
    }
    json(res, 200, account);
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    const token = bearerToken(req);
    if (token) deleteSession(db, token);
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/tracks") {
    const parsed = await readJsonBody(req, res);
    if (parsed === undefined) return;
    const body = parsed as { id?: unknown; name?: unknown; track?: unknown; timeLimitMs?: unknown; survivorTarget?: unknown };
    if (!isTrack(body.track)) {
      json(res, 400, {
        error:
          "body.track must be a Segment[]: each entry needs a string moduleId, a position with finite x/y/z, " +
          "a finite rotation, and finite pitch/roll if present",
      });
      return;
    }
    const unknown = unknownModuleIds(body.track, PUBLISH_MODULES);
    if (unknown.length > 0) {
      json(res, 400, { error: `unknown Module id(s): ${unknown.join(", ")}` });
      return;
    }
    const badTimeLimit = invalidTimeLimitReason(body.timeLimitMs);
    if (badTimeLimit) {
      json(res, 400, { error: badTimeLimit });
      return;
    }
    const badSurvivorTarget = invalidSurvivorTargetReason(body.survivorTarget);
    if (badSurvivorTarget) {
      json(res, 400, { error: badSurvivorTarget });
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
      // Absent is valid and means "the default" (ADR 0041), same as the
      // clock above — already validated, so anything here is a real integer.
      ...(typeof body.survivorTarget === "number" ? { survivorTarget: body.survivorTarget } : {}),
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
  // The M8 milestone playtest Track (ticket 04) — per-id, not whole-DB, so
  // it joins databases that already hold user Tracks on their next boot.
  // Seeded from the shared chained composition (never hand-placed Segments),
  // served to Matches the same way every published Track is.
  seedTrackIfMissing(db, ASSET_DEMO_TRACK_ID, "Asset demo", ASSET_DEMO_TRACK);
  const assetsDir = config.assetsDir ?? process.env.TRACK_ASSETS_DIR ?? defaultAssetsDir();
  const discord =
    config.discord ??
    (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.DISCORD_REDIRECT_URI
      ? {
          clientId: process.env.DISCORD_CLIENT_ID,
          clientSecret: process.env.DISCORD_CLIENT_SECRET,
          redirectUri: process.env.DISCORD_REDIRECT_URI,
        }
      : undefined);
  const routeConfig: RouteConfig = {
    assetsDir,
    ...(discord ? { discord } : {}),
    clientAppUrl: config.clientAppUrl ?? process.env.PUBLIC_CLIENT_URL ?? "http://localhost:5173",
    discordFetch: config.discordFetch ?? fetch,
  };

  const server = createServer((req, res) => {
    handle(db, req, res, routeConfig).catch((err: unknown) => {
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

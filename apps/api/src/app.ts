import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  BASE_RACE_NAME,
  BASE_RACE_TIME_LIMIT_MS,
  BASE_RACE_TRACK,
  BASE_RACE_TRACK_ID,
  DEFAULT_API_PORT,
  MAX_PLAYERS,
} from "@dont-fall/shared";
import { defaultAssetsDir } from "./assets/assets.service.js";
import { registerAssetRoutes } from "./assets/assets.controller.js";
import { registerAuthRoutes } from "./auth/auth.controller.js";
import type { DiscordOAuthConfig, FetchLike } from "./auth/auth.service.js";
import { openDb, type ApiDb } from "./db/db.js";
import { syncSeedTrack } from "./tracks/tracks.dao.js";
import { registerTrackRoutes } from "./tracks/tracks.controller.js";
import { LobbiesService, type LobbiesDeps } from "./lobbies/lobbies.service.js";
import { registerLobbyRoutes } from "./lobbies/lobbies.controller.js";
import { registerSettingsRoutes } from "./settings/settings.controller.js";
import { registerCareerRoutes } from "./career/career.controller.js";
import { registerMatchesRoutes } from "./matches/matches.controller.js";
import { registerRewardsRoutes } from "./rewards/rewards.controller.js";
import { registerBetsRoutes } from "./bets/bets.controller.js";
import { registerFriendsRoutes } from "./friends/friends.controller.js";
import { ServiceError } from "./http/errors.js";

export interface BuildAppOptions {
  db?: ApiDb;
  dbPath?: string;
  assetsDir?: string;
  discord?: DiscordOAuthConfig;
  clientAppUrl?: string;
  discordFetch?: FetchLike;
  apiUrl?: string;
  maxPlayers?: number;
  /**
   * The match-server service token (ticket 14) — `SERVICE_TOKEN` env in
   * production, expected on the betting open/settle calls and the match
   * results save (ADR 0059). Absent (tests, standalone dev without one) the
   * server calls are refused and betting stays closed; everything else is
   * unaffected.
   */
  serviceToken?: string;
  matchPortRange?: LobbiesDeps["matchPortRange"];
  lobbies?: Pick<LobbiesDeps, "startMatchServer" | "fetchLobbyStatus" | "statusPollIntervalMs" | "idleGraceMs">;
}

/**
 * Builds the whole API without listening (ADR 0058) — the seam every test
 * uses via `app.inject()`, so no route test needs a socket. Production
 * (`index.ts`) builds once and listens; `startApi` below is the programmatic
 * equivalent the match-server suites use (they fetch over real HTTP).
 */
export const buildApp = async (options: BuildAppOptions = {}): Promise<FastifyInstance> => {
  const app = Fastify();
  await app.register(cors, {
    // Wide-open, dev-only posture, same as both merged services had (M3
    // grilling session Q11/Q15): no credential here for a permissive origin
    // to steal. Without this a browser's cross-origin POST fails at the
    // preflight and every screen can only report the API as unreachable.
    origin: "*",
    // Every method the routes use — a missing one dies at the browser's
    // preflight as a CORS error (PUT cosmetics did exactly that).
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // JSON parsing with the old services' exact leniency: an empty body parses
  // to `undefined` (controllers decide — `/tracks/generate` allows it, a
  // publish rejects it), malformed JSON is a 400 `{ error: "invalid JSON body" }`.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (body === "") {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("invalid JSON body"), { statusCode: 400 }));
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: unknown }, _req, reply) => {
    if (err instanceof ServiceError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    const statusCode = err.statusCode;
    const status = typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    // A single malformed/unlucky request must never take the always-on
    // service down for every other caller (same posture as ADR 0011's
    // per-socket `trySend` in apps/server).
    if (status === 500) console.error("api request failed:", err);
    reply.code(status).send({ error: status === 500 ? "internal error" : err.message });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found" }));

  const db = options.db ?? openDb(options.dbPath ?? "./data/track-service.sqlite");
  // The one code-owned seed, the base race (ADR 0078), synced — missing →
  // seeded, drifted → a new Revision with the code's content (ADR 0073). A
  // synced boot writes nothing. Every other Track is authored in the builder.
  syncSeedTrack(db, { id: BASE_RACE_TRACK_ID, name: BASE_RACE_NAME, track: BASE_RACE_TRACK, timeLimitMs: BASE_RACE_TIME_LIMIT_MS });

  const maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  const lobbies = new LobbiesService({
    apiUrl: options.apiUrl ?? `http://localhost:${DEFAULT_API_PORT}`,
    maxPlayers,
    ...(options.matchPortRange ? { matchPortRange: options.matchPortRange } : {}),
    ...(options.lobbies ?? {}),
  });
  app.addHook("onClose", async () => {
    await lobbies.close();
  });

  const assetsDir = options.assetsDir ?? defaultAssetsDir();
  app.get("/health", async () => ({ ok: true }));
  registerTrackRoutes(app, db, options.serviceToken);
  registerAssetRoutes(app, assetsDir);
  registerAuthRoutes(app, db, {
    ...(options.discord ? { discord: options.discord } : {}),
    clientAppUrl: options.clientAppUrl ?? "http://localhost:5173",
    discordFetch: options.discordFetch ?? fetch,
  });
  registerLobbyRoutes(app, lobbies);
  registerSettingsRoutes(app, { maxPlayers, countOnlinePlayers: () => lobbies.countOnlinePlayers() });
  registerRewardsRoutes(app, db);
  registerBetsRoutes(app, db, options.serviceToken);
  registerMatchesRoutes(app, db, options.serviceToken);
  registerCareerRoutes(app, db);
  registerFriendsRoutes(app, db, lobbies);

  return app;
};

export interface ApiService {
  port: number;
  close: () => Promise<void>;
}

/**
 * Programmatic listen — what production (`index.ts`) and the match-server
 * suites (real HTTP fetches) use. Route tests prefer `buildApp` + `inject`
 * and never touch the network.
 */
export const startApi = async (config: BuildAppOptions & { port?: number; host?: string } = {}): Promise<ApiService> => {
  const app = await buildApp(config);
  const port = config.port ?? DEFAULT_API_PORT;
  await app.listen({ port, host: config.host ?? "0.0.0.0" });
  const address = app.server.address();
  return {
    port: typeof address === "object" && address ? address.port : port,
    close: () => app.close(),
  };
};

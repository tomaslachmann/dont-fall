import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  BASE_RACE_NAME,
  BASE_RACE_TIME_LIMIT_MS,
  BASE_RACE_THUMBNAIL_FILE,
  BASE_RACE_TRACK,
  BASE_RACE_TRACK_ID,
  DEFAULT_API_PORT,
  MAX_PLAYERS,
  PARTY_CODE_LENGTH,
} from "@dont-fall/shared";
import { defaultAssetsDir, readThumbnailDataUrl } from "./assets/assets.service.js";
import { registerAssetRoutes } from "./assets/assets.controller.js";
import { registerAuthRoutes } from "./auth/auth.controller.js";
import type { DiscordOAuthConfig, FetchLike } from "./auth/auth.service.js";
import { openDb, type ApiDb } from "./db/db.js";
import { syncSeedTrack } from "./tracks/tracks.dao.js";
import { registerTrackRoutes } from "./tracks/tracks.controller.js";
import { LobbiesService, type LobbiesDeps } from "./lobbies/lobbies.service.js";
import { registerLobbyRoutes } from "./lobbies/lobbies.controller.js";
import { proxyMatchSockets } from "./lobbies/matchSocketProxy.js";
import { registerSettingsRoutes } from "./settings/settings.controller.js";
import { registerCareerRoutes } from "./career/career.controller.js";
import { registerMatchesRoutes } from "./matches/matches.controller.js";
import { registerRewardsRoutes } from "./rewards/rewards.controller.js";
import { registerBetsRoutes } from "./bets/bets.controller.js";
import { brokerPresenceSource, registerFriendsRoutes } from "./friends/friends.controller.js";
import { countOnlineAccounts, randomFriendAlphabetCode, recordBeat } from "./friends/friends.dao.js";
import { invitesOnConnect } from "./friends/friends.service.js";
import { getAccountBySessionToken } from "./auth/accounts.dao.js";
import { PartiesService, type PartyTimers } from "./party/parties.service.js";
import { accountLooks, mayInviteToParty } from "./party/party.service.js";
import { registerPartyRoutes } from "./party/party.controller.js";
import { AccountSockets, isAccountSocketPath } from "./party/accountSocket.js";
import { VoiceService, type VoiceDeps } from "./voice/voice.service.js";
import { registerVoiceRoutes } from "./voice/voice.controller.js";
import { listMutes } from "./voice/mutes.dao.js";
import { registerPersonalBestRoutes } from "./personalBests/personalBests.controller.js";
import { registerClientErrorRoutes } from "./clientErrors/clientErrors.controller.js";
import { registerLeaderboardRoutes } from "./leaderboards/leaderboards.controller.js";
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
  lobbies?: Pick<LobbiesDeps, "startMatchServer" | "fetchLobbyStatus" | "reserveSeats" | "statusPollIntervalMs" | "idleGraceMs">;
  /**
   * Parties and Account socket test seams (ADR 0112): a clock and timers for
   * `PartiesService`, a faster presence beat, and a handle on the service so
   * a route suite can bring Accounts online without opening sockets. Absent
   * in production.
   */
  parties?: {
    now?: () => number;
    timers?: PartyTimers;
    accountBeatMs?: number;
    expose?: (parties: PartiesService) => void;
  };
  /**
   * Voice chat's relay (ADR 0111). **Present means on**: the worker thread is
   * spawned and every Lobby's roster is fed to it. Production passes it
   * (`resolveConfig`); route tests leave it out, so no test spawns a thread.
   */
  voice?: {
    /** The relay's port. `0` asks the OS for one. */
    port?: number;
    /** Test seam: builds the worker instead of spawning the real relay. */
    spawn?: VoiceDeps["spawn"];
  };
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
  const assetsDir = options.assetsDir ?? defaultAssetsDir();
  // Its own screenshot rides with it (ADR 0085) — a seed Track's picture is
  // code-owned like its Segments, read from the assets directory the GLBs
  // are served from.
  const seedThumbnail = readThumbnailDataUrl(assetsDir, BASE_RACE_THUMBNAIL_FILE);
  syncSeedTrack(db, {
    id: BASE_RACE_TRACK_ID,
    name: BASE_RACE_NAME,
    track: BASE_RACE_TRACK,
    timeLimitMs: BASE_RACE_TIME_LIMIT_MS,
    ...(seedThumbnail === undefined ? {} : { thumbnail: seedThumbnail }),
  });

  const maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  const now = options.parties?.now ?? Date.now;
  // ADR 0112: Parties live beside the Lobbies, in memory. The three below
  // reach each other only through closures, so none needs the others built first.
  const parties: PartiesService = new PartiesService({
    looks: accountLooks(db),
    mayInvite: mayInviteToParty(db),
    push: (accountId, message) => void accountSockets.send(accountId, message),
    reserveSeats: (port, accountIds) => lobbies.reserveSeats(port, accountIds),
    randomCode: () => randomFriendAlphabetCode(PARTY_CODE_LENGTH),
    now,
    ...(options.parties?.timers ? { timers: options.parties.timers } : {}),
  });
  // Voice chat's relay (ADR 0111) — a worker thread with a port of its own,
  // fed the rosters, Parties and Mutes only this thread knows. Built before
  // the lobbies, which hand it every roster change.
  const voice: VoiceService | null =
    options.voice === undefined
      ? null
      : new VoiceService({
          authenticate: (token) => getAccountBySessionToken(db, token)?.id,
          mutesOf: (accountId) => listMutes(db, accountId),
          partyOf: (accountId) => parties.partyOf(accountId),
          ...(options.voice.port !== undefined ? { port: options.voice.port } : {}),
          ...(options.voice.spawn ? { spawn: options.voice.spawn } : {}),
        });
  const lobbies: LobbiesService = new LobbiesService({
    apiUrl: options.apiUrl ?? `http://localhost:${DEFAULT_API_PORT}`,
    maxPlayers,
    ...(options.matchPortRange ? { matchPortRange: options.matchPortRange } : {}),
    ...(options.lobbies ?? {}),
    parties,
    ...(voice
      ? {
          voice: {
            setRoster: (port, accountIds) => voice.setRoster(port, accountIds),
            endRoom: (port) => voice.endRoom(port),
          },
        }
      : {}),
  });
  // A Party is half the link rule (ADR 0111), so the relay follows it rather
  // than asking. `partyOf` is re-read here, not carried on the event.
  const stopPartyWatch = voice === null ? null : parties.onChange((accountIds) => {
    for (const accountId of accountIds) voice.setParty(accountId, parties.partyOf(accountId));
  });
  if (voice !== null) await voice.start();
  // The Account socket (ADR 0112): its lifecycle is what makes a member
  // online or not, and it is the one writer of presence beats.
  const accountSockets: AccountSockets = new AccountSockets({
    authenticate: (token) => getAccountBySessionToken(db, token)?.id,
    opened: (accountId) => {
      parties.connected(accountId);
      for (const invite of invitesOnConnect(db, accountId, now())) {
        accountSockets.send(accountId, { type: "lobbyInvite", invite });
      }
    },
    closed: (accountId) => parties.disconnected(accountId),
    place: (accountId, place, lobbyPort) => parties.setPlace(accountId, place, lobbyPort),
    beat: (accountId) => recordBeat(db, accountId, now()),
    ...(options.parties?.accountBeatMs !== undefined ? { beatMs: options.parties.accountBeatMs } : {}),
  });
  options.parties?.expose?.(parties);
  // Open sockets hold the HTTP server open, so they go before it closes.
  app.addHook("preClose", async () => {
    accountSockets.close();
  });
  app.addHook("onClose", async () => {
    stopPartyWatch?.();
    parties.close();
    await lobbies.close();
    await voice?.close();
  });
  // One `upgrade` handler, two kinds of socket: the Account socket at
  // `/account`, and a Lobby's through this address (ADR 0107) — online there
  // is only the one.
  const proxyLobbySocket = proxyMatchSockets((port) => lobbies.isLobbyPort(port));
  app.server.on("upgrade", (req, socket, head: Buffer) => {
    if (isAccountSocketPath(req.url)) accountSockets.handleUpgrade(req, socket, head);
    // Where there is no nginx (local dev), the voice socket is carried to the
    // relay's port from here, as a Lobby's is to its Match server. Online,
    // nginx sends it straight to the worker and this never runs (ADR 0111).
    else if (voice !== null && VoiceService.isVoicePath(req.url)) voice.handleUpgrade(req, socket, head);
    else proxyLobbySocket(req, socket, head);
  });

  app.get("/health", async () => ({ ok: true }));
  registerTrackRoutes(app, db, options.serviceToken);
  registerAssetRoutes(app, assetsDir);
  registerAuthRoutes(app, db, {
    ...(options.discord ? { discord: options.discord } : {}),
    clientAppUrl: options.clientAppUrl ?? "http://localhost:5173",
    discordFetch: options.discordFetch ?? fetch,
    onSignOut: (accountId) => accountSockets.signOut(accountId),
  });
  registerLobbyRoutes(app, lobbies, db);
  // ADR 0110: beans online are signed-in Accounts by presence heartbeat.
  registerSettingsRoutes(app, { maxPlayers, countOnlinePlayers: async () => countOnlineAccounts(db, Date.now()) });
  registerRewardsRoutes(app, db);
  registerBetsRoutes(app, db, options.serviceToken);
  registerMatchesRoutes(app, db, options.serviceToken);
  registerCareerRoutes(app, db);
  registerFriendsRoutes(app, db, lobbies, {
    pushLobbyInvite: (toAccountId, invite) => accountSockets.send(toAccountId, { type: "lobbyInvite", invite }),
  });
  registerPartyRoutes(app, db, parties, brokerPresenceSource(lobbies));
  registerPersonalBestRoutes(app, db, options.serviceToken);
  registerClientErrorRoutes(app, db, options.serviceToken);
  registerLeaderboardRoutes(app, db);
  registerVoiceRoutes(app, db, (accountId, muted) => voice?.setMutes(accountId, muted));

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

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_API_PORT,
  DEFAULT_SERVER_PORT,
  GRACE_WINDOW_MS,
  IDLE_INPUTS,
  MAX_PLAYERS,
  MODULE_LIBRARY,
  NICKNAME_MAX_LENGTH,
  RapierSimulation,
  SNAPSHOT_HZ,
  TICK_MS,
  DEFAULT_TIME_LIMIT_MS,
  COUNTDOWN_MS,
  ROUND_END_MS,
  STANDINGS_READY_TIMEOUT_MS,
  allQualified,
  allReady,
  resolveHostId,
  PLAYERS_TO_START,
  advanceMatchPhase,
  countdownMsLeft,
  phaseLocksInput,
  TICK_RATE_HZ,
  TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
  TRACK_FETCH_MAX_WAIT_MS,
  TRACK_FETCH_RETRY_DELAY_MS,
  initPhysics,
  randomBearerToken,
  resolveTrack,
  roundTimeLeftMs,
  trackSpawn,
  type ClientMessage,
  type LobbyPlayer,
  type MatchState,
  type ServerMessage,
  type SimInputs,
  type Track,
} from "@dont-fall/shared";
import { WebSocketServer, type WebSocket } from "ws";
import { handleLobbyMessage } from "./match/lobby.js";
import { startMatchLoop } from "./match/matchLoop.js";
import { MatchRuntime } from "./match/matchRuntime.js";
import { send, truncateForCloseReason, trySend } from "./net/wire.js";
import { fetchAssetLibrary } from "./track/assetSource.js";
import { fetchTrack, type FetchedTrack } from "./track/trackSource.js";

/**
 * The authoritative match server (ADR 0002, ticket 02): one `RapierSimulation`
 * per process, stepped at a fixed 30 Hz, with every connected client's
 * Character in its collection (ticket 01). No matchmaking, no on-demand
 * spin-up (ADR 0011) — this process is started manually and serves whoever
 * connects to it.
 */
export interface MatchServer {
  /** The port actually bound (useful when `port: 0` asked for an OS-assigned one, e.g. in tests). */
  port: number;
  close: () => Promise<void>;
}

export interface PortRange {
  min: number;
  max: number;
}

export interface StartServerConfig {
  /** Port to listen on. `0` asks the OS for an ephemeral port. Defaults to {@link DEFAULT_SERVER_PORT}. */
  port?: number;
  /**
   * Bind the first free port inside `[min, max]` instead of `port`.
   * Docker publishes only known ports, so an OS-ephemeral port bound inside
   * the API container is unreachable from the browser — the lobby broker
   * hands that port to the client, which dials it and never gets a welcome.
   * Local dev leaves this unset (ephemeral ports on localhost just work).
   * Invalid (`min > max`, outside 1..65535) fails fast, before physics init.
   */
  portRange?: PortRange;
  /** Track-serving API base URL (ADR 0028, merged service in ADR 0058 — the option/env names are historical). Defaults to `TRACK_SERVICE_URL` env, then localhost:{@link DEFAULT_API_PORT}. */
  trackServiceUrl?: string;
  /** Ticket 12: how long/often to retry the startup Track fetch. Test-only knobs; production uses `fetchTrack`'s defaults. */
  trackFetchMaxWaitMs?: number;
  trackFetchRetryDelayMs?: number;
  trackFetchAttemptTimeoutMs?: number;
  /**
   * How many connected Players a Round waits for before its Countdown starts
   * (M4 ticket 04, ADR 0040). Defaults to `PLAYERS_TO_START` env, then
   * {@link PLAYERS_TO_START}.
   *
   * Configurable so a developer working alone can set it to 1: until ticket
   * 07's Lobby there is nothing in the game able to press start, so a
   * single-browser Playtest would otherwise sit in LOBBY forever.
   */
  playersToStart?: number;
  /**
   * How many connections this server accepts before refusing the next one
   * outright (grilling session, 2026-09). Defaults to `MAX_PLAYERS` env,
   * then {@link MAX_PLAYERS}. Refused with a WS close (reason string, same
   * pattern as the existing Playtest/mid-Round refusals just below) rather
   * than ever seating an eleventh Character no capacity plan accounted for.
   */
  maxPlayers?: number;
  /**
   * How long the Countdown holds before a Round is released (M4 ticket 04).
   * Defaults to {@link COUNTDOWN_MS}. A test-only knob, like the track-fetch
   * timings above — it lets a test put this server into a running Round
   * without waiting out three real seconds.
   */
  countdownMs?: number;
  /** How long ROUND_END holds before RESULTS (M4 ticket 05). Defaults to {@link ROUND_END_MS}. Test-only, like `countdownMs`. */
  roundEndMs?: number;
  /**
   * Ceiling on how long Standings waits for every connected Player to
   * confirm Ready before advancing anyway (M7 ticket 10, ADR 0051).
   * Defaults to {@link STANDINGS_READY_TIMEOUT_MS}. Test-only, like
   * `countdownMs` — lets a test confirm the timeout fallback itself
   * without sitting through the real one.
   */
  standingsReadyTimeoutMs?: number;
  /**
   * Ignore the Revision's authored Time Limit and use this instead. Test-only
   * (ADR 0038 is explicit that the clock belongs to the Track): the API
   * enforces a floor of ten seconds on a published Revision, which is far too
   * long to wait out in a test of what happens when the clock expires.
   */
  timeLimitMsOverride?: number;
  /**
   * Ignore the Revision's authored Survivor Target and use this instead
   * (M5 ticket 05). Test-only, and the same kind of override
   * `timeLimitMsOverride` is over the same kind of Track default: a test
   * that needs a Survival Round to end on a specific number shouldn't have
   * to publish a Revision authored for it.
   *
   * Ticket 05's `fallBehaviorOverride` is deliberately gone from beside it
   * (ticket 07): that was never a Track default to override, it was the
   * Round type standing in for a Lobby that couldn't pick one. The Lobby
   * picks now (`setRoundType`), and the tests go through it.
   */
  survivorTargetOverride?: number;
  /**
   * Force this Match's own length over {@link DEFAULT_MATCH_LENGTH} (M7
   * ticket 04, ADR 0049). Test-only, the same kind of override
   * `timeLimitMsOverride` is: a test that wants to pin a Match to a single
   * Round (to keep testing pre-M7 single-Round behaviour) or sit through a
   * whole multi-Round one without waiting out the real default shouldn't
   * have to. Ticket 05 gives the Lobby a real, non-test-only way to set this.
   */
  matchLengthOverride?: number;
}

/**
 * Listens on the first free port in `[min, max]`, skipping `EADDRINUSE`
 * collisions. Two near-simultaneous boots may both try the same candidate —
 * the loser just moves to the next one, so no cross-process lock is needed
 * at dev scale. Throws the last bind error when the whole range is taken.
 */
const listenFirstFree = async (server: Server, min: number, max: number): Promise<number> => {
  let lastError: unknown = new Error(`no free port in [${min}, ${max}]`);
  for (let port = min; port <= max; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          server.removeListener("listening", onListening);
          server.removeListener("error", onError);
        };
        const onListening = (): void => {
          cleanup();
          resolve();
        };
        const onError = (err: unknown): void => {
          cleanup();
          reject(err);
        };
        server.once("listening", onListening);
        server.once("error", onError);
        server.listen(port);
      });
      return port;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

const validPortRange = (range: PortRange): boolean =>
  Number.isInteger(range.min) &&
  Number.isInteger(range.max) &&
  range.min >= 1 &&
  range.max <= 65535 &&
  range.min <= range.max;

export const startServer = async (config: StartServerConfig = {}): Promise<MatchServer> => {
  if (config.portRange !== undefined && !validPortRange(config.portRange)) {
    throw new RangeError(
      `portRange must be { min, max } within 1..65535 with min <= max, got ${JSON.stringify(config.portRange)}`,
    );
  }
  await initPhysics();

  // ADR 0028: the Match server never holds Module data or generates a Track
  // itself — it always just fetches one, resolved against the procedural
  // registry composed with the fetched asset half (`MODULE_LIBRARY` plus
  // the API art, M8 ticket 02, ADR 0050 as amended).
  const trackServiceUrl =
    config.trackServiceUrl ?? process.env.TRACK_SERVICE_URL ?? `http://localhost:${DEFAULT_API_PORT}`;
  // Ticket 12's test-only knobs, shared by every `fetchTrack` call this
  // server ever makes — the boot-time one below, and a Playtest connection's
  // live reload (further down) — so a test can bound both the same way.
  const countdownMs = config.countdownMs ?? COUNTDOWN_MS;
  const roundEndMs = config.roundEndMs ?? ROUND_END_MS;
  const standingsReadyTimeoutMs = config.standingsReadyTimeoutMs ?? STANDINGS_READY_TIMEOUT_MS;
  const envPlayersToStart = Number(process.env.PLAYERS_TO_START);
  const playersToStart =
    config.playersToStart ?? (Number.isInteger(envPlayersToStart) && envPlayersToStart > 0 ? envPlayersToStart : PLAYERS_TO_START);
  const envMaxPlayers = Number(process.env.MAX_PLAYERS);
  const maxPlayers = config.maxPlayers ?? (Number.isInteger(envMaxPlayers) && envMaxPlayers > 0 ? envMaxPlayers : MAX_PLAYERS);
  const trackFetchRetryOptions = {
    ...(config.trackFetchMaxWaitMs !== undefined ? { maxWaitMs: config.trackFetchMaxWaitMs } : {}),
    ...(config.trackFetchRetryDelayMs !== undefined ? { retryDelayMs: config.trackFetchRetryDelayMs } : {}),
    ...(config.trackFetchAttemptTimeoutMs !== undefined ? { attemptTimeoutMs: config.trackFetchAttemptTimeoutMs } : {}),
  };
  // `let`, not `const`: a Playtest connection's `?track=` (below) can replace
  // both with a freshly-fetched/rebuilt Track+simulation while the server is
  // The Track this server boots on. From here it lives on the runtime, which a
  // Playtest `?track=` reload or a Lobby Track pick can replace while running.
  // Asset art loads once, here (M8 ticket 02) — fetch-once-per-loader, so a
  // mid-Match edit on the API cannot split this server from the world
  // it already built. A boot with no asset Modules in any Track still pays
  // four tiny fetches; correctness of the library beats saving them.
  const bootTrack = await fetchTrack(trackServiceUrl, trackFetchRetryOptions);
  const library = { ...MODULE_LIBRARY, ...(await fetchAssetLibrary(trackServiceUrl)) };
  // This Match's own id (ticket 14) — one stable name for the Match that the
  // API (betting pools keyed by `(matchId, round)`) and every client share
  // via the snapshot. The broker needs none of it: its Lobby id stays its
  // own bookkeeping, never crossing into the Match.
  const matchId = randomUUID();
  const rt = new MatchRuntime(
    {
      matchId,
      trackServiceUrl,
      trackFetchRetryOptions,
      countdownMs,
      roundEndMs,
      standingsReadyTimeoutMs,
      playersToStart,
      maxPlayers,
      ...(config.timeLimitMsOverride !== undefined ? { timeLimitMsOverride: config.timeLimitMsOverride } : {}),
      ...(config.survivorTargetOverride !== undefined ? { survivorTargetOverride: config.survivorTargetOverride } : {}),
      ...(config.matchLengthOverride !== undefined ? { matchLengthOverride: config.matchLengthOverride } : {}),
    },
    bootTrack,
    library,
  );

  // A tiny HTTP surface sharing the WebSocket's own port (grilling session,
  // 2026-09) — `GET /status` is the lobby broker's only way to know this
  // Match's live occupancy/phase without joining it as a Player. Everything
  // else this server does is still the WebSocket protocol; this exists
  // purely so something outside the Match (the broker) can poll it.
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/status") {
      // M9 ticket 11 phase 2b: friends presence reads who (authed Accounts,
      // anonymous seats omitted) and which Round — alongside the occupancy
      // the broker already polled for. Account ids are identifiers, not
      // credentials, and this port only ever answers localhost.
      const round =
        rt.match.phase === "COUNTDOWN" || rt.match.phase === "RUNNING" || rt.match.phase === "ROUND_END"
          ? rt.roundResults.length + 1
          : null;
      const body = JSON.stringify({
        playerCount: rt.sockets.size,
        maxPlayers: rt.config.maxPlayers,
        phase: rt.match.phase,
        round,
        accounts: [...rt.lobbyPlayers.values()].flatMap((p) => (p.accountId === null ? [] : [p.accountId])),
      });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: httpServer });

  /**
   * Cleared the moment a port is actually bound (below). While it is set,
   * bind failures belong to the listen logic, which retries or rejects them.
   */
  let binding = true;

  /**
   * `ws` is constructed with `{ server }`, so it attaches its own listener to
   * the HTTP server and **re-emits whatever that server emits on this
   * instance** — including a bind `error`. Node's unhandled-`'error'` rule
   * then turns a routine `EADDRINUSE` from `listenFirstFree`'s port scan
   * into a process exit.
   *
   * That is fatal well beyond one Match: every Lobby is an in-process
   * `startServer` inside the always-on API (ADR 0054/0058), so one taken
   * port in the Lobby range killed tracks, assets, auth and every other
   * live Lobby with it — observed as an API that died the moment somebody
   * created a Lobby, leaving already-running Matches unable to fetch their
   * `.glb` files (procedural Modules kept drawing; asset-backed ones
   * silently rendered nothing).
   *
   * Bind errors stay the listen logic's business — it retries the scan and
   * rejects with the last failure, so ignoring them here loses nothing.
   * Anything after bind is a real runtime WebSocket fault: logged, never
   * fatal, because one bad socket must not take the process down either.
   */
  wss.on("error", (err: unknown) => {
    if (binding) return;
    console.error("DON'T FALL: match server WebSocket error:", err);
  });

  wss.on("connection", (socket, req) => {
    void (async () => {
      // Capacity (grilling session, 2026-09): checked first, synchronously,
      // before anything else this handler does — a full server refuses the
      // next connection outright rather than ever seating a Character past
      // `maxPlayers`. A flat cap on every connection this process holds
      // (`rt.sockets`), not just active Lobby/Round joiners: it mirrors what
      // a Player-facing "room" capacity means (`Lobby.tsx`'s own "N SLOTS
      // OPEN"), and a mid-Match spectator (M7 ticket 08) is still a
      // connection this server is holding open for someone.
      if (rt.sockets.size >= rt.config.maxPlayers) {
        socket.close(4003, truncateForCloseReason(`server is full (${rt.config.maxPlayers} players)`));
        return;
      }

      // Track Builder's Playtest button (`?track=<id>` on the connection URL,
      // read by `apps/client`'s own bootstrap and forwarded onto its
      // WebSocket URL) — the one way this always-on dev server ever serves
      // anything other than whatever it fetched at boot. Absent for every
      // ordinary player connection, which behaves exactly as before.
      const requestedTrackId = new URL(req.url ?? "/", "http://match-server").searchParams.get("track");
      if (requestedTrackId !== null) {
        // Always re-fetch by id rather than short-circuiting on
        // `requestedTrackId === fetched.id` (code review): Playtest
        // republishes to the same fixed reserved id every time (a new
        // Revision, ADR 0032) — comparing id alone would keep this server
        // serving the very first Revision it ever loaded forever, silently
        // ignoring every subsequent edit+Playtest cycle.
        let candidate: FetchedTrack;
        try {
          candidate = await fetchTrack(trackServiceUrl, { ...trackFetchRetryOptions, trackId: requestedTrackId });
        } catch (err) {
          socket.close(4002, truncateForCloseReason(`failed to load Track "${requestedTrackId}": ${(err as Error).message}`));
          return;
        }

        const alreadyLoaded = candidate.id === rt.fetched.id && candidate.revision === rt.fetched.revision;
        if (!alreadyLoaded) {
          // Checked here — AFTER the `await` above, immediately before the
          // synchronous mutation below — not earlier (code review: a check
          // taken before an `await` is stale by the time that `await`
          // resolves). An ordinary connection with no `?track=` never awaits
          // anything before registering itself, so if one lands while this
          // fetch was in flight, `sockets.size` here already reflects it —
          // this connection then correctly refuses instead of silently
          // replacing the `simulation` a just-joined player's Character
          // only exists in.
          if (rt.sockets.size > 0) {
            // Refuse rather than silently swap the Track under already-connected
            // players' feet — this server has no concept of separate concurrent
            // Matches yet (that's M4's job), so "reload" can only ever mean
            // "reload for everyone," which is only ever safe with no one here.
            socket.close(4001, truncateForCloseReason(`server already has ${rt.sockets.size} player(s) connected on a different Track — restart to test a new one`));
            return;
          }
          // Everything from here to the end of this `if` is synchronous (no
          // `await`) — the event loop cannot run another 'connection' handler
          // in between, so this whole reload is effectively atomic with
          // respect to the `sockets.size` check just above. `sockets.size
          // === 0` was just checked above, so `resetToFreshLobby`'s own
          // re-seating of every connected Player is a no-op here — this path
          // only ever reloads with nobody in it yet.
          rt.fetched = candidate;
          rt.resetToFreshLobby(candidate.track);
          console.log(`DON'T FALL: reloaded Track "${rt.fetched.id}"@${rt.fetched.revision} for a Playtest connection`);
        }
      }

      // Joining mid-Match spectates (M7 ticket 08) — M4 ticket 05's refusal
      // stood here before it: dropping a fresh Character into a Race already
      // in progress is neither fair to them nor to the people racing, so a
      // connection landing outside LOBBY/COUNTDOWN while someone is here
      // joins the Lobby's list but not the Round — registered and welcomed
      // exactly like everyone else, but seated by no simulation until a
      // fresh Match does it (`MatchRuntime.spectators`, cleared only by
      // `resetToFreshLobby`, so they wait out the whole Match rather than
      // joining its next Round halfway).
      //
      // COUNTDOWN still seats: the Round hasn't begun racing, so arriving
      // before it starts is joining the Round, not the middle of one.
      //
      // Gated on someone actually being here, not on the phase alone: the
      // return to LOBBY is decided by the tick loop, so between the last
      // Player leaving and the next tick there is a window where the phase
      // still reads RESULTS with nobody in it, and a Round with no Players in
      // it is not a Round to protect.
      //
      // This does not (and should not) make a reload *during* a Round work:
      // the server may not have processed the old socket's close yet, and
      // even once it has, that is exactly the mid-Round rejoin this path
      // exists to refuse as a Player. Whoever left is a DNF; they come back
      // for the next Match — as a spectator first if it is still running.
      const spectating = rt.sockets.size > 0 && rt.match.phase !== "LOBBY" && rt.match.phase !== "COUNTDOWN";

      const id = randomUUID();
      // Spawn in the loaded Track's own start frame (free placement puts the
      // start platform anywhere) — never M1's world coords (playtest bug, 2026-09).
      const spawn = trackSpawn(rt.fetched.track, rt.joinCount);
      const joinOrder = rt.joinCount;
      rt.joinCount += 1;
      rt.sockets.set(id, socket);
      rt.inputs.add(id);
      // A newcomer has nothing yet — the next tick must push even if the
      // shared payload is unchanged for everyone else (ADR 0057: idle phases
      // broadcast only on change, and a join is nobody's change but theirs).
      rt.snapshotDirty = true;
      // The host is the first joiner (M4 ticket 07, ADR 0040) — `joinOrder`
      // is what `resolveHostId` reads to decide that, recomputed from
      // whoever is still connected rather than stored.
      rt.lobbyPlayers.set(id, { id, nickname: "Player", ready: false, joinOrder, accountId: null });
      // A mid-Match spectator is in the Lobby's list, not in the Round (M7
      // ticket 08): registered and welcomed above, but seated by no
      // simulation — `buildSimulationFor` seats everyone else, and only a
      // fresh Match seats them.
      if (spectating) rt.spectators.add(id);
      else rt.simulation.addCharacter(id, spawn);

      send(socket, {
        type: "welcome",
        playerId: id,
        // A bearer credential the client presents on reconnect (ADR 0024). M2
        // issues it; no reconnect logic acts on it yet.
        sessionToken: randomBearerToken(),
        spawn,
        trackId: rt.fetched.id,
        trackRevision: rt.fetched.revision,
        // Read off the runtime, not the local that seeded it: one name for
        // the threshold at the point it goes on the wire, so a future
        // runtime-adjustable value cannot leave the welcome advertising a
        // number the tick loop no longer uses.
        config: {
          snapshotHz: SNAPSHOT_HZ,
          graceWindowMs: GRACE_WINDOW_MS,
          playersToStart: rt.config.playersToStart,
          maxPlayers: rt.config.maxPlayers,
        },
      });

      // A single client's socket erroring (an abrupt reset, a write to a
      // half-closed pipe) must never take the Match down for everyone else
      // (ADR 0011). 'close' still fires afterwards and does the cleanup.
      socket.on("error", () => {});

      socket.on("message", (raw) => {
        // A malformed frame from one client must never take the Match down for
        // everyone else (ADR 0011: the server keeps running regardless).
        let message: ClientMessage;
        try {
          message = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          return;
        }
        if (message.type === "ping" && typeof message.clientTimeMs === "number") {
          // Transport echo for the client's clock sync (ADR 0019). No server state.
          send(socket, { type: "pong", clientTimeMs: message.clientTimeMs, serverTimeMs: performance.now() });
          return;
        }
        if (message.type === "input" && Array.isArray(message.inputs)) {
          rt.inputs.receive(id, message.inputs);
          return;
        }
        if (message.type === "sync") {
          // A late-attached listener asking for the current state (ADR
          // 0057) — the next tick pushes whether or not anything changed.
          rt.snapshotDirty = true;
          return;
        }

        // Lobby interactions (M4 ticket 07, ADR 0040) — nickname/ready/Track
        // pick/start/return, all travelling this same socket, no second
        // transport. Every gate they enforce lives in `match/lobby.ts`.
        if (handleLobbyMessage(rt, id, message)) return;
      });

      socket.on("close", () => {
        // Leaving *while the Round is being raced* is a DNF (M4 ticket 05).
        // Not during the Countdown — nobody has raced yet — and not during
        // ROUND_END/RESULTS, where this Player's result is already decided
        // and a DNF would overwrite a Qualification they earned. Captured
        // before `lobbyPlayers.delete` below removes the only place this
        // nickname lives — the Results screen (ticket 08) has nothing else
        // to call this Player once their Character is gone.
        //
        // Never for a mid-Match spectator (M7 ticket 08): they never raced,
        // so there is nothing to record — and no body to eliminate or
        // remove below, since none was ever seated for them.
        const spectating = rt.spectators.has(id);
        const midRound = rt.match.phase === "RUNNING";
        if (midRound && !spectating && !rt.dnf.some((entry) => entry.id === id)) {
          const row = rt.lobbyPlayers.get(id);
          rt.dnf.push({ id, nickname: row?.nickname ?? "Player", accountId: row?.accountId ?? null });
        }
        rt.sockets.delete(id);
        rt.inputs.remove(id);
        rt.lobbyPlayers.delete(id);
        rt.spectators.delete(id);
        // A mid-Round disconnect is eliminated, not removed (M5 ticket 04,
        // ADR 0042) — pulling a rigid body out of the world mid-Round would
        // disturb contact resolution for everyone still racing. Outside
        // RUNNING nobody else is relying on this Character's body for
        // anything, so a plain removal is still correct and cheaper.
        if (!spectating && midRound) rt.simulation.eliminateCharacter(id);
        else if (!spectating) rt.simulation.removeCharacter(id);
      });
    })();
  });

  // ADR 0059: a finished server closes itself — everyone left for the
  // results page, or the straggler grace ran out. `closeServer` below is only
  // *called* from a later tick, so referencing it here is safe.
  const interval = startMatchLoop(rt, { onTerminalClose: () => void closeServer() });

  const port =
    config.portRange !== undefined
      ? await listenFirstFree(httpServer, config.portRange.min, config.portRange.max)
      : await new Promise<number>((resolve, reject) => {
          httpServer.once("listening", () => {
            const address = httpServer.address();
            resolve(typeof address === "object" && address ? address.port : (config.port ?? DEFAULT_SERVER_PORT));
          });
          httpServer.once("error", reject); // e.g. EADDRINUSE — reject instead of hanging forever
          httpServer.listen(config.port ?? DEFAULT_SERVER_PORT);
        });
  binding = false;

  const closeServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // M7 ticket 05: stop any in-flight `buildMatchStructure` from
      // continuing to draw against the API for a Match nothing is
      // listening to anymore — see `MatchRuntime.closed`'s own doc.
      rt.closed = true;
      clearInterval(interval);
      for (const socket of rt.sockets.values()) socket.close();
      // `wss` was created with `{ server: httpServer }` — closing it only
      // stops the WebSocket layer, never the HTTP server underneath it
      // (`ws`'s own documented behavior for an externally-owned server).
      // Both need closing; the callback that resolves/rejects this promise
      // waits on the HTTP server, the one actually holding the port.
      wss.close();
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });

  return { port, close: closeServer };
};

import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_TRACK_SERVICE_PORT,
  GRACE_WINDOW_MS,
  IDLE_INPUTS,
  MODULE_LIBRARY,
  NICKNAME_MAX_LENGTH,
  RapierSimulation,
  SNAPSHOT_HZ,
  TICK_MS,
  DEFAULT_TIME_LIMIT_MS,
  COUNTDOWN_MS,
  ROUND_END_MS,
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
  resolveTrack,
  roundTimeLeftMs,
  trackSpawn,
  type ClientMessage,
  type FallBehavior,
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

export interface StartServerConfig {
  /** Port to listen on. `0` asks the OS for an ephemeral port. Defaults to {@link DEFAULT_SERVER_PORT}. */
  port?: number;
  /** track-service base URL (ADR 0028). Defaults to `TRACK_SERVICE_URL` env, then localhost:{@link DEFAULT_TRACK_SERVICE_PORT}. */
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
   * How long the Countdown holds before a Round is released (M4 ticket 04).
   * Defaults to {@link COUNTDOWN_MS}. A test-only knob, like the track-fetch
   * timings above — it lets a test put this server into a running Round
   * without waiting out three real seconds.
   */
  countdownMs?: number;
  /** How long ROUND_END holds before RESULTS (M4 ticket 05). Defaults to {@link ROUND_END_MS}. Test-only, like `countdownMs`. */
  roundEndMs?: number;
  /**
   * Ignore the Revision's authored Time Limit and use this instead. Test-only
   * (ADR 0038 is explicit that the clock belongs to the Track): track-service
   * enforces a floor of ten seconds on a published Revision, which is far too
   * long to wait out in a test of what happens when the clock expires.
   */
  timeLimitMsOverride?: number;
  /**
   * Force this Round's `RoundRules.fallBehavior` (M5 ticket 05). Test-only,
   * standing in for the Lobby's own Round-type picker (ticket 07) — until
   * that exists, a Round-level override with no live source is exactly what
   * a test needs to exercise Survival's own endings server-side at all.
   */
  fallBehaviorOverride?: FallBehavior;
  /** Force this Round's `RoundRules.survivorTarget` (M5 ticket 05). Same reasoning and same test-only status as `fallBehaviorOverride`. */
  survivorTargetOverride?: number;
}

export const startServer = async (config: StartServerConfig = {}): Promise<MatchServer> => {
  await initPhysics();

  // ADR 0028: the Match server never holds Module data or generates a Track
  // itself — it always just fetches one, resolved against every Module the
  // shared package currently knows (`MODULE_LIBRARY`).
  const trackServiceUrl =
    config.trackServiceUrl ?? process.env.TRACK_SERVICE_URL ?? `http://localhost:${DEFAULT_TRACK_SERVICE_PORT}`;
  // Ticket 12's test-only knobs, shared by every `fetchTrack` call this
  // server ever makes — the boot-time one below, and a Playtest connection's
  // live reload (further down) — so a test can bound both the same way.
  const countdownMs = config.countdownMs ?? COUNTDOWN_MS;
  const roundEndMs = config.roundEndMs ?? ROUND_END_MS;
  const envPlayersToStart = Number(process.env.PLAYERS_TO_START);
  const playersToStart =
    config.playersToStart ?? (Number.isInteger(envPlayersToStart) && envPlayersToStart > 0 ? envPlayersToStart : PLAYERS_TO_START);
  const trackFetchRetryOptions = {
    ...(config.trackFetchMaxWaitMs !== undefined ? { maxWaitMs: config.trackFetchMaxWaitMs } : {}),
    ...(config.trackFetchRetryDelayMs !== undefined ? { retryDelayMs: config.trackFetchRetryDelayMs } : {}),
    ...(config.trackFetchAttemptTimeoutMs !== undefined ? { attemptTimeoutMs: config.trackFetchAttemptTimeoutMs } : {}),
  };
  // `let`, not `const`: a Playtest connection's `?track=` (below) can replace
  // both with a freshly-fetched/rebuilt Track+simulation while the server is
  // The Track this server boots on. From here it lives on the runtime, which a
  // Playtest `?track=` reload or a Lobby Track pick can replace while running.
  const bootTrack = await fetchTrack(trackServiceUrl, trackFetchRetryOptions);
  const rt = new MatchRuntime(
    {
      trackServiceUrl,
      trackFetchRetryOptions,
      countdownMs,
      roundEndMs,
      playersToStart,
      ...(config.timeLimitMsOverride !== undefined ? { timeLimitMsOverride: config.timeLimitMsOverride } : {}),
      ...(config.fallBehaviorOverride !== undefined ? { fallBehaviorOverride: config.fallBehaviorOverride } : {}),
      ...(config.survivorTargetOverride !== undefined ? { survivorTargetOverride: config.survivorTargetOverride } : {}),
    },
    bootTrack,
  );

  const wss = new WebSocketServer({ port: config.port ?? DEFAULT_SERVER_PORT });

  wss.on("connection", (socket, req) => {
    void (async () => {
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

      // No mid-Round join, and so no mid-Round *re*join (M4 ticket 05):
      // dropping a fresh Character into a Race already in progress is neither
      // fair to them nor to the people racing. Refused with a reason the
      // client can show, the same way a Playtest Track clash is.
      //
      // Gated on someone actually being here, not on the phase alone: the
      // return to LOBBY is decided by the tick loop, so between the last
      // Player leaving and the next tick there is a window where the phase
      // still reads RESULTS with nobody in it, and a Round with no Players in
      // it is not a Round to protect.
      //
      // This does not (and should not) make a reload *during* a Round work:
      // the server may not have processed the old socket's close yet, and
      // even once it has, that is exactly the mid-Round rejoin this ticket
      // exists to refuse. Whoever left is a DNF; they come back for the next
      // Round.
      if (rt.sockets.size > 0 && rt.match.phase !== "LOBBY" && rt.match.phase !== "COUNTDOWN") {
        socket.close(4002, truncateForCloseReason("a Round is already under way — wait for it to finish"));
        return;
      }

      const id = randomUUID();
      // Spawn in the loaded Track's own start frame (free placement puts the
      // start platform anywhere) — never M1's world coords (playtest bug, 2026-09).
      const spawn = trackSpawn(rt.fetched.track, rt.joinCount);
      const joinOrder = rt.joinCount;
      rt.joinCount += 1;
      rt.sockets.set(id, socket);
      rt.inputs.add(id);
      // The host is the first joiner (M4 ticket 07, ADR 0040) — `joinOrder`
      // is what `resolveHostId` reads to decide that, recomputed from
      // whoever is still connected rather than stored.
      rt.lobbyPlayers.set(id, { id, nickname: "Player", ready: false, joinOrder });
      rt.simulation.addCharacter(id, spawn);

      send(socket, {
        type: "welcome",
        playerId: id,
        // A bearer credential the client presents on reconnect (ADR 0024). M2
        // issues it; no reconnect logic acts on it yet.
        sessionToken: randomBytes(32).toString("base64url"),
        spawn,
        trackId: rt.fetched.id,
        trackRevision: rt.fetched.revision,
        // Read off the runtime, not the local that seeded it: one name for
        // the threshold at the point it goes on the wire, so a future
        // runtime-adjustable value cannot leave the welcome advertising a
        // number the tick loop no longer uses.
        config: { snapshotHz: SNAPSHOT_HZ, graceWindowMs: GRACE_WINDOW_MS, playersToStart: rt.config.playersToStart },
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
        const midRound = rt.match.phase === "RUNNING";
        if (midRound && !rt.dnf.some((entry) => entry.id === id)) {
          rt.dnf.push({ id, nickname: rt.lobbyPlayers.get(id)?.nickname ?? "Player" });
        }
        rt.sockets.delete(id);
        rt.inputs.remove(id);
        rt.lobbyPlayers.delete(id);
        // A mid-Round disconnect is eliminated, not removed (M5 ticket 04,
        // ADR 0042) — pulling a rigid body out of the world mid-Round would
        // disturb contact resolution for everyone still racing. Outside
        // RUNNING nobody else is relying on this Character's body for
        // anything, so a plain removal is still correct and cheaper.
        if (midRound) rt.simulation.eliminateCharacter(id);
        else rt.simulation.removeCharacter(id);
      });
    })();
  });

  const interval = startMatchLoop(rt);

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject); // e.g. EADDRINUSE — reject instead of hanging forever
  });
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : (config.port ?? DEFAULT_SERVER_PORT);

  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(interval);
        for (const socket of rt.sockets.values()) socket.close();
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};

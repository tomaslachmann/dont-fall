import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
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
  type LobbyPlayer,
  type MatchState,
  type ServerMessage,
  type SimInputs,
  type Track,
} from "@dont-fall/shared";
import { WebSocketServer, type WebSocket } from "ws";

export interface FetchedTrack {
  id: string;
  revision: number;
  track: Track;
  /** The Time Limit published with this Revision (M4 ticket 03, ADR 0038). */
  timeLimitMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a fully-resolved Track from track-service (ADR 0028) — the Match
 * server never holds Module data or generates a Track itself, whether it's
 * hand-built or randomly assembled makes no difference here. `id`/`revision`
 * are carried into every client's `welcome` (ticket 11) so a client fetches
 * this *exact* Revision, never "latest" independently — a publish landing
 * mid-Match could otherwise desync a client from what the server is running.
 *
 * Retries with backoff (ticket 12) — track-service may still be starting up
 * (e.g. Docker container ordering isn't instant); a single-shot fetch failing
 * on that transient race isn't the same problem as track-service being
 * genuinely gone. Still fails loudly (and unmasked) once the budget runs out.
 * Each attempt itself is bounded ({@link TRACK_FETCH_ATTEMPT_TIMEOUT_MS}) —
 * without that, a single hung request (track-service accepts the connection
 * but never responds) could block past the whole retry budget instead of
 * being abandoned and retried.
 *
 * `trackId`, when given, fetches that exact id's latest Revision (`GET
 * /tracks/:id`) instead of a random one (`GET /tracks/any`) — the Track
 * Builder's Playtest button (a connecting client's own `?track=` query
 * param, see {@link startServer}) is the only caller that ever passes this;
 * the normal boot-time fetch never does.
 */
const fetchTrack = async (
  trackServiceUrl: string,
  {
    maxWaitMs = TRACK_FETCH_MAX_WAIT_MS,
    retryDelayMs = TRACK_FETCH_RETRY_DELAY_MS,
    attemptTimeoutMs = TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
    trackId,
  }: { maxWaitMs?: number; retryDelayMs?: number; attemptTimeoutMs?: number; trackId?: string } = {},
): Promise<FetchedTrack> => {
  const path = trackId !== undefined ? `/tracks/${encodeURIComponent(trackId)}` : "/tracks/any";
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  let lastError: unknown;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${trackServiceUrl}${path}`, { signal: AbortSignal.timeout(attemptTimeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { id: string; revision: number; track: Track; timeLimitMs?: number };
      if (attempt > 1) console.log(`DON'T FALL: track-service reachable after ${attempt} attempts`);
      return {
        id: body.id,
        revision: body.revision,
        track: body.track,
        // Defaulted rather than required, so a track-service that predates
        // the column (ADR 0038's own backfill hasn't run yet) still yields a
        // playable Round rather than a Match server that won't start.
        timeLimitMs: body.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
      };
    } catch (err) {
      lastError = err;
      console.warn(`DON'T FALL: track-service fetch attempt ${attempt} failed, retrying: ${(err as Error).message}`);
      await sleep(retryDelayMs);
    }
  }
  throw new Error(
    `track-service unreachable or has no Track at ${trackServiceUrl} after ${attempt} attempts (ADR 0028): ${(lastError as Error)?.message}`,
  );
};

/**
 * A WebSocket close reason is capped at 123 UTF-8 bytes (RFC 6455) — `ws`
 * throws if handed more. Truncating defensively here means a future longer
 * message (a longer trackId, a longer underlying fetch error) degrades
 * gracefully instead of crashing the connection handler outright.
 */
const CLOSE_REASON_MAX_BYTES = 123;
const truncateForCloseReason = (reason: string): string => {
  // Pops whole Unicode code points, not UTF-16 code units (code review) —
  // `.slice(0, -1)` on the raw string can cut a surrogate pair in half,
  // turning a multi-byte character right at the boundary into a lone
  // surrogate that re-encodes as U+FFFD instead of truncating cleanly.
  const codePoints = Array.from(reason);
  while (Buffer.byteLength(codePoints.join(""), "utf8") > CLOSE_REASON_MAX_BYTES) codePoints.pop();
  return codePoints.join("");
};

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
}

/**
 * Send to one client, swallowing any failure. A socket can drop between a
 * `readyState` check and the write, and `ws` then throws synchronously or emits
 * `'error'` — neither may escape the tick loop or the connection handler and
 * take the Match down for everyone else (ADR 0011). The `'close'` handler does
 * the cleanup regardless.
 */
const trySend = (socket: WebSocket, payload: string): void => {
  try {
    socket.send(payload);
  } catch {
    // dropped mid-write — 'close' will clean up
  }
};

const send = (socket: WebSocket, message: ServerMessage): void => {
  trySend(socket, JSON.stringify(message));
};

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
  /**
   * This Round's Time Limit — the Revision's own (ADR 0038), unless a test
   * has overridden it. A function, not a captured value: a Playtest reload
   * replaces `fetched` with a different Track carrying a different clock.
   */
  const roundTimeLimitMs = (): number => config.timeLimitMsOverride ?? fetched.timeLimitMs;
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
  // already running — the one thing that never used to change after boot.
  let fetched = await fetchTrack(trackServiceUrl, trackFetchRetryOptions);
  const resolveForSimulation = (track: Track) => resolveTrack(MODULE_LIBRARY, track);

  /**
   * Every connected Player as the Lobby sees them (M4 ticket 07, ADR 0040) —
   * nickname, Ready, and the join order that decides who the host is
   * (`resolveHostId`, recomputed, never stored). Kept in step with `sockets`
   * one-for-one: populated in the same place a connection registers itself,
   * deleted in the same place `'close'` cleans everything else up.
   */
  const lobbyPlayers = new Map<string, LobbyPlayer>();

  /**
   * Builds a fresh simulation for `track` and re-seats every currently
   * connected Player into it at a spawn for their own join order (M4 ticket
   * 07) — the one thing the original boot-time-only reload (below, and
   * Track Builder's own Playtest `?track=`) never had to do, since it only
   * ever ran with `sockets.size === 0`. A Lobby's host picking a different
   * Track can do this with others already sitting in it; nobody's
   * Character should vanish just because the world under it changed.
   */
  const rebuildSimulationFor = (track: Track): RapierSimulation => {
    const next = new RapierSimulation({ ...resolveForSimulation(track), withDefaultCharacter: false });
    for (const [playerId, player] of lobbyPlayers) {
      next.addCharacter(playerId, trackSpawn(track, player.joinOrder));
    }
    return next;
  };

  /**
   * The one reset every "start a fresh Round on `track`" transition shares —
   * the connect-time `?track=` reload, a live Lobby `selectTrack`, and M4
   * ticket 08's return from Results: swap in a freshly-built simulation and
   * restart the tick/phase bookkeeping it depends on.
   *
   * Built before the old world is discarded, and only swapped in once it
   * exists (`rebuildSimulationFor` can throw — an unknown Module id in a
   * Track published against a newer library) — disposing first would leave
   * this server holding a freed Rapier world for every subsequent tick.
   *
   * `serverTick` restarts with the new simulation's own tick counter (ADR
   * 0027), or every subsequent input — stamped from the client's *new*
   * `state.tick`, always small — reads as permanently stale against the old,
   * much larger `serverTick`: every queued input discarded before it can
   * ever match `thisTick`, and the resulting `lastInputTick` ack (now way
   * ahead of what the client sent) makes the client think everything it sent
   * already got applied. No one can move, for the rest of this process's
   * life, not just this Track.
   *
   * Callers still own anything specific to their own trigger — which Track
   * `fetched` now points at, clearing `dnf`, resetting Ready.
   *
   * Also clears `startRequested` — a live `selectTrack`'s own `await` leaves
   * a window where a `start` sent right behind it can be validated and
   * queued against the *old* Lobby before this reset lands, then get spent
   * by the tick loop right after, starting a Round on the just-swapped-away
   * Track instead of the one the request actually named.
   */
  const resetToFreshLobby = (track: Track): void => {
    const nextSimulation = rebuildSimulationFor(track);
    simulation.dispose();
    simulation = nextSimulation;
    serverTick = 0;
    roundStartTick = 0;
    match = { phase: "LOBBY", phaseStartTick: 0 };
    startRequested = false;
  };

  // The Match starts with no players; ticket 01's single-player default
  // Character is opted out here rather than added and immediately disposed.
  let simulation = rebuildSimulationFor(fetched.track);

  const sockets = new Map<string, WebSocket>();
  // The server's own monotonic tick — advances by exactly one every interval,
  // unconditionally, from before any client connects. ADR 0027: each tick, the
  // server applies the queued input *stamped for that tick number*
  // (`tick === serverTick`), not just the next thing FIFO in the queue —
  // "steps == inputs consumed by tick number" holds by construction, closing
  // the systematic bias a starved queue used to introduce (the server kept
  // stepping physics every interval regardless, so its position for tick N
  // used to run ahead of what the client had actually predicted for N).
  let serverTick = 0;
  /**
   * The Tick this Round's clock counts from (M4 ticket 03, ADR 0038) — set by
   * the COUNTDOWN → RUNNING transition and nothing else (M4 ticket 04), so a
   * Round's Time Limit starts when the Round does rather than when the server
   * did. Until then the clock reads its full authored value.
   */
  let roundStartTick = 0;
  /**
   * The authoritative Match phase (ADR 0040) — the server owns every
   * transition and clients only render what rides the snapshot.
   */
  let match: MatchState = { phase: "LOBBY", phaseStartTick: 0 };
  /**
   * Players who dropped while the Round was being raced (M4 ticket 05) — a
   * DNF, distinct from being Eliminated, which is simply "still here and
   * never Qualified" and needs no record of its own. Their Characters are
   * gone from the world, so this is the only thing left that remembers they
   * were in this Round at all; the Results screen (ticket 08) is who reads it.
   * Cleared when the next Round's Countdown begins.
   */
  let dnf: { id: string; nickname: string }[] = [];
  /**
   * Whether the host's `start` has been validated (enough Players connected,
   * everyone Ready) and is waiting for the tick loop to hand it to
   * `advanceMatchPhase` (M4 ticket 07). Validated once, at the message
   * handler, not re-checked here — this is a one-shot edge, spent on the
   * very next tick whether or not it actually caused a transition (e.g. if
   * every Player left in the same instant it was set), so a stale request
   * can never cause a spurious Countdown for whoever connects next.
   */
  let startRequested = false;
  /**
   * Bumped on every `selectTrack` request, so a stale one resolving after a
   * newer one (ordinary network jitter — the host clicked twice in quick
   * succession) can tell it's been superseded and applies nothing, instead
   * of two requests racing to be the one that "wins" by finishing last.
   */
  let selectTrackSeq = 0;
  /**
   * Whether the host's request to return to the Lobby from Results has been
   * validated and is waiting for the tick loop to hand it to
   * `advanceMatchPhase` (M4 ticket 08) — same one-shot-edge contract as
   * `startRequested`.
   */
  let returnToLobbyRequested = false;
  /**
   * Whether this Round has met either of its endings, as of the last Tick
   * simulated (M4 ticket 05). Read one Tick later, by the phase decision at
   * the top of the loop — a Tick's lag on ending a Round nobody can perceive,
   * in exchange for the phase still being decided before anything is
   * simulated, exactly as ticket 04 left it.
   */
  let roundEnding = { allQualified: false, timeExpired: false };
  /**
   * What the Round clock read when the Round ended (M4 ticket 05) — 0 if the
   * clock ran out, whatever was left if everyone Qualified first. Held so the
   * clock *stops* at round end instead of either springing back to the full
   * Limit or carrying on counting into the Results.
   */
  let finalTimeLeftMs = 0;
  // A short per-client queue absorbs network jitter and reordering;
  // `lastApplied` fills a tick a client's packet hasn't arrived for yet, and
  // `lastInputTick` — the server tick actually simulated, whether a real input
  // matched it or `lastApplied` repeated — is echoed in the snapshot as the
  // reconciliation acknowledgement (ADR 0013), honestly, so the client
  // replays exactly the inputs the server hasn't processed yet.
  const inputQueues = new Map<string, { tick: number; input: SimInputs }[]>();
  const lastApplied = new Map<string, SimInputs>();
  const lastInputTicks = new Map<string, number>();
  // A fast/hitching client can briefly outrun the tick rate; keep only the
  // newest few so the server never falls a growing number of ticks behind a
  // client's intent.
  const MAX_QUEUED_INPUTS = 6;
  // Monotonic across the process so each joiner gets a distinct spawn slot even
  // as others leave — two solid Characters must never spawn on the same spot.
  let joinCount = 0;

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

        const alreadyLoaded = candidate.id === fetched.id && candidate.revision === fetched.revision;
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
          if (sockets.size > 0) {
            // Refuse rather than silently swap the Track under already-connected
            // players' feet — this server has no concept of separate concurrent
            // Matches yet (that's M4's job), so "reload" can only ever mean
            // "reload for everyone," which is only ever safe with no one here.
            socket.close(4001, truncateForCloseReason(`server already has ${sockets.size} player(s) connected on a different Track — restart to test a new one`));
            return;
          }
          // Everything from here to the end of this `if` is synchronous (no
          // `await`) — the event loop cannot run another 'connection' handler
          // in between, so this whole reload is effectively atomic with
          // respect to the `sockets.size` check just above. `sockets.size
          // === 0` was just checked above, so `resetToFreshLobby`'s own
          // re-seating of every connected Player is a no-op here — this path
          // only ever reloads with nobody in it yet.
          fetched = candidate;
          resetToFreshLobby(candidate.track);
          console.log(`DON'T FALL: reloaded Track "${fetched.id}"@${fetched.revision} for a Playtest connection`);
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
      if (sockets.size > 0 && match.phase !== "LOBBY" && match.phase !== "COUNTDOWN") {
        socket.close(4002, truncateForCloseReason("a Round is already under way — wait for it to finish"));
        return;
      }

      const id = randomUUID();
      // Spawn in the loaded Track's own start frame (free placement puts the
      // start platform anywhere) — never M1's world coords (playtest bug, 2026-09).
      const spawn = trackSpawn(fetched.track, joinCount);
      const joinOrder = joinCount;
      joinCount += 1;
      sockets.set(id, socket);
      inputQueues.set(id, []);
      lastApplied.set(id, IDLE_INPUTS);
      lastInputTicks.set(id, 0);
      // The host is the first joiner (M4 ticket 07, ADR 0040) — `joinOrder`
      // is what `resolveHostId` reads to decide that, recomputed from
      // whoever is still connected rather than stored.
      lobbyPlayers.set(id, { id, nickname: "Player", ready: false, joinOrder });
      simulation.addCharacter(id, spawn);

      send(socket, {
        type: "welcome",
        playerId: id,
        // A bearer credential the client presents on reconnect (ADR 0024). M2
        // issues it; no reconnect logic acts on it yet.
        sessionToken: randomBytes(32).toString("base64url"),
        spawn,
        trackId: fetched.id,
        trackRevision: fetched.revision,
        config: { snapshotHz: SNAPSHOT_HZ, graceWindowMs: GRACE_WINDOW_MS, playersToStart },
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
          const queue = inputQueues.get(id);
          if (!queue) return;
          // Each packet carries the current input plus a redundant tail of recent
          // ones (ADR 0021). Dedupe by tick against what's been applied and
          // what's already queued; a head-of-line burst or reorder loses nothing.
          for (const entry of message.inputs) {
            if (typeof entry?.tick !== "number" || !Number.isFinite(entry.tick)) continue;
            if (entry.tick <= (lastInputTicks.get(id) ?? 0)) continue;
            if (queue.some((q) => q.tick === entry.tick)) continue;
            queue.push({ tick: entry.tick, input: entry.input });
          }
          queue.sort((a, b) => a.tick - b.tick);
          while (queue.length > MAX_QUEUED_INPUTS) queue.shift();
          return;
        }

        // Lobby interactions (M4 ticket 07, ADR 0040) — nickname/ready/Track
        // pick/start, all travelling this same socket, no second transport.

        if (message.type === "setNickname" && typeof message.nickname === "string") {
          // A nickname is cosmetic, never a start gate — any connected Player
          // may send this at any time, in any phase. An empty result after
          // trimming leaves the existing nickname alone rather than blanking it.
          const trimmed = message.nickname.trim().slice(0, NICKNAME_MAX_LENGTH);
          const player = lobbyPlayers.get(id);
          if (player && trimmed.length > 0) player.nickname = trimmed;
          return;
        }

        if (message.type === "setReady" && typeof message.ready === "boolean") {
          // Only meaningful in LOBBY — there is no "getting un-ready" mid-Round,
          // and honoring it there would just be silently ignored by the start
          // gate anyway, so it's simplest to only apply it here at all.
          if (match.phase !== "LOBBY") return;
          const player = lobbyPlayers.get(id);
          if (player) player.ready = message.ready;
          return;
        }

        if (message.type === "selectTrack" && typeof message.trackId === "string") {
          // Host-only and LOBBY-only, enforced by the server, not by which
          // client happens to send it (ADR 0040). Checked again after the
          // `await` below, for the identical reason the connect-time reload
          // re-checks `sockets.size` after its own fetch: the world can move
          // on while this is in flight.
          if (match.phase !== "LOBBY" || resolveHostId([...lobbyPlayers.values()]) !== id) return;
          const requestedTrackId = message.trackId;
          const seq = ++selectTrackSeq;
          void (async () => {
            let candidate: FetchedTrack;
            try {
              candidate = await fetchTrack(trackServiceUrl, { ...trackFetchRetryOptions, trackId: requestedTrackId });
            } catch (err) {
              console.warn(`DON'T FALL: Lobby selectTrack failed to load Track "${requestedTrackId}": ${(err as Error).message}`);
              return;
            }
            if (
              seq !== selectTrackSeq ||
              match.phase !== "LOBBY" ||
              !sockets.has(id) ||
              resolveHostId([...lobbyPlayers.values()]) !== id
            ) {
              // Superseded by a newer pick, or the Lobby moved on (Round
              // started, this sender left, host changed) while the fetch
              // was in flight.
              return;
            }
            const alreadyLoaded = candidate.id === fetched.id && candidate.revision === fetched.revision;
            if (alreadyLoaded) return;
            fetched = candidate;
            resetToFreshLobby(candidate.track);
            console.log(`DON'T FALL: Lobby selected Track "${fetched.id}"@${fetched.revision}`);
          })();
          return;
        }

        if (message.type === "start") {
          // Enforced here, not by whichever client happens to click: host
          // only, LOBBY only, enough Players, everyone Ready (ADR 0040). A
          // request that fails any of these is simply ignored — the host's
          // own UI is what keeps a non-host from ever sending this for real,
          // so a client that sends it anyway gets no error, just silence.
          if (match.phase !== "LOBBY") return;
          const players = [...lobbyPlayers.values()];
          if (resolveHostId(players) !== id) return;
          if (sockets.size < playersToStart) return;
          if (!allReady(players)) return;
          startRequested = true;
          return;
        }

        if (message.type === "returnToLobby") {
          // Host-only, RESULTS-only, same discipline as `start` (M4 ticket
          // 08): there is no auto-rematch timer, so nothing else is allowed
          // to move the Match out of RESULTS.
          if (match.phase !== "RESULTS") return;
          if (resolveHostId([...lobbyPlayers.values()]) !== id) return;
          returnToLobbyRequested = true;
          return;
        }
      });

      socket.on("close", () => {
        // Leaving *while the Round is being raced* is a DNF (M4 ticket 05).
        // Not during the Countdown — nobody has raced yet — and not during
        // ROUND_END/RESULTS, where this Player's result is already decided
        // and a DNF would overwrite a Qualification they earned. Captured
        // before `lobbyPlayers.delete` below removes the only place this
        // nickname lives — the Results screen (ticket 08) has nothing else
        // to call this Player once their Character is gone.
        if (match.phase === "RUNNING" && !dnf.some((entry) => entry.id === id)) {
          dnf.push({ id, nickname: lobbyPlayers.get(id)?.nickname ?? "Player" });
        }
        sockets.delete(id);
        inputQueues.delete(id);
        lastApplied.delete(id);
        lastInputTicks.delete(id);
        lobbyPlayers.delete(id);
        simulation.removeCharacter(id);
      });
    })();
  });

  let consecutiveTickFailures = 0;
  // Snapshot rate is decoupled from the tick rate (ADR 0020): the sim steps
  // every tick, but a snapshot goes out only every `1000 / SNAPSHOT_HZ` ms of
  // simulated time. At M2's 30/30 that is every tick; the accumulator lets the
  // 12-player path drop to 20 Hz later with no other change.
  const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;
  let snapshotAccumulatorMs = 0;
  const interval = setInterval(() => {
    // The Match loop must survive a bad tick (a physics edge case, a NaN) —
    // one hiccup crashing the process would drop every connected player. Log
    // and carry on; the next tick usually recovers (ADR 0011).
    // The tick about to be simulated — NOT yet committed to `serverTick`.
    // `RapierSimulation.tick()` only advances its own `tickCount` (echoed as
    // `state.tick`, and what the client's tick numbering is seeded/synced
    // against) after `world.step()` succeeds. If it throws below, `serverTick`
    // must stay right where it is so the next interval retries this exact
    // same tick number — advancing it unconditionally here would leave
    // `serverTick` permanently ahead of `state.tick` after just one failed
    // tick, silently breaking "physics steps == inputs applied by tick
    // number" (ADR 0027) for the rest of the Match.
    const thisTick = serverTick + 1;
    try {
      // Decided before anything is simulated, and committed below only once
      // the tick has actually succeeded — the same discipline `serverTick`
      // itself follows, so a failed tick retries this exact decision rather
      // than advancing the Match past a Tick that never ran.
      const nextMatch = advanceMatchPhase(match, {
        tick: thisTick,
        connectedPlayers: sockets.size,
        startRequested,
        countdownMs,
        roundEndMs,
        allQualified: roundEnding.allQualified,
        timeExpired: roundEnding.timeExpired,
        returnToLobbyRequested,
      });
      // A one-shot edge, spent the instant this tick reads it whether or not
      // it actually caused a transition — otherwise a request left stale by
      // (say) everyone leaving in the same instant it fired could cause a
      // spurious Countdown the moment anyone next connects.
      startRequested = false;
      returnToLobbyRequested = false;
      // Input is locked in every phase but RUNNING (ADR 0040). Enforced here
      // rather than by refusing the packet: the client runs the same rule on
      // its own prediction, so both sides stop and start driving the
      // Character on the identical Tick, and a client that ignores the rule
      // simply has its input replaced.
      const inputLocked = phaseLocksInput(nextMatch.phase);
      const tickInputs: Record<string, SimInputs> = {};
      for (const id of sockets.keys()) {
        const queue = inputQueues.get(id);
        if (queue) {
          const idx = queue.findIndex((q) => q.tick === thisTick);
          if (idx >= 0) {
            lastApplied.set(id, queue[idx]!.input);
            queue.splice(0, idx + 1); // consumed, plus anything older that's now moot
          } else {
            while (queue.length && queue[0]!.tick < thisTick) queue.shift(); // stale — never coming
          }
        }
        // Honest ack: the tick actually simulated for this client, whether a
        // real input matched it or `lastApplied` repeated — never left behind
        // at the last tick a *distinct* input happened to land on.
        lastInputTicks.set(id, thisTick);
        // The ack bookkeeping above stays honest whatever the phase — the
        // client is still reconciling against these Ticks — only the input
        // actually simulated is replaced.
        tickInputs[id] = inputLocked ? IDLE_INPUTS : (lastApplied.get(id) ?? IDLE_INPUTS);
      }

      simulation.tick(tickInputs);
      serverTick = thisTick;
      // The Round's clock starts the Tick the Countdown ends, not when the
      // server did (M4 ticket 03's anchor, now owned by this transition).
      if (nextMatch.phase === "RUNNING" && match.phase !== "RUNNING") roundStartTick = thisTick;
      // A fresh Countdown is a fresh Round: last Round's DNFs are not this
      // Round's (M4 ticket 05).
      if (nextMatch.phase === "COUNTDOWN" && match.phase !== "COUNTDOWN") dnf = [];
      if (nextMatch.phase === "LOBBY" && match.phase === "RESULTS") {
        // Going again (M4 ticket 08): everyone still connected gets a fresh
        // Round on the same Track, re-seated at their spawn slot. A genuinely
        // fresh Lobby, not a resumed one: last Round's DNFs are not this
        // Round's (same reasoning as the Countdown-triggered clear above),
        // and everyone's Ready goes back to false — otherwise a Lobby the
        // host returns to would start itself the instant it existed, since
        // both Players necessarily left the last Round Ready.
        resetToFreshLobby(fetched.track);
        dnf = [];
        for (const player of lobbyPlayers.values()) player.ready = false;
      } else {
        match = nextMatch;
      }
      consecutiveTickFailures = 0;

      // Built every tick, not just when a snapshot goes out: the Round's own
      // endings are read off it, and they should not be noticed only as often
      // as the snapshot rate happens to be (ADR 0020 decouples the two).
      const state = simulation.snapshot();
      for (const [id, character] of Object.entries(state.characters)) {
        character.lastInputTick = lastInputTicks.get(id) ?? 0;
      }

      // Before the Round is RUNNING none of its clock has been spent, so it
      // reads its full authored value rather than counting down in the Lobby.
      const timeLimitMs = roundTimeLimitMs();
      // Before a Round the clock reads its full authored value; during one it
      // counts down; after one it stops where it stopped.
      let timeLeftMs: number;
      if (match.phase === "RUNNING") {
        timeLeftMs = roundTimeLeftMs(timeLimitMs, serverTick - roundStartTick);
        finalTimeLeftMs = timeLeftMs;
      } else if (match.phase === "ROUND_END" || match.phase === "RESULTS") {
        timeLeftMs = finalTimeLeftMs;
      } else {
        timeLeftMs = timeLimitMs;
      }
      // Both endings, decided by the server from state it already owns (ADR
      // 0040) — whichever happens first ends the Round.
      roundEnding = {
        allQualified: allQualified(state.characters),
        timeExpired: match.phase === "RUNNING" && timeLeftMs === 0,
      };

      snapshotAccumulatorMs += TICK_MS;
      if (snapshotAccumulatorMs < SNAPSHOT_INTERVAL_MS) return;
      snapshotAccumulatorMs -= SNAPSHOT_INTERVAL_MS;
      // Per-client payload: `serverTimeMs` is the same for all, `commandQueueDepth`
      // is this client's own un-applied input backlog (feeds its LEAD, ADR 0021).
      // One `JSON.stringify` per client — negligible at M2 scale, and the shape
      // binary + delta encoding will need anyway.
      const serverTimeMs = performance.now();
      const countdown = countdownMsLeft(match, serverTick, countdownMs);
      // Built once per snapshot, not once per client — every connected
      // client sees the identical Lobby (M4 ticket 07), and `hostId` is
      // recomputed from who's here now rather than stored anywhere.
      const lobbyPlayerList = [...lobbyPlayers.values()];
      const lobbySnapshot = { hostId: resolveHostId(lobbyPlayerList), players: lobbyPlayerList };
      for (const [id, socket] of sockets) {
        if (socket.readyState !== socket.OPEN) continue;
        trySend(
          socket,
          JSON.stringify({
            type: "snapshot",
            state,
            serverTimeMs,
            commandQueueDepth: inputQueues.get(id)?.length ?? 0,
            timeLeftMs,
            phase: match.phase,
            countdownMsLeft: countdown,
            dnf,
            trackId: fetched.id,
            trackRevision: fetched.revision,
            lobby: lobbySnapshot,
          } satisfies ServerMessage),
        );
      }
    } catch (err) {
      // Rate-limit the log: a persistently broken sim shouldn't spam 30×/s.
      if (consecutiveTickFailures % TICK_RATE_HZ === 0) {
        console.error(`DON'T FALL: tick failed (${consecutiveTickFailures + 1}), continuing`, err);
      }
      consecutiveTickFailures += 1;
    }
  }, TICK_MS);

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
        for (const socket of sockets.values()) socket.close();
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const server = await startServer();
  console.log(`DON'T FALL server listening on ws://localhost:${server.port}`);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      console.log(`DON'T FALL: received ${signal}, shutting down...`);

      try {
        await server.close();
        console.log("DON'T FALL: server stopped");
        process.exit(0);
      } catch (err) {
        console.error("DON'T FALL: shutdown failed", err);
        process.exit(1);
      }
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
}

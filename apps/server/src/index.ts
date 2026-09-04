import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_TRACK_SERVICE_PORT,
  GRACE_WINDOW_MS,
  IDLE_INPUTS,
  MODULE_LIBRARY,
  RapierSimulation,
  SNAPSHOT_HZ,
  TICK_MS,
  DEFAULT_TIME_LIMIT_MS,
  TICK_RATE_HZ,
  TRACK_FETCH_ATTEMPT_TIMEOUT_MS,
  TRACK_FETCH_MAX_WAIT_MS,
  TRACK_FETCH_RETRY_DELAY_MS,
  initPhysics,
  resolveTrack,
  roundTimeLeftMs,
  trackSpawn,
  type ClientMessage,
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

  // The Match starts with no players; ticket 01's single-player default
  // Character is opted out here rather than added and immediately disposed.
  let simulation = new RapierSimulation({ ...resolveForSimulation(fetched.track), withDefaultCharacter: false });

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
   * The Tick this Round's clock counts from (M4 ticket 03, ADR 0038).
   *
   * Anchored when the first player arrives at an empty server, so a Match
   * server that has been idle for an hour doesn't greet its first joiner with
   * an already-expired clock. That is a stand-in, and deliberately a
   * single variable: M4 ticket 04 gives the server a real Match phase, and
   * the RUNNING transition becomes the one thing that sets this.
   */
  let roundStartTick = 0;
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
          // respect to the `sockets.size` check just above.
          //
          // Built BEFORE the old world is discarded, and only swapped in once
          // it exists: `resolveForSimulation` can throw (an unknown Module id
          // in a Track published against a newer library), and disposing
          // first would leave this server holding a freed Rapier world —
          // every subsequent tick throwing, for every future connection,
          // rather than just this one Playtest attempt failing.
          const nextSimulation = new RapierSimulation({
            ...resolveForSimulation(candidate.track),
            withDefaultCharacter: false,
          });
          // The replaced `simulation`'s Rapier WASM `World` is native memory
          // the JS garbage collector never reclaims, so it is released
          // explicitly. (This used to be a documented leak: `RapierSimulation`
          // had no disposal lifecycle at all until M4 ticket 01 gave it one
          // for the client's own mount/unmount, which makes the fix here a
          // single call.) Safe at exactly this point: `sockets.size === 0`
          // was checked above, so no Character in this world is still in use.
          simulation.dispose();
          fetched = candidate;
          simulation = nextSimulation;
          // The new simulation's own tick counter restarts at 0 (ADR 0027) —
          // `serverTick` must restart with it, or every subsequent input
          // (stamped from the client's *new* `state.tick`, always small)
          // reads as permanently stale against the old, much larger
          // `serverTick`: every queued input gets discarded as stale before
          // it can ever match `thisTick`, and the resulting `lastInputTick`
          // ack — now way ahead of what the client sent — makes the client
          // think everything it sent already got applied. No one can move,
          // for the rest of this server process's life, not just this Track.
          serverTick = 0;
          // A reload is a new Round on a new Track, so its clock starts over
          // too — and `serverTick` has just been reset under it.
          roundStartTick = 0;
          console.log(`DON'T FALL: reloaded Track "${fetched.id}"@${fetched.revision} for a Playtest connection`);
        }
      }

      // First arrival at an empty server starts the Round's clock (see
      // `roundStartTick`). Checked before this socket is registered below.
      if (sockets.size === 0) roundStartTick = serverTick;

      const id = randomUUID();
      // Spawn in the loaded Track's own start frame (free placement puts the
      // start platform anywhere) — never M1's world coords (playtest bug, 2026-09).
      const spawn = trackSpawn(fetched.track, joinCount);
      joinCount += 1;
      sockets.set(id, socket);
      inputQueues.set(id, []);
      lastApplied.set(id, IDLE_INPUTS);
      lastInputTicks.set(id, 0);
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
        config: { snapshotHz: SNAPSHOT_HZ, graceWindowMs: GRACE_WINDOW_MS },
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
        }
      });

      socket.on("close", () => {
        sockets.delete(id);
        inputQueues.delete(id);
        lastApplied.delete(id);
        lastInputTicks.delete(id);
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
        tickInputs[id] = lastApplied.get(id) ?? IDLE_INPUTS;
      }

      simulation.tick(tickInputs);
      serverTick = thisTick;
      consecutiveTickFailures = 0;

      snapshotAccumulatorMs += TICK_MS;
      if (snapshotAccumulatorMs < SNAPSHOT_INTERVAL_MS) return;
      snapshotAccumulatorMs -= SNAPSHOT_INTERVAL_MS;

      const state = simulation.snapshot();
      for (const [id, character] of Object.entries(state.characters)) {
        character.lastInputTick = lastInputTicks.get(id) ?? 0;
      }
      // Per-client payload: `serverTimeMs` is the same for all, `commandQueueDepth`
      // is this client's own un-applied input backlog (feeds its LEAD, ADR 0021).
      // One `JSON.stringify` per client — negligible at M2 scale, and the shape
      // binary + delta encoding will need anyway.
      const serverTimeMs = performance.now();
      // Counted here, once per broadcast, so every client in this Round reads
      // the identical clock off the identical Tick (ADR 0038 — the client
      // never computes time remaining, it only renders this).
      const timeLeftMs = roundTimeLeftMs(fetched.timeLimitMs, serverTick - roundStartTick);
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

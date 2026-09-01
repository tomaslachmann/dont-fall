import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SERVER_PORT,
  GRACE_WINDOW_MS,
  IDLE_INPUTS,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  RapierSimulation,
  SNAPSHOT_HZ,
  TICK_MS,
  TICK_RATE_HZ,
  initPhysics,
  playgroundSpawn,
  type ClientMessage,
  type ServerMessage,
  type SimInputs,
} from "@dont-fall/shared";
import { WebSocketServer, type WebSocket } from "ws";

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

  // The Match starts with no players; ticket 01's single-player default
  // Character is opted out here rather than added and immediately disposed.
  const simulation = new RapierSimulation({
    statics: PLAYGROUND_STATICS,
    checkpoints: PLAYGROUND_CHECKPOINTS,
    spinners: PLAYGROUND_SPINNERS,
    props: PLAYGROUND_PROPS,
    withDefaultCharacter: false,
  });

  const sockets = new Map<string, WebSocket>();
  // One input per client is consumed per server tick (ticket 05): a short
  // per-client queue absorbs network jitter, `lastApplied` fills a tick a
  // client's packet hasn't arrived for, and `lastInputTick` — the tick number
  // of the input actually applied — is echoed in the snapshot as the
  // reconciliation acknowledgement so the client replays exactly the inputs
  // the server hasn't processed yet.
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

  wss.on("connection", (socket) => {
    const id = randomUUID();
    const spawn = playgroundSpawn(joinCount);
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
    try {
      const tickInputs: Record<string, SimInputs> = {};
      for (const id of sockets.keys()) {
        const next = inputQueues.get(id)?.shift();
        if (next) {
          lastApplied.set(id, next.input);
          lastInputTicks.set(id, next.tick);
        }
        tickInputs[id] = lastApplied.get(id) ?? IDLE_INPUTS;
      }

      simulation.tick(tickInputs);
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
      for (const [id, socket] of sockets) {
        if (socket.readyState !== socket.OPEN) continue;
        trySend(
          socket,
          JSON.stringify({
            type: "snapshot",
            state,
            serverTimeMs,
            commandQueueDepth: inputQueues.get(id)?.length ?? 0,
          } satisfies ServerMessage),
        );
      }
      consecutiveTickFailures = 0;
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

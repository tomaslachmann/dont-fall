import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SERVER_PORT,
  IDLE_INPUTS,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  RapierSimulation,
  TICK_MS,
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

const send = (socket: WebSocket, message: ServerMessage): void => {
  socket.send(JSON.stringify(message));
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

    send(socket, { type: "welcome", id, spawn });

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
      if (message.type === "input" && typeof message.tick === "number" && Number.isFinite(message.tick)) {
        const queue = inputQueues.get(id);
        if (!queue) return;
        // Drop anything not newer than what's been applied (a reordered or
        // duplicate frame) and keep the queue bounded.
        if (message.tick > (lastInputTicks.get(id) ?? 0)) {
          queue.push({ tick: message.tick, input: message.input });
          queue.sort((a, b) => a.tick - b.tick);
          while (queue.length > MAX_QUEUED_INPUTS) queue.shift();
        }
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

  const interval = setInterval(() => {
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
    const state = simulation.snapshot();
    for (const [id, character] of Object.entries(state.characters)) {
      character.lastInputTick = lastInputTicks.get(id) ?? 0;
    }
    const payload = JSON.stringify({ type: "snapshot", state } satisfies ServerMessage);
    for (const socket of sockets.values()) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
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
}

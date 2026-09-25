import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { MODULE_LIBRARY, assetIdsOf, initNavigation, initPhysics } from "@dont-fall/shared";
import { WebSocketServer } from "ws";
import { startMatchLoop } from "./match/matchLoop.js";
import { MatchRuntime } from "./match/matchRuntime.js";
import { buildRuntimeConfig, type StartServerConfig } from "./server/config.js";
import { handleConnection } from "./server/connections.js";
import { startPerf } from "./server/perf.js";
import { assertValidPortRange, listen } from "./server/ports.js";
import { createStatusHandler } from "./server/statusHttp.js";
import { createServerAssetLoader } from "./track/assetSource.js";
import { fetchTrack } from "./track/trackSource.js";

export type { PortRange, ServerRuntimeConfig, StartServerConfig, TestOverrides } from "./server/config.js";
export { RESERVATION_SECRET_HEADER, type ReservationGrant, type ReservationRequest } from "./server/statusHttp.js";

/**
 * Booting one authoritative Match server (ADR 0002): a fixed-30 Hz
 * `RapierSimulation` with every connected client's Character in it, a
 * WebSocket for the game and, for the broker, a `GET /status` and a
 * `POST /reservations` (ADR 0112), on one port.
 *
 * This file is the bootstrap and nothing else. What each step *is* lives
 * beside it: `server/config.ts` (what a caller asked for, resolved),
 * `server/ports.ts` (binding), `server/statusHttp.ts`, `server/connections.ts`
 * and `server/seats.ts` (who connects and what they are), `server/perf.ts`
 * (measurement), and `match/` (the Match itself).
 */
export interface MatchServer {
  /** The port actually bound (useful when `port: 0` asked for an OS-assigned one, e.g. in tests). */
  port: number;
  close: () => Promise<void>;
}

export const startServer = async (config: StartServerConfig = {}): Promise<MatchServer> => {
  assertValidPortRange(config.portRange);
  await initPhysics();
  // Recast's WASM, for every Bot this Match may seat (ADR 0129): once per
  // process, like Rapier's, so no Round's navmesh ever waits on it.
  await initNavigation();

  const runtimeConfig = buildRuntimeConfig(config, process.env);

  // The Track this server boots on. From here it lives on the runtime, which a
  // Playtest `?track=` reload or a Lobby Track pick can replace while running.
  const bootTrack = await fetchTrack(runtimeConfig.trackServiceUrl, runtimeConfig.trackFetchRetryOptions);
  // Only the boot Track's Assets (memory-footprint ticket 01, ADR 0080); the
  // runtime loads more as later Tracks need them, each id once — so a mid-Match
  // edit on the API cannot split this server from the world it already built.
  const assets = createServerAssetLoader(runtimeConfig.trackServiceUrl);
  const library = { ...MODULE_LIBRARY, ...(await assets.load(assetIdsOf(bootTrack.track))) };
  // This Match's own id (ticket 14) — one stable name that the API (betting
  // pools keyed by `(matchId, round)`) and every client share via the
  // snapshot. The broker needs none of it; its Lobby id stays its own.
  const matchId = randomUUID();
  const perf = startPerf(process.env, matchId);
  const rt = new MatchRuntime(
    {
      matchId,
      ...runtimeConfig,
      ...(perf.profileClock !== null ? { profileClock: perf.profileClock } : {}),
      ...(config.onAccountRoster ? { onAccountRoster: config.onAccountRoster } : {}),
      assets,
    },
    bootTrack,
    library,
  );

  const httpServer = createServer(createStatusHandler(rt));
  const wss = new WebSocketServer({ server: httpServer });

  /**
   * Cleared the moment a port is actually bound. While it is set, bind
   * failures belong to the listen logic, which retries or rejects them.
   */
  let binding = true;

  /**
   * `ws` is constructed with `{ server }`, so it re-emits whatever the HTTP
   * server emits — including a bind `error`. Node's unhandled-`'error'` rule
   * then turns a routine `EADDRINUSE` from the port scan into a process exit,
   * which is fatal well beyond one Match: every Lobby is an in-process
   * `startServer` inside the always-on API (ADR 0054/0058), so one taken port
   * killed tracks, assets, auth and every other live Lobby with it.
   *
   * Bind errors stay the listen logic's business — it retries and rejects with
   * the last failure — so ignoring them here loses nothing. Anything after
   * bind is a real WebSocket fault: logged, never fatal.
   */
  wss.on("error", (err: unknown) => {
    if (binding) return;
    console.error("DON'T FALL: match server WebSocket error:", err);
  });

  wss.on("connection", (socket, req) => {
    void handleConnection(rt, socket, req);
  });

  let port: number;
  try {
    port = await listen(httpServer, config);
  } catch (err) {
    // No port, no Match. Nothing is ticking yet — the loop starts only once
    // the bind has succeeded — so what is left to undo is perf's event-loop
    // monitor and the WebSocket layer. Before, the loop was started first and
    // kept ticking, a Rapier world and all, for the life of the process: one
    // per Lobby the API tried to create once its port range was used up
    // (ADR 0054/0058).
    perf.stop();
    wss.close();
    throw err;
  }
  binding = false;

  // ADR 0059: a finished server closes itself — everyone left for the results
  // page, or the straggler grace ran out. `closeServer` is only *called* from
  // a later tick, so referencing it before its definition is safe (and it
  // needs `loop` in turn, so one of the two has to come first). `await listen`
  // resumes in a microtask, so no connection lands between the bind and this.
  const loop = startMatchLoop(rt, { onTerminalClose: () => void closeServer(), perf: perf.perf });

  const closeServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // M7 ticket 05: stop any in-flight `buildMatchStructure` from continuing
      // to draw against the API for a Match nothing is listening to any more.
      rt.closed = true;
      loop.stop();
      perf.stop();
      rt.bots.dispose();
      for (const socket of rt.sockets.values()) socket.close();
      // `wss` was created with `{ server: httpServer }`, so closing it stops
      // only the WebSocket layer (`ws`'s documented behaviour for an
      // externally-owned server). The HTTP server is the one holding the port,
      // so its callback is what resolves this promise.
      wss.close();
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });

  return { port, close: closeServer };
};

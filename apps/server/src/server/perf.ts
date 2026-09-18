import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { TickPerf, tickPerfRequested } from "../match/tickPerf.js";

/**
 * The Match server's measurement wiring (M13 ticket 02), in one place so the
 * bootstrap reads as "start it, stop it" rather than four conditionals
 * threaded through it. Everything here is off unless the process runs with
 * `DONTFALL_PERF=1`.
 */

/** How often the event-loop monitor samples; its readings include this much, so `TickPerf` subtracts it. */
const EVENT_LOOP_RESOLUTION_MS = 10;

export interface ServerPerf {
  /** Handed to the Match loop, which reports every tick to it. `null` when unmeasured. */
  perf: TickPerf | null;
  /**
   * Handed to every simulation this Match builds, so the tick log can split a
   * tick into Rapier's own phases. `null` when unmeasured — a clock the
   * simulation calls on every phase of every tick is not free.
   */
  profileClock: (() => number) | null;
  stop: () => void;
}

export const startPerf = (env: NodeJS.ProcessEnv, matchId: string): ServerPerf => {
  if (!tickPerfRequested(env)) return { perf: null, profileClock: null, stop: () => {} };
  const eventLoop = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  eventLoop.enable();
  const perf = new TickPerf({
    now: () => performance.now(),
    log: (line) => console.log(`${line} · match ${matchId}`),
    eventLoop,
    eventLoopResolutionMs: EVENT_LOOP_RESOLUTION_MS,
  });
  return { perf, profileClock: () => performance.now(), stop: () => eventLoop.disable() };
};

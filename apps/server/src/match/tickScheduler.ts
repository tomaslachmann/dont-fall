import { MAX_CATCH_UP_TICKS, TICK_MS } from "@dont-fall/shared";

/**
 * What keeps the Match server's tick at a true 30 Hz (ADR 0004, ADR 0109).
 *
 * `setInterval(runTick, TICK_MS)` never did: Node's timers count whole
 * milliseconds and re-arm from when the callback ran, so a period averaged
 * ~34.6 ms and a late one was never made up — 28.9 Hz native, 25–27 Hz in
 * Docker, measured. The client predicts at a true 30 Hz, so its LEAD drained
 * forever (ADR 0021) and every snapshot's `serverTimeMs` re-anchored the
 * viewer's clock into a sawtooth.
 *
 * Here tick n is due at `start + n * TICK_MS` — a product off one anchor,
 * never a running sum, so neither a late wake nor float error accumulates —
 * and is handed that due time, which is what its snapshot is stamped with. The
 * timer is aimed at the next due time, and a wake never runs a tick that is
 * not yet due.
 *
 * A wake runs **one** tick. A wake that finds more due re-arms at once, the
 * timer layer's soonest, instead of running them back to back: libuv's poll
 * phase comes between two timer callbacks and never inside one, so a burst
 * would run every overdue tick before reading the sockets — each one repeating
 * a Player's last input (`InputRouter`) and then dropping the real one, which
 * arrived during the stall, as stale. One per wake, the input is read before
 * the ticks it addresses; and under a sustained overload (ADR 0054's
 * in-process Lobbies together over budget) no Lobby holds the API's event loop
 * for more than one tick. Off saturation the throughput is the same; once the
 * process is over budget it is 2–5% lower, since Node's soonest re-arm is 1 ms.
 *
 * A wake that finds more than {@link MAX_CATCH_UP_TICKS} due forgives the
 * rest: the grid is rebased so that exactly that many are due now, and the
 * one after them is due one tick from now — so a long stall is neither a
 * spiral nor a fast-forward through seconds of simulation.
 */

/** The clock and the one-shot timer the scheduler runs on — injected, so tests can drive it. */
export interface TickSchedulerTimers {
  /** A monotonic millisecond clock — `performance.now` in the server. */
  now: () => number;
  /** Calls `fn` once, about `delayMs` from now, and returns what cancels it — `setTimeout` in the server. */
  setTimer: (fn: () => void, delayMs: number) => () => void;
}

export interface TickScheduler {
  /** No tick runs after this — not even the rest of a catch-up already under way. Safe to call from inside a tick, and more than once. */
  stop: () => void;
}

/**
 * One tick, handed the instant on the {@link TickSchedulerTimers.now} timeline
 * it was due — never when it happened to run, which carries the timer's
 * lateness and the ticks before it in a catch-up.
 */
export type ScheduledTick = (dueMs: number) => void;

const nodeTimers: TickSchedulerTimers = {
  now: () => performance.now(),
  setTimer: (fn, delayMs) => {
    const handle = setTimeout(fn, delayMs);
    return () => clearTimeout(handle);
  },
};

export const startTickScheduler = (tick: ScheduledTick, timers: TickSchedulerTimers = nodeTimers): TickScheduler => {
  let anchorMs = timers.now();
  let ticksRun = 0;
  let stopped = false;
  let cancel: (() => void) | null = null;
  const dueMs = (n: number): number => anchorMs + n * TICK_MS;

  const arm = (): void => {
    // Behind, this is 0 — the timer layer's soonest (1 ms in Node), a fresh
    // timers phase with a poll phase before it. A wake can also come early —
    // libuv's clock is cached and whole-ms, so a timer can fire a fraction of
    // a millisecond before `performance.now()` says it should. Such a wake
    // runs nothing and simply re-arms.
    cancel = timers.setTimer(wake, Math.max(0, dueMs(ticksRun + 1) - timers.now()));
  };

  const wake = (): void => {
    cancel = null;
    const nowMs = timers.now();
    // More than the cap due: rebase so exactly the cap's worth is due now
    // (the last of them at `nowMs`), forgiving the rest.
    if (dueMs(ticksRun + 1 + MAX_CATCH_UP_TICKS) <= nowMs) anchorMs = nowMs - (ticksRun + MAX_CATCH_UP_TICKS) * TICK_MS;
    try {
      if (!stopped && dueMs(ticksRun + 1) <= nowMs) {
        ticksRun += 1;
        tick(dueMs(ticksRun));
      }
    } finally {
      // Re-armed even when the tick threw — `setInterval` re-arms in a
      // `finally` too, so one bad tick never silently ends the Match's clock.
      if (!stopped) arm();
    }
  };

  arm();
  return {
    stop: () => {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
};

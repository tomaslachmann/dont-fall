import { MAX_CATCH_UP_TICKS, TICK_MS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { startTickScheduler, type TickSchedulerTimers } from "./tickScheduler.js";

const START_MS = 1000;

/**
 * A clock that only moves when told to, and a one-shot timer that fires
 * `lateMs()` after it was aimed — the way Node's whole-millisecond timers
 * really fire. `block` is the event loop stuck (a GC pause, a suspended
 * container): time passes and no timer runs until the next `advanceTo`.
 * `poll` is libuv's poll phase, where sockets are read: it runs after each
 * timer callback, never inside one.
 */
const fakeTimers = (lateMs: () => number, poll: () => void = () => {}) => {
  let nowMs = START_MS;
  let pending: { atMs: number; fn: () => void; cancelled: boolean }[] = [];
  const timers: TickSchedulerTimers = {
    now: () => nowMs,
    setTimer: (fn, delayMs) => {
      const timer = { atMs: nowMs + delayMs + lateMs(), fn, cancelled: false };
      pending.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return {
    timers,
    now: () => nowMs,
    live: () => pending.filter((timer) => !timer.cancelled).length,
    block: (ms: number) => {
      nowMs += ms;
    },
    advanceTo: (untilMs: number) => {
      for (;;) {
        pending = pending.filter((timer) => !timer.cancelled);
        const next = pending.reduce<(typeof pending)[number] | null>((a, b) => (a === null || b.atMs < a.atMs ? b : a), null);
        if (next === null || next.atMs > untilMs) break;
        pending = pending.filter((timer) => timer !== next);
        nowMs = Math.max(nowMs, next.atMs);
        next.fn();
        poll();
      }
      nowMs = Math.max(nowMs, untilMs);
    },
  };
};

/** Deterministic lateness in `[minMs, maxMs]`. */
const seededLateness = (minMs: number, maxMs: number, seed = 7) => {
  let state = seed;
  return (): number => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return minMs + (state / 2 ** 31) * (maxMs - minMs);
  };
};

const recordTicks = (clock: ReturnType<typeof fakeTimers>) => {
  const atMs: number[] = [];
  const dueAtMs: number[] = [];
  const scheduler = startTickScheduler((dueMs) => {
    atMs.push(clock.now());
    dueAtMs.push(dueMs);
  }, clock.timers);
  return { atMs, dueAtMs, scheduler };
};

describe("startTickScheduler (ADR 0109)", () => {
  it("keeps 30 Hz with every timer 1–4 ms late, and the lateness never adds up", () => {
    const clock = fakeTimers(seededLateness(1, 4));
    const { atMs } = recordTicks(clock);
    const seconds = 60;
    clock.advanceTo(START_MS + seconds * 1000);

    expect(Math.abs(atMs.length - 30 * seconds)).toBeLessThanOrEqual(1);
    // Tick n ran no earlier than it was due, and at most one timer's lateness
    // after — as true of the last tick as of the first.
    atMs.forEach((ranMs, i) => {
      const dueMs = START_MS + (i + 1) * TICK_MS;
      expect(ranMs).toBeGreaterThanOrEqual(dueMs);
      expect(ranMs - dueMs).toBeLessThanOrEqual(4);
    });
  });

  it("hands each tick its grid time, not the moment it ran — what the snapshot is stamped with", () => {
    const clock = fakeTimers(seededLateness(1, 4));
    const { atMs, dueAtMs } = recordTicks(clock);
    clock.advanceTo(START_MS + 10_000);

    // Exactly the grid, with none of the 1–4 ms of lateness each run carried.
    expect(dueAtMs).toEqual(atMs.map((_, i) => START_MS + (i + 1) * TICK_MS));
    expect(atMs.some((ranMs, i) => ranMs !== dueAtMs[i])).toBe(true);
  });

  it("never runs a tick early when a timer fires before it was aimed", () => {
    // libuv caches its clock in whole milliseconds, so a real timer can fire
    // a fraction of a millisecond before `performance.now()` says it should.
    const clock = fakeTimers(seededLateness(-0.9, 2));
    const { atMs } = recordTicks(clock);
    clock.advanceTo(START_MS + 10_000);

    expect(Math.abs(atMs.length - 300)).toBeLessThanOrEqual(1);
    atMs.forEach((ranMs, i) => expect(ranMs).toBeGreaterThanOrEqual(START_MS + (i + 1) * TICK_MS));
  });

  it("catches up a hiccup shorter than the cap in full", () => {
    const clock = fakeTimers(() => 1);
    const { atMs } = recordTicks(clock);
    clock.advanceTo(START_MS + 1000);
    clock.block(70); // the worst late wake measured in Docker
    clock.advanceTo(START_MS + 3000);

    expect(Math.abs(atMs.length - 90)).toBeLessThanOrEqual(1);
  });

  it("catches up a 500 ms stall by at most the cap, then rebases instead of fast-forwarding", () => {
    const clock = fakeTimers(() => 1);
    const { atMs, dueAtMs } = recordTicks(clock);
    clock.advanceTo(START_MS + 1000);
    const beforeStall = atMs.length;
    clock.block(500);
    const wakeMs = clock.now();
    clock.advanceTo(wakeMs + TICK_MS / 2);

    // ~15 ticks fell due during the stall; the cap's worth runs, one per
    // wake, each re-armed at once — within a few ms of the stall ending.
    const burst = atMs.slice(beforeStall);
    expect(burst).toHaveLength(MAX_CATCH_UP_TICKS);
    expect(new Set(burst).size).toBe(MAX_CATCH_UP_TICKS);
    expect(burst.every((ranMs) => ranMs >= wakeMs && ranMs - wakeMs <= MAX_CATCH_UP_TICKS)).toBe(true);
    // Stamped on the rebased grid: a tick apart, the last of them due at the
    // wake — never after the moment each one ran.
    dueAtMs.slice(beforeStall).forEach((dueMs, i) => {
      expect(dueMs).toBeCloseTo(wakeMs - (MAX_CATCH_UP_TICKS - 1 - i) * TICK_MS, 9);
      expect(dueMs).toBeLessThanOrEqual(burst[i]!);
    });

    // The rest are forgiven: the next tick is a whole tick later, and from
    // there the cadence is 30 Hz again.
    clock.advanceTo(wakeMs + 2000);
    const after = atMs.slice(beforeStall + MAX_CATCH_UP_TICKS);
    expect(after[0]! - wakeMs).toBeGreaterThanOrEqual(TICK_MS);
    expect(dueAtMs[beforeStall + MAX_CATCH_UP_TICKS]).toBeCloseTo(wakeMs + TICK_MS, 9);
    expect(Math.abs(after.length - 60)).toBeLessThanOrEqual(1);
  });

  it("reads the sockets between catch-up ticks, so input that arrived during a stall is in hand for the ticks it addresses", () => {
    // An input that lands on the socket while the event loop is stuck is only
    // read in libuv's poll phase — after a timer callback, never inside one.
    // So after a stall the first overdue tick cannot see it (the timers phase
    // comes first); every one after it must, which needs each catch-up tick
    // to be its own timer callback rather than one burst.
    let onSocket = 0;
    let read = 0;
    const clock = fakeTimers(
      () => 1,
      () => {
        read = onSocket;
      },
    );
    const inputsSeen: number[] = [];
    startTickScheduler(() => inputsSeen.push(read), clock.timers);
    clock.advanceTo(START_MS + 1000);
    const beforeStall = inputsSeen.length;
    clock.block(4.5 * TICK_MS); // four or five ticks fall due, under the cap
    onSocket = 1;
    clock.advanceTo(clock.now() + 2 * TICK_MS);

    const afterStall = inputsSeen.slice(beforeStall);
    expect(afterStall.length).toBeGreaterThanOrEqual(4);
    expect(afterStall).toEqual([0, ...afterStall.slice(1).map(() => 1)]);
  });

  it("keeps ticking after a tick throws, as `setInterval` did", () => {
    const clock = fakeTimers(() => 1);
    let ticks = 0;
    startTickScheduler(() => {
      ticks += 1;
      if (ticks === 3) throw new Error("a bad tick");
    }, clock.timers);

    // The throw still reaches the timer layer (the process's own policy decides
    // what an uncaught error does), but the next tick is already armed.
    expect(() => clock.advanceTo(START_MS + 1000)).toThrow("a bad tick");
    expect(clock.live()).toBe(1);
    clock.advanceTo(START_MS + 2000);
    expect(Math.abs(ticks - 60)).toBeLessThanOrEqual(1);
  });

  it("stops ticking once stopped, and leaves no timer behind", () => {
    const clock = fakeTimers(() => 1);
    const { atMs, scheduler } = recordTicks(clock);
    clock.advanceTo(START_MS + 1000);
    const ticks = atMs.length;
    scheduler.stop();
    clock.advanceTo(START_MS + 5000);

    expect(atMs).toHaveLength(ticks);
    expect(clock.live()).toBe(0);
  });

  it("stops mid-catch-up when a tick stops it — the Match's own terminal close", () => {
    const clock = fakeTimers(() => 1);
    let ticks = 0;
    const scheduler = startTickScheduler(() => {
      ticks += 1;
      if (ticks === 2) scheduler.stop();
    }, clock.timers);
    clock.block(4 * TICK_MS); // four ticks due on the first wake
    clock.advanceTo(START_MS + 5000);

    expect(ticks).toBe(2);
    expect(clock.live()).toBe(0);
  });
});

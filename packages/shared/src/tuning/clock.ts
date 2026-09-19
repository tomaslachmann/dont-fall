/**
 * The simulation's clock (ADR 0004) — every other file here counts in its
 * ticks. Part of `tuning/` (see `index.ts`).
 */

/** Fixed simulation rate. The sim always steps at this cadence (ADR 0004). */
export const TICK_RATE_HZ = 30;

/** Seconds of simulated time advanced by one {@link TICK_RATE_HZ} tick. */
export const TICK_DT = 1 / TICK_RATE_HZ;

/** Milliseconds of simulated time advanced by one tick. */
export const TICK_MS = TICK_DT * 1000;

/** Convert a duration in milliseconds to whole simulation ticks. */
export const msToTicks = (ms: number): number => Math.round(ms / TICK_MS);

/**
 * Upper bound on how many sim steps a single frame may run before the loop
 * gives up catching up (avoids the "spiral of death" after a long stall).
 */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * The Match server's {@link MAX_STEPS_PER_FRAME} (ADR 0109): how many overdue
 * ticks a late wake catches up before the rest are forgiven. The longest gap
 * between two wakes measured (70 ms in Docker, over 2500 ticks) leaves two
 * due, so every ordinary hiccup is caught up in full and the server keeps
 * exactly 30 Hz. A wake that finds six or more due — 200 ms or more past the
 * due time of the last tick run, such as a suspended container — runs five,
 * one per wake, each re-armed at once, and forgives the rest: the tick after
 * those five is due one tick after that wake.
 */
export const MAX_CATCH_UP_TICKS = 5;

/**
 * Absorbs float drift in the fixed-step accumulator so an exact multiple of
 * {@link TICK_MS} (e.g. 100ms → 3 ticks) doesn't lose its last tick.
 */
export const FIXED_STEP_EPSILON_MS = 1e-6;

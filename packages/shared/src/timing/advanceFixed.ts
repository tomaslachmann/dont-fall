import { MAX_STEPS_PER_FRAME, TICK_MS } from "../tuning.js";
import type { FixedSimulation } from "./FixedSimulation.js";

/** Absorbs float drift so an exact multiple (100ms → 3 ticks) doesn't lose its last tick. */
const EPSILON_MS = 1e-6;

export interface AdvanceFixedParams<TInput, TSnapshot> {
  simulation: FixedSimulation<TInput, TSnapshot>;
  /** Input applied to every tick run this frame. */
  input: TInput;
  /** Leftover simulated time (ms) from the previous frame. */
  accumulatorMs: number;
  /** Wall-clock time (ms) elapsed since the previous frame. */
  elapsedMs: number;
  /**
   * The snapshot one tick before the simulation's current state, retained by the
   * caller across frames. Omit on the first call.
   *
   * This must be carried between frames: on a frame that runs no ticks (the
   * common case above 30 fps) it is passed straight back out so the renderer
   * keeps interpolating toward the current tick instead of freezing (ADR 0004).
   */
  previousSnapshot?: NoInfer<TSnapshot>;
}

export interface AdvanceFixedResult<TSnapshot> {
  /** Snapshot after the whole number of ticks this frame ran. */
  snapshot: TSnapshot;
  /**
   * Snapshot exactly one tick before {@link snapshot}. The renderer interpolates
   * from here toward `snapshot` by `accumulatorMs / TICK_MS`. Feed it back in as
   * `previousSnapshot` next frame.
   */
  previousSnapshot: TSnapshot;
  /** Simulated time (ms) not yet consumed — feed back in next frame. */
  accumulatorMs: number;
  /** How many fixed ticks ran this frame. */
  steps: number;
}

/**
 * Advance a {@link FixedSimulation} in fixed {@link TICK_MS} steps to catch up
 * with wall-clock time, returning the last two snapshots so the renderer can
 * interpolate between them (ADR 0004).
 *
 * A frame that fell far behind (tab backgrounded, GC pause) is clamped to
 * {@link MAX_STEPS_PER_FRAME} and the backlog is dropped rather than banked, so
 * the loop never spirals trying to catch up.
 */
export const advanceFixed = <TInput, TSnapshot>({
  simulation,
  input,
  accumulatorMs,
  elapsedMs,
  previousSnapshot,
}: AdvanceFixedParams<TInput, TSnapshot>): AdvanceFixedResult<TSnapshot> => {
  let acc = accumulatorMs + elapsedMs;
  let steps = 0;
  let previous = previousSnapshot;

  while (acc + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
    previous = simulation.snapshot();
    simulation.tick(input);
    acc -= TICK_MS;
    steps += 1;
  }

  if (acc < 0) acc = 0;
  if (acc + EPSILON_MS >= TICK_MS) {
    // Still behind after the clamp — discard the backlog.
    acc = acc % TICK_MS;
  }

  const snapshot = simulation.snapshot();
  return {
    snapshot,
    previousSnapshot: previous ?? snapshot,
    accumulatorMs: acc,
    steps,
  };
};

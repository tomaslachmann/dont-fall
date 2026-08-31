import { MAX_STEPS_PER_FRAME, TICK_MS } from "./tuning.js";

/** Absorbs float drift so an exact multiple (100ms → 3 ticks) doesn't lose its last tick. */
const EPSILON_MS = 1e-6;

export interface AdvanceFixedParams<TState> {
  /** Leftover simulated time (ms) from the previous frame. */
  accumulatorMs: number;
  /** Wall-clock time (ms) elapsed since the previous frame. */
  elapsedMs: number;
  /** Simulation state at the start of the frame. */
  state: TState;
  /**
   * The state exactly one tick before `state`, carried from the previous frame.
   * Defaults to `state` (nothing to interpolate from yet).
   */
  previousState?: TState;
  /** Advance the state by exactly one fixed tick. Close over per-frame inputs here. */
  step: (state: TState) => TState;
}

export interface AdvanceFixedResult<TState> {
  /** State after the whole number of ticks this frame ran. */
  state: TState;
  /**
   * The state exactly one tick before {@link state}. The renderer interpolates
   * from here toward `state` by `accumulatorMs / TICK_MS` (ADR 0004). Always one
   * tick apart from `state`, even when several ticks ran this frame.
   */
  previousState: TState;
  /** Simulated time (ms) not yet consumed — feed back in next frame. */
  accumulatorMs: number;
  /** How many fixed ticks ran this frame. */
  steps: number;
}

/**
 * Run the simulation forward in fixed {@link TICK_MS} steps to catch up with
 * wall-clock time, keeping the unconsumed remainder for the renderer to
 * interpolate against (ADR 0004).
 *
 * Because the step loop lives here, this also returns `previousState` — the
 * state one tick behind `state` — so the caller can interpolate correctly even
 * on a frame that ran multiple ticks.
 *
 * A frame that fell far behind (tab backgrounded, GC pause) is clamped to
 * {@link MAX_STEPS_PER_FRAME} and the backlog is dropped rather than banked, so
 * the loop never spirals trying to catch up.
 */
export const advanceFixed = <TState>({
  accumulatorMs,
  elapsedMs,
  state,
  previousState,
  step,
}: AdvanceFixedParams<TState>): AdvanceFixedResult<TState> => {
  let acc = accumulatorMs + elapsedMs;
  let current = state;
  let previous = previousState ?? state;
  let steps = 0;

  while (acc + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
    previous = current;
    current = step(current);
    acc -= TICK_MS;
    steps += 1;
  }

  if (acc < 0) acc = 0;

  if (acc + EPSILON_MS >= TICK_MS) {
    // Still behind after the clamp — discard the backlog.
    acc = acc % TICK_MS;
  }

  return { state: current, previousState: previous, accumulatorMs: acc, steps };
};

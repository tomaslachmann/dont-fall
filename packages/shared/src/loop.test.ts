import { describe, expect, it } from "vitest";
import { advanceFixed } from "./loop.js";
import { MAX_STEPS_PER_FRAME } from "./tuning.js";

/** A trivial sim: an integer counter, +1 per step. Independent of the real sim. */
const countStep = (n: number): number => n + 1;

describe("advanceFixed", () => {
  it("runs one step when elapsed time covers one tick but not two", () => {
    const result = advanceFixed({
      accumulatorMs: 0,
      elapsedMs: 50, // one 33.33ms tick fits, a second does not
      state: 0,
      step: countStep,
    });

    expect(result.steps).toBe(1);
    expect(result.state).toBe(1);
    expect(result.previousState).toBe(0);
    // 50 - 33.333... left over
    expect(result.accumulatorMs).toBeCloseTo(16.667, 2);
  });

  it("runs three steps for 100ms of elapsed time", () => {
    const result = advanceFixed({
      accumulatorMs: 0,
      elapsedMs: 100,
      state: 0,
      step: countStep,
    });

    expect(result.steps).toBe(3);
    expect(result.state).toBe(3);
    expect(result.accumulatorMs).toBeCloseTo(0, 6);
  });

  it("keeps previousState exactly one tick behind state when several ticks run in one frame", () => {
    const result = advanceFixed({
      accumulatorMs: 0,
      elapsedMs: 100, // three ticks
      state: 0,
      step: countStep,
    });

    expect(result.state).toBe(3);
    expect(result.previousState).toBe(2);
  });

  it("runs no steps when not enough time has accumulated", () => {
    const result = advanceFixed({
      accumulatorMs: 10,
      elapsedMs: 0,
      state: 7,
      previousState: 6,
      step: countStep,
    });

    expect(result.steps).toBe(0);
    expect(result.state).toBe(7);
    expect(result.previousState).toBe(6);
    expect(result.accumulatorMs).toBe(10);
  });

  it("defaults previousState to state before any tick has run", () => {
    const result = advanceFixed({ accumulatorMs: 0, elapsedMs: 5, state: 42, step: countStep });
    expect(result.steps).toBe(0);
    expect(result.previousState).toBe(42);
  });

  it("carries the accumulator across frames", () => {
    const first = advanceFixed({ accumulatorMs: 0, elapsedMs: 20, state: 0, step: countStep });
    expect(first.steps).toBe(0);

    const second = advanceFixed({
      accumulatorMs: first.accumulatorMs,
      elapsedMs: 20, // 20 + 20 = 40ms, now one tick fires
      state: first.state,
      step: countStep,
    });
    expect(second.steps).toBe(1);
  });

  it("clamps runaway frames to MAX_STEPS_PER_FRAME and drops the backlog", () => {
    const result = advanceFixed({
      accumulatorMs: 0,
      elapsedMs: 10_000, // a huge stall
      state: 0,
      step: countStep,
    });

    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(result.state).toBe(MAX_STEPS_PER_FRAME);
    expect(result.previousState).toBe(MAX_STEPS_PER_FRAME - 1);
    // backlog is discarded, not banked
    expect(result.accumulatorMs).toBeLessThan(1000);
  });
});

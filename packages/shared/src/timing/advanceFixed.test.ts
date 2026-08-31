import { describe, expect, it } from "vitest";
import type { FixedSimulation } from "./FixedSimulation.js";
import { advanceFixed } from "./advanceFixed.js";
import { MAX_STEPS_PER_FRAME } from "../tuning.js";

/** In-memory fake: a counter that increments by `input` per tick. */
class CounterSim implements FixedSimulation<number, number> {
  private value = 0;
  tick(input: number): void {
    this.value += input;
  }
  snapshot(): number {
    return this.value;
  }
}

describe("advanceFixed", () => {
  it("runs one tick when elapsed time covers one tick but not two", () => {
    const sim = new CounterSim();
    const result = advanceFixed({ simulation: sim, input: 1, accumulatorMs: 0, elapsedMs: 50 });

    expect(result.steps).toBe(1);
    expect(result.snapshot).toBe(1);
    expect(result.accumulatorMs).toBeCloseTo(16.667, 2);
  });

  it("runs three ticks for 100ms of elapsed time", () => {
    const sim = new CounterSim();
    const result = advanceFixed({ simulation: sim, input: 1, accumulatorMs: 0, elapsedMs: 100 });

    expect(result.steps).toBe(3);
    expect(result.snapshot).toBe(3);
    expect(result.accumulatorMs).toBeCloseTo(0, 6);
  });

  it("keeps previousSnapshot exactly one tick behind snapshot on a multi-tick frame", () => {
    const sim = new CounterSim();
    const result = advanceFixed({ simulation: sim, input: 1, accumulatorMs: 0, elapsedMs: 100 });

    expect(result.snapshot).toBe(3);
    expect(result.previousSnapshot).toBe(2);
  });

  it("passes a carried previousSnapshot straight through on a zero-tick frame", () => {
    const sim = new CounterSim();

    // Frame A: enough time for one tick — value goes 0 → 1.
    const a = advanceFixed({ simulation: sim, input: 1, accumulatorMs: 0, elapsedMs: 40 });
    expect(a.steps).toBe(1);
    expect(a.previousSnapshot).toBe(0);
    expect(a.snapshot).toBe(1);

    // Frame B: not enough time for another tick. The renderer must still be able
    // to interpolate 0 → 1 as alpha grows, so both snapshots are unchanged.
    const b = advanceFixed({
      simulation: sim,
      input: 1,
      accumulatorMs: a.accumulatorMs,
      elapsedMs: 10,
      previousSnapshot: a.previousSnapshot,
    });
    expect(b.steps).toBe(0);
    expect(b.previousSnapshot).toBe(0);
    expect(b.snapshot).toBe(1);
  });

  it("falls back to the current snapshot for both when no previousSnapshot is carried yet", () => {
    const sim = new CounterSim();
    sim.tick(7);
    const result = advanceFixed({ simulation: sim, input: 1, accumulatorMs: 5, elapsedMs: 10 });

    expect(result.steps).toBe(0);
    expect(result.snapshot).toBe(7);
    expect(result.previousSnapshot).toBe(7);
  });

  it("carries the accumulator across frames", () => {
    const sim = new CounterSim();
    const first = advanceFixed({ simulation: sim, input: 1, accumulatorMs: 0, elapsedMs: 20 });
    expect(first.steps).toBe(0);

    const second = advanceFixed({
      simulation: sim,
      input: 1,
      accumulatorMs: first.accumulatorMs,
      elapsedMs: 20,
    });
    expect(second.steps).toBe(1);
  });

  it("clamps a runaway frame to MAX_STEPS_PER_FRAME and drops the backlog", () => {
    const sim = new CounterSim();
    const result = advanceFixed({
      simulation: sim,
      input: 1,
      accumulatorMs: 0,
      elapsedMs: 10_000,
    });

    expect(result.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(result.snapshot).toBe(MAX_STEPS_PER_FRAME);
    expect(result.previousSnapshot).toBe(MAX_STEPS_PER_FRAME - 1);
    expect(result.accumulatorMs).toBeLessThan(1000);
  });
});

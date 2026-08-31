import { describe, expect, it } from "vitest";
import { IDLE_INPUTS, createInitialState, step } from "./sim.js";

describe("step", () => {
  it("integrates the demo entity's position by its velocity over one 30 Hz tick", () => {
    const state = createInitialState();
    state.demo.velocity = { x: 3, y: 0, z: 0 };

    const next = step(state, IDLE_INPUTS);

    // 3 units/s at a 1/30 s tick = 0.1 units this tick
    expect(next.demo.position.x).toBeCloseTo(0.1, 6);
    expect(next.demo.position.y).toBeCloseTo(0, 6);
    expect(next.demo.position.z).toBeCloseTo(0, 6);
  });

  it("advances the tick counter", () => {
    const next = step(createInitialState(), IDLE_INPUTS);
    expect(next.tick).toBe(1);
  });

  it("applies input impulse to velocity before integrating", () => {
    const state = createInitialState();

    const next = step(state, { impulse: { x: 6, y: 0, z: 0 } });

    // velocity becomes 6 this tick, then position moves 6 * 1/30 = 0.2
    expect(next.demo.velocity.x).toBeCloseTo(6, 6);
    expect(next.demo.position.x).toBeCloseTo(0.2, 6);
  });

  it("does not mutate the input state", () => {
    const state = createInitialState();
    state.demo.velocity = { x: 1, y: 0, z: 0 };

    step(state, IDLE_INPUTS);

    expect(state.demo.position.x).toBe(0);
    expect(state.tick).toBe(0);
  });
});

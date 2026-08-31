import type { Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { WOBBLE_MAX_TILT, initialWobbleState, stepWobble, type WobbleState } from "./wobble.js";

const FORWARD: Vec3 = { x: 0, y: 0, z: 1 };
const RIGHT: Vec3 = { x: 1, y: 0, z: 0 };
const DT = 1 / 60;

/** Run `stepWobble` across a sequence of positions, one per frame, returning the final state. */
const run = (positions: Vec3[], forward = FORWARD, right = RIGHT): WobbleState => {
  let state = initialWobbleState;
  let prev = positions[0]!;
  for (let i = 1; i < positions.length; i += 1) {
    state = stepWobble(state, positions[i]!, prev, forward, right, DT);
    prev = positions[i]!;
  }
  return state;
};

describe("stepWobble", () => {
  it("stays upright while standing still", () => {
    const still: Vec3 = { x: 0, y: 0, z: 0 };
    const state = run([still, still, still, still]);
    expect(state.pitch).toBe(0);
    expect(state.roll).toBe(0);
  });

  it("leans backward the instant it starts moving forward (inertia)", () => {
    let state = initialWobbleState;
    state = stepWobble(state, { x: 0, y: 0, z: 0.1 }, { x: 0, y: 0, z: 0 }, FORWARD, RIGHT, DT);
    expect(state.pitch).toBeGreaterThan(0); // leans backward, away from the new forward motion
  });

  it("leans forward on a sudden stop", () => {
    // accelerate up to a steady speed first...
    let state = initialWobbleState;
    let z = 0;
    for (let i = 0; i < 30; i += 1) {
      const next = { x: 0, y: 0, z: z + 0.1 };
      state = stepWobble(state, next, { x: 0, y: 0, z }, FORWARD, RIGHT, DT);
      z = next.z;
    }
    // ...then stop dead: no movement this frame, so velocity drops to 0.
    state = stepWobble(state, { x: 0, y: 0, z }, { x: 0, y: 0, z }, FORWARD, RIGHT, DT);
    expect(state.pitch).toBeLessThan(0); // leans forward, into the direction it was travelling
  });

  it("settles back to upright at a constant velocity", () => {
    const positions: Vec3[] = [];
    for (let i = 0; i < 60; i += 1) positions.push({ x: 0, y: 0, z: i * 0.1 });
    const state = run(positions);
    expect(Math.abs(state.pitch)).toBeLessThan(0.01);
  });

  it("leans sideways when accelerating to the right", () => {
    let state = initialWobbleState;
    state = stepWobble(state, { x: 0.1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, FORWARD, RIGHT, DT);
    expect(state.roll).toBeGreaterThan(0);
  });

  it("clamps extreme acceleration to WOBBLE_MAX_TILT", () => {
    let state = initialWobbleState;
    state = stepWobble(state, { x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }, FORWARD, RIGHT, DT);
    expect(Math.abs(state.pitch)).toBeLessThanOrEqual(WOBBLE_MAX_TILT);
  });

  it("is a no-op when deltaSeconds is zero or negative", () => {
    const state = { pitch: 0.2, roll: -0.1, velocity: { x: 1, y: 0, z: 0 } };
    expect(stepWobble(state, { x: 5, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, FORWARD, RIGHT, 0)).toEqual(state);
  });

  it("resolves lean relative to the Character's current facing, not a world axis", () => {
    // Facing +X now (forward = world +X); accelerating along world +X should
    // read as *forward* acceleration, leaning backward just like the default case.
    const facingX: Vec3 = { x: 1, y: 0, z: 0 };
    const rightOfX: Vec3 = { x: 0, y: 0, z: -1 };
    let state = initialWobbleState;
    state = stepWobble(state, { x: 0.1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, facingX, rightOfX, DT);
    expect(state.pitch).toBeGreaterThan(0);
    expect(state.roll).toBeCloseTo(0, 5);
  });
});

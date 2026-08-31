import { describe, expect, it } from "vitest";
import { interpolateState } from "./interpolate.js";
import { characterSnapshot, type SimState } from "./SimState.js";

const stateAt = (x: number, teleported = false): SimState => ({
  tick: 0,
  character: characterSnapshot({ position: { x, y: x * 2, z: x * 3 }, teleported }),
});

describe("interpolateState", () => {
  it("returns the midpoint at alpha 0.5", () => {
    const render = interpolateState(stateAt(0), stateAt(10), 0.5);
    expect(render.character.position).toEqual({ x: 5, y: 10, z: 15 });
  });

  it("returns the previous state at alpha 0", () => {
    const render = interpolateState(stateAt(2), stateAt(10), 0);
    expect(render.character.position).toEqual({ x: 2, y: 4, z: 6 });
  });

  it("returns the next state at alpha 1", () => {
    const render = interpolateState(stateAt(2), stateAt(10), 1);
    expect(render.character.position).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("clamps alpha outside [0, 1]", () => {
    expect(interpolateState(stateAt(0), stateAt(10), 2).character.position.x).toBe(10);
    expect(interpolateState(stateAt(0), stateAt(10), -1).character.position.x).toBe(0);
  });

  it("snaps to the next pose without blending when next was teleported", () => {
    const render = interpolateState(stateAt(0), stateAt(10, true), 0.5);
    expect(render.character.position).toEqual({ x: 10, y: 20, z: 30 });
  });
});

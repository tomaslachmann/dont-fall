import { describe, expect, it } from "vitest";
import { IDENTITY_QUAT } from "../math/quat.js";
import type { BoneSnapshot } from "../simulation/Ragdoll.js";
import type { PropSnapshot } from "../simulation/Prop.js";
import { interpolateState } from "./interpolate.js";
import { characterSnapshot, type CharacterMotionState, type SimState } from "./SimState.js";

const bone = (x: number): BoneSnapshot => ({ position: { x, y: 0, z: 0 }, rotation: IDENTITY_QUAT });
const prop = (x: number): PropSnapshot => ({ position: { x, y: 0, z: 0 }, rotation: IDENTITY_QUAT });

const ID = "p1";

const stateAt = (x: number, respawnCount = 0, props: PropSnapshot[] = []): SimState => ({
  tick: 0,
  characters: { [ID]: characterSnapshot({ position: { x, y: x * 2, z: x * 3 }, respawnCount }) },
  props,
});

const ragdollStateAt = (x: number, motionState: CharacterMotionState = "Ragdoll"): SimState => ({
  tick: 0,
  characters: { [ID]: characterSnapshot({ position: { x, y: 0, z: 0 }, motionState, bones: [bone(x)] }) },
  props: [],
});

describe("interpolateState", () => {
  it("returns the midpoint at alpha 0.5", () => {
    const render = interpolateState(stateAt(0), stateAt(10), 0.5);
    expect(render.characters[ID]!.position).toEqual({ x: 5, y: 10, z: 15 });
  });

  it("returns the previous state at alpha 0", () => {
    const render = interpolateState(stateAt(2), stateAt(10), 0);
    expect(render.characters[ID]!.position).toEqual({ x: 2, y: 4, z: 6 });
  });

  it("returns the next state at alpha 1", () => {
    const render = interpolateState(stateAt(2), stateAt(10), 1);
    expect(render.characters[ID]!.position).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("clamps alpha outside [0, 1]", () => {
    expect(interpolateState(stateAt(0), stateAt(10), 2).characters[ID]!.position.x).toBe(10);
    expect(interpolateState(stateAt(0), stateAt(10), -1).characters[ID]!.position.x).toBe(0);
  });

  it("snaps to the next pose without blending when respawnCount changed between prev and next", () => {
    const render = interpolateState(stateAt(0, 0), stateAt(10, 1), 0.5);
    expect(render.characters[ID]!.position).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("interpolates normally once respawnCount is stable again", () => {
    const render = interpolateState(stateAt(0, 1), stateAt(10, 1), 0.5);
    expect(render.characters[ID]!.position.x).toBe(5);
  });

  it("interpolates ragdoll bone positions while the motion state holds", () => {
    const render = interpolateState(ragdollStateAt(0), ragdollStateAt(10), 0.5);
    expect(render.characters[ID]!.bones[0]!.position.x).toBe(5);
  });

  it("snaps (no blend) when the motion state changes — the drawn body swaps", () => {
    // Controlled -> Ragdoll: use the next pose directly, don't lerp through the air
    const render = interpolateState(stateAt(0), ragdollStateAt(10), 0.5);
    expect(render.characters[ID]!.position.x).toBe(10);
    expect(render.characters[ID]!.bones[0]!.position.x).toBe(10);
  });

  it("has no bones while Controlled", () => {
    const render = interpolateState(stateAt(0), stateAt(10), 0.5);
    expect(render.characters[ID]!.bones).toEqual([]);
  });

  it("carries motionState straight from next, uninterpolated", () => {
    const render = interpolateState(stateAt(0), ragdollStateAt(10, "GettingUp"), 0.5);
    expect(render.characters[ID]!.motionState).toBe("GettingUp");
  });

  it("interpolates Prop positions independently of the Character", () => {
    const render = interpolateState(
      stateAt(0, 0, [prop(0)]),
      stateAt(0, 1, [prop(10)]), // Character respawns; the Prop keeps moving normally
      0.5,
    );
    expect(render.props[0]!.position.x).toBe(5);
  });

  it("renders a Character present in next but not yet in prev at its next pose, unblended", () => {
    const prev: SimState = { tick: 0, characters: {}, props: [] };
    const next = stateAt(10);
    const render = interpolateState(prev, next, 0.5);
    expect(render.characters[ID]!.position).toEqual({ x: 10, y: 20, z: 30 });
  });
});

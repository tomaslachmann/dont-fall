import { characterSnapshot, forwardOf, interpolateState, type RenderCharacter } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { carriedPose } from "./carriedPose.js";

/** A carried body as the server's world draws it: `distance` ahead of a grabber at `at` facing `facing`. */
const heldAhead = (at: { x: number; y: number; z: number }, facing: number, distance: number): RenderCharacter => {
  const ahead = forwardOf(facing);
  const row = characterSnapshot({
    position: { x: at.x + ahead.x * distance, y: at.y + 0.4, z: at.z + ahead.z * distance },
    motionState: "Held",
    facing: facing + Math.PI,
  });
  const state = { tick: 1, characters: { held: row }, props: [] };
  return interpolateState(state, state, 1).characters.held!;
};

describe("carriedPose (ADR 0104)", () => {
  it("hangs the body off the grabber as it is drawn, not where the server's past has the grabber", () => {
    const server = { position: { x: 0, y: 1, z: 0 }, facing: 0 };
    const drawn = { position: { x: 3, y: 1, z: -2 }, facing: 0 };
    const pose = carriedPose(heldAhead(server.position, 0, 1.1), server, drawn);
    expect(pose.position.x).toBeCloseTo(3, 9);
    expect(pose.position.y).toBeCloseTo(1.4, 9);
    expect(pose.position.z).toBeCloseTo(-3.1, 9);
  });

  it("turns the body round with a grabber the prediction has turned further — a Spin ahead of the server", () => {
    const server = { position: { x: 0, y: 1, z: 0 }, facing: 0.4 };
    const drawn = { position: { x: 0, y: 1, z: 0 }, facing: 1.9 };
    const pose = carriedPose(heldAhead(server.position, 0.4, 1.1), server, drawn);
    const ahead = forwardOf(1.9);
    expect(pose.position.x).toBeCloseTo(ahead.x * 1.1, 9);
    expect(pose.position.z).toBeCloseTo(ahead.z * 1.1, 9);
    expect(Math.cos(pose.facing - (1.9 + Math.PI))).toBeCloseTo(1, 9); // still facing its grabber
  });

  it("changes nothing when the grabber is drawn exactly where the server has it — every other client's case", () => {
    const grabber = { position: { x: 5, y: 1, z: 5 }, facing: -2 };
    const held = heldAhead(grabber.position, -2, 0.8);
    const pose = carriedPose(held, grabber, grabber);
    expect(pose.position.x).toBeCloseTo(held.position.x, 9);
    expect(pose.position.z).toBeCloseTo(held.position.z, 9);
    expect(pose.facing).toBeCloseTo(held.facing, 9);
  });
});

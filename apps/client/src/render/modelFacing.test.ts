import { describe, expect, it } from "vitest";
import { FACING_TURN_SPEED, nextModelYaw } from "./modelFacing.js";

const dir = (x: number, z: number) => ({ x, y: 0, z });

describe("nextModelYaw", () => {
  it("turns toward the move direction, capped at the turn speed", () => {
    const yaw = nextModelYaw({ currentYaw: 0, moveDirection: dir(1, 0), deltaSeconds: 0.01, facingLocked: false });
    expect(yaw).toBeCloseTo(FACING_TURN_SPEED * 0.01, 6);
  });

  it("lands exactly on the target once it is within a single step", () => {
    const yaw = nextModelYaw({ currentYaw: 0, moveDirection: dir(1, 0), deltaSeconds: 1, facingLocked: false });
    expect(yaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it("takes the shortest arc across the ±π seam", () => {
    // Facing just under +π, walking just over −π: the short way round is
    // forward through π, not the long way back through zero.
    const yaw = nextModelYaw({
      currentYaw: Math.PI - 0.05,
      moveDirection: dir(-Math.sin(Math.PI - 0.1), -Math.cos(Math.PI - 0.1)),
      deltaSeconds: 0.01,
      facingLocked: false,
    });
    expect(yaw).toBeGreaterThan(Math.PI - 0.05);
  });

  it("leaves the yaw alone while idle", () => {
    expect(nextModelYaw({ currentYaw: 1.2, moveDirection: dir(0, 0), deltaSeconds: 0.1, facingLocked: false })).toBe(1.2);
  });

  it("leaves the yaw alone while a Grab hold locks the facing", () => {
    expect(nextModelYaw({ currentYaw: 1.2, moveDirection: dir(1, 0), deltaSeconds: 0.1, facingLocked: true })).toBe(1.2);
  });

  it("never turns while locked, even walking straight backwards", () => {
    // The bug this rule exists for: backing away from whoever you are holding
    // used to spin the rendered model a full 180°, dragging the arm-reach
    // pose out through the Character's own back.
    let yaw = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      yaw = nextModelYaw({ currentYaw: yaw, moveDirection: dir(0, 1), deltaSeconds: 1 / 60, facingLocked: true });
    }
    expect(yaw).toBe(0);
  });
});

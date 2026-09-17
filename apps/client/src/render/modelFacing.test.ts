import { movementDirection } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { FACING_TURN_SPEED_MAX, facingFromModelYaw, nextModelYaw } from "./modelFacing.js";

const dir = (x: number, z: number) => ({ x, y: 0, z });

/** Seconds of 60 fps frames until a turn from yaw 0 toward `moveDirection` is within `tolerance` of it. */
const secondsToTurn = (moveDirection: { x: number; y: number; z: number }, tolerance: number): number => {
  const target = Math.atan2(moveDirection.x, moveDirection.z);
  let yaw = 0;
  for (let frame = 1; frame <= 600; frame += 1) {
    yaw = nextModelYaw({ currentYaw: yaw, moveDirection, deltaSeconds: 1 / 60, facingLocked: false });
    if (Math.abs(target - yaw) <= tolerance) return frame / 60;
  }
  return Infinity;
};

const TEN_DEGREES = (10 * Math.PI) / 180;

describe("nextModelYaw", () => {
  it("turns toward the move direction, never faster than the turn speed cap", () => {
    const yaw = nextModelYaw({ currentYaw: 0, moveDirection: dir(1, 0), deltaSeconds: 0.01, facingLocked: false });
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThanOrEqual(FACING_TURN_SPEED_MAX * 0.01 + 1e-9);
  });

  it("eases in to a soft stop: each frame's step is smaller than the last near the target", () => {
    let yaw = 0;
    const steps: number[] = [];
    for (let frame = 0; frame < 20; frame += 1) {
      const next = nextModelYaw({ currentYaw: yaw, moveDirection: dir(1, 0), deltaSeconds: 1 / 60, facingLocked: false });
      steps.push(next - yaw);
      yaw = next;
    }
    expect(steps.at(-1)!).toBeLessThan(steps[0]!);
    expect(steps.at(-1)!).toBeGreaterThan(0);
  });

  it("settles on the target given long enough", () => {
    const yaw = nextModelYaw({ currentYaw: 0, moveDirection: dir(1, 0), deltaSeconds: 1, facingLocked: false });
    expect(yaw).toBeCloseTo(Math.PI / 2, 4);
  });

  it("takes about a fifth of a second to come round a quarter turn, and longer to turn around", () => {
    const quarter = secondsToTurn(dir(1, 0), TEN_DEGREES);
    const around = secondsToTurn(dir(-0.0001, -1), TEN_DEGREES);
    expect(quarter).toBeGreaterThan(0.15);
    expect(quarter).toBeLessThan(0.25);
    expect(around).toBeGreaterThan(quarter);
    expect(around).toBeLessThan(0.4);
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

describe("facingFromModelYaw (ADR 0085)", () => {
  it("is the camera yaw that would drive the Character the way the body has turned", () => {
    for (const lookYaw of [0, 0.7, Math.PI / 2, 2.5, -1.3, -Math.PI + 0.01]) {
      const forward = movementDirection({ forward: true, back: false, left: false, right: false }, lookYaw);
      // Run forward long enough for the body to finish turning.
      const bodyYaw = nextModelYaw({ currentYaw: 0, moveDirection: forward, deltaSeconds: 5, facingLocked: false });
      const facing = facingFromModelYaw(bodyYaw);
      expect(Math.cos(facing)).toBeCloseTo(Math.cos(lookYaw), 3);
      expect(Math.sin(facing)).toBeCloseTo(Math.sin(lookYaw), 3);
    }
  });

  it("stays in (−π, π] however many times the body has turned around", () => {
    const facing = facingFromModelYaw(7 * Math.PI + 0.3);
    expect(facing).toBeGreaterThan(-Math.PI);
    expect(facing).toBeLessThanOrEqual(Math.PI);
  });
});

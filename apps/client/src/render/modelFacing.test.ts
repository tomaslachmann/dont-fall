import { movementDirection } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { FACING_TURN_SPEED_MAX } from "@dont-fall/shared";
import {
  clampSpinMomentum,
  decayedSpinMomentum,
  facingFromModelYaw,
  measuredYawRate,
  modelYawFromFacing,
  nextModelYaw,
  SPIN_MOMENTUM_REST,
} from "./modelFacing.js";

const dir = (x: number, z: number) => ({ x, y: 0, z });

/** Seconds of 60 fps frames until a turn from yaw 0 toward `moveDirection` is within `tolerance` of it. */
const secondsToTurn = (moveDirection: { x: number; y: number; z: number }, tolerance: number): number => {
  const target = Math.atan2(moveDirection.x, moveDirection.z);
  let yaw = 0;
  for (let frame = 1; frame <= 600; frame += 1) {
    yaw = nextModelYaw({ currentYaw: yaw, moveDirection, deltaSeconds: 1 / 60, turnScale: 1 });
    if (Math.abs(target - yaw) <= tolerance) return frame / 60;
  }
  return Infinity;
};

const TEN_DEGREES = (10 * Math.PI) / 180;

describe("nextModelYaw", () => {
  it("turns toward the move direction, never faster than the turn speed cap", () => {
    const yaw = nextModelYaw({ currentYaw: 0, moveDirection: dir(1, 0), deltaSeconds: 0.01, turnScale: 1 });
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThanOrEqual(FACING_TURN_SPEED_MAX * 0.01 + 1e-9);
  });

  it("eases in to a soft stop: each frame's step is smaller than the last near the target", () => {
    let yaw = 0;
    const steps: number[] = [];
    for (let frame = 0; frame < 20; frame += 1) {
      const next = nextModelYaw({ currentYaw: yaw, moveDirection: dir(1, 0), deltaSeconds: 1 / 60, turnScale: 1 });
      steps.push(next - yaw);
      yaw = next;
    }
    expect(steps.at(-1)!).toBeLessThan(steps[0]!);
    expect(steps.at(-1)!).toBeGreaterThan(0);
  });

  it("settles on the target given long enough", () => {
    const yaw = nextModelYaw({ currentYaw: 0, moveDirection: dir(1, 0), deltaSeconds: 1, turnScale: 1 });
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
      turnScale: 1,
    });
    expect(yaw).toBeGreaterThan(Math.PI - 0.05);
  });

  it("leaves the yaw alone while idle", () => {
    expect(nextModelYaw({ currentYaw: 1.2, moveDirection: dir(0, 0), deltaSeconds: 0.1, turnScale: 1 })).toBe(1.2);
  });

  it("turns a grabber at its reduced rate, never faster than the cap it scales (ADR 0104)", () => {
    const full = nextModelYaw({ currentYaw: 0, moveDirection: dir(-1, 0), deltaSeconds: 0.05, turnScale: 1 });
    const loaded = nextModelYaw({ currentYaw: 0, moveDirection: dir(-1, 0), deltaSeconds: 0.05, turnScale: 0.5 });
    expect(Math.abs(loaded)).toBeCloseTo(Math.abs(full) / 2, 6);
    expect(Math.abs(loaded)).toBeLessThanOrEqual(FACING_TURN_SPEED_MAX * 0.5 * 0.05 + 1e-9);
  });
});

describe("facingFromModelYaw (ADR 0085)", () => {
  it("is the camera yaw that would drive the Character the way the body has turned", () => {
    for (const lookYaw of [0, 0.7, Math.PI / 2, 2.5, -1.3, -Math.PI + 0.01]) {
      const forward = movementDirection({ forward: true, back: false, left: false, right: false }, lookYaw);
      // Run forward long enough for the body to finish turning.
      const bodyYaw = nextModelYaw({ currentYaw: 0, moveDirection: forward, deltaSeconds: 5, turnScale: 1 });
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

  it("is undone by modelYawFromFacing, which pins a Held or Spinning body to the sim's facing (ADR 0104)", () => {
    for (const facing of [0, 0.7, Math.PI / 2, 2.5, -1.3, -Math.PI + 0.01, Math.PI]) {
      const back = facingFromModelYaw(modelYawFromFacing(facing));
      expect(Math.cos(back)).toBeCloseTo(Math.cos(facing), 9);
      expect(Math.sin(back)).toBeCloseTo(Math.sin(facing), 9);
    }
  });
});

describe("the Spin's follow-through (ADR 0104's drawn hold)", () => {
  it("measures the pinned yaw's own rate, shortest-arc even across the wrap", () => {
    expect(measuredYawRate(0.3, 0, 1 / 60)).toBeCloseTo(18, 6);
    // Crossing π: from just under it to just past −π is a small forward step.
    expect(measuredYawRate(-Math.PI + 0.05, Math.PI - 0.05, 1 / 60)).toBeCloseTo(6, 6);
    expect(measuredYawRate(1, 0, 0)).toBe(0);
  });

  it("bleeds the whirl off exponentially and lets it go once it is slow", () => {
    let momentum = 9.4; // a full Spin, 3π rad/s
    const rates = [momentum];
    for (let i = 0; i < 120; i += 1) {
      momentum = decayedSpinMomentum(momentum, 1 / 60);
      rates.push(momentum);
    }
    expect(rates[30]!).toBeLessThan(rates[0]! / 2);
    expect(rates[120]!).toBe(0);
    // Never lingers below the rest threshold.
    for (const rate of rates) if (rate !== 0) expect(Math.abs(rate)).toBeGreaterThanOrEqual(SPIN_MOMENTUM_REST);
  });

  it("seeds no faster than the server's own facing clamp accepts", () => {
    expect(clampSpinMomentum(40)).toBe(FACING_TURN_SPEED_MAX);
    expect(clampSpinMomentum(-40)).toBe(-FACING_TURN_SPEED_MAX);
    expect(clampSpinMomentum(5)).toBe(5);
  });
});

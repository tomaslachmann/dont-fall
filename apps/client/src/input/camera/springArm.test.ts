import { movementDirection, type Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  PITCH_MAX,
  PITCH_MIN,
  clampPitch,
  resolveArm,
  springArmPosition,
} from "./springArm.js";

const origin = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const dist = (a: Vec3, b: Vec3) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

describe("clampPitch", () => {
  it("clamps below the floor and above the ceiling", () => {
    expect(clampPitch(-5)).toBe(PITCH_MIN);
    expect(clampPitch(5)).toBe(PITCH_MAX);
  });
  it("passes an in-range pitch through", () => {
    expect(clampPitch(0.5)).toBe(0.5);
  });
});

describe("springArmPosition", () => {
  it("sits directly behind the target (+Z) at yaw 0 pitch 0", () => {
    const pos = springArmPosition({ x: 0, y: 1, z: 0 }, 0, 0, 7);
    expect(pos.x).toBeCloseTo(0, 6);
    expect(pos.y).toBeCloseTo(1, 6);
    expect(pos.z).toBeCloseTo(7, 6);
  });

  it("stays behind the character's facing at a quarter-turn yaw (−X, opposite forward +X)", () => {
    const pos = springArmPosition({ x: 0, y: 0, z: 0 }, Math.PI / 2, 0, 7);
    expect(pos.x).toBeCloseTo(-7, 6);
    expect(pos.z).toBeCloseTo(0, 6);
  });

  it("raises the camera as pitch increases", () => {
    const low = springArmPosition(origin(), 0, 0, 7);
    const high = springArmPosition(origin(), 0, 0.5, 7);
    expect(high.y).toBeGreaterThan(low.y);
  });

  it("agrees with movementDirection: pressing forward drives the character away from the camera", () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.3]) {
      const forward = movementDirection(
        { forward: true, back: false, left: false, right: false },
        yaw,
      );
      const cam = springArmPosition(origin(), yaw, 0, 7);
      // camera is opposite the forward direction, so dot(forward, cam) is negative
      expect(forward.x * cam.x + forward.z * cam.z).toBeLessThan(0);
    }
  });
});

describe("resolveArm", () => {
  const desired = (): Vec3 => ({ x: 0, y: 0, z: 10 });

  it("returns the desired position when nothing is in the way", () => {
    expect(resolveArm(origin(), desired(), () => null, 1.2, 0.2)).toEqual({ x: 0, y: 0, z: 10 });
  });

  it("shortens the arm to a hit partway along the ray, minus the skin", () => {
    const pos = resolveArm(origin(), desired(), () => 6, 1.2, 0.2);
    expect(pos.z).toBeCloseTo(5.8, 6); // 6 - skin
  });

  it("never pulls the camera closer than the minimum distance", () => {
    const pos = resolveArm(origin(), desired(), () => 0, 1.2, 0.2);
    expect(dist(origin(), pos)).toBeCloseTo(1.2, 6);
  });

  it("never pushes the camera past the desired position", () => {
    const pos = resolveArm(origin(), desired(), () => 999, 1.2, 0.2);
    expect(pos.z).toBeCloseTo(10, 6);
  });
});

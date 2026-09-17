import { movementDirection, type Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  CAMERA_ARM_IN_SECONDS,
  CAMERA_ARM_OUT_SECONDS,
  PITCH_MAX,
  PITCH_MIN,
  armTargetLength,
  clampPitch,
  easeArmLength,
  pointOnArm,
  springArmPosition,
  thickCast,
} from "./springArm.js";

const origin = (): Vec3 => ({ x: 0, y: 0, z: 0 });

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

describe("armTargetLength", () => {
  const desired = (): Vec3 => ({ x: 0, y: 0, z: 10 });

  it("is the full arm when nothing is in the way", () => {
    expect(armTargetLength(origin(), desired(), () => null, 1.2, 0.2)).toBe(10);
  });

  it("shortens the arm to a hit partway along the ray, minus the skin", () => {
    expect(armTargetLength(origin(), desired(), () => 6, 1.2, 0.2)).toBeCloseTo(5.8, 6);
  });

  it("never pulls the camera closer than the minimum distance", () => {
    expect(armTargetLength(origin(), desired(), () => 0, 1.2, 0.2)).toBeCloseTo(1.2, 6);
  });

  it("never pushes the camera past the desired position", () => {
    expect(armTargetLength(origin(), desired(), () => 999, 1.2, 0.2)).toBeCloseTo(10, 6);
  });
});

describe("easeArmLength", () => {
  it("moves toward a shorter arm quickly and toward a longer one slowly", () => {
    const pulledIn = 7 - easeArmLength(7, 3, 1 / 60);
    const letOut = easeArmLength(3, 7, 1 / 60) - 3;
    expect(pulledIn).toBeGreaterThan(0);
    expect(letOut).toBeGreaterThan(0);
    expect(pulledIn).toBeGreaterThan(letOut * 3);
  });

  it("closes most of the way in within about CAMERA_ARM_IN_SECONDS, and out within CAMERA_ARM_OUT_SECONDS", () => {
    const inAfter = easeArmLength(7, 3, CAMERA_ARM_IN_SECONDS);
    const outAfter = easeArmLength(3, 7, CAMERA_ARM_OUT_SECONDS);
    // One time constant: all but e⁻¹ of the way.
    expect(inAfter - 3).toBeCloseTo(4 * Math.exp(-1), 6);
    expect(7 - outAfter).toBeCloseTo(4 * Math.exp(-1), 6);
  });

  it("never overshoots, however long the frame", () => {
    expect(easeArmLength(7, 3, 10)).toBeGreaterThanOrEqual(3);
    expect(easeArmLength(3, 7, 10)).toBeLessThanOrEqual(7);
  });

  it("does not jitter a steady arm: a hit that flickers on and off moves the camera only a little per frame", () => {
    // The pumping this exists for: one frame the ray hits at 3, the next it
    // misses and wants the full 7. Held for a second of alternating frames,
    // the camera settles instead of jumping 4 units every frame.
    let length = 7;
    const perFrame: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      const next = easeArmLength(length, frame % 2 === 0 ? 3 : 7, 1 / 60);
      perFrame.push(Math.abs(next - length));
      length = next;
    }
    expect(Math.max(...perFrame.slice(10))).toBeLessThan(1);
  });
});

describe("pointOnArm", () => {
  it("is `length` from the origin, toward the desired position", () => {
    const at = pointOnArm({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 13 }, 4);
    expect(at).toEqual({ x: 1, y: 2, z: 7 });
  });
});

describe("thickCast", () => {
  it("reports the nearest of five parallel rays: the centre and four a radius out", () => {
    const rays: { from: Vec3; to: Vec3 }[] = [];
    const cast = thickCast((from, to) => {
      rays.push({ from, to });
      // Only the ray offset upward hits something.
      return from.y > 0.1 ? 4 : null;
    }, 0.25);
    expect(cast(origin(), { x: 0, y: 0, z: 10 })).toBe(4);
    expect(rays).toHaveLength(5);
    for (const { from, to } of rays) {
      // Parallel to the arm, and a radius (or nothing) off it.
      expect(to.z - from.z).toBeCloseTo(10, 6);
      expect([0, 0.25]).toContainEqual(Number(Math.hypot(from.x, from.y).toFixed(6)));
    }
  });

  it("is clear when every ray is clear", () => {
    expect(thickCast(() => null, 0.25)(origin(), { x: 0, y: 3, z: 10 })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { rotateVec3ByQuat, type Vec3 } from "../math/vec3.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import {
  applyMotionPose,
  backAndForth,
  easeMotion,
  invalidMotionReason,
  MOTION_EASINGS,
  motionPointVelocity,
  motionPose,
  type SegmentMotion,
} from "./Motion.js";

const Y = { x: 0, y: 1, z: 0 };
const ORIGIN = { x: 0, y: 0, z: 0 };
const ticks = (seconds: number): number => seconds * TICK_RATE_HZ;
const expectVec = (actual: Vec3, expected: Vec3, digits = 6): void => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
};

describe("easeMotion", () => {
  it.each(MOTION_EASINGS)("%s starts at 0 and ends at 1", (easing) => {
    expect(easeMotion(easing, 0)).toBeCloseTo(0);
    expect(easeMotion(easing, 1)).toBeCloseTo(1);
  });

  it("eases in slowly and out slowly where named", () => {
    expect(easeMotion("easeIn", 0.25)).toBeLessThan(0.25);
    expect(easeMotion("easeOut", 0.25)).toBeGreaterThan(0.25);
    expect(easeMotion("easeInOut", 0.5)).toBeCloseTo(0.5);
  });
});

describe("backAndForth", () => {
  const timing = { period: 4, easing: "linear" as const, pause: 0.5 };

  it("goes out, holds, comes back, holds — over one period", () => {
    // travel = (4 - 2·0.5) / 2 = 1.5 s each way
    expect(backAndForth(timing, 0)).toBe(0);
    expect(backAndForth(timing, 0.75)).toBeCloseTo(0.5);
    expect(backAndForth(timing, 1.5)).toBe(1);
    expect(backAndForth(timing, 1.9)).toBe(1);
    expect(backAndForth(timing, 2.75)).toBeCloseTo(0.5);
    expect(backAndForth(timing, 3.6)).toBe(0);
  });

  it("repeats every period and shifts by phase", () => {
    expect(backAndForth(timing, 0.75 + 4 * 7)).toBeCloseTo(backAndForth(timing, 0.75));
    expect(backAndForth({ ...timing, phase: 0.5 }, 0.75)).toBeCloseTo(backAndForth(timing, 2.75));
  });
});

describe("motionPose", () => {
  it("spins about its pivot at a constant speed", () => {
    const motion: SegmentMotion = { spin: { axis: Y, pivot: { x: 1, y: 0, z: 0 }, speed: Math.PI / 2 } };
    // A quarter turn per second about x = 1: the origin swings to (1, 0, 1).
    expectVec(applyMotionPose(motionPose(motion, ticks(1)), ORIGIN), { x: 1, y: 0, z: 1 });
    expectVec(applyMotionPose(motionPose(motion, ticks(1)), { x: 1, y: 5, z: 0 }), { x: 1, y: 5, z: 0 });
  });

  it("swings between minus and plus its amplitude", () => {
    const motion: SegmentMotion = {
      swing: { axis: Y, pivot: ORIGIN, amplitude: Math.PI / 2, period: 2, easing: "easeInOut" },
    };
    const tip = { x: 1, y: 0, z: 0 };
    expectVec(applyMotionPose(motionPose(motion, 0), tip), rotateVec3ByQuat(tip, { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }));
    expectVec(applyMotionPose(motionPose(motion, ticks(0.5)), tip), tip);
    expectVec(applyMotionPose(motionPose(motion, ticks(1)), tip), { x: 0, y: 0, z: -1 });
  });

  it("slides between rest and its offset", () => {
    const motion: SegmentMotion = { slide: { offset: { x: 0, y: 3, z: 0 }, period: 2, easing: "linear" } };
    expectVec(motionPose(motion, 0).position, ORIGIN);
    expectVec(motionPose(motion, ticks(0.5)).position, { x: 0, y: 1.5, z: 0 });
    expectVec(motionPose(motion, ticks(1)).position, { x: 0, y: 3, z: 0 });
  });

  it("composes spin, then swing, then slide", () => {
    const motion: SegmentMotion = {
      spin: { axis: Y, pivot: ORIGIN, speed: Math.PI / 2 },
      slide: { offset: { x: 10, y: 0, z: 0 }, period: 2, easing: "linear" },
    };
    // At 1 s: spun a quarter turn about the rest origin, then slid the full 10.
    expectVec(applyMotionPose(motionPose(motion, ticks(1)), { x: 1, y: 0, z: 0 }), { x: 10, y: 0, z: -1 });
  });

  it("takes fractional ticks for render interpolation", () => {
    const motion: SegmentMotion = { slide: { offset: { x: 3, y: 0, z: 0 }, period: 2, easing: "linear" } };
    expect(motionPose(motion, 15.5).position.x).toBeGreaterThan(motionPose(motion, 15).position.x);
    expect(motionPose(motion, 15.5).position.x).toBeLessThan(motionPose(motion, 16).position.x);
  });
});

describe("motionPointVelocity", () => {
  it("is how far the point moves over the next tick, per second", () => {
    const motion: SegmentMotion = { spin: { axis: Y, pivot: ORIGIN, speed: 3 } };
    const rim = { x: 2, y: 0, z: 0 };
    const velocity = motionPointVelocity(motion, 10, rim);
    // |v| ≈ ω·r at a small per-tick angle; the rim is faster than the hub.
    expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(6, 1);
    const hub = motionPointVelocity(motion, 10, { x: 0.5, y: 0, z: 0 });
    expect(Math.hypot(hub.x, hub.y, hub.z)).toBeLessThan(2);
  });

  it("is zero while a back-and-forth holds at an end", () => {
    const motion: SegmentMotion = { slide: { offset: { x: 4, y: 0, z: 0 }, period: 4, easing: "linear", pause: 1 } };
    expectVec(motionPointVelocity(motion, ticks(1.2), ORIGIN), ORIGIN);
  });
});

describe("invalidMotionReason", () => {
  const spin = { axis: Y, pivot: ORIGIN, speed: 1 };
  const timing = { period: 2, easing: "linear" };

  it("accepts every kind, alone or together", () => {
    expect(invalidMotionReason({ spin })).toBeUndefined();
    expect(invalidMotionReason({ swing: { ...spin, amplitude: 1, ...timing } })).toBeUndefined();
    expect(invalidMotionReason({ slide: { offset: Y, ...timing, pause: 0.5, phase: 0.25 } })).toBeUndefined();
    expect(invalidMotionReason({ spin, slide: { offset: Y, ...timing } })).toBeUndefined();
  });

  it.each([
    [null, /object/],
    [{}, /spin, swing or slide/],
    [{ wobble: {} }, /unknown kind/],
    [{ spin: { ...spin, axis: ORIGIN } }, /axis/],
    [{ spin: { ...spin, speed: Number.NaN } }, /speed/],
    [{ slide: { offset: Y, ...timing, period: 0 } }, /period/],
    [{ slide: { offset: Y, ...timing, easing: "bounce" } }, /easing/],
    [{ slide: { offset: Y, ...timing, pause: 1 } }, /longer than its two pauses/],
    [{ swing: { ...spin, ...timing } }, /amplitude/],
  ])("refuses %j", (value, reason) => {
    expect(invalidMotionReason(value)).toMatch(reason);
  });
});

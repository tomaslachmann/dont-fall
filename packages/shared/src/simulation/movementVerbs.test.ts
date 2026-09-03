import { describe, expect, it } from "vitest";
import { pitchQuat } from "../math/quat.js";
import { rotateVec3ByQuat } from "../math/vec3.js";
import { SLOPE_SPEED_ANGLE_FACTOR, WALKABLE_SLOPE_MAX_ANGLE } from "../tuning.js";
import { dashEnvelope, slopeSpeedMultiplier } from "./movementVerbs.js";

describe("dashEnvelope", () => {
  const duration = 10;
  const rampOut = 2;

  it("is zero at and outside the burst boundaries", () => {
    expect(dashEnvelope(0, duration, rampOut)).toBe(0);
    expect(dashEnvelope(duration, duration, rampOut)).toBe(0);
    expect(dashEnvelope(-1, duration, rampOut)).toBe(0);
    expect(dashEnvelope(duration + 3, duration, rampOut)).toBe(0);
  });

  it("builds continuously toward full speed — never plateaus before the release", () => {
    // A "nitro" build: strictly increasing all the way through the build phase,
    // not an early ramp settling into a flat middle.
    const samples = [1, 2, 3, 4, 5, 6, 7].map((t) => dashEnvelope(t, duration, rampOut));
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]!);
    }
  });

  it("reaches full speed right where the release phase begins", () => {
    expect(dashEnvelope(duration - rampOut, duration, rampOut)).toBe(1);
  });

  it("releases smoothly back to zero over the final rampOut window", () => {
    const releaseStart = duration - rampOut;
    const a = dashEnvelope(releaseStart + 0.5, duration, rampOut);
    const b = dashEnvelope(releaseStart + 1, duration, rampOut);
    const c = dashEnvelope(releaseStart + 1.5, duration, rampOut);
    expect(a).toBeLessThan(1);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });

  it("is not symmetric — mirroring around the midpoint no longer matches (unlike the old ramp-plateau-ramp shape)", () => {
    const t = 3;
    expect(dashEnvelope(t, duration, rampOut)).not.toBeCloseTo(dashEnvelope(duration - t, duration, rampOut), 1);
  });

  it("falls back to a pure release (no build) when rampOut covers the whole burst", () => {
    // duration 6, rampOut clamped to 6: envelope is just the release curve throughout.
    const long = dashEnvelope(1, 6, 10);
    const short = dashEnvelope(1, 6, 6);
    expect(long).toBeCloseTo(short, 10);
  });
});

describe("slopeSpeedMultiplier (ticket 04, M3.6 — Unity's signed-slope-angle model, not Quake 3's re-normalise-to-flat one)", () => {
  const FLAT = { x: 0, y: 1, z: 0 };
  // A ground normal tilted toward +Z (PITCH > 0): the plane is higher at
  // negative Z, so travelling toward +Z is downhill, toward -Z is uphill —
  // matches how `RapierSimulation.test.ts`'s own tilted-floor fixtures read
  // the same `pitchQuat` convention.
  const tiltedNormal = (pitch: number) => rotateVec3ByQuat({ x: 0, y: 1, z: 0 }, pitchQuat(pitch));

  it("is exactly 1 on flat ground, in every direction — no slope, no effect", () => {
    expect(slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, FLAT)).toBe(1);
    expect(slopeSpeedMultiplier({ x: 1, y: 0, z: 0 }, FLAT)).toBe(1);
    expect(slopeSpeedMultiplier({ x: 1, y: 0, z: 1 }, FLAT)).toBe(1);
  });

  it("is exactly 1 when no horizontal direction is held — a stationary Character has no direction to be uphill/downhill relative to", () => {
    expect(slopeSpeedMultiplier({ x: 0, y: 0, z: 0 }, tiltedNormal(WALKABLE_SLOPE_MAX_ANGLE))).toBe(1);
  });

  it("is greater than 1 moving downhill, less than 1 moving uphill, on the same slope", () => {
    const normal = tiltedNormal(0.3);
    const downhill = slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, normal);
    const uphill = slopeSpeedMultiplier({ x: 0, y: 0, z: -1 }, normal);
    expect(downhill).toBeGreaterThan(1);
    expect(uphill).toBeLessThan(1);
  });

  it("is close to 1 moving perpendicular to the fall line (sidestepping across the slope, not up or down it)", () => {
    const normal = tiltedNormal(0.3);
    const sideways = slopeSpeedMultiplier({ x: 1, y: 0, z: 0 }, normal);
    expect(sideways).toBeCloseTo(1, 6);
  });

  it("is symmetric: the uphill penalty and downhill bonus are equal and opposite around 1, at the same angle", () => {
    const normal = tiltedNormal(0.3);
    const downhill = slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, normal);
    const uphill = slopeSpeedMultiplier({ x: 0, y: 0, z: -1 }, normal);
    expect(downhill - 1).toBeCloseTo(1 - uphill, 10);
  });

  it("matches the documented formula exactly at the walkable limit — the steepest angle this ever operates at", () => {
    const normal = tiltedNormal(WALKABLE_SLOPE_MAX_ANGLE);
    const downhill = slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, normal);
    const uphill = slopeSpeedMultiplier({ x: 0, y: 0, z: -1 }, normal);
    expect(downhill).toBeCloseTo(1 + SLOPE_SPEED_ANGLE_FACTOR * WALKABLE_SLOPE_MAX_ANGLE, 6);
    expect(uphill).toBeCloseTo(1 - SLOPE_SPEED_ANGLE_FACTOR * WALKABLE_SLOPE_MAX_ANGLE, 6);
  });

  it("a steeper slope produces a stronger effect than a shallower one, same direction", () => {
    const shallow = slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, tiltedNormal(0.1));
    const steep = slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, tiltedNormal(0.3));
    expect(steep).toBeGreaterThan(shallow);
  });

  it("normalises the move direction — magnitude never changes the multiplier, only which way it points", () => {
    const normal = tiltedNormal(0.3);
    const unit = slopeSpeedMultiplier({ x: 0, y: 0, z: 1 }, normal);
    const scaled = slopeSpeedMultiplier({ x: 0, y: 0, z: 5 }, normal);
    expect(scaled).toBeCloseTo(unit, 10);
  });
});

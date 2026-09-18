import { describe, expect, it } from "vitest";
import { pitchQuat } from "../math/quat.js";
import { lengthVec3, rotateVec3ByQuat, type Vec3 } from "../math/vec3.js";
import { TICK_DT } from "../tuning/clock.js";
import { MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR, MOVE_VELOCITY_CAP, SLOPE_SPEED_ANGLE_FACTOR, WALKABLE_SLOPE_MAX_ANGLE } from "../tuning/movement.js";
import { accelerateVelocity, applyVolumeForce, dashEnvelope, slopeSpeedMultiplier } from "./movementVerbs.js";

describe("dashEnvelope", () => {
  const duration = 10;
  const rampOut = 2;
  /** The pre-ADR-0092 shape: build across the whole burst, no plateau. */
  const nitro = (elapsed: number, d = duration, out = rampOut) => dashEnvelope(elapsed, d, d - out, out);

  it("is zero at and outside the burst boundaries", () => {
    expect(nitro(0)).toBe(0);
    expect(nitro(duration)).toBe(0);
    expect(nitro(-1)).toBe(0);
    expect(nitro(duration + 3)).toBe(0);
  });

  it("builds continuously toward full speed when the ramp fills the burst — never plateaus before the release", () => {
    // A "nitro" build: strictly increasing all the way through the build phase,
    // not an early ramp settling into a flat middle.
    const samples = [1, 2, 3, 4, 5, 6, 7].map((t) => nitro(t));
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]!);
    }
  });

  it("reaches full speed right where the release phase begins", () => {
    expect(nitro(duration - rampOut)).toBe(1);
  });

  it("releases smoothly back to zero over the final rampOut window", () => {
    const releaseStart = duration - rampOut;
    const a = nitro(releaseStart + 0.5);
    const b = nitro(releaseStart + 1);
    const c = nitro(releaseStart + 1.5);
    expect(a).toBeLessThan(1);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });

  it("is not symmetric — mirroring around the midpoint no longer matches (unlike the old ramp-plateau-ramp shape)", () => {
    const t = 3;
    expect(nitro(t)).not.toBeCloseTo(nitro(duration - t), 1);
  });

  it("falls back to a pure release (no build) when rampOut covers the whole burst", () => {
    // duration 6, rampOut clamped to 6: envelope is just the release curve throughout.
    const long = dashEnvelope(1, 6, 0, 10);
    const short = dashEnvelope(1, 6, 0, 6);
    expect(long).toBeCloseTo(short, 10);
  });

  it("holds full speed between the ramp and the release (ADR 0092's three-second burst)", () => {
    // The whole point of the ramp-in: a burst longer than its build spends the
    // middle AT full speed, not still accelerating toward it.
    const ramp = 3;
    expect(dashEnvelope(ramp, duration, ramp, rampOut)).toBe(1);
    expect(dashEnvelope(5, duration, ramp, rampOut)).toBe(1);
    expect(dashEnvelope(duration - rampOut - 0.001, duration, ramp, rampOut)).toBe(1);
    // …and is still building before it.
    expect(dashEnvelope(1, duration, ramp, rampOut)).toBeLessThan(1);
    expect(dashEnvelope(2, duration, ramp, rampOut)).toBeGreaterThan(dashEnvelope(1, duration, ramp, rampOut));
  });

  it("clamps a ramp that would overrun the release rather than losing the release", () => {
    // rampIn 20 on a 10-tick burst: the build is cut back to where the release
    // starts, so full speed is still reached and still eased out.
    expect(dashEnvelope(duration - rampOut, duration, 20, rampOut)).toBe(1);
    expect(dashEnvelope(duration - 0.5, duration, 20, rampOut)).toBeLessThan(1);
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

describe("accelerateVelocity (ticket 05, M3.6, ADR 0035 — Source's Friction()/Accelerate() shape, replacing a direct velocity.xz = wish assignment)", () => {
  const closeVec = (v: Vec3, expected: Vec3, precision = 6): void => {
    expect(v.x).toBeCloseTo(expected.x, precision);
    expect(v.z).toBeCloseTo(expected.z, precision);
  };
  // A deliberately small, illustrative pair of factors standing in for a
  // future low-grip Surface (ticket 06) — not derived from the production
  // MOVE_ACCEL_FACTOR/MOVE_FRICTION_FACTOR, which are chosen to saturate.
  const SLOW_FACTOR = 2;

  it("at the default (full-grip, saturating) factors, reaches the wish velocity exactly within a single tick — numerically identical to the old direct assignment, from any starting velocity", () => {
    const wish: Vec3 = { x: 6, y: 0, z: 0 };
    for (const current of [{ x: 0, y: 0, z: 0 }, { x: -6, y: 0, z: 0 }, { x: 0, y: 0, z: 6 }, { x: -21, y: 0, z: 15 }]) {
      const result = accelerateVelocity(current, wish, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR);
      closeVec(result, wish);
    }
  });

  it("at the default factors, a sharp reversal lands exactly on the new wish — no perpendicular or opposite residual carries over (unlike Quake-style strafe-jumping, deliberately)", () => {
    const current: Vec3 = { x: 0, y: 0, z: -21 }; // full speed one way
    const wish: Vec3 = { x: 21, y: 0, z: 0 }; // a hard 90° turn, same tick
    closeVec(accelerateVelocity(current, wish, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR), wish);
  });

  it("at the default factors, releasing input (wish = 0) stops dead within a single tick, from any speed", () => {
    for (const current of [{ x: 6, y: 0, z: 0 }, { x: -21, y: 0, z: 15 }]) {
      const result = accelerateVelocity(current, { x: 0, y: 0, z: 0 }, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR);
      closeVec(result, { x: 0, y: 0, z: 0 });
    }
  });

  it("at a slow (Surface-scaled) factor, does NOT reach the wish velocity in one tick — it moves only partway, in the wish direction", () => {
    const current: Vec3 = { x: 0, y: 0, z: 0 };
    const wish: Vec3 = { x: 6, y: 0, z: 0 };
    const result = accelerateVelocity(current, wish, SLOW_FACTOR, SLOW_FACTOR);
    expect(result.x).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(wish.x);
    expect(result.z).toBeCloseTo(0, 8);
  });

  it("at a slow factor, repeated ticks monotonically approach the wish velocity — a genuine ramp, not a snap (the exact failure mode a flat equal-magnitude accel/drag step had, and this Source-shaped one doesn't)", () => {
    const wish: Vec3 = { x: 6, y: 0, z: 0 };
    let current: Vec3 = { x: 0, y: 0, z: 0 };
    let prevDistance = lengthVec3({ x: wish.x - current.x, y: 0, z: wish.z - current.z });
    for (let i = 0; i < 15; i += 1) {
      current = accelerateVelocity(current, wish, SLOW_FACTOR, SLOW_FACTOR);
      const distance = lengthVec3({ x: wish.x - current.x, y: 0, z: wish.z - current.z });
      expect(distance).toBeLessThan(prevDistance);
      prevDistance = distance;
    }
    // Not just "closer," but meaningfully far along toward the target —
    // confirms it isn't just barely inching forward before stalling.
    expect(current.x).toBeGreaterThan(wish.x * 0.5);
  });

  it("accelerate never pushes speed-along-wish past wishSpeed in a single tick, approaching from below", () => {
    const wish: Vec3 = { x: 6, y: 0, z: 0 };
    const result = accelerateVelocity({ x: 0, y: 0, z: 0 }, wish, SLOW_FACTOR, SLOW_FACTOR);
    expect(result.x).toBeLessThanOrEqual(wish.x);
  });

  it("coasting down from above wishSpeed relies on friction alone (accelerate never fires against its own target) and never drops below it in one tick", () => {
    const wish: Vec3 = { x: 6, y: 0, z: 0 };
    const result = accelerateVelocity({ x: 10, y: 0, z: 0 }, wish, SLOW_FACTOR, SLOW_FACTOR);
    expect(result.x).toBeGreaterThanOrEqual(wish.x);
    expect(result.x).toBeLessThan(10); // friction still did *something*
  });

  it("caps the result at MOVE_VELOCITY_CAP even when the wish velocity itself exceeds it", () => {
    const oversizedWish: Vec3 = { x: MOVE_VELOCITY_CAP * 3, y: 0, z: 0 };
    const result = accelerateVelocity({ x: 0, y: 0, z: 0 }, oversizedWish, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR);
    expect(lengthVec3(result)).toBeCloseTo(MOVE_VELOCITY_CAP, 6);
  });

  it("always zeroes the result's Y component, regardless of current/wish's own Y — this is a horizontal-only pipeline (code review: not \"passed through untouched\" — vertical velocity is the caller's own responsibility entirely)", () => {
    const result = accelerateVelocity({ x: 0, y: 999, z: 0 }, { x: 6, y: -5, z: 0 }, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR);
    expect(result.y).toBe(0);
  });
});

describe("applyVolumeForce (M3.7 ticket 04, ADR 0036 — a Volume's continuous per-tick contribution)", () => {
  it("accelerates along force's own direction by force * TICK_DT", () => {
    const result = applyVolumeForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 0 }, 100);
    expect(result.y).toBeCloseTo(30 * TICK_DT, 10);
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
  });

  it("leaves velocity components perpendicular to force untouched", () => {
    const result = applyVolumeForce({ x: 5, y: 0, z: -3 }, { x: 0, y: 30, z: 0 }, 100);
    expect(result.x).toBe(5);
    expect(result.z).toBe(-3);
  });

  it("never exceeds maxInducedSpeed along force's own direction, however strong force is", () => {
    const result = applyVolumeForce({ x: 0, y: 0, z: 0 }, { x: 0, y: 10000, z: 0 }, 8);
    expect(result.y).toBeCloseTo(8, 10);
  });

  it("contributes nothing further once already at or beyond the cap — it never pulls the Character back down", () => {
    const result = applyVolumeForce({ x: 0, y: 15, z: 0 }, { x: 0, y: 30, z: 0 }, 8);
    expect(result.y).toBe(15);
  });

  it("clamps only the along-force component when starting above the cap on an unrelated axis (an updraft doesn't cap unrelated horizontal drift)", () => {
    const result = applyVolumeForce({ x: 50, y: 0, z: 0 }, { x: 0, y: 30, z: 0 }, 8);
    expect(result.x).toBe(50);
    expect(result.y).toBeCloseTo(30 * TICK_DT, 10);
  });

  it("a zero force is a no-op", () => {
    const velocity = { x: 1, y: 2, z: 3 };
    expect(applyVolumeForce(velocity, { x: 0, y: 0, z: 0 }, 100)).toEqual(velocity);
  });

  it("works along an arbitrary (non-axis-aligned) force direction, e.g. a horizontal wind tunnel", () => {
    const result = applyVolumeForce({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }, 100); // magnitude 5
    expect(lengthVec3(result)).toBeCloseTo(5 * TICK_DT, 10);
    expect(result.x / result.z).toBeCloseTo(3 / 4, 10); // same direction as force
  });
});

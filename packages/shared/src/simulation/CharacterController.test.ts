import { describe, expect, it } from "vitest";
import { lengthVec3, vec3 } from "../math/vec3.js";
import { IMPACT_RAGDOLL_MIN, WALL_IMPACT_MIN_SPEED, WALL_IMPACT_SCALE } from "../tuning.js";
import { wallImpactKnockback } from "./CharacterController.js";

describe("wallImpactKnockback", () => {
  it("bounces back along the outward normal, not into the surface", () => {
    // A wall face on the -x side of the obstacle reports normal1 = (-1,0,0)
    // (Rapier's CharacterCollision.normal1 already points away from the
    // obstacle, toward the Character) — the Knockback must point the same way.
    const impulse = wallImpactKnockback(vec3(-1, 0, 0), 10);
    expect(impulse.x).toBeLessThan(0);
  });

  it("matches the normal's horizontal direction on any wall orientation", () => {
    const normal = vec3(0.6, 0, -0.8); // an angled wall face
    const impulse = wallImpactKnockback(normal, 10);
    const dot = impulse.x * normal.x + impulse.z * normal.z;
    expect(dot).toBeGreaterThan(0);
  });

  it("scales magnitude with closing speed, not a flat constant", () => {
    const slow = wallImpactKnockback(vec3(1, 0, 0), 10);
    const fast = wallImpactKnockback(vec3(1, 0, 0), 20);
    const slowMag = Math.hypot(slow.x, slow.y, slow.z);
    const fastMag = Math.hypot(fast.x, fast.y, fast.z);
    expect(fastMag).toBeCloseTo(slowMag * 2, 6);
    expect(slowMag).toBeCloseTo(10 * WALL_IMPACT_SCALE, 10);
  });

  it("adds a small upward lift", () => {
    const impulse = wallImpactKnockback(vec3(1, 0, 0), 10);
    expect(impulse.y).toBeGreaterThan(0);
  });

  it("a barely-qualifying hit still forces Ragdoll, not just Stagger (code review)", () => {
    // WALL_IMPACT_SCALE is calibrated off DASH_SPEED (so a full-strength Dash
    // reproduces its old flat magnitude exactly), which on its own would let
    // closingSpeed === WALL_IMPACT_MIN_SPEED scale down below
    // IMPACT_RAGDOLL_MIN — resolveCollisions decided this was a wall hit, but
    // the resulting impulse would only Stagger the Character. The floor in
    // wallImpactKnockback closes that gap.
    const impulse = wallImpactKnockback(vec3(-1, 0, 0), WALL_IMPACT_MIN_SPEED);
    expect(lengthVec3(impulse)).toBeGreaterThanOrEqual(IMPACT_RAGDOLL_MIN);
  });
});

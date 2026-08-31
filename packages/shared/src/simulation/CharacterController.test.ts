import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec3.js";
import { DASH_WALL_IMPACT_MAGNITUDE } from "../tuning.js";
import { dashWallKnockback } from "./CharacterController.js";

describe("dashWallKnockback", () => {
  it("bounces back along the outward normal, not into the surface", () => {
    // A wall face on the -x side of the obstacle reports normal1 = (-1,0,0)
    // (Rapier's CharacterCollision.normal1 already points away from the
    // obstacle, toward the Character) — the Knockback must point the same way.
    const impulse = dashWallKnockback(vec3(-1, 0, 0));
    expect(impulse.x).toBeLessThan(0);
  });

  it("matches the normal's horizontal direction on any wall orientation", () => {
    const normal = vec3(0.6, 0, -0.8); // an angled wall face
    const impulse = dashWallKnockback(normal);
    const dot = impulse.x * normal.x + impulse.z * normal.z;
    expect(dot).toBeGreaterThan(0);
  });

  it("always has magnitude DASH_WALL_IMPACT_MAGNITUDE", () => {
    const impulse = dashWallKnockback(vec3(1, 0, 0));
    const magnitude = Math.hypot(impulse.x, impulse.y, impulse.z);
    expect(magnitude).toBeCloseTo(DASH_WALL_IMPACT_MAGNITUDE, 10);
  });

  it("adds a small upward lift", () => {
    const impulse = dashWallKnockback(vec3(1, 0, 0));
    expect(impulse.y).toBeGreaterThan(0);
  });
});

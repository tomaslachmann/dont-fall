import { describe, expect, it } from "vitest";
import { lengthVec3, vec3 } from "../math/vec3.js";
import { SPINNER_KNOCKBACK_LIFT, SPINNER_KNOCKBACK_SCALE } from "../tuning.js";
import { spinnerAngleAt, spinnerKnockback, type SpinnerConfig } from "./Spinner.js";

describe("spinnerKnockback", () => {
  const center = vec3(0, 1, 0);

  it("pushes tangentially, not radially outward", () => {
    // A point straight out along +x from a spinner rotating +1 rad/s around Y:
    // velocity = angularSpeed × r = (0,1,0) × (1,0,0) = (0,0,-1) — pure -z, no +x.
    const impulse = spinnerKnockback(center, 1, vec3(1, 1, 0));
    expect(impulse.x).toBeCloseTo(0, 5);
    expect(impulse.z).toBeLessThan(0);
  });

  it("hits harder farther from the axis", () => {
    const near = spinnerKnockback(center, 2, vec3(0.5, 1, 0));
    const far = spinnerKnockback(center, 2, vec3(3, 1, 0));
    const horizontal = (v: typeof near) => Math.hypot(v.x, v.z);
    expect(horizontal(far)).toBeGreaterThan(horizontal(near));
  });

  it("reverses direction with the spin", () => {
    const cw = spinnerKnockback(center, 2, vec3(1, 1, 0));
    const ccw = spinnerKnockback(center, -2, vec3(1, 1, 0));
    expect(cw.z).toBeLessThan(0);
    expect(ccw.z).toBeGreaterThan(0);
  });

  it("always adds the same upward lift", () => {
    const impulse = spinnerKnockback(center, 3, vec3(2, 1, 0));
    expect(impulse.y).toBe(SPINNER_KNOCKBACK_LIFT);
  });

  it("scales tangential speed by SPINNER_KNOCKBACK_SCALE", () => {
    const angularSpeed = 2;
    const point = vec3(2, 1, 0); // radius 2
    const impulse = spinnerKnockback(center, angularSpeed, point);
    const horizontalSpeed = Math.hypot(impulse.x, impulse.z);
    expect(horizontalSpeed).toBeCloseTo(angularSpeed * 2 * SPINNER_KNOCKBACK_SCALE, 5);
  });

  it("is a no-op magnitude at the axis itself", () => {
    const impulse = spinnerKnockback(center, 5, vec3(0, 1, 0));
    expect(lengthVec3(vec3(impulse.x, 0, impulse.z))).toBeCloseTo(0, 5);
  });
});

describe("spinnerAngleAt", () => {
  const config: SpinnerConfig = {
    center: vec3(0, 1, 0),
    armLength: 3,
    halfHeight: 0.3,
    armRadius: 0.2,
    angularSpeed: Math.PI, // half a turn per second
  };

  it("starts at initialAngle (default 0)", () => {
    expect(spinnerAngleAt(config, 0)).toBe(0);
  });

  it("advances proportionally to elapsed ticks", () => {
    // 30 ticks = 1 simulated second at TICK_RATE_HZ = 30
    expect(spinnerAngleAt(config, 30)).toBeCloseTo(Math.PI, 10);
  });

  it("honours a nonzero initialAngle", () => {
    const offset: SpinnerConfig = { ...config, initialAngle: 1 };
    expect(spinnerAngleAt(offset, 0)).toBe(1);
  });
});

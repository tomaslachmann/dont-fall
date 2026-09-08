import { describe, expect, it } from "vitest";
import { lerpAngle } from "./angle.js";

describe("lerpAngle", () => {
  it("interpolates linearly when there's no wraparound", () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 10);
    expect(lerpAngle(1, 0, 0.25)).toBeCloseTo(0.75, 10);
  });

  it("takes the shortest arc across the +/-PI wraparound, not the long way around", () => {
    // From just below +PI to just above -PI is a tiny step across the seam,
    // not a near-full-circle trip the other way.
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const result = lerpAngle(a, b, 0.5);
    // The shortest-arc midpoint is exactly PI (== -PI), wrapped consistently.
    expect(Math.abs(Math.abs(result) - Math.PI)).toBeLessThan(1e-9);
  });

  it("wraps the other direction symmetrically", () => {
    const a = -Math.PI + 0.1;
    const b = Math.PI - 0.1;
    const result = lerpAngle(a, b, 0.5);
    expect(Math.abs(Math.abs(result) - Math.PI)).toBeLessThan(1e-9);
  });

  it("t=0 returns a, t=1 returns b, exactly", () => {
    expect(lerpAngle(0.3, 2.9, 0)).toBeCloseTo(0.3, 10);
    expect(lerpAngle(0.3, 2.9, 1)).toBeCloseTo(2.9, 10);
  });

  it("a full-circle-apart pair (a === b) never drifts", () => {
    expect(lerpAngle(1.5, 1.5, 0.5)).toBeCloseTo(1.5, 10);
  });
});

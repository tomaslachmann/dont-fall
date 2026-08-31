import { describe, expect, it } from "vitest";
import { dashEnvelope } from "./movementVerbs.js";

describe("dashEnvelope", () => {
  const duration = 8;
  const ramp = 2;

  it("is zero at and outside the burst boundaries", () => {
    expect(dashEnvelope(0, duration, ramp)).toBe(0);
    expect(dashEnvelope(duration, duration, ramp)).toBe(0);
    expect(dashEnvelope(-1, duration, ramp)).toBe(0);
    expect(dashEnvelope(duration + 3, duration, ramp)).toBe(0);
  });

  it("holds full speed through the middle", () => {
    expect(dashEnvelope(duration / 2, duration, ramp)).toBe(1);
    expect(dashEnvelope(ramp + 0.5, duration, ramp)).toBe(1);
  });

  it("ramps up smoothly over the first `ramp` ticks", () => {
    const a = dashEnvelope(0.4, duration, ramp);
    const b = dashEnvelope(1.0, duration, ramp);
    const c = dashEnvelope(1.7, duration, ramp);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(1);
  });

  it("is symmetric — ramp-out mirrors ramp-in", () => {
    for (const t of [0.3, 0.8, 1.5]) {
      expect(dashEnvelope(t, duration, ramp)).toBeCloseTo(
        dashEnvelope(duration - t, duration, ramp),
        10,
      );
    }
  });

  it("becomes a smooth peak with no plateau when the ramps meet", () => {
    // duration 6, ramp clamped to 3: only the exact midpoint hits 1
    expect(dashEnvelope(2, 6, 5)).toBeGreaterThan(0);
    expect(dashEnvelope(2, 6, 5)).toBeLessThan(1);
    expect(dashEnvelope(4, 6, 5)).toBeLessThan(1);
    expect(dashEnvelope(3, 6, 5)).toBe(1);
  });
});

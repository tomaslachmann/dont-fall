import { describe, expect, it } from "vitest";
import { dashEnvelope } from "./movementVerbs.js";

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

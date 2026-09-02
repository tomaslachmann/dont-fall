import { describe, expect, it } from "vitest";
import { NetMetrics } from "./netMetrics.js";

describe("NetMetrics", () => {
  it("reports correction-distance percentiles over the recent window", () => {
    const m = new NetMetrics();
    for (let i = 1; i <= 100; i += 1) m.recordCorrection(i / 100); // 0.01 .. 1.00
    const line = m.format();
    // p50 ≈ 0.50, p95 ≈ 0.95, max = 1.00 — window is 90, so the oldest 10 fell off.
    expect(line).toMatch(/p50 0\.5[0-6]/);
    expect(line).toMatch(/p95 0\.9[5-9]/);
    expect(line).toMatch(/max 1\.00/);
  });

  it("counts reconciliations in the last second only", () => {
    const m = new NetMetrics();
    m.recordCorrection(0.1);
    m.recordCorrection(0.1);
    expect(m.reconcilesPerSec).toBe(2);
  });

  it("format is stable with no data", () => {
    expect(() => new NetMetrics().format()).not.toThrow();
  });
});

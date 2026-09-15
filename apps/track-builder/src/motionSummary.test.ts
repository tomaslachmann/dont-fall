import { describe, expect, it } from "vitest";
import { slideSummary, spinSummary, swingSummary } from "./motionSummary.js";

describe("motion card summaries", () => {
  it("spin reads degrees per second and the axis letter", () => {
    expect(spinSummary({ axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, speed: Math.PI / 2 })).toBe(
      "90 °/s · Y",
    );
  });

  it("swing reads amplitude, period and the axis letter", () => {
    expect(
      swingSummary({
        axis: { x: 1, y: 0, z: 0 },
        pivot: { x: 0, y: 0, z: 0 },
        amplitude: Math.PI / 4,
        period: 2.4,
        easing: "easeInOut",
      }),
    ).toBe("±45° · 2.4 s · X");
  });

  it("slide reads travel metres and period", () => {
    expect(
      slideSummary({ offset: { x: 6, y: 0, z: 0 }, period: 3, easing: "linear" }),
    ).toBe("6 m · 3 s");
  });
});

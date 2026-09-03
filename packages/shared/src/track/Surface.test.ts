import { describe, expect, it } from "vitest";
import { DEFAULT_SURFACE, SURFACES, surfaceConfig } from "./Surface.js";

describe("SURFACES (ticket 01 — mud, the first Surface)", () => {
  it("default has no effect on top speed", () => {
    expect(SURFACES[DEFAULT_SURFACE]!.topSpeedMultiplier).toBe(1);
  });

  it("mud caps top speed below default", () => {
    expect(SURFACES.mud!.topSpeedMultiplier).toBeLessThan(1);
    expect(SURFACES.mud!.topSpeedMultiplier).toBeGreaterThan(0);
  });
});

describe("SURFACES (ticket 06 — grip: one scalar multiplying both acceleration and drag)", () => {
  it("default has full grip", () => {
    expect(SURFACES[DEFAULT_SURFACE]!.grip).toBe(1);
  });

  it("mud is re-expressed in grip terms too — its own grip stays neutral (only its top speed is capped)", () => {
    expect(SURFACES.mud!.grip).toBe(1);
  });

  it("ice has near-zero grip, but not exactly zero — it still (slowly) accelerates and (slowly) stops, per the ticket's own \"accelerates slowly\" framing, not \"never moves\"", () => {
    expect(SURFACES.ice!.grip).toBeGreaterThan(0);
    expect(SURFACES.ice!.grip).toBeLessThan(0.2);
  });

  it("ice leaves top speed unchanged — \"ice makes you faster\" is the wrong intuition, per neither Quake nor Source altering max speed for slick surfaces", () => {
    expect(SURFACES.ice!.topSpeedMultiplier).toBe(1);
  });
});

describe("surfaceConfig", () => {
  it("looks up a known Surface", () => {
    expect(surfaceConfig("mud")).toBe(SURFACES.mud);
  });

  it("falls back to the default Surface for an unknown id", () => {
    expect(surfaceConfig("lava")).toBe(SURFACES[DEFAULT_SURFACE]);
  });

  it("falls back to the default Surface for undefined (no ground contact)", () => {
    expect(surfaceConfig(undefined)).toBe(SURFACES[DEFAULT_SURFACE]);
  });
});

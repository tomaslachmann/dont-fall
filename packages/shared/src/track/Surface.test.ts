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

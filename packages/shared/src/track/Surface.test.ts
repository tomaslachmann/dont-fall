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

  // ADR 0094 retires "ice leaves top speed alone" (ADR 0035/0036's Quake/Source
  // rule): a Player scrabbling along ice should not reach concrete's pace. Ice
  // keeps the milder penalty of the two slow Surfaces — the floor that takes
  // your feet is not also the one that takes your time.
  it("ice and mud both cost speed, and mud costs the most of any Surface", () => {
    expect(SURFACES.ice!.topSpeedMultiplier).toBeLessThan(1);
    expect(SURFACES.mud!.topSpeedMultiplier).toBeLessThan(SURFACES.ice!.topSpeedMultiplier);
  });

  // ADR 0094: the only multiplier above 1 — a deck that visibly bulges under
  // you has to be worth jumping on.
  it("mud costs a jump and a bounce deck gives one back", () => {
    expect(SURFACES.mud!.jumpMultiplier).toBeLessThan(1);
    expect(SURFACES.ice!.jumpMultiplier).toBeLessThan(1);
    expect(SURFACES.bounce!.jumpMultiplier).toBeGreaterThan(1);
  });
});

describe("SURFACES (M3.7 ticket 02 — bounce, a per-Surface landing property)", () => {
  it("no Surface bounces by default", () => {
    expect(SURFACES[DEFAULT_SURFACE]!.bounce).toBeUndefined();
    expect(SURFACES.mud!.bounce).toBeUndefined();
    expect(SURFACES.ice!.bounce).toBeUndefined();
  });

  it("bounce has a restitution under 1 (loses some energy each bounce, not a perpetual-motion trampoline) and a positive speed floor", () => {
    expect(SURFACES.bounce!.bounce).toBeDefined();
    expect(SURFACES.bounce!.bounce!.restitution).toBeGreaterThan(0);
    expect(SURFACES.bounce!.bounce!.restitution).toBeLessThan(1);
    expect(SURFACES.bounce!.bounce!.minSpeed).toBeGreaterThan(0);
  });

  it("bounce leaves top speed and grip alone — its whole effect is on landing, not on walking", () => {
    expect(SURFACES.bounce!.topSpeedMultiplier).toBe(1);
    expect(SURFACES.bounce!.grip).toBe(1);
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

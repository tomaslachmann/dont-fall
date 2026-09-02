import { describe, expect, it } from "vitest";
import { decayPositionOffset } from "./errorOffset.js";

describe("decayPositionOffset", () => {
  it("decays by exactly half over one half-life", () => {
    const after = decayPositionOffset({ x: 0.1, y: 0, z: 0 }, 100, 100, 2.0);
    expect(after.x).toBeCloseTo(0.05, 5);
  });

  it("honours a configurable half-life (the capsule's fixed value, unlike a Prop's blended one)", () => {
    const after50 = decayPositionOffset({ x: 0.1, y: 0, z: 0 }, 50, 50, 2.0);
    expect(after50.x).toBeCloseTo(0.05, 5);
    const after200 = decayPositionOffset({ x: 0.1, y: 0, z: 0 }, 200, 200, 2.0);
    expect(after200.x).toBeCloseTo(0.05, 5);
  });

  it("is frame-rate independent — two half-steps equal one full step", () => {
    const start = { x: 0.2, y: -0.1, z: 0.05 };
    const oneStep = decayPositionOffset(start, 16, 100, 2.0);
    const twoSteps = decayPositionOffset(decayPositionOffset(start, 8, 100, 2.0), 8, 100, 2.0);
    expect(twoSteps.x).toBeCloseTo(oneStep.x, 5);
    expect(twoSteps.y).toBeCloseTo(oneStep.y, 5);
    expect(twoSteps.z).toBeCloseTo(oneStep.z, 5);
  });

  it("drops the offset outright past the hard-snap distance — a genuine desync, not something to ease", () => {
    const after = decayPositionOffset({ x: 2.5, y: 0, z: 0 }, 16, 100, 2.0);
    expect(after).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("floors to zero below flatEpsilonM instead of fading forever at invisible fractions", () => {
    const after = decayPositionOffset({ x: 0.0003, y: 0, z: 0 }, 16, 100, 2.0, 0.0005);
    expect(after).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("does not floor when flatEpsilonM is left at its default (0)", () => {
    const after = decayPositionOffset({ x: 0.0003, y: 0, z: 0 }, 16, 100, 2.0);
    expect(after.x).toBeGreaterThan(0);
  });
});

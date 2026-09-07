import { DEFAULT_SURVIVOR_TARGET, MAX_SURVIVOR_TARGET, MIN_SURVIVOR_TARGET } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { parseDraftSurvivorTarget } from "./survivorTargetField.js";

describe("parseDraftSurvivorTarget", () => {
  it("takes an authored whole number of Players", () => {
    expect(parseDraftSurvivorTarget("4")).toBe(4);
  });

  it("takes the default for a blank field rather than clamping 0 up to the floor", () => {
    expect(parseDraftSurvivorTarget("")).toBe(DEFAULT_SURVIVOR_TARGET);
    expect(parseDraftSurvivorTarget("   ")).toBe(DEFAULT_SURVIVOR_TARGET);
  });

  it("takes the default for something that isn't a number at all", () => {
    expect(parseDraftSurvivorTarget("four")).toBe(DEFAULT_SURVIVOR_TARGET);
  });

  it("clamps an out-of-range target to the nearest legal one", () => {
    expect(parseDraftSurvivorTarget("0")).toBe(MIN_SURVIVOR_TARGET);
    expect(parseDraftSurvivorTarget("99")).toBe(MAX_SURVIVOR_TARGET);
  });

  it("rounds a fraction of a Player — half a survivor isn't an ending", () => {
    expect(parseDraftSurvivorTarget("3.4")).toBe(3);
    expect(parseDraftSurvivorTarget("3.6")).toBe(4);
  });
});

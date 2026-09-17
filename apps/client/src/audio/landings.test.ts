import { describe, expect, it } from "vitest";
import { LANDING_MIN_AIRBORNE_MS } from "../render/jumpSequence.js";
import { LAND_HEAVY_FALL_SPEED, Landings, landingSound } from "./landings.js";

describe("Landings (M14 ticket 02)", () => {
  it("reports a landing after enough air, with the peak fall speed", () => {
    const landings = new Landings();
    expect(landings.update("a", true, 0, 0)).toBeNull();
    expect(landings.update("a", false, 8, 16)).toBeNull();
    expect(landings.update("a", false, -12, 300)).toBeNull();
    expect(landings.update("a", false, -9, 400)).toBeNull();
    expect(landings.update("a", true, -2, 450)).toEqual({ fallSpeed: 12 });
    expect(landings.update("a", true, -2, 466)).toBeNull();
  });

  it("stays quiet for a step off a kerb", () => {
    const landings = new Landings();
    landings.update("a", true, 0, 0);
    landings.update("a", false, -3, 16);
    expect(landings.update("a", true, -2, 16 + LANDING_MIN_AIRBORNE_MS - 1)).toBeNull();
  });

  it("keeps Characters apart", () => {
    const landings = new Landings();
    landings.update("a", true, 0, 0);
    landings.update("b", true, 0, 0);
    landings.update("a", false, -10, 10);
    expect(landings.update("b", true, 0, 1000)).toBeNull();
    expect(landings.update("a", true, 0, 1000)).toEqual({ fallSpeed: 10 });
  });

  it("forgets the air time of a Character that went down", () => {
    const landings = new Landings();
    landings.update("a", true, 0, 0);
    landings.update("a", false, -10, 10);
    landings.forget("a");
    expect(landings.update("a", true, 0, 2000)).toBeNull();
  });
});

describe("landingSound", () => {
  it("is heavy from the heavy fall speed, and louder the faster the fall", () => {
    expect(landingSound({ fallSpeed: LAND_HEAVY_FALL_SPEED - 0.1 }).slot).toBe("character.land");
    expect(landingSound({ fallSpeed: LAND_HEAVY_FALL_SPEED }).slot).toBe("character.land_heavy");
    expect(landingSound({ fallSpeed: 2 }).gain).toBe(0.35);
    expect(landingSound({ fallSpeed: 10 }).gain).toBeGreaterThan(landingSound({ fallSpeed: 6 }).gain);
    expect(landingSound({ fallSpeed: 40 }).gain).toBe(1);
  });
});

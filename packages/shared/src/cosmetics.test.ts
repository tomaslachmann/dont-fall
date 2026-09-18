import { describe, expect, it } from "vitest";
import {
  BASE_BODY_COLOR_ID,
  BODY_COLOR_COUNT,
  BODY_COLOR_HUES,
  bodyColorHue,
  DEFAULT_BODY_COLOR,
  HATS,
  hatById,
  hatsUnlockedBetween,
  invalidBodyColorReason,
  invalidHatReason,
  isHatUnlocked,
  lockedHatReason,
} from "./cosmetics.js";
import { levelForXp, xpLevelStart } from "./economy.js";

describe("body skins (M9 ticket 15)", () => {
  it("accepts every owned skin — an int in range", () => {
    for (let id = 0; id < BODY_COLOR_COUNT; id += 1) {
      expect(invalidBodyColorReason(id)).toBeUndefined();
    }
  });

  it("refuses out-of-range skins and nonsense with a reason naming the fix", () => {
    for (const id of [BODY_COLOR_COUNT, BODY_COLOR_COUNT + 3, -1, 1.5, "0", null, undefined, {}]) {
      expect(invalidBodyColorReason(id)).toMatch(/color must be an integer/);
    }
  });

  it("maps every tinted skin to a hue — the renderer never looks one up missing", () => {
    expect(BODY_COLOR_HUES).toHaveLength(BODY_COLOR_COUNT - 1);
    for (const hue of BODY_COLOR_HUES) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    expect(DEFAULT_BODY_COLOR).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_BODY_COLOR).toBeLessThan(BODY_COLOR_COUNT);
  });

  it("resolves hues tri-state: a hue per tint, null for base, undefined for junk", () => {
    for (let id = 0; id < BODY_COLOR_HUES.length; id += 1) {
      expect(bodyColorHue(id)).toBe(BODY_COLOR_HUES[id]);
    }
    expect(bodyColorHue(BASE_BODY_COLOR_ID)).toBeNull();
    for (const junk of [null, BODY_COLOR_COUNT, -1, 1.5, Number.NaN]) {
      expect(bodyColorHue(junk)).toBeUndefined();
    }
  });
});

describe("hats (ADR 0083)", () => {
  it("has unique ids, and lists the cheapest unlock first", () => {
    expect(new Set(HATS.map((hat) => hat.id)).size).toBe(HATS.length);
    const levels = HATS.map((hat) => hat.unlockLevel);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(Math.min(...levels)).toBeGreaterThan(1);
  });

  it("covers the crest with every hat but the crown", () => {
    expect(HATS.filter((hat) => !hat.coversCrest).map((hat) => hat.id)).toEqual(["crown"]);
  });

  it("finds a hat by id, and nothing for anything else", () => {
    expect(hatById("crown")?.name).toBe("CROWN");
    for (const junk of ["Crown", "", null, undefined, 3, {}]) expect(hatById(junk)).toBeUndefined();
  });

  it("accepts a known hat or none, and refuses the rest with a reason naming the fix", () => {
    expect(invalidHatReason(null)).toBeUndefined();
    for (const hat of HATS) expect(invalidHatReason(hat.id)).toBeUndefined();
    for (const junk of ["Crown", "", undefined, 3, {}]) {
      expect(invalidHatReason(junk)).toMatch(/hat must be null or one of: cone, /);
    }
  });

  it("unlocks a hat at its level of XP, not a point before", () => {
    const cone = hatById("cone")!;
    expect(isHatUnlocked(cone, 0)).toBe(false);
    expect(isHatUnlocked(cone, xpLevelStart(cone.unlockLevel) - 1)).toBe(false);
    expect(isHatUnlocked(cone, xpLevelStart(cone.unlockLevel))).toBe(true);
    expect(levelForXp(xpLevelStart(cone.unlockLevel))).toBe(cone.unlockLevel);
  });

  it("says which level a locked hat needs, and nothing for taking a hat off", () => {
    expect(lockedHatReason("ufo", 0)).toBe("UFO unlocks at level 30");
    expect(lockedHatReason("ufo", xpLevelStart(30))).toBeUndefined();
    expect(lockedHatReason(null, 0)).toBeUndefined();
  });

  it("lists the hats a Match's XP unlocked — none when no unlock level was crossed", () => {
    expect(hatsUnlockedBetween(0, xpLevelStart(2) - 1)).toEqual([]);
    expect(hatsUnlockedBetween(0, xpLevelStart(2)).map((hat) => hat.id)).toEqual(["cone"]);
    expect(hatsUnlockedBetween(xpLevelStart(4), xpLevelStart(9)).map((hat) => hat.id)).toEqual(["pot", "bucket"]);
    expect(hatsUnlockedBetween(xpLevelStart(9), xpLevelStart(9) + 10)).toEqual([]);
  });
});

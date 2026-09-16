import { describe, expect, it } from "vitest";
import {
  BASE_BODY_SKIN_ID,
  BODY_SKIN_COUNT,
  BODY_SKIN_HUES,
  bodySkinHue,
  DEFAULT_BODY_SKIN,
  invalidBodySkinReason,
} from "./cosmetics.js";

describe("body skins (M9 ticket 15)", () => {
  it("accepts every owned skin — an int in range", () => {
    for (let id = 0; id < BODY_SKIN_COUNT; id += 1) {
      expect(invalidBodySkinReason(id)).toBeUndefined();
    }
  });

  it("refuses out-of-range skins and nonsense with a reason naming the fix", () => {
    for (const id of [BODY_SKIN_COUNT, BODY_SKIN_COUNT + 3, -1, 1.5, "0", null, undefined, {}]) {
      expect(invalidBodySkinReason(id)).toMatch(/bodySkin must be an integer/);
    }
  });

  it("maps every tinted skin to a hue — the renderer never looks one up missing", () => {
    expect(BODY_SKIN_HUES).toHaveLength(BODY_SKIN_COUNT - 1);
    for (const hue of BODY_SKIN_HUES) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    expect(DEFAULT_BODY_SKIN).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_BODY_SKIN).toBeLessThan(BODY_SKIN_COUNT);
  });

  it("resolves hues tri-state: a hue per tint, null for base, undefined for junk", () => {
    for (let id = 0; id < BODY_SKIN_HUES.length; id += 1) {
      expect(bodySkinHue(id)).toBe(BODY_SKIN_HUES[id]);
    }
    expect(bodySkinHue(BASE_BODY_SKIN_ID)).toBeNull();
    for (const junk of [null, BODY_SKIN_COUNT, -1, 1.5, Number.NaN]) {
      expect(bodySkinHue(junk)).toBeUndefined();
    }
  });
});

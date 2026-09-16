import { describe, expect, it } from "vitest";
import {
  clampLaunchHeight,
  invalidLaunchReason,
  isSegmentLaunch,
  launchHeightOf,
  launchVelocityFor,
  type LaunchDef,
} from "./Launch.js";
import { GRAVITY_Y, LAUNCH_HEIGHT_MAX, LAUNCH_HEIGHT_MIN, LAUNCH_HEIGHT_PRESETS, launchHeightToSpeed } from "../tuning.js";

/** Where a body thrown straight up at `speed` stops rising, under this game's own gravity. */
const apexOf = (speed: number): number => (speed * speed) / (2 * Math.abs(GRAVITY_Y));

describe("launchHeightToSpeed (ADR 0069)", () => {
  it("throws to exactly the height it was given — the number the author types is the number they get", () => {
    for (const height of [LAUNCH_HEIGHT_MIN, 3, 6, 7.5, 10, LAUNCH_HEIGHT_MAX]) {
      expect(apexOf(launchHeightToSpeed(height))).toBeCloseTo(height, 10);
    }
  });

  it("puts every preset well clear of a plain jump", () => {
    // JUMP_VELOCITY 10 under GRAVITY_Y -22 apexes at ~2.3 — the low preset
    // must read as a Spring, not as a slightly better jump.
    const jumpApex = apexOf(10);
    for (const height of Object.values(LAUNCH_HEIGHT_PRESETS)) expect(height).toBeGreaterThan(jumpApex * 1.25);
  });
});

describe("launchVelocityFor", () => {
  it("points straight up the Module's own +Y — a Spring is aimed by tilting its Segment, never by a second field", () => {
    const v = launchVelocityFor(6);
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
    expect(v.y).toBeCloseTo(launchHeightToSpeed(6), 10);
  });
});

describe("invalidLaunchReason", () => {
  it("accepts a height inside the authorable range", () => {
    expect(invalidLaunchReason({ height: LAUNCH_HEIGHT_MIN })).toBeUndefined();
    expect(invalidLaunchReason({ height: 6.25 })).toBeUndefined();
    expect(invalidLaunchReason({ height: LAUNCH_HEIGHT_MAX })).toBeUndefined();
    expect(isSegmentLaunch({ height: 6 })).toBe(true);
  });

  it("names why a launch is unstorable rather than letting it reach a Match", () => {
    expect(invalidLaunchReason(null)).toMatch(/must be an object/);
    expect(invalidLaunchReason(6)).toMatch(/must be an object/);
    expect(invalidLaunchReason({})).toMatch(/finite number of metres/);
    expect(invalidLaunchReason({ height: Number.NaN })).toMatch(/finite number of metres/);
    expect(invalidLaunchReason({ height: Number.POSITIVE_INFINITY })).toMatch(/finite number of metres/);
    expect(invalidLaunchReason({ height: LAUNCH_HEIGHT_MIN - 0.01 })).toMatch(/between/);
    expect(invalidLaunchReason({ height: LAUNCH_HEIGHT_MAX + 0.01 })).toMatch(/between/);
    expect(isSegmentLaunch({ height: 0 })).toBe(false);
  });
});

describe("clampLaunchHeight", () => {
  it("pulls a typed number into range instead of storing an invalid Track", () => {
    expect(clampLaunchHeight(0)).toBe(LAUNCH_HEIGHT_MIN);
    expect(clampLaunchHeight(999)).toBe(LAUNCH_HEIGHT_MAX);
    expect(clampLaunchHeight(7.5)).toBe(7.5);
  });
});

describe("launchHeightOf", () => {
  const def: LaunchDef = { trigger: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }, height: 6 };

  it("uses the Asset's own default when the Segment says nothing — a placed Spring is never dead", () => {
    expect(launchHeightOf(undefined, def)).toBe(6);
  });

  it("lets the Segment override it", () => {
    expect(launchHeightOf({ height: 12 }, def)).toBe(12);
  });
});

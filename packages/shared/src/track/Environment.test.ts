import { describe, expect, it } from "vitest";
import {
  CLOUD_FLOOR_MIN_CLEARANCE,
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENT_IDS,
  ENVIRONMENT_PRESETS,
  ENVIRONMENT_PUFF_STYLES,
  cloudFloorY,
  invalidEnvironmentReason,
  isEnvironmentId,
  resolveEnvironmentId,
  sunDirection,
  sunLightDirection,
  wrapAround,
  type EnvironmentPreset,
} from "./Environment.js";
import { DEFAULT_KILL_PLANE_Y } from "../tuning.js";

const DAY = ENVIRONMENT_PRESETS.day;

const withSun = (azimuthDeg: number, elevationDeg: number, lightElevationDeg?: number): EnvironmentPreset => ({
  ...DAY,
  sky: { ...DAY.sky, sun: { ...DAY.sky.sun, azimuthDeg, elevationDeg } },
  light: lightElevationDeg === undefined ? { ...DAY.light } : { ...DAY.light, lightElevationDeg },
});

const length = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z);

describe("the presets", () => {
  it("has one for every id, and the default is one of them", () => {
    expect(Object.keys(ENVIRONMENT_PRESETS).sort()).toEqual([...ENVIRONMENT_IDS].sort());
    expect(ENVIRONMENT_IDS).toContain(DEFAULT_ENVIRONMENT_ID);
  });

  it.each(ENVIRONMENT_IDS)("%s holds 24-bit colours and fog that clears before it closes", (id) => {
    const preset = ENVIRONMENT_PRESETS[id];
    const colours = [
      preset.sky.zenith,
      preset.sky.horizon,
      preset.sky.nadir,
      preset.sky.sun.color,
      preset.light.hemiSky,
      preset.light.sunColor,
      preset.cloudFloor.lit,
      preset.cloudFloor.shade,
      preset.puffs.lit,
      preset.puffs.shade,
    ];
    for (const colour of colours) {
      expect(Number.isInteger(colour) && colour >= 0 && colour <= 0xffffff).toBe(true);
    }
    expect(preset.fog.near).toBeGreaterThanOrEqual(0);
    expect(preset.fog.far).toBeGreaterThan(preset.fog.near);
    expect(preset.exposure).toBeGreaterThan(0);
    for (const band of preset.puffs.bands) expect(band.high).toBeGreaterThan(band.low);
    expect(preset.cloudFloor.openBelow).toBeGreaterThanOrEqual(0);
    expect(preset.cloudFloor.openBelow).toBeLessThan(1);
    expect(ENVIRONMENT_PUFF_STYLES).toContain(preset.puffs.style);
    expect(Number.isInteger(preset.puffs.count) && preset.puffs.count >= 0).toBe(true);
    const { stars } = preset.sky;
    if (stars) {
      expect(Number.isInteger(stars.color) && stars.color >= 0 && stars.color <= 0xffffff).toBe(true);
      expect(Number.isInteger(stars.count) && stars.count >= 0).toBe(true);
      expect(stars.size).toBeGreaterThan(0);
    }
  });

  it("gives every id its own palette", () => {
    const presets = ENVIRONMENT_IDS.map((id) => ENVIRONMENT_PRESETS[id]);
    expect(new Set(presets).size).toBe(ENVIRONMENT_IDS.length);
  });

  it.each(ENVIRONMENT_IDS)("%s keeps its light above the horizon, so decks are always lit from above", (id) => {
    expect(sunLightDirection(ENVIRONMENT_PRESETS[id]).y).toBeGreaterThan(0.5);
  });

  it("shows the sunset sun where a Round's chase camera can see it: low, and ahead of a run toward −Z", () => {
    const sun = sunDirection(ENVIRONMENT_PRESETS.sunset);
    // The chase camera never shows more than ~22° above the horizon (research §1c).
    expect(sun.y).toBeGreaterThan(0);
    expect(Math.asin(sun.y)).toBeLessThan((22 * Math.PI) / 180);
    expect(sun.z).toBeLessThan(0);
  });

  it("gives night stars, and no other preset any", () => {
    expect(ENVIRONMENT_PRESETS.night.sky.stars?.count).toBeGreaterThan(0);
    expect(ENVIRONMENT_PRESETS.day.sky.stars).toBeUndefined();
    expect(ENVIRONMENT_PRESETS.sunset.sky.stars).toBeUndefined();
  });
});

describe("invalidEnvironmentReason", () => {
  it.each(ENVIRONMENT_IDS)("accepts %s", (id) => {
    expect(invalidEnvironmentReason(id)).toBeUndefined();
    expect(isEnvironmentId(id)).toBe(true);
  });

  it.each([["Day"], ["candy"], [""], [undefined], [null], [3], ["toString"], [["day"]]])(
    "refuses %j with a readable reason",
    (value) => {
      expect(invalidEnvironmentReason(value)).toBe("environment must be one of day, sunset, night");
      expect(isEnvironmentId(value)).toBe(false);
    },
  );
});

describe("resolveEnvironmentId", () => {
  it("keeps a known id, with no warning", () => {
    expect(resolveEnvironmentId("night")).toEqual({ id: "night", warning: undefined });
  });

  it("falls back to the default, with a warning naming the id, for one this build does not know", () => {
    const { id, warning } = resolveEnvironmentId("candy");
    expect(id).toBe(DEFAULT_ENVIRONMENT_ID);
    expect(warning).toContain('"candy"');
  });

  it("falls back silently when the field is missing", () => {
    expect(resolveEnvironmentId(undefined)).toEqual({ id: DEFAULT_ENVIRONMENT_ID, warning: undefined });
    expect(resolveEnvironmentId(null)).toEqual({ id: DEFAULT_ENVIRONMENT_ID, warning: undefined });
  });
});

describe("sunDirection", () => {
  it("points along +Z at azimuth 0 on the horizon, and along +X at azimuth 90", () => {
    const north = sunDirection(withSun(0, 0));
    expect(north.x).toBeCloseTo(0, 10);
    expect(north.y).toBeCloseTo(0, 10);
    expect(north.z).toBeCloseTo(1, 10);

    const east = sunDirection(withSun(90, 0));
    expect(east.x).toBeCloseTo(1, 10);
    expect(east.z).toBeCloseTo(0, 10);
  });

  it("points straight up at elevation 90, whatever the azimuth", () => {
    const up = sunDirection(withSun(137, 90));
    expect(up.x).toBeCloseTo(0, 10);
    expect(up.y).toBeCloseTo(1, 10);
    expect(up.z).toBeCloseTo(0, 10);
  });

  it("is a unit vector whose elevation is the preset's", () => {
    const d = sunDirection(withSun(60, 55));
    expect(length(d)).toBeCloseTo(1, 10);
    expect(Math.asin(d.y) * (180 / Math.PI)).toBeCloseTo(55, 10);
  });

  it("puts day's sun about where the old hardcoded light stood, (10, 18, 6)", () => {
    const d = sunDirection(DAY);
    const old = { x: 10 / Math.hypot(10, 18, 6), y: 18 / Math.hypot(10, 18, 6), z: 6 / Math.hypot(10, 18, 6) };
    expect(d.x * old.x + d.y * old.y + d.z * old.z).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
  });
});

describe("sunLightDirection", () => {
  it("is the drawn sun's direction when the preset does not lift the light", () => {
    const preset = withSun(200, 8);
    expect(sunLightDirection(preset)).toEqual(sunDirection(preset));
  });

  it("keeps the sun's azimuth but takes lightElevationDeg when set", () => {
    const preset = withSun(200, 8, 35);
    const light = sunLightDirection(preset);
    const sun = sunDirection(preset);
    expect(Math.asin(light.y) * (180 / Math.PI)).toBeCloseTo(35, 10);
    expect(Math.atan2(light.x, light.z)).toBeCloseTo(Math.atan2(sun.x, sun.z), 10);
    expect(length(light)).toBeCloseTo(1, 10);
  });
});

describe("cloudFloorY", () => {
  const offset = DAY.cloudFloor.offsetAboveKillPlane;

  it("sits the preset's offset above the kill height under a Track well clear of it", () => {
    expect(cloudFloorY(DAY, DEFAULT_KILL_PLANE_Y, 0)).toBe(DEFAULT_KILL_PLANE_Y + offset);
  });

  it("stays under a Segment only 2.8 above the kill height (the lowest stored Track, research §1d)", () => {
    const lowest = DEFAULT_KILL_PLANE_Y + 2.8;
    const y = cloudFloorY(DAY, DEFAULT_KILL_PLANE_Y, lowest);
    expect(y).toBeLessThanOrEqual(lowest - CLOUD_FLOOR_MIN_CLEARANCE);
    expect(y).toBeGreaterThan(DEFAULT_KILL_PLANE_Y);
  });

  it("is clamped under geometry that reaches nearer the kill height than the offset", () => {
    const lowest = DEFAULT_KILL_PLANE_Y + 0.2;
    expect(cloudFloorY(DAY, DEFAULT_KILL_PLANE_Y, lowest)).toBe(lowest - CLOUD_FLOOR_MIN_CLEARANCE);
  });

  it("follows the kill height it is given, and treats a Track with nothing drawn as unbounded", () => {
    expect(cloudFloorY(DAY, -20, Infinity)).toBe(-20 + offset);
  });
});

describe("wrapAround", () => {
  it("leaves a value already inside the tile alone", () => {
    expect(wrapAround(3, 0, 100)).toBe(3);
    expect(wrapAround(-49, 0, 100)).toBe(-49);
  });

  it("moves a value past either edge by whole tiles into the tile", () => {
    expect(wrapAround(60, 0, 100)).toBe(-40);
    expect(wrapAround(-60, 0, 100)).toBe(40);
    expect(wrapAround(1234, 0, 100)).toBe(34);
    expect(wrapAround(-1234, 0, 100)).toBe(-34);
  });

  it("is half-open: the low edge stays, the high edge wraps to the low one", () => {
    expect(wrapAround(-50, 0, 100)).toBe(-50);
    expect(wrapAround(50, 0, 100)).toBe(-50);
  });

  it("centres the tile on the camera, wherever it is", () => {
    expect(wrapAround(0, 1000, 100)).toBe(1000);
    expect(wrapAround(940, 1000, 100)).toBe(1040);
    expect(wrapAround(1051, 1000, 100)).toBe(951);
  });

  it("always lands in [center - size/2, center + size/2), even for a value a hair below a tile edge", () => {
    const cases: [number, number][] = [
      [-50 - 1e-15, 0],
      [0.1 + 0.2, 7.3],
      [-1e-17, 50],
      [123456.789, -98765.4321],
    ];
    for (const [value, center] of cases) {
      const wrapped = wrapAround(value, center, 100);
      expect(wrapped).toBeGreaterThanOrEqual(center - 50);
      expect(wrapped).toBeLessThan(center + 50);
      const tiles = (wrapped - value) / 100;
      expect(Math.abs(tiles - Math.round(tiles))).toBeLessThan(1e-6);
    }
  });
});

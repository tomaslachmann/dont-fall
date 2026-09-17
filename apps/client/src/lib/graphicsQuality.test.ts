import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPHICS_QUALITY,
  GRAPHICS_QUALITY_LEVELS,
  GRAPHICS_QUALITY_SETTINGS,
  GRAPHICS_QUALITY_STORAGE_KEY,
  readGraphicsQuality,
  writeGraphicsQuality,
} from "./graphicsQuality.js";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("graphics quality (ADR 0079, M13 ticket 05)", () => {
  it("defaults to high, today's look", () => {
    expect(DEFAULT_GRAPHICS_QUALITY).toBe("high");
    expect(GRAPHICS_QUALITY_LEVELS).toEqual(["high", "medium", "low"]);
  });

  it("keeps high exactly as M12 shipped it", () => {
    expect(GRAPHICS_QUALITY_SETTINGS.high).toEqual({
      maxPixelRatio: 2,
      composerSamples: 4,
      shadows: { mapSize: 2048, filter: "soft" },
      cloudPuffs: true,
    });
  });

  it("gets cheaper at every step down, and only low turns shadows off", () => {
    const [high, medium, low] = GRAPHICS_QUALITY_LEVELS.map((level) => GRAPHICS_QUALITY_SETTINGS[level]);
    expect(medium!.maxPixelRatio).toBeLessThan(high!.maxPixelRatio);
    expect(low!.maxPixelRatio).toBeLessThan(medium!.maxPixelRatio);
    expect(medium!.composerSamples).toBeLessThan(high!.composerSamples);
    expect(low!.composerSamples).toBe(0);
    expect(medium!.shadows!.mapSize).toBeLessThan(high!.shadows!.mapSize);
    expect(medium!.shadows!.filter).toBe("pcf");
    expect(low!.shadows).toBeNull();
    expect(low!.cloudPuffs).toBe(false);
  });

  it("stores a level per device and reads it back", () => {
    const storage = memoryStorage();
    expect(readGraphicsQuality(storage)).toBe("high");
    writeGraphicsQuality(storage, "low");
    expect(storage.values.get(GRAPHICS_QUALITY_STORAGE_KEY)).toBe("low");
    expect(readGraphicsQuality(storage)).toBe("low");
  });

  it("reads anything unknown or unreadable as the default, and never throws", () => {
    const storage = memoryStorage();
    storage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, "ultra");
    expect(readGraphicsQuality(storage)).toBe("high");
    expect(readGraphicsQuality(null)).toBe("high");
    expect(readGraphicsQuality(throwing)).toBe("high");
    expect(() => writeGraphicsQuality(throwing, "low")).not.toThrow();
  });
});

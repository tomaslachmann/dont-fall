import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSoundCredits } from "./credits.js";
import { SOUND_SLOTS } from "./slots.js";

const soundsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "sounds");

describe("SOUND_SLOTS (M14 ticket 02)", () => {
  const credited = new Set(parseSoundCredits(readFileSync(join(soundsDir, "CREDITS.md"), "utf8")).map((credit) => credit.file));

  it("points every slot at files that ship and are credited", () => {
    for (const [slot, config] of Object.entries(SOUND_SLOTS)) {
      expect(config.files.length, slot).toBeGreaterThan(0);
      for (const file of config.files) {
        expect(existsSync(join(soundsDir, file)), `${slot}: ${file}`).toBe(true);
        expect(credited.has(file), `${slot}: ${file} credited`).toBe(true);
      }
    }
  });

  it("keeps distances ordered and gains sane", () => {
    for (const [slot, config] of Object.entries(SOUND_SLOTS)) {
      expect(config.maxDistance, slot).toBeGreaterThanOrEqual(config.refDistance);
      expect(config.gain, slot).toBeGreaterThan(0);
      expect(config.gain, slot).toBeLessThanOrEqual(1);
      expect(config.pitchJitter, slot).toBeLessThan(0.25);
    }
  });
});

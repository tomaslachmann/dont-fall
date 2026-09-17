import { ENVIRONMENT_IDS, ENVIRONMENT_PRESETS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { cloudFloorFade } from "./cloudFloor.js";
import { FOG_FAR_PLANE_MARGIN, fogFarPlane } from "./farPlane.js";

describe("fogFarPlane (M13 ticket 04)", () => {
  it("draws a little past each preset's fog, and no further", () => {
    for (const id of ENVIRONMENT_IDS) {
      const preset = ENVIRONMENT_PRESETS[id];
      expect(fogFarPlane(preset)).toBe(preset.fog.far + FOG_FAR_PLANE_MARGIN);
    }
    expect(fogFarPlane(ENVIRONMENT_PRESETS.day)).toBe(180);
    expect(fogFarPlane(ENVIRONMENT_PRESETS.night)).toBe(200);
  });

  it("clips the cloud floor for every preset, so the floor always fades before it", () => {
    for (const id of ENVIRONMENT_IDS) {
      const fade = cloudFloorFade(fogFarPlane(ENVIRONMENT_PRESETS[id]));
      expect(fade.fromCamera).toBe(true);
      expect(fade.end).toBeLessThan(fogFarPlane(ENVIRONMENT_PRESETS[id]));
      // And never before the fog itself has hidden the floor's own colour.
      expect(fade.end).toBeGreaterThanOrEqual(ENVIRONMENT_PRESETS[id].fog.far);
    }
  });
});

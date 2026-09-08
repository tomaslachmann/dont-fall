import { describe, expect, it } from "vitest";
import { tintHueForId } from "./playerTint.js";

describe("tintHueForId", () => {
  it("is deterministic — the same id always hashes to the same hue", () => {
    const id = "a-session-id";
    expect(tintHueForId(id)).toBe(tintHueForId(id));
  });

  it("returns a hue in [0, 360)", () => {
    for (const id of ["a", "b", "abcdef", "session-1234", ""]) {
      const hue = tintHueForId(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("spreads different ids across different hues, not one bucket", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `player-${i}`);
    const hues = new Set(ids.map(tintHueForId));
    // Not a strict pigeonhole proof, but 12 real session-id-shaped strings
    // collapsing to one or two hues would make every player look the same —
    // exactly the regression this guards against.
    expect(hues.size).toBeGreaterThan(6);
  });
});

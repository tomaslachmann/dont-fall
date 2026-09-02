import { describe, expect, it } from "vitest";
import { generateRandomTrack } from "./generate.js";

describe("generateRandomTrack", () => {
  it("produces a Track with the requested number of Segments", () => {
    const track = generateRandomTrack(["a", "b", "c"], 7);
    expect(track).toHaveLength(7);
  });

  it("only ever picks Modules from the given list", () => {
    const track = generateRandomTrack(["only-one"], 5);
    expect(track.every((s) => s.moduleId === "only-one")).toBe(true);
  });

  it("chains Segments with no gaps by construction (ADR 0030) — same as chainTrack", () => {
    const track = generateRandomTrack(["a", "b"], 3);
    expect(track[0]!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(track[0]!.rotation).toBe(0);
  });

  it("throws when the Module library is empty", () => {
    expect(() => generateRandomTrack([])).toThrow(/empty Module library/);
  });

  it("defaults to a non-trivial length when count is omitted", () => {
    const track = generateRandomTrack(["a"]);
    expect(track.length).toBeGreaterThan(1);
  });
});

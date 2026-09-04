import { describe, expect, it } from "vitest";
import { qualificationPlacement } from "./qualification.js";

const at = (...ticks: (number | null)[]): Record<string, { finishTick: number | null }> =>
  Object.fromEntries(ticks.map((finishTick, i) => [`p${i}`, { finishTick }]));

describe("qualificationPlacement", () => {
  it("is null for a Character that has not Qualified", () => {
    expect(qualificationPlacement(at(10, null), "p1")).toBeNull();
  });

  it("is null for a Character that isn't in the snapshot at all", () => {
    expect(qualificationPlacement(at(10), "nobody")).toBeNull();
  });

  it("ranks by finish Tick, earliest first", () => {
    const characters = at(30, 10, 20);

    expect(qualificationPlacement(characters, "p1")).toBe(1);
    expect(qualificationPlacement(characters, "p2")).toBe(2);
    expect(qualificationPlacement(characters, "p0")).toBe(3);
  });

  it("counts only Qualified Characters — someone still running never occupies a place", () => {
    expect(qualificationPlacement(at(null, null, 40), "p2")).toBe(1);
  });

  it("gives two Characters that arrived on the same Tick the same placement", () => {
    // A Finish Zone is an area, not a line (CONTEXT.md) — arriving together
    // is a designed outcome, not a tie to be broken arbitrarily.
    const characters = at(10, 10, 25);

    expect(qualificationPlacement(characters, "p0")).toBe(1);
    expect(qualificationPlacement(characters, "p1")).toBe(1);
    expect(qualificationPlacement(characters, "p2")).toBe(3);
  });

  it("is 1 for the only Character in the Match", () => {
    expect(qualificationPlacement(at(7), "p0")).toBe(1);
  });
});

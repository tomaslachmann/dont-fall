import { describe, expect, it } from "vitest";
import { allQualified, isEliminated } from "./Qualification.js";

const chars = (...ticks: (number | null)[]) =>
  Object.fromEntries(ticks.map((finishTick, i) => [`p${i}`, { finishTick }]));

describe("allQualified", () => {
  it("is true once every connected Character has reached the Finish Zone", () => {
    expect(allQualified(chars(10, 20))).toBe(true);
  });

  it("is false while anyone is still out on the Track", () => {
    expect(allQualified(chars(10, null))).toBe(false);
  });

  it("is false for an empty Match — nobody having Qualified is not everybody having Qualified", () => {
    // Otherwise an empty server would end a Round over and over.
    expect(allQualified({})).toBe(false);
  });

  it("is true for a single Character who Qualified", () => {
    expect(allQualified(chars(5))).toBe(true);
  });
});

describe("isEliminated", () => {
  it("is nobody while the Round is still being raced", () => {
    expect(isEliminated("RUNNING", null)).toBe(false);
    expect(isEliminated("COUNTDOWN", null)).toBe(false);
    expect(isEliminated("LOBBY", null)).toBe(false);
  });

  it("is anyone who had not Qualified when the Round ended", () => {
    expect(isEliminated("ROUND_END", null)).toBe(true);
    expect(isEliminated("RESULTS", null)).toBe(true);
  });

  it("is never someone who Qualified", () => {
    expect(isEliminated("ROUND_END", 500)).toBe(false);
    expect(isEliminated("RESULTS", 500)).toBe(false);
  });

  it("does not care how many times they Fell — a Fall never eliminates (CONTEXT.md)", () => {
    // Falling costs time through Respawn and nothing else; only the Round
    // ending without a Finish Zone entry eliminates.
    expect(isEliminated("RUNNING", null)).toBe(false);
    expect(isEliminated("ROUND_END", 12)).toBe(false);
  });
});

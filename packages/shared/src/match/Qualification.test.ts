import { describe, expect, it } from "vitest";
import { allQualified, isEliminated, qualificationPlacement, survivorTargetReached } from "./Qualification.js";

const chars = (...ticks: (number | null)[]) =>
  Object.fromEntries(ticks.map((finishTick, i) => [`p${i}`, { finishTick }]));

const survivors = (...eliminated: boolean[]) => Object.fromEntries(eliminated.map((e, i) => [`p${i}`, { eliminated: e }]));

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

  it("does not wait on an eliminated Character — M5 ticket 04's disconnect fix would otherwise hold a Round open forever", () => {
    expect(allQualified({ p0: { finishTick: 10 }, p1: { finishTick: null, eliminated: true } })).toBe(true);
  });

  it("still waits on a Character that is down but not eliminated (an ordinary Impact, still racing)", () => {
    expect(allQualified({ p0: { finishTick: 10 }, p1: { finishTick: null, eliminated: false } })).toBe(false);
  });
});

describe("survivorTargetReached", () => {
  it("is false while more Players remain standing than the Target", () => {
    expect(survivorTargetReached(survivors(false, false, false), 1)).toBe(false);
  });

  it("is true once survivors drop to exactly the Target", () => {
    expect(survivorTargetReached(survivors(false, true, true), 1)).toBe(true);
  });

  it("is true once survivors drop below the Target, not just to it — a lopsided Impact eliminating two at once must not skip past its own ending", () => {
    expect(survivorTargetReached(survivors(true, true, true), 1)).toBe(true);
  });

  it("is false for an empty Match — nobody connected is not a Round with survivors left, same reasoning as allQualified", () => {
    expect(survivorTargetReached({}, 1)).toBe(false);
  });

  it("is true immediately when nobody has been eliminated and the Target is already met (winner-takes-all with one Player)", () => {
    expect(survivorTargetReached(survivors(false), 1)).toBe(true);
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

describe("qualificationPlacement", () => {
  it("is null for a Character that has not Qualified", () => {
    expect(qualificationPlacement(chars(10, null), "p1")).toBeNull();
  });

  it("is null for a Character that isn't in the snapshot at all", () => {
    expect(qualificationPlacement(chars(10), "nobody")).toBeNull();
  });

  it("ranks by finish Tick, earliest first", () => {
    const characters = chars(30, 10, 20);

    expect(qualificationPlacement(characters, "p1")).toBe(1);
    expect(qualificationPlacement(characters, "p2")).toBe(2);
    expect(qualificationPlacement(characters, "p0")).toBe(3);
  });

  it("counts only Qualified Characters — someone still running never occupies a place", () => {
    expect(qualificationPlacement(chars(null, null, 40), "p2")).toBe(1);
  });

  it("gives two Characters that arrived on the same Tick the same placement", () => {
    // A Finish Zone is an area, not a line (CONTEXT.md) — arriving together
    // is a designed outcome, not a tie to be broken arbitrarily.
    const characters = chars(10, 10, 25);

    expect(qualificationPlacement(characters, "p0")).toBe(1);
    expect(qualificationPlacement(characters, "p1")).toBe(1);
    expect(qualificationPlacement(characters, "p2")).toBe(3);
  });

  it("is 1 for the only Character in the Match", () => {
    expect(qualificationPlacement(chars(7), "p0")).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  beansForPlacement,
  earningsForMatch,
  levelForXp,
  parimutuelOdds,
  settlePayouts,
  stakePayout,
  xpBarFractions,
  xpForRoundScore,
  xpLevelStart,
} from "./economy.js";

describe("match earnings", () => {
  it("XP is linear on Score — a 500-point Match pays 1,000", () => {
    expect(xpForRoundScore(120)).toBe(240);
    expect(xpForRoundScore(0)).toBe(0);
  });

  it("beans price placement — winner takes the field, last takes the floor", () => {
    expect(beansForPlacement(1, 10)).toBe(100);
    expect(beansForPlacement(10, 10)).toBe(10);
    expect(beansForPlacement(6, 4)).toBe(10); // a tiny field still pays the floor, never less
  });

  it("a Match sums XP over Scores and beans over placements", () => {
    expect(
      earningsForMatch([
        { placement: 1, playerCount: 4, score: 120 },
        { placement: 3, playerCount: 4, score: 40 },
      ]),
    ).toEqual({ xp: 320, beans: 40 + 20 });
  });
});

describe("levels", () => {
  it("level 1 starts at 0 and each level costs a thousand more than the last", () => {
    expect(xpLevelStart(1)).toBe(0);
    expect(xpLevelStart(2)).toBe(1_000);
    expect(xpLevelStart(3)).toBe(3_000);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(999)).toBe(1);
    expect(levelForXp(1_000)).toBe(2);
    expect(levelForXp(2_999)).toBe(2);
    expect(levelForXp(3_000)).toBe(3);
  });

  it("bar fractions split before/earned inside one level", () => {
    expect(xpBarFractions(460, 310)).toEqual({ before: 0.46, earned: 0.31 });
    expect(xpBarFractions(0, 0)).toEqual({ before: 0, earned: 0 });
  });

  it("overflow past the bar end clamps rather than overshooting", () => {
    const { before, earned } = xpBarFractions(900, 500);
    expect(before).toBeCloseTo(0.9);
    expect(before + earned).toBeLessThanOrEqual(1);
  });
});

describe("spectator wagering", () => {
  it("odds are total over runner pool — backing the favourite pays the least", () => {
    expect(parimutuelOdds({ floppo: 240, goopy: 180, splatto: 60 })).toEqual({
      floppo: 480 / 240,
      goopy: 480 / 180,
      splatto: 480 / 60,
    });
  });

  it("a runner nobody backed has no odds, not a made-up number", () => {
    expect(parimutuelOdds({ floppo: 100, bonk: 0 })).toEqual({ floppo: 1, bonk: undefined });
  });

  it("winners split the whole pool proportionally — no house cut", () => {
    expect(
      settlePayouts(
        [
          { bettorId: "a", stake: 100, won: true },
          { bettorId: "b", stake: 50, won: true },
          { bettorId: "c", stake: 150, won: false },
        ],
        300,
      ),
    ).toEqual([
      { bettorId: "a", payout: 200 },
      { bettorId: "b", payout: 100 },
      { bettorId: "c", payout: 0 },
    ]);
  });

  it("one row per bettor, first-seen order — split stakes sum before paying", () => {
    expect(
      settlePayouts(
        [
          { bettorId: "a", stake: 60, won: true },
          { bettorId: "b", stake: 40, won: false },
          { bettorId: "a", stake: 40, won: false },
        ],
        200,
      ),
    ).toEqual([
      { bettorId: "a", payout: 200 },
      { bettorId: "b", payout: 0 },
    ]);
  });

  it("integer dust goes to the largest remainder, deterministically", () => {
    // Stakes 1 and 1 on winners, 1 elsewhere: exact 1.5 each, 1 coin of dust.
    // Fractions tie, stakes tie — the alphabetically first bettor takes it.
    expect(
      settlePayouts(
        [
          { bettorId: "a", stake: 1, won: true },
          { bettorId: "b", stake: 1, won: true },
          { bettorId: "c", stake: 1, won: false },
        ],
        3,
      ),
    ).toEqual([
      { bettorId: "a", payout: 2 },
      { bettorId: "b", payout: 1 },
      { bettorId: "c", payout: 0 },
    ]);
  });

  it("nobody backed the winner: every stake refunds, nothing is confiscated", () => {
    expect(
      settlePayouts(
        [
          { bettorId: "a", stake: 100, won: false },
          { bettorId: "b", stake: 250, won: false },
        ],
        350,
      ),
    ).toEqual([
      { bettorId: "a", payout: 100 },
      { bettorId: "b", payout: 250 },
    ]);
  });

  it("no bets: nothing to pay", () => {
    expect(settlePayouts([], 0)).toEqual([]);
  });
});

describe("stakePayout (ADR 0110)", () => {
  it("quotes what a settle would pay with the stake in both pools", () => {
    // 100 more on a runner holding 300 of 480: the pot is 580, the runner's 400.
    expect(stakePayout(100, 300, 480)).toBe(Math.floor((100 * 580) / 400));
    const settled = settlePayouts(
      [
        { bettorId: "old", stake: 300, won: true },
        { bettorId: "me", stake: 100, won: true },
        { bettorId: "other", stake: 180, won: false },
      ],
      580,
    );
    expect(settled.find((row) => row.bettorId === "me")?.payout).toBe(stakePayout(100, 300, 480));
  });

  it("a lone stake on an unbacked runner is quoted the whole pot plus itself", () => {
    expect(stakePayout(50, 0, 480)).toBe(530);
  });
});

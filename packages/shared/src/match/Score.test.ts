import { describe, expect, it } from "vitest";
import { MAX_ROUND_SCORE, QUALIFICATION_SCORE_BONUS } from "../tuning/match.js";
import { buildRoundResult, matchPlacements, matchScore, matchWinner, roundScore, type RoundResult } from "./Score.js";

describe("roundScore", () => {
  it.each([2, 4, 12])("first always takes MAX_ROUND_SCORE, at N = %i", (n) => {
    expect(roundScore(1, n, true)).toBe(MAX_ROUND_SCORE + QUALIFICATION_SCORE_BONUS);
  });

  it.each([2, 4, 12])("last always takes zero (plus the Qualification bonus if they Qualified), at N = %i", (n) => {
    expect(roundScore(n, n, false)).toBe(0);
    expect(roundScore(n, n, true)).toBe(QUALIFICATION_SCORE_BONUS);
  });

  it("pays the same percentile currency at N = 3 as at N = 5 for an equivalent relative placement", () => {
    // 2nd of 3 and 3rd of 5 are both exactly halfway down the field.
    expect(roundScore(2, 3, false)).toBeCloseTo(roundScore(3, 5, false), 10);
  });

  it("guards N === 1 — a solo Round pays the full percentile share instead of dividing by zero", () => {
    expect(roundScore(1, 1, false)).toBe(MAX_ROUND_SCORE);
    expect(Number.isFinite(roundScore(1, 1, true))).toBe(true);
  });

  it("adds the flat Qualification bonus on top of the percentile share", () => {
    expect(roundScore(3, 6, true)).toBe(roundScore(3, 6, false) + QUALIFICATION_SCORE_BONUS);
  });
});

describe("buildRoundResult", () => {
  it("gives placement 1 to a continuous field starting at the Qualified tier", () => {
    const result = buildRoundResult(
      {
        a: { finishTick: 100, checkpointIndex: 4, fallCount: 0 },
        b: { finishTick: null, checkpointIndex: 2, fallCount: 1, eliminatedTick: 50 },
      },
      [],
      [],
    );

    expect(result.rows).toEqual([
      { id: "a", placement: 1, qualified: true },
      { id: "b", placement: 2, qualified: false },
    ]);
  });

  it("shares a placement across a Qualified tie, and the non-Qualified tier's placement still continues past it", () => {
    const result = buildRoundResult(
      {
        a: { finishTick: 100, checkpointIndex: 4, fallCount: 0 },
        b: { finishTick: 100, checkpointIndex: 4, fallCount: 0 },
        c: { finishTick: null, checkpointIndex: 1, fallCount: 2, eliminatedTick: 40 },
      },
      [],
      [],
    );

    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r.placement]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(1);
    expect(byId.c).toBe(3); // skips 2 — standard competition ranking, same convention buildResults uses
  });

  it("shares a placement across a Survival elimination tie (a shove that eliminates two Characters on the same Tick)", () => {
    const result = buildRoundResult(
      {
        survivor: { finishTick: 300, checkpointIndex: null, fallCount: 0 },
        fellTogetherA: { finishTick: null, checkpointIndex: null, fallCount: 1, eliminatedTick: 90 },
        fellTogetherB: { finishTick: null, checkpointIndex: null, fallCount: 1, eliminatedTick: 90 },
        fellFirst: { finishTick: null, checkpointIndex: null, fallCount: 1, eliminatedTick: 30 },
      },
      [],
      [],
    );

    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r.placement]));
    expect(byId.survivor).toBe(1);
    expect(byId.fellTogetherA).toBe(2);
    expect(byId.fellTogetherB).toBe(2);
    expect(byId.fellFirst).toBe(4); // skips 3
  });

  it("leaves a DNF row out of the field entirely — not present, not zero-placed", () => {
    const result = buildRoundResult(
      { stayed: { finishTick: 90, checkpointIndex: 4, fallCount: 0 } },
      [
        { id: "stayed", nickname: "Stayed", ready: true, joinOrder: 0, accountId: null, color: null, skin: null, hat: null },
        { id: "left", nickname: "Left", ready: true, joinOrder: 1, accountId: null, color: null, skin: null, hat: null },
      ],
      [{ id: "left", nickname: "Left", accountId: null, color: null, skin: null, hat: null }],
    );

    expect(result.rows.map((r) => r.id)).toEqual(["stayed"]);
  });
});

describe("matchScore", () => {
  it("folds every Round a Player appears in", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: true }, { id: "b", placement: 2, qualified: false }] },
      { rows: [{ id: "a", placement: 2, qualified: false }, { id: "b", placement: 1, qualified: true }] },
    ];

    const totals = matchScore(results);
    expect(totals.a).toBeCloseTo(roundScore(1, 2, true) + roundScore(2, 2, false), 10);
    expect(totals.b).toBeCloseTo(roundScore(2, 2, false) + roundScore(1, 2, true), 10);
    expect(totals.a).toBeCloseTo(totals.b!, 10); // symmetric — same two placements, in the opposite Round
  });

  it("scores zero for a Round a Player is absent from, without dropping their earlier total", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: true }, { id: "b", placement: 2, qualified: false }] },
      { rows: [{ id: "a", placement: 1, qualified: true }] }, // b dropped before this Round
    ];

    const totals = matchScore(results);
    expect(totals.a).toBeCloseTo(roundScore(1, 2, true) * 2, 10);
    expect(totals.b).toBeCloseTo(roundScore(2, 2, false), 10);
  });

  it("parks a dropper's total at their last played Round across a three-Round Match with shrinking fields (M7 ticket 08)", () => {
    // b drops after Round one: Rounds two and three are scored over the
    // field that actually played them (N = 2, not 3), and b's total is
    // exactly their Round-one Score — verified here, not re-implemented
    // (the ticket's own instruction), since `matchScore` already falls out
    // this way for a Player absent from a Round's rows.
    const results: RoundResult[] = [
      {
        rows: [
          { id: "a", placement: 1, qualified: true },
          { id: "b", placement: 2, qualified: true },
          { id: "c", placement: 3, qualified: false },
        ],
      },
      {
        rows: [
          { id: "a", placement: 1, qualified: true },
          { id: "c", placement: 2, qualified: false },
        ],
      },
      {
        rows: [
          { id: "c", placement: 1, qualified: true },
          { id: "a", placement: 2, qualified: false },
        ],
      },
    ];

    const totals = matchScore(results);
    expect(Object.keys(totals).sort()).toEqual(["a", "b", "c"]);
    expect(totals.b).toBeCloseTo(roundScore(2, 3, true), 10);
    expect(totals.a).toBeCloseTo(roundScore(1, 3, true) + roundScore(1, 2, true) + roundScore(2, 2, false), 10);
    expect(totals.c).toBeCloseTo(roundScore(3, 3, false) + roundScore(2, 2, false) + roundScore(1, 2, true), 10);
  });
});

describe("matchWinner", () => {
  it("picks the highest total", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: true }, { id: "b", placement: 2, qualified: false }] },
    ];

    expect(matchWinner(results)).toEqual([{ id: "a", score: roundScore(1, 2, true) }]);
  });

  it("breaks a tie on total by placement in the last Round", () => {
    const results: RoundResult[] = [
      // Round 1: a and b both score the same (a Qualified 2nd, b non-Qualified 1st happen to net equal — set up directly instead).
      { rows: [{ id: "a", placement: 1, qualified: false }, { id: "b", placement: 2, qualified: false }] },
      { rows: [{ id: "a", placement: 2, qualified: false }, { id: "b", placement: 1, qualified: false }] },
    ];
    // a and b have identical totals (symmetric placements) — the last Round (index 1) has b in placement 1.

    expect(matchWinner(results)).toEqual([{ id: "b", score: matchScore(results).b }]);
  });

  it("reports a genuine tie — equal total AND equal placement in the last Round — rather than picking one", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: true }, { id: "b", placement: 1, qualified: true }] },
    ];

    const winners = matchWinner(results);
    expect(winners.map((w) => w.id).sort()).toEqual(["a", "b"]);
    expect(winners.every((w) => w.score === matchScore(results).a)).toBe(true);
  });

  it("returns nothing for a Match with no Rounds played yet", () => {
    expect(matchWinner([])).toEqual([]);
  });
});

describe("matchPlacements", () => {
  it("orders by total Score, best first, with 1-based placements", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: true }, { id: "b", placement: 2, qualified: false }] },
    ];

    expect(matchPlacements(results)).toEqual([
      { id: "a", score: matchScore(results).a, placement: 1 },
      { id: "b", score: matchScore(results).b, placement: 2 },
    ]);
  });

  it("breaks display order by last-Round placement, but tied totals still share one placement", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: false }, { id: "b", placement: 2, qualified: false }] },
      { rows: [{ id: "a", placement: 2, qualified: false }, { id: "b", placement: 1, qualified: false }] },
    ];

    // Symmetric totals — b ahead on the last-Round tiebreak, both still rank 1.
    expect(matchPlacements(results)).toEqual([
      { id: "b", score: matchScore(results).b, placement: 1 },
      { id: "a", score: matchScore(results).a, placement: 1 },
    ]);
  });

  it("skips the placement after a tie — standard competition ranking, like every other rank in the codebase", () => {
    const results: RoundResult[] = [
      { rows: [{ id: "a", placement: 1, qualified: true }, { id: "b", placement: 1, qualified: true }, { id: "c", placement: 3, qualified: false }] },
    ];

    expect(matchPlacements(results).map((row) => [row.id, row.placement])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 3],
    ]);
  });

  it("ranks nobody when no Rounds were played", () => {
    expect(matchPlacements([])).toEqual([]);
  });
});

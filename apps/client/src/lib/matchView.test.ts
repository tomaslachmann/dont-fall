import { describe, expect, it } from "vitest";
import { ordinal, toMatchResultsView, toStandingRows } from "./matchView.js";

const ROUND_1 = [
  { id: "a", nickname: "GOOPY", score: 120, placement: 1, gone: false },
  { id: "b", nickname: "NOODLE", score: 40, placement: 2, gone: false },
];

describe("toStandingRows", () => {
  it("a first Round is all gains, no moves, nobody out", () => {
    expect(toStandingRows(ROUND_1, new Map(), "b")).toEqual([
      { name: "GOOPY", skin: expect.any(String), gained: 120, total: 120 },
      { name: "NOODLE", skin: expect.any(String), gained: 40, total: 40, you: true },
    ]);
  });

  it("gained is the delta and moved is the climb since last Round", () => {
    const prev = new Map([
      ["a", { score: 120, placement: 2 }],
      ["b", { score: 40, placement: 1 }],
    ]);
    const rows = toStandingRows(
      [
        { id: "a", nickname: "GOOPY", score: 160, placement: 1, gone: false },
        { id: "b", nickname: "NOODLE", score: 100, placement: 2, gone: false },
      ],
      prev,
      undefined,
    );
    expect(rows).toMatchObject([
      { name: "GOOPY", gained: 40, total: 160, moved: 1 },
      { name: "NOODLE", gained: 60, total: 100, moved: -1 },
    ]);
  });

  it("only a gone Player reads as out — a bad Round never eliminates", () => {
    const rows = toStandingRows(
      [
        { id: "a", nickname: "GOOPY", score: 160, placement: 1, gone: false },
        { id: "b", nickname: "NOODLE", score: 20, placement: 4, gone: true },
      ],
      new Map(),
      undefined,
    );
    expect(rows[0]).not.toHaveProperty("out");
    expect(rows[1]).toMatchObject({ out: true });
  });
});

describe("ordinal", () => {
  it("suffixes 1ST/2ND/3RD/NTH", () => {
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11)]).toEqual([
      "1ST",
      "2ND",
      "3RD",
      "4TH",
      "11TH",
    ]);
  });
});

describe("toMatchResultsView", () => {
  const twoRounds = {
    matchId: "m1",
    results: [
      {
        rows: [
          { id: "a", placement: 1, qualified: true },
          { id: "b", placement: 2, qualified: true },
          { id: "c", placement: 3, qualified: false },
        ],
      },
      {
        rows: [
          { id: "b", placement: 1, qualified: true },
          { id: "a", placement: 2, qualified: true },
        ],
      },
    ],
    nicknames: { a: "GOOPY", b: "NOODLE", c: "FLOPPO" },
    accountIds: { a: "acc-a", b: "acc-b" },
    totalFalls: { a: 2, b: 5, c: 1 },
    endedAtMs: 60_000,
  };

  it("ranks the final table by total Score — b 190, a 140, c 0", () => {
    const view = toMatchResultsView(twoRounds, "a");
    expect(view.table).toEqual([
      { id: "b", nickname: "NOODLE", score: 190, placement: 1 },
      { id: "a", nickname: "GOOPY", score: 140, placement: 2 },
      { id: "c", nickname: "FLOPPO", score: 0, placement: 3 },
    ]);
  });

  it("builds one Player's own claim rows and stat line, skipping Rounds they sat out", () => {
    const view = toMatchResultsView(twoRounds, "c");
    expect(view.myRounds).toEqual([{ placement: 3, playerCount: 3, score: 0 }]);
    expect(view.myStats).toEqual({ wins: 0, falls: 1, best: 3 });

    const winner = toMatchResultsView(twoRounds, "b");
    expect(winner.myRounds).toEqual([
      { placement: 2, playerCount: 3, score: 70 },
      { placement: 1, playerCount: 2, score: 120 },
    ]);
    expect(winner.myStats).toEqual({ wins: 1, falls: 5, best: 1 });
  });

  it("a spectator gets no claim rows and no stat line", () => {
    const view = toMatchResultsView(twoRounds, "spectator");
    expect(view.myRounds).toEqual([]);
    expect(view.myStats).toBeNull();
    expect(toMatchResultsView(twoRounds, undefined).myStats).toBeNull();
  });

  it("breaks a Score tie by last-Round placement, sharing the placement", () => {
    const tied = {
      matchId: "m1",
      results: [
        {
          rows: [
            { id: "a", placement: 1, qualified: true },
            { id: "b", placement: 2, qualified: true },
          ],
        },
        {
          rows: [
            { id: "b", placement: 1, qualified: true },
            { id: "a", placement: 2, qualified: true },
          ],
        },
      ],
      nicknames: { a: "GOOPY", b: "NOODLE" },
      accountIds: {},
      totalFalls: { a: 0, b: 0 },
      endedAtMs: 60_000,
    };
    const view = toMatchResultsView(tied, "a");
    expect(view.table).toEqual([
      { id: "b", nickname: "NOODLE", score: 140, placement: 1 },
      { id: "a", nickname: "GOOPY", score: 140, placement: 1 },
    ]);
  });

  it("scoreboard rows carry the last Round's own gain — 0 for whoever sat it out", () => {
    const view = toMatchResultsView(twoRounds, "a");
    expect(view.scoreboard).toMatchObject([
      { name: "NOODLE", gained: 120, total: 190 },
      { name: "GOOPY", gained: 20, total: 140, you: true },
      { name: "FLOPPO", gained: 0, total: 0 },
    ]);
  });
});

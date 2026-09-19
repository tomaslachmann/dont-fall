import { describe, expect, it } from "vitest";
import { toCareerMatchRows, toCareerStatTiles, toEarnedBadgeNames } from "./careerView.js";

describe("toCareerStatTiles", () => {
  it("maps a career onto six tiles — wins heroed, best and win rate honest at zero", () => {
    const tiles = toCareerStatTiles({ matches: 4, wins: 1, podiums: 2, falls: 7, bestPlacement: 1, cleanMatches: 1, bestSurvivalMs: null, grabsBroken: 0 });

    expect(tiles).toEqual([
      { label: "MATCHES", value: "4" },
      { label: "WINS", value: "1", hero: true },
      { label: "PODIUMS", value: "2" },
      { label: "FALLS", value: "7" },
      { label: "BEST", value: "#1" },
      { label: "WIN RATE", value: "25%" },
    ]);
  });

  it("an empty career is zeros with em-dashes, never NaN or Infinity", () => {
    const tiles = toCareerStatTiles({ matches: 0, wins: 0, podiums: 0, falls: 0, bestPlacement: null, cleanMatches: 0, bestSurvivalMs: null, grabsBroken: 0 });

    expect(tiles).toContainEqual({ label: "BEST", value: "—" });
    expect(tiles).toContainEqual({ label: "WIN RATE", value: "—" });
  });
});

describe("toCareerMatchRows", () => {
  it("maps a Match onto a row — rank, score, and a relative when", () => {
    const rows = toCareerMatchRows(
      [{ matchId: "m1", placement: 1, score: 190, falls: 0, rounds: 2, trackNames: ["Green Hills"], endedAtMs: 60_000 }],
      370_000,
    );

    expect(rows).toEqual([{ rank: 1, track: "Green Hills", points: 190, when: "5 MINUTES AGO" }]);
  });

  it("joins distinct Track names and falls back honestly when there are none", () => {
    const rows = toCareerMatchRows(
      [
        { matchId: "m1", placement: 2, score: 90, falls: 3, rounds: 2, trackNames: ["Green Hills", "Blue Bay"], endedAtMs: 60_000 },
        { matchId: "m2", placement: 4, score: 10, falls: 9, rounds: 1, trackNames: [], endedAtMs: 60_000 },
      ],
      61_000,
    );

    expect(rows[0]?.track).toBe("Green Hills · Blue Bay");
    expect(rows[1]?.track).toBe("UNTITLED TRACK");
  });
});

describe("toEarnedBadgeNames", () => {
  it("names earned badges in catalog order, skipping unknown ids", () => {
    expect(toEarnedBadgeNames(["winner", "no-such-badge", "first-steps"])).toEqual(["First Steps", "Winner"]);
  });
});

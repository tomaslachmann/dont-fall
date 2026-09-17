import { describe, expect, it } from "vitest";
import { BADGES, badgeById, evaluateBadges, type CareerStats } from "./Career.js";

const STATS: CareerStats = { matches: 0, wins: 0, podiums: 0, falls: 0, bestPlacement: null, cleanMatches: 0 };

describe("evaluateBadges", () => {
  it("earns nothing on an empty career", () => {
    expect(evaluateBadges(STATS)).toEqual([]);
  });

  it("unlocks First Steps on the first finished Match", () => {
    expect(evaluateBadges({ ...STATS, matches: 1 })).toEqual(["first-steps"]);
  });

  it("unlocks Contender at ten Matches, keeping First Steps", () => {
    expect(evaluateBadges({ ...STATS, matches: 10 })).toEqual(["first-steps", "contender"]);
  });

  it("unlocks Winner and Podium on a Match win — a win is a podium too", () => {
    const earned = evaluateBadges({ ...STATS, matches: 1, wins: 1, podiums: 1, bestPlacement: 1 });
    expect(earned).toEqual(["first-steps", "podium", "winner"]);
  });

  it("unlocks Podium without Winner on a non-winning top-3", () => {
    const earned = evaluateBadges({ ...STATS, matches: 3, podiums: 1, bestPlacement: 2 });
    expect(earned).toContain("podium");
    expect(earned).not.toContain("winner");
  });

  it("unlocks Champion at five wins", () => {
    const earned = evaluateBadges({ ...STATS, matches: 12, wins: 5, podiums: 6, bestPlacement: 1 });
    expect(earned).toEqual(["first-steps", "contender", "podium", "winner", "champion"]);
  });

  it("unlocks Flawless on a Match with zero falls, even without winning it", () => {
    const earned = evaluateBadges({ ...STATS, matches: 2, cleanMatches: 1, bestPlacement: 4, falls: 3 });
    expect(earned).toContain("flawless");
    expect(earned).not.toContain("winner");
  });

  it("a fall-free career still needs a finished Match for Flawless", () => {
    expect(evaluateBadges(STATS)).not.toContain("flawless");
  });
});

describe("badge catalog", () => {
  it("every earned id resolves to a named badge", () => {
    const everything: CareerStats = { matches: 99, wins: 99, podiums: 99, falls: 0, bestPlacement: 1, cleanMatches: 99 };
    for (const id of evaluateBadges(everything)) {
      expect(badgeById(id)?.name.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = BADGES.map((badge) => badge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

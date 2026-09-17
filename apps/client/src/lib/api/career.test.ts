import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchCareer } from "./career.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCareer", () => {
  it("reads the whole career off /career", async () => {
    const career = {
      stats: { matches: 2, wins: 1, podiums: 2, falls: 5, bestPlacement: 1, cleanMatches: 1 },
      badges: { earned: ["first-steps"], total: 6 },
      matches: [
        { matchId: "m1", placement: 1, score: 190, falls: 0, rounds: 2, trackNames: ["Green Hills"], endedAtMs: 60_000 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(career), { status: 200 })));

    await expect(fetchCareer()).resolves.toEqual(career);
  });
});

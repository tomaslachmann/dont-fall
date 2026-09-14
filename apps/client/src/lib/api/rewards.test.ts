import { describe, expect, it, vi, afterEach } from "vitest";
import { claimRewards, getRewardsBalance } from "./rewards.js";

const API = "http://localhost:8081"; // apiBaseUrl() under jsdom

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claimRewards", () => {
  it("posts the Match's rows and returns the credit", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ gainedXp: 320, gainedCoins: 60, xpBefore: 0, xpAfter: 320, coinsBefore: 0, coinsAfter: 60 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rounds = [{ placement: 1, playerCount: 4, score: 120 }];

    await expect(claimRewards(rounds, "m1")).resolves.toMatchObject({ gainedXp: 320, gainedCoins: 60 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/rewards/claim`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ matchId: "m1", rounds }) }),
    );
  });
});

describe("getRewardsBalance", () => {
  it("reads lifetime totals off /rewards/me", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ xp: 320, coins: 60 }), { status: 200 })));

    await expect(getRewardsBalance()).resolves.toEqual({ xp: 320, coins: 60 });
  });
});

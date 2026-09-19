import { describe, expect, it, vi, afterEach } from "vitest";
import { claimRewards, getRewardsBalance } from "./rewards.js";

const API = "http://localhost:8081"; // apiBaseUrl() under jsdom

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claimRewards", () => {
  it("posts only the Match's id — the server finds your Rounds (ADR 0110) — and returns the credit", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ gainedXp: 320, gainedCoins: 60, xpBefore: 0, xpAfter: 320, coinsBefore: 0, coinsAfter: 60 }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(claimRewards("m1")).resolves.toMatchObject({ gainedXp: 320, gainedCoins: 60 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/rewards/claim`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ matchId: "m1" }) }),
    );
  });
});

describe("getRewardsBalance", () => {
  it("reads lifetime totals off /rewards/me", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ xp: 320, coins: 60 }), { status: 200 })));

    await expect(getRewardsBalance()).resolves.toEqual({ xp: 320, coins: 60 });
  });
});

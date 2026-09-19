import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { earningsForMatch, roundScore, type PersistedMatchResult } from "@dont-fall/shared";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword, creditAccountEarnings } from "../auth/accounts.dao.js";
import { openBettingRound, placeBet, settleBettingRound } from "../bets/bets.service.js";
import { saveMatchResult } from "../matches/matches.service.js";
import { claimMatchRewards, getRewardsBalance, roundsPlayedBy } from "./rewards.service.js";

/** Two Rounds of four: "me" wins the first and comes third in the second (ADR 0110 — the server's own rows). */
const matchFor = (matchId: string, accountId: string): PersistedMatchResult => ({
  matchId,
  results: [
    {
      rows: [
        { id: "me", placement: 1, qualified: true },
        { id: "b", placement: 2, qualified: true },
        { id: "c", placement: 3, qualified: false },
        { id: "d", placement: 4, qualified: false },
      ],
    },
    {
      rows: [
        { id: "b", placement: 1, qualified: true },
        { id: "c", placement: 2, qualified: true },
        { id: "me", placement: 3, qualified: false },
        { id: "d", placement: 4, qualified: false },
      ],
    },
  ],
  roundTrackIds: ["t1", "t2"],
  nicknames: { me: "Wobbleton", b: "B", c: "C", d: "D" },
  accountIds: { me: accountId },
  colors: {},
  skins: {},
  hats: {},
  totalFalls: { me: 0 },
  survivalMs: {},
  grabsBroken: {},
  endedAtMs: 1_000,
});

const ROUNDS = [
  { placement: 1, playerCount: 4, score: roundScore(1, 4, true) },
  { placement: 3, playerCount: 4, score: roundScore(3, 4, false) },
];
const EARNED = earningsForMatch(ROUNDS);

const withDb = (run: (db: ApiDb) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "api-rewards-test-"));
  try {
    run(openDb(join(dir, "test.sqlite")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const signUp = (db: ApiDb, email: string) =>
  createAccountWithPassword(db, { email, password: "correct horse battery staple", displayName: email.split("@")[0]! });

describe("roundsPlayedBy (ADR 0110)", () => {
  it("reads this Account's own Rounds off the stored Match", () => {
    expect(roundsPlayedBy(matchFor("m1", "acc"), "acc")).toEqual(ROUNDS);
    expect(roundsPlayedBy(matchFor("m1", "acc"), "someone-else")).toEqual([]);
  });
});

describe("claimMatchRewards", () => {
  it("credits the server's own Rounds, whatever the client sends, and replays without crediting twice", () => {
    withDb((db) => {
      const account = signUp(db, "wobbleton@example.com");
      saveMatchResult(db, matchFor("m1", account.id));
      saveMatchResult(db, matchFor("m2", account.id));

      // A forged body changes nothing: the rows are the stored Match's.
      const forged = { matchId: "m1", rounds: [{ placement: 1, playerCount: 99, score: 10_000 }] };
      expect(claimMatchRewards(db, account.id, forged)).toEqual({
        gainedXp: EARNED.xp,
        gainedCoins: EARNED.beans,
        xpBefore: 0,
        xpAfter: EARNED.xp,
        coinsBefore: 0,
        coinsAfter: EARNED.beans,
        rounds: ROUNDS,
        betWinnings: 0,
      });
      expect(claimMatchRewards(db, account.id, { matchId: "m2" }).xpAfter).toBe(2 * EARNED.xp);
      expect(claimMatchRewards(db, account.id, { matchId: "m1" }).xpAfter).toBe(EARNED.xp);
      expect(getRewardsBalance(db, account.id)).toEqual({ xp: 2 * EARNED.xp, coins: 2 * EARNED.beans });
    });
  });

  it("refuses a Match the caller did not race, an unknown Match, and an unknown Account", () => {
    withDb((db) => {
      const racer = signUp(db, "racer@example.com");
      const stranger = signUp(db, "stranger@example.com");
      saveMatchResult(db, matchFor("m1", racer.id));

      expect(() => claimMatchRewards(db, stranger.id, { matchId: "m1" })).toThrowError(/did not race/);
      expect(() => claimMatchRewards(db, racer.id, {})).toThrowError(/matchId/);
      expect(() => claimMatchRewards(db, racer.id, { matchId: "no-such-match" })).toThrowError(/no finished Match/);
      expect(() => getRewardsBalance(db, "no-such-account")).toThrowError(/not logged in/);
    });
  });

  it("reports what the caller's bets on the Match won", () => {
    withDb((db) => {
      const racer = signUp(db, "racer@example.com");
      const bettor = signUp(db, "bettor@example.com");
      const rival = signUp(db, "rival@example.com");
      creditAccountEarnings(db, bettor.id, { xp: 0, coins: 500 });
      creditAccountEarnings(db, rival.id, { xp: 0, coins: 500 });
      const match = matchFor("m1", racer.id);
      saveMatchResult(db, { ...match, accountIds: { me: racer.id, b: bettor.id } });
      const runners = [
        { playerId: "me", nickname: "Wobbleton" },
        { playerId: "c", nickname: "C" },
      ];
      openBettingRound(db, { matchId: "m1", round: 1, closesAtMs: 60_000, runners });
      placeBet(db, { id: bettor.id, displayName: "bettor" }, { matchId: "m1", round: 1, targetId: "me", amount: 100 }, 1_000);
      placeBet(db, { id: rival.id, displayName: "rival" }, { matchId: "m1", round: 1, targetId: "c", amount: 300 }, 2_000);
      settleBettingRound(db, { matchId: "m1", round: 1, winnerIds: ["me"] }, 3_000);

      expect(claimMatchRewards(db, bettor.id, { matchId: "m1" }).betWinnings).toBe(400);
      expect(claimMatchRewards(db, racer.id, { matchId: "m1" }).betWinnings).toBe(0);
    });
  });
});

describe("rewards routes", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "api-rewards-test-"));
    app = await buildApp({
      dbPath: join(dir, "test.sqlite"),
      apiUrl: "http://localhost:8081",
      maxPlayers: 4,
      serviceToken: "test-service-token",
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("claims the stored Match by its id alone, 401s without a session, 404s an unknown Match", async () => {
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "wobbleton@example.com", password: "correct horse battery staple", displayName: "Wobbleton" },
    });
    const { token, account } = signup.json() as { token: string; account: { id: string } };
    const seeded = await app.inject({
      method: "POST",
      url: "/internal/match-results",
      headers: { "x-service-token": "test-service-token" },
      payload: matchFor("m1", account.id),
    });
    expect(seeded.statusCode).toBe(200);

    const claim = (matchId: string, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
      app.inject({ method: "POST", url: "/rewards/claim", headers, payload: { matchId } });
    expect((await claim("m1")).json()).toMatchObject({ gainedXp: EARNED.xp, rounds: ROUNDS });
    expect((await claim("m1", {})).statusCode).toBe(401);
    expect((await claim("no-such-match")).statusCode).toBe(404);
  });
});

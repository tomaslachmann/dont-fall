import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword } from "../auth/accounts.dao.js";
import { saveMatchResult } from "../matches/matches.service.js";
import { claimMatchRewards, getRewardsBalance } from "./rewards.service.js";

const ROUNDS = [
  { placement: 1, playerCount: 4, score: 120 },
  { placement: 3, playerCount: 4, score: 40 },
]; // 320 XP, 60 beans — the shared formula's own answer, never restated here

const seedMatch = (db: ApiDb, matchId: string): void => {
  saveMatchResult(db, {
    matchId,
    results: [{ rows: [{ id: "me", placement: 1, qualified: true }] }],
    nicknames: { me: "Wobbleton" },
    totalFalls: { me: 0 },
    endedAtMs: 1_000,
  });
};

describe("claimMatchRewards", () => {
  it("credits the shared formula's answer and reports before/after", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-rewards-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const account = createAccountWithPassword(db, {
        email: "wobbleton@example.com",
        password: "correct horse battery staple",
        displayName: "Wobbleton",
      });

      seedMatch(db, "m1");
      seedMatch(db, "m2");

      expect(claimMatchRewards(db, account.id, { matchId: "m1", rounds: ROUNDS })).toEqual({
        gainedXp: 320,
        gainedCoins: 60,
        xpBefore: 0,
        xpAfter: 320,
        coinsBefore: 0,
        coinsAfter: 60,
      });

      // A second Match accumulates on top — nothing resets.
      expect(claimMatchRewards(db, account.id, { matchId: "m2", rounds: ROUNDS }).xpAfter).toBe(640);
      expect(getRewardsBalance(db, account.id)).toEqual({ xp: 640, coins: 120 });

      // Replaying the first Match replays its stored numbers — never a second credit.
      expect(claimMatchRewards(db, account.id, { matchId: "m1", rounds: ROUNDS })).toEqual({
        gainedXp: 320,
        gainedCoins: 60,
        xpBefore: 0,
        xpAfter: 320,
        coinsBefore: 0,
        coinsAfter: 60,
      });
      expect(getRewardsBalance(db, account.id)).toEqual({ xp: 640, coins: 120 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invented rows and an unknown Account", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-rewards-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const account = createAccountWithPassword(db, {
        email: "wobbleton@example.com",
        password: "correct horse battery staple",
        displayName: "Wobbleton",
      });

      seedMatch(db, "m1");

      expect(() => claimMatchRewards(db, account.id, { matchId: "m1", rounds: [] })).toThrowError(/non-empty/);
      expect(() =>
        claimMatchRewards(db, account.id, { matchId: "m1", rounds: [{ placement: 5, playerCount: 4, score: 0 }] }),
      ).toThrowError(/outrank/);
      expect(() =>
        claimMatchRewards(db, account.id, { matchId: "m1", rounds: [{ placement: 1, playerCount: 4, score: -5 }] }),
      ).toThrowError(/non-negative/);
      expect(() => claimMatchRewards(db, account.id, { rounds: ROUNDS })).toThrowError(/matchId/);
      expect(() => claimMatchRewards(db, account.id, { matchId: "no-such-match", rounds: ROUNDS })).toThrowError(
        /no finished Match/,
      );
      expect(() => claimMatchRewards(db, "no-such-account", { matchId: "m1", rounds: ROUNDS })).toThrowError(
        /not logged in/,
      );
      expect(() => getRewardsBalance(db, "no-such-account")).toThrowError(/not logged in/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  const signupToken = async (): Promise<string> => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "wobbleton@example.com", password: "correct horse battery staple", displayName: "Wobbleton" },
    });
    return (res.json() as { token: string }).token;
  };

  it("claims once per Match and reads back on /rewards/me", async () => {
    const token = await signupToken();
    const seeded = await app.inject({
      method: "POST",
      url: "/internal/match-results",
      headers: { "x-service-token": "test-service-token" },
      payload: {
        matchId: "m1",
        results: [{ rows: [{ id: "me", placement: 1, qualified: true }] }],
        nicknames: { me: "Wobbleton" },
        totalFalls: { me: 0 },
        endedAtMs: 1_000,
      },
    });
    expect(seeded.statusCode).toBe(200);

    const claim = await app.inject({
      method: "POST",
      url: "/rewards/claim",
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: "m1", rounds: ROUNDS },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ gainedXp: 320, gainedCoins: 60, xpAfter: 320, coinsAfter: 60 });

    // A replayed claim replays the stored numbers — the balance never moves twice.
    const replay = await app.inject({
      method: "POST",
      url: "/rewards/claim",
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: "m1", rounds: ROUNDS },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ gainedXp: 320, gainedCoins: 60, xpAfter: 320, coinsAfter: 60 });

    const balance = await app.inject({
      method: "GET",
      url: "/rewards/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(balance.statusCode).toBe(200);
    expect(balance.json()).toEqual({ xp: 320, coins: 60 });
  });

  it("401s without a session and 400s on invented rows", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/rewards/claim", payload: { matchId: "m1", rounds: ROUNDS } }))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ method: "GET", url: "/rewards/me" })).statusCode).toBe(401);

    const token = await signupToken();
    await app.inject({
      method: "POST",
      url: "/internal/match-results",
      headers: { "x-service-token": "test-service-token" },
      payload: {
        matchId: "m1",
        results: [{ rows: [{ id: "me", placement: 1, qualified: true }] }],
        nicknames: { me: "Wobbleton" },
        totalFalls: { me: 0 },
        endedAtMs: 1_000,
      },
    });
    const bad = await app.inject({
      method: "POST",
      url: "/rewards/claim",
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: "m1", rounds: [] },
    });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "POST",
      url: "/rewards/claim",
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: "no-such-match", rounds: ROUNDS },
    });
    expect(unknown.statusCode).toBe(404);
  });
});

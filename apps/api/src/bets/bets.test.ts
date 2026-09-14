import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDb, type ApiDb } from "../db/db.js";
import {
  createAccountWithPassword,
  createSession,
  creditAccountEarnings,
  getAccountEarnings,
} from "../auth/accounts.dao.js";
import { getBettingState, openBettingRound, placeBet, settleBettingRound } from "./bets.service.js";

const SERVICE_TOKEN = "test-service-token";
const RUNNERS = [
  { playerId: "p1", nickname: "Floppo" },
  { playerId: "p2", nickname: "Goopy" },
];

const fund = (db: ApiDb, email: string, name: string, coins: number): { id: string; token: string } => {
  const account = createAccountWithPassword(db, {
    email,
    password: "correct horse battery staple",
    displayName: name,
  });
  creditAccountEarnings(db, account.id, { xp: 0, coins });
  return { id: account.id, token: createSession(db, account.id).token };
};

describe("betting service", () => {
  it("runs the whole round: open, stake, live odds, settle, credit", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-bets-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const ann = fund(db, "ann@example.com", "Ann", 1000);
      const bob = fund(db, "bob@example.com", "Bob", 1000);

      openBettingRound(db, { matchId: "m1", round: 1, closesAtMs: 60_000, runners: RUNNERS });
      expect(placeBet(db, { id: ann.id, displayName: "Ann" }, { matchId: "m1", round: 1, targetId: "p1", amount: 240 }, 1_000))
        .toEqual({ betId: expect.any(String), coins: 760 });
      placeBet(db, { id: bob.id, displayName: "Bob" }, { matchId: "m1", round: 1, targetId: "p2", amount: 180 }, 2_000);
      placeBet(db, { id: bob.id, displayName: "Bob" }, { matchId: "m1", round: 1, targetId: "p1", amount: 60 }, 3_000);

      const state = getBettingState(db, "m1", 1, 4_000);
      expect(state.open).toBe(true);
      expect(state.runners).toEqual([
        { playerId: "p1", nickname: "Floppo", pool: 300, odds: 480 / 300 },
        { playerId: "p2", nickname: "Goopy", pool: 180, odds: 480 / 180 },
      ]);
      expect(state.totalPool).toBe(480);
      expect(state.bettorCount).toBe(2);
      expect(state.recentBets.map((b) => [b.nickname, b.amount, b.targetNickname])).toEqual([
        ["Bob", 60, "Floppo"],
        ["Bob", 180, "Goopy"],
        ["Ann", 240, "Floppo"],
      ]);

      const settled = settleBettingRound(db, { matchId: "m1", round: 1, winnerIds: ["p1"] }, 50_000);
      // Winners staked 300 of 480: Ann 240*480/300 = 384, Bob 60*480/300 = 96.
      expect(settled).toEqual({
        matchId: "m1",
        round: 1,
        settled: true,
        payouts: [
          { bettorId: ann.id, payout: 384 },
          { bettorId: bob.id, payout: 96 },
        ],
      });
      // Balances moved exactly there: staked at placement, paid at settle.
      expect(getBettingState(db, "m1", 1, 51_000).settled).toBe(true);
      expect(getBettingState(db, "m1", 1, 51_000).open).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a retried settle pays once and answers identically", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-bets-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const ann = fund(db, "ann@example.com", "Ann", 1000);
      openBettingRound(db, { matchId: "m1", round: 1, closesAtMs: 60_000, runners: RUNNERS });
      placeBet(db, { id: ann.id, displayName: "Ann" }, { matchId: "m1", round: 1, targetId: "p1", amount: 100 }, 1_000);

      const first = settleBettingRound(db, { matchId: "m1", round: 1, winnerIds: ["p1"] }, 50_000);
      const second = settleBettingRound(db, { matchId: "m1", round: 1, winnerIds: ["p1"] }, 51_000);
      expect(second).toEqual(first);
      // Paid once, not twice: 1000 - 100 staked + 100 won back.
      expect(getAccountEarnings(db, ann.id)?.coins).toBe(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses bad tickets: unknown round, closed board, unknown runner, bad amount, broke bettor", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-bets-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const ann = fund(db, "ann@example.com", "Ann", 50);
      const ticket = { matchId: "m1", round: 1, targetId: "p1", amount: 25 };

      expect(() => placeBet(db, { id: ann.id, displayName: "Ann" }, ticket, 1_000)).toThrow(/not open/);
      openBettingRound(db, { matchId: "m1", round: 1, closesAtMs: 60_000, runners: RUNNERS });
      expect(() => placeBet(db, { id: ann.id, displayName: "Ann" }, { ...ticket, targetId: "ghost" }, 1_000)).toThrow(
        /not on this Round's board/,
      );
      expect(() => placeBet(db, { id: ann.id, displayName: "Ann" }, { ...ticket, amount: 0 }, 1_000)).toThrow(
        /positive integer/,
      );
      expect(() => placeBet(db, { id: ann.id, displayName: "Ann" }, { ...ticket, amount: 51 }, 1_000)).toThrow(
        /not enough jelly beans/,
      );
      expect(() => placeBet(db, { id: ann.id, displayName: "Ann" }, ticket, 61_000)).toThrow(/closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("settling an unknown round is a 404, winners off the board a 400", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-bets-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      expect(() => settleBettingRound(db, { matchId: "nope", round: 1, winnerIds: ["p1"] }, 1_000)).toThrow(
        /no betting round/,
      );
      openBettingRound(db, { matchId: "m1", round: 1, closesAtMs: 60_000, runners: RUNNERS });
      expect(() => settleBettingRound(db, { matchId: "m1", round: 1, winnerIds: ["ghost"] }, 1_000)).toThrow(
        /from this Round's board/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("betting routes", () => {
  let dir: string;
  let app: FastifyInstance;
  let db: ApiDb;
  let ann: { id: string; token: string };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "api-bets-routes-test-"));
    db = openDb(join(dir, "test.sqlite"));
    ann = fund(db, "ann@example.com", "Ann", 1000);
    app = await buildApp({ db, serviceToken: SERVICE_TOKEN });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const open = () =>
    app.inject({
      method: "POST",
      url: "/bets/rounds/open",
      headers: { "x-service-token": SERVICE_TOKEN },
      payload: { matchId: "m1", round: 1, closesAtMs: Date.now() + 60_000, runners: RUNNERS },
    });

  it("the service calls need the service token — otherwise 403, betting stays closed", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/bets/rounds/open",
      payload: { matchId: "m1", round: 1, closesAtMs: Date.now() + 60_000, runners: RUNNERS },
    });
    expect(denied.statusCode).toBe(403);

    const wrong = await app.inject({
      method: "POST",
      url: "/bets/rounds/settle",
      headers: { "x-service-token": "wrong" },
      payload: { matchId: "m1", round: 1, winnerIds: ["p1"] },
    });
    expect(wrong.statusCode).toBe(403);

    expect((await open()).statusCode).toBe(200);
  });

  it("stakes beans and reads the board back, authed throughout", async () => {
    expect((await open()).statusCode).toBe(200);

    const anon = await app.inject({
      method: "POST",
      url: "/bets",
      payload: { matchId: "m1", round: 1, targetId: "p1", amount: 100 },
    });
    expect(anon.statusCode).toBe(401);

    const placed = await app.inject({
      method: "POST",
      url: "/bets",
      headers: { authorization: `Bearer ${ann.token}` },
      payload: { matchId: "m1", round: 1, targetId: "p1", amount: 100 },
    });
    expect(placed.statusCode).toBe(201);
    expect(placed.json()).toEqual({ betId: expect.any(String), coins: 900 });

    const state = await app.inject({
      method: "GET",
      url: "/bets/m1/1",
      headers: { authorization: `Bearer ${ann.token}` },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      matchId: "m1",
      round: 1,
      open: true,
      totalPool: 100,
      bettorCount: 1,
    });
  });
});

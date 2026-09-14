import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDb } from "../db/db.js";
import { getMatchResult, saveMatchResult } from "./matches.service.js";

const RESULT = {
  matchId: "m1",
  results: [
    { rows: [{ id: "p1", placement: 1, qualified: true }] },
    {
      rows: [
        { id: "p1", placement: 1, qualified: true },
        { id: "p2", placement: 2, qualified: false },
      ],
    },
  ],
  nicknames: { p1: "Floppo", p2: "Goopy" },
  accountIds: { p1: "acc-1" },
  totalFalls: { p1: 1, p2: 3 },
  endedAtMs: 60_000,
};

describe("match results service", () => {
  it("round-trips one finished Match, first write wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-matches-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      expect(() => getMatchResult(db, "m1")).toThrowError(/no finished Match/);

      expect(saveMatchResult(db, RESULT)).toEqual({ matchId: "m1" });
      expect(getMatchResult(db, "m1")).toEqual(RESULT);

      // A retried save is a no-op, never an overwrite.
      saveMatchResult(db, { ...RESULT, totalFalls: { p1: 99, p2: 99 } });
      expect(getMatchResult(db, "m1")).toEqual(RESULT);

      expect(() => getMatchResult(db, "no-such-match")).toThrowError(/no finished Match/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed saves", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-matches-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      expect(() => saveMatchResult(db, { ...RESULT, matchId: "" })).toThrowError(/matchId/);
      expect(() => saveMatchResult(db, { ...RESULT, results: [] })).toThrowError(/non-empty/);
      expect(() => saveMatchResult(db, { ...RESULT, results: [{ rows: [] }] })).toThrowError(/non-empty rows/);
      expect(() =>
        saveMatchResult(db, { ...RESULT, results: [{ rows: [{ id: "p1", placement: 0, qualified: true }] }] }),
      ).toThrowError(/placement/);
      expect(() => saveMatchResult(db, { ...RESULT, nicknames: [] })).toThrowError(/nicknames/);
      expect(() => saveMatchResult(db, { ...RESULT, accountIds: [] })).toThrowError(/accountIds/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults a missing accountIds map — pre-2b saves carry none", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-matches-test-"));
    try {
      const db = openDb(join(dir, "test.sqlite"));
      const { accountIds: _dropped, ...legacy } = RESULT;

      expect(saveMatchResult(db, legacy)).toEqual({ matchId: "m1" });
      expect(getMatchResult(db, "m1")).toEqual({ ...legacy, accountIds: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("match results routes", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "api-matches-test-"));
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

  it("saves via the service token and reads back per Player session", async () => {
    const refused = await app.inject({ method: "POST", url: "/internal/match-results", payload: RESULT });
    expect(refused.statusCode).toBe(403);

    const saved = await app.inject({
      method: "POST",
      url: "/internal/match-results",
      headers: { "x-service-token": "test-service-token" },
      payload: RESULT,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ matchId: "m1" });

    expect((await app.inject({ method: "GET", url: "/matches/m1" })).statusCode).toBe(401);

    const token = await signupToken();
    const read = await app.inject({
      method: "GET",
      url: "/matches/m1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(RESULT);

    const missing = await app.inject({
      method: "GET",
      url: "/matches/no-such-match",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
  });
});

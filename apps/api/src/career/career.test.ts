import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchScore } from "@dont-fall/shared";
import { buildApp } from "../app.js";
import type { ApiDb } from "../db/db.js";
import { openDb } from "../db/db.js";
import { saveMatchResult } from "../matches/matches.service.js";
import { saveTrack } from "../tracks/tracks.dao.js";
import { getCareer } from "./career.service.js";

/** acc-1 wins both Rounds, fall-free, on one named Track. */
const MATCH_WIN = {
  matchId: "m-win",
  results: [
    { rows: [{ id: "p1", placement: 1, qualified: true }, { id: "p2", placement: 2, qualified: false }] },
    { rows: [{ id: "p1", placement: 1, qualified: true }, { id: "p2", placement: 2, qualified: false }] },
  ],
  roundTrackIds: ["t-green", "t-green"],
  nicknames: { p1: "Floppo", p2: "Goopy" },
  accountIds: { p1: "acc-1", p2: "acc-2" },
  colors: {},
  totalFalls: { p1: 0, p2: 2 },
  survivalMs: { p1: 41_000 },
  grabsBroken: { p1: 2 },
  endedAtMs: 60_000,
};

/** acc-1 takes 2nd of 3 with five falls, across two Tracks (one unnamed, one gone). */
const MATCH_PODIUM = {
  matchId: "m-podium",
  results: [
    {
      rows: [
        { id: "p1", placement: 2, qualified: true },
        { id: "p2", placement: 1, qualified: true },
        { id: "px", placement: 3, qualified: false },
      ],
    },
  ],
  roundTrackIds: ["t-nameless", "t-gone"],
  nicknames: { p1: "Floppo", p2: "Goopy", px: "Anon" },
  accountIds: { p1: "acc-1", p2: "acc-2" },
  colors: {},
  totalFalls: { p1: 5, p2: 1, px: 9 },
  survivalMs: { p1: 73_500 },
  grabsBroken: { p1: 1 },
  endedAtMs: 120_000,
};

const seedTracks = (db: ApiDb): void => {
  saveTrack(db, { id: "t-green", name: "Green Hills", track: [] });
  saveTrack(db, { id: "t-nameless", track: [] });
};

const openTestDb = (): { dir: string; db: ApiDb } => {
  const dir = mkdtempSync(join(tmpdir(), "api-career-test-"));
  return { dir, db: openDb(join(dir, "test.sqlite")) };
};

describe("career service", () => {
  it("an empty career is zeros and an empty list — never a 404", () => {
    const { dir, db } = openTestDb();
    try {
      expect(getCareer(db, "acc-nobody")).toEqual({
        stats: { matches: 0, wins: 0, podiums: 0, falls: 0, bestPlacement: null, cleanMatches: 0, bestSurvivalMs: null, grabsBroken: 0 },
        badges: { earned: [], total: 6 },
        matches: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aggregates two Matches: the win, the podium, the falls, and the flawless one", () => {
    const { dir, db } = openTestDb();
    try {
      seedTracks(db);
      saveMatchResult(db, MATCH_WIN);
      saveMatchResult(db, MATCH_PODIUM);

      const career = getCareer(db, "acc-1");
      // ADR 0110: the longest single Survival stay, and every Struggle won.
      expect(career.stats).toEqual({
        matches: 2,
        wins: 1,
        podiums: 2,
        falls: 5,
        bestPlacement: 1,
        cleanMatches: 1,
        bestSurvivalMs: 73_500,
        grabsBroken: 3,
      });
      expect(career.badges).toEqual({ earned: ["first-steps", "podium", "winner", "flawless"], total: 6 });

      // Newest first, with the exact numbers the results page showed.
      expect(career.matches.map((row) => row.matchId)).toEqual(["m-podium", "m-win"]);
      expect(career.matches[0]).toEqual({
        matchId: "m-podium",
        placement: 2,
        score: matchScore(MATCH_PODIUM.results).p1,
        falls: 5,
        rounds: 1,
        trackNames: ["UNTITLED TRACK"],
        endedAtMs: 120_000,
      });
      expect(career.matches[1]).toEqual({
        matchId: "m-win",
        placement: 1,
        score: matchScore(MATCH_WIN.results).p1,
        falls: 0,
        rounds: 2,
        trackNames: ["Green Hills"],
        endedAtMs: 60_000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("anonymous seats leave no row — an Account only ever sees its own races", () => {
    const { dir, db } = openTestDb();
    try {
      seedTracks(db);
      saveMatchResult(db, MATCH_PODIUM);

      // px raced without an Account: nothing attributable, nothing stored.
      expect(getCareer(db, "acc-1").stats.matches).toBe(1);
      expect(getCareer(db, "acc-2").stats.matches).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a Bot that wins leaves no row, and the Player it beat reads the place it really took (M17 ticket 10)", () => {
    const { dir, db } = openTestDb();
    try {
      seedTracks(db);
      // A Bot is a seat with no Account (ADR 0129): named, coloured, timed and
      // scored like anyone, and missing from `accountIds` alone.
      saveMatchResult(db, {
        matchId: "m-bot",
        results: [{ rows: [{ id: "bot", placement: 1, qualified: true }, { id: "p1", placement: 2, qualified: false }] }],
        roundTrackIds: ["t-green"],
        nicknames: { bot: "pixelpeach", p1: "Floppo" },
        accountIds: { p1: "acc-1" },
        colors: { bot: 3 },
        hats: { bot: "crown" },
        totalFalls: { bot: 0, p1: 1 },
        survivalMs: { bot: 90_000, p1: 20_000 },
        grabsBroken: { bot: 4, p1: 0 },
        endedAtMs: 10_000,
      });

      const career = getCareer(db, "acc-1");
      expect(career.stats).toMatchObject({ matches: 1, wins: 0, podiums: 1, bestPlacement: 2, bestSurvivalMs: 20_000, grabsBroken: 0 });
      expect(career.matches[0]).toMatchObject({ matchId: "m-bot", placement: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a retried save never double-counts a career", () => {
    const { dir, db } = openTestDb();
    try {
      seedTracks(db);
      saveMatchResult(db, MATCH_WIN);
      saveMatchResult(db, MATCH_WIN);

      expect(getCareer(db, "acc-1").stats).toMatchObject({ matches: 1, wins: 1, falls: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a pre-index save still counts — its rows just name no Tracks", () => {
    const { dir, db } = openTestDb();
    try {
      seedTracks(db);
      const { roundTrackIds: _dropped, ...legacy } = MATCH_WIN;
      saveMatchResult(db, legacy);

      const career = getCareer(db, "acc-1");
      expect(career.stats).toMatchObject({ matches: 1, wins: 1 });
      expect(career.matches[0]?.trackNames).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("career route", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "api-career-test-"));
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

  it("serves the caller's own career behind the Bearer [REDACTED] nobody else's", async () => {
    expect((await app.inject({ method: "GET", url: "/career" })).statusCode).toBe(401);

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "wobbleton@example.com", password: "correct horse battery staple", displayName: "Wobbleton" },
    });
    const { account, token } = signup.json() as { account: { id: string }; token: string };

    const saved = await app.inject({
      method: "POST",
      url: "/internal/match-results",
      headers: { "x-service-token": "test-service-token" },
      payload: { ...MATCH_WIN, accountIds: { p1: account.id, p2: "acc-2" } },
    });
    expect(saved.statusCode).toBe(200);

    const career = await app.inject({ method: "GET", url: "/career", headers: { authorization: `Bearer ${token}` } });
    expect(career.statusCode).toBe(200);
    expect(career.json()).toMatchObject({
      stats: { matches: 1, wins: 1 },
      badges: { earned: ["first-steps", "podium", "winner", "flawless"], total: 6 },
    });
    // No Tracks seeded in this app: the row honestly says so.
    expect((career.json() as { matches: { trackNames: string[] }[] }).matches[0]?.trackNames).toEqual([
      "UNTITLED TRACK",
    ]);
  });
});

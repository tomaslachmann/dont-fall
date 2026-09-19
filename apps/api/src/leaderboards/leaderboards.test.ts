import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEADERBOARD_SIZE } from "@dont-fall/shared";
import { openDb, type ApiDb } from "../db/db.js";
import { createAccountWithPassword } from "../auth/accounts.dao.js";
import { insertMatchParticipants } from "../matches/matches.dao.js";
import { offerPersonalBest } from "../personalBests/personalBests.dao.js";
import { getLeaderboard } from "./leaderboards.service.js";

let dir: string;
let db: ApiDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "api-leaderboards-test-"));
  db = openDb(join(dir, "test.sqlite"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const account = (name: string) =>
  createAccountWithPassword(db, { email: `${name}@example.com`, password: "correct horse battery staple", displayName: name }).id;

let match = 0;
const played = (accountId: string, placement: number, bestSurvivalMs: number | null = null) => {
  match += 1;
  insertMatchParticipants(db, [
    { matchId: `m${match}`, accountId, placement, score: 0, falls: 0, bestSurvivalMs, grabsBroken: 0, endedAtMs: match },
  ]);
};

describe("leaderboards (ADR 0110)", () => {
  it("ranks wins most first, shares a tie, and leaves out anyone who never won", () => {
    const amy = account("Amy");
    const bo = account("Bo");
    const cy = account("Cy");
    played(amy, 1);
    played(amy, 1);
    played(bo, 1);
    played(bo, 1);
    played(cy, 2);

    const board = getLeaderboard(db, "wins", cy);
    // Tied at the top: both are 1st, in no promised order.
    expect(board.rows.map((row) => [row.displayName, row.rank, row.value]).sort()).toEqual([
      ["Amy", 1, 2],
      ["Bo", 1, 2],
    ]);
    expect(board.you).toBeNull();
  });

  it("ranks Survival by the longest single stay, and a Race Track by its fastest Personal Best", () => {
    const amy = account("Amy");
    const bo = account("Bo");
    played(amy, 2, 40_000);
    played(amy, 3, 90_000);
    played(bo, 1, 60_000);
    expect(getLeaderboard(db, "survival", amy).rows.map((row) => [row.displayName, row.value])).toEqual([
      ["Amy", 90_000],
      ["Bo", 60_000],
    ]);

    offerPersonalBest(db, { accountId: amy, trackId: "t1", raceTimeMs: 81_000, matchId: "x", atMs: 1 });
    offerPersonalBest(db, { accountId: bo, trackId: "t1", raceTimeMs: 79_500, matchId: "x", atMs: 1 });
    offerPersonalBest(db, { accountId: bo, trackId: "t2", raceTimeMs: 50_000, matchId: "x", atMs: 1 });
    const race = getLeaderboard(db, "race", amy, "t1");
    expect(race.rows.map((row) => [row.displayName, row.value])).toEqual([
      ["Bo", 79_500],
      ["Amy", 81_000],
    ]);
    expect(race.you).toMatchObject({ rank: 2, displayName: "Amy" });
  });

  it("lists the top of a board, and your own row beside it when you are further down", () => {
    const me = account("Me");
    for (let n = 0; n < LEADERBOARD_SIZE + 5; n += 1) {
      const other = account(`p${n}`);
      played(other, 1);
      played(other, 1);
    }
    played(me, 1);

    const board = getLeaderboard(db, "wins", me);
    expect(board.rows).toHaveLength(LEADERBOARD_SIZE);
    expect(board.you).toMatchObject({ displayName: "Me", rank: LEADERBOARD_SIZE + 6, value: 1 });
  });

  it("refuses a board that does not exist, and a Race board without a Track", () => {
    const me = account("Me");
    expect(() => getLeaderboard(db, "falls", me)).toThrowError(/no board/);
    expect(() => getLeaderboard(db, "race", me)).toThrowError(/needs a Track/);
  });
});

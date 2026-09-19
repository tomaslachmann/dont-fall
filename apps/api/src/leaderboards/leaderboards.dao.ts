import { desc, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { ApiDb } from "../db/db.js";
import { accounts, matchParticipants, personalBests } from "../db/schema.js";

/** One Account's number on a board, best first — before names or ranks are attached. */
export interface BoardEntry {
  accountId: string;
  value: number;
}

/** Every Account that has won a Match, most wins first (ADR 0110). */
export const winsBoard = (db: ApiDb): BoardEntry[] => {
  const wins = sql<number>`sum(${matchParticipants.placement} = 1)`;
  return db
    .select({ accountId: matchParticipants.accountId, value: wins })
    .from(matchParticipants)
    .groupBy(matchParticipants.accountId)
    .having(sql`${wins} > 0`)
    .orderBy(desc(wins), asc(matchParticipants.accountId))
    .all();
};

/** Every Account's longest stay in one Survival Round, longest first (ADR 0110). */
export const survivalBoard = (db: ApiDb): BoardEntry[] => {
  const best = sql<number>`max(${matchParticipants.bestSurvivalMs})`;
  return db
    .select({ accountId: matchParticipants.accountId, value: best })
    .from(matchParticipants)
    .where(isNotNull(matchParticipants.bestSurvivalMs))
    .groupBy(matchParticipants.accountId)
    .orderBy(desc(best), asc(matchParticipants.accountId))
    .all();
};

/** Every Account's Personal Best on one Track, fastest first (ADR 0088, 0110). */
export const raceBoard = (db: ApiDb, trackId: string): BoardEntry[] =>
  db
    .select({ accountId: personalBests.accountId, value: personalBests.bestMs })
    .from(personalBests)
    .where(eq(personalBests.trackId, trackId))
    .orderBy(asc(personalBests.bestMs), asc(personalBests.accountId))
    .all();

/** Names and Colours for the Accounts a board lists. */
export const boardAccounts = (
  db: ApiDb,
  accountIds: readonly string[],
): Map<string, { displayName: string; color: number }> => {
  if (accountIds.length === 0) return new Map();
  return new Map(
    db
      .select({ id: accounts.id, displayName: accounts.displayName, color: accounts.color })
      .from(accounts)
      .where(inArray(accounts.id, [...accountIds]))
      .all()
      .map((row) => [row.id, { displayName: row.displayName, color: row.color }] as const),
  );
};

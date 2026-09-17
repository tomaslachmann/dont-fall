import { desc, eq, sql } from "drizzle-orm";
import type { CareerStats } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { matchParticipants } from "../db/schema.js";
import type { MatchParticipantRow } from "../matches/matches.dao.js";

/**
 * One Account's whole career in a single row scan — every aggregate the
 * Profile screen's stat tiles read. A career with no finished Matches is all
 * zeros with a null best, never a missing row: the screen renders zeros, not
 * a second empty state.
 */
export const getCareerAggregates = (db: ApiDb, accountId: string): CareerStats => {
  const row = db
    .select({
      matches: sql<number>`count(*)`,
      wins: sql<number>`sum(${matchParticipants.placement} = 1)`,
      podiums: sql<number>`sum(${matchParticipants.placement} <= 3)`,
      falls: sql<number>`sum(${matchParticipants.falls})`,
      bestPlacement: sql<number | null>`min(${matchParticipants.placement})`,
      cleanMatches: sql<number>`sum(${matchParticipants.falls} = 0)`,
    })
    .from(matchParticipants)
    .where(eq(matchParticipants.accountId, accountId))
    .get();
  // `sum()` over zero rows is NULL, `count(*)` is 0 — the `?? 0` is the
  // empty-career row, not paranoia. `bestPlacement` stays genuinely null.
  return {
    matches: row?.matches ?? 0,
    wins: row?.wins ?? 0,
    podiums: row?.podiums ?? 0,
    falls: row?.falls ?? 0,
    bestPlacement: row?.bestPlacement ?? null,
    cleanMatches: row?.cleanMatches ?? 0,
  };
};

/** Newest-first participant rows for one Account — the career history behind the Profile screen. */
export const listRecentParticipations = (
  db: ApiDb,
  accountId: string,
  limit: number,
): MatchParticipantRow[] =>
  db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.accountId, accountId))
    .orderBy(desc(matchParticipants.endedAtMs))
    .limit(limit)
    .all();

import { eq } from "drizzle-orm";
import type { PersistedMatchResult } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { matchResults } from "../db/schema.js";

/**
 * Persists one finished Match's results (ADR 0059) — first write wins. A
 * retried save (same `matchId`) is a no-op, not an overwrite: results are
 * written once at the terminal RESULTS and never mutated, so a duplicated
 * server notification can't corrupt a finished Match.
 */
export const saveMatchResult = (db: ApiDb, result: PersistedMatchResult): void => {
  db.insert(matchResults)
    .values({ matchId: result.matchId, data: result, endedAtMs: result.endedAtMs })
    .onConflictDoNothing({ target: [matchResults.matchId] })
    .run();
};

/** Reads one finished Match's results back — `undefined` when no Match was ever saved under this id. */
export const getMatchResult = (db: ApiDb, matchId: string): PersistedMatchResult | undefined => {
  const row = db.select().from(matchResults).where(eq(matchResults.matchId, matchId)).get();
  return row?.data;
};

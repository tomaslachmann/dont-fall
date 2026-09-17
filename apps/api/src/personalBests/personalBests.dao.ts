import { and, eq, sql } from "drizzle-orm";
import type { ApiDb } from "../db/db.js";
import { personalBests } from "../db/schema.js";

/**
 * Offers one finished run as a Personal Best (ADR 0088) — inserted when the
 * Account has none on this Track, kept only when faster than the one it has.
 * A slower run, or a retried report of the same run, changes nothing.
 */
export const offerPersonalBest = (
  db: ApiDb,
  run: { accountId: string; trackId: string; raceTimeMs: number; matchId: string; atMs: number },
): void => {
  db.insert(personalBests)
    .values({ accountId: run.accountId, trackId: run.trackId, bestMs: run.raceTimeMs, matchId: run.matchId, setAtMs: run.atMs })
    .onConflictDoUpdate({
      target: [personalBests.accountId, personalBests.trackId],
      set: { bestMs: run.raceTimeMs, matchId: run.matchId, setAtMs: run.atMs },
      setWhere: sql`${personalBests.bestMs} > ${run.raceTimeMs}`,
    })
    .run();
};

/** One Account's Personal Best on one Track, in ms — `null` before any finished run. */
export const getPersonalBestMs = (db: ApiDb, accountId: string, trackId: string): number | null => {
  const row = db
    .select({ bestMs: personalBests.bestMs })
    .from(personalBests)
    .where(and(eq(personalBests.accountId, accountId), eq(personalBests.trackId, trackId)))
    .get();
  return row?.bestMs ?? null;
};

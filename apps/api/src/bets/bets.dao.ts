import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ApiDb } from "../db/db.js";
import { betRounds, bets } from "../db/schema.js";

export interface BetRunner {
  playerId: string;
  nickname: string;
}

export interface BetRoundRow {
  matchId: string;
  round: number;
  closesAtMs: number;
  runners: BetRunner[];
  settled: boolean;
  winnerIds: string[] | null;
}

export interface BetRow {
  id: string;
  accountId: string;
  nickname: string;
  targetId: string;
  targetNickname: string;
  amount: number;
  placedAtMs: number;
}

const toRoundRow = (row: typeof betRounds.$inferSelect): BetRoundRow => ({
  matchId: row.matchId,
  round: row.round,
  closesAtMs: row.closesAtMs,
  runners: row.runners,
  settled: row.settled === 1,
  winnerIds: row.winnerIds,
});

/**
 * Opens a Round for betting (ticket 14) — first write wins. A retried open
 * (same `(matchId, round)`) can't move the close or swap the board, so a
 * duplicated server notification is a no-op, not a reopened window.
 */
export const openBetRound = (
  db: ApiDb,
  round: { matchId: string; round: number; closesAtMs: number; runners: BetRunner[] },
): BetRoundRow => {
  db.insert(betRounds)
    .values({ ...round, settled: 0 })
    .onConflictDoNothing({ target: [betRounds.matchId, betRounds.round] })
    .run();
  const row = db
    .select()
    .from(betRounds)
    .where(and(eq(betRounds.matchId, round.matchId), eq(betRounds.round, round.round)))
    .get();
  if (!row) throw new Error("bet round vanished right after opening it");
  return toRoundRow(row);
};

export const getBetRound = (db: ApiDb, matchId: string, round: number): BetRoundRow | undefined => {
  const row = db
    .select()
    .from(betRounds)
    .where(and(eq(betRounds.matchId, matchId), eq(betRounds.round, round)))
    .get();
  return row === undefined ? undefined : toRoundRow(row);
};

export const insertBet = (
  db: ApiDb,
  bet: { matchId: string; round: number; accountId: string; nickname: string; targetId: string; targetNickname: string; amount: number },
  nowMs: number,
): BetRow => {
  const id = randomUUID();
  db.insert(bets)
    .values({ id, ...bet, placedAtMs: nowMs })
    .run();
  return { id, ...bet, placedAtMs: nowMs };
};

export const listBets = (db: ApiDb, matchId: string, round: number): BetRow[] =>
  db
    .select({
      id: bets.id,
      accountId: bets.accountId,
      nickname: bets.nickname,
      targetId: bets.targetId,
      targetNickname: bets.targetNickname,
      amount: bets.amount,
      placedAtMs: bets.placedAtMs,
    })
    .from(bets)
    .where(and(eq(bets.matchId, matchId), eq(bets.round, round)))
    .orderBy(bets.placedAtMs)
    .all();

/** Latest tickets first, for the panel's ticker. */
export const recentBets = (db: ApiDb, matchId: string, round: number, limit: number): BetRow[] =>
  db
    .select({
      id: bets.id,
      accountId: bets.accountId,
      nickname: bets.nickname,
      targetId: bets.targetId,
      targetNickname: bets.targetNickname,
      amount: bets.amount,
      placedAtMs: bets.placedAtMs,
    })
    .from(bets)
    .where(and(eq(bets.matchId, matchId), eq(bets.round, round)))
    .orderBy(desc(bets.placedAtMs), desc(bets.id))
    .limit(limit)
    .all();

export const countBettors = (db: ApiDb, matchId: string, round: number): number => {
  const row = db
    .select({ count: sql<number>`count(distinct ${bets.accountId})` })
    .from(bets)
    .where(and(eq(bets.matchId, matchId), eq(bets.round, round)))
    .get();
  return row?.count ?? 0;
};

/**
 * Marks a Round settled with the winners it paid (ticket 14) — the settle's
 * own idempotence: an already-settled Round keeps its first answer, so a
 * retried settle can't pay twice.
 */
export const markSettled = (
  db: ApiDb,
  matchId: string,
  round: number,
  winnerIds: string[],
  nowMs: number,
): BetRoundRow | undefined => {
  const current = getBetRound(db, matchId, round);
  if (!current || current.settled) return current;
  db.update(betRounds)
    .set({ settled: 1, winnerIds, settledAtMs: nowMs })
    .where(and(eq(betRounds.matchId, matchId), eq(betRounds.round, round)))
    .run();
  return getBetRound(db, matchId, round);
};

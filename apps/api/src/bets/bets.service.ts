import { parimutuelOdds, settlePayouts } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { creditAccountEarnings, getAccountEarnings, spendCoins } from "../auth/accounts.dao.js";
import {
  countBettors,
  getBetRound,
  insertBet,
  listBets,
  markSettled,
  openBetRound,
  recentBets,
  type BetRunner,
} from "./bets.dao.js";

export interface BettingRunnerState extends BetRunner {
  pool: number;
  /** Nothing divides the pool yet when nobody backed this runner — the panel renders a dash. */
  odds: number | undefined;
}

export interface BettingState {
  matchId: string;
  round: number;
  open: boolean;
  closesAtMs: number;
  settled: boolean;
  winnerIds: string[] | null;
  runners: BettingRunnerState[];
  totalPool: number;
  bettorCount: number;
  recentBets: { nickname: string; amount: number; targetNickname: string; placedAtMs: number }[];
}

const TICKER_LIMIT = 5;

const stateOf = (db: ApiDb, matchId: string, round: number, nowMs: number): BettingState => {
  const bettingRound = getBetRound(db, matchId, round);
  if (!bettingRound) throw new ServiceError(404, "no betting round for this Match and Round");
  const placed = listBets(db, matchId, round);
  const pools: { [targetId: string]: number } = Object.fromEntries(
    bettingRound.runners.map((runner) => [runner.playerId, 0]),
  );
  for (const bet of placed) pools[bet.targetId] = (pools[bet.targetId] ?? 0) + bet.amount;
  const totalPool = Object.values(pools).reduce((sum, pool) => sum + pool, 0);
  const odds = parimutuelOdds(pools);
  return {
    matchId,
    round,
    open: !bettingRound.settled && nowMs < bettingRound.closesAtMs,
    closesAtMs: bettingRound.closesAtMs,
    settled: bettingRound.settled,
    winnerIds: bettingRound.winnerIds,
    runners: bettingRound.runners.map((runner) => ({
      ...runner,
      pool: pools[runner.playerId] ?? 0,
      odds: odds[runner.playerId],
    })),
    totalPool,
    bettorCount: countBettors(db, matchId, round),
    recentBets: recentBets(db, matchId, round, TICKER_LIMIT).map((bet) => ({
      nickname: bet.nickname,
      amount: bet.amount,
      targetNickname: bet.targetNickname,
      placedAtMs: bet.placedAtMs,
    })),
  };
};

/**
 * Opens a Round for betting — the match server's call when its Countdown
 * starts. First write wins (the DAO), so a retried open is a read, and the
 * response always describes the Round as it stands.
 */
export const openBettingRound = (
  db: ApiDb,
  round: { matchId: string; round: number; closesAtMs: number; runners: BetRunner[] },
): { matchId: string; round: number; closesAtMs: number; open: boolean } => {
  if (typeof round.matchId !== "string" || round.matchId.length === 0) throw new ServiceError(400, "matchId is required");
  if (!Number.isInteger(round.round) || round.round < 1) throw new ServiceError(400, "round must be a positive integer");
  if (!Number.isInteger(round.closesAtMs) || round.closesAtMs <= 0) {
    throw new ServiceError(400, "closesAtMs must be a positive integer");
  }
  if (!Array.isArray(round.runners) || round.runners.length === 0) {
    throw new ServiceError(400, "runners must be a non-empty list of { playerId, nickname }");
  }
  for (const runner of round.runners) {
    if (typeof runner?.playerId !== "string" || runner.playerId.length === 0 || typeof runner?.nickname !== "string") {
      throw new ServiceError(400, "runners must be a non-empty list of { playerId, nickname }");
    }
  }
  const opened = openBetRound(db, round);
  return { matchId: opened.matchId, round: opened.round, closesAtMs: opened.closesAtMs, open: !opened.settled };
};

/**
 * Stakes beans on one runner — the Spectator panel's STAKE behind
 * `POST /bets`. The debit is atomic (`spendCoins`' conditional UPDATE), so
 * the check-then-insert below can't overspend a racing balance: validate
 * everything first, debit, then write the ticket.
 */
export const placeBet = (
  db: ApiDb,
  account: { id: string; displayName: string },
  ticket: { matchId: string; round: number; targetId: string; amount: number },
  nowMs: number,
): { betId: string; coins: number } => {
  if (typeof ticket.matchId !== "string" || ticket.matchId.length === 0) {
    throw new ServiceError(400, "matchId is required");
  }
  if (!Number.isInteger(ticket.round) || ticket.round < 1) throw new ServiceError(400, "round must be a positive integer");
  if (!Number.isInteger(ticket.amount) || ticket.amount < 1) {
    throw new ServiceError(400, "amount must be a positive integer number of beans");
  }
  const bettingRound = getBetRound(db, ticket.matchId, ticket.round);
  if (!bettingRound) throw new ServiceError(400, "betting is not open for this Match and Round");
  if (bettingRound.settled) throw new ServiceError(400, "this Round already settled — the board is final");
  if (nowMs >= bettingRound.closesAtMs) throw new ServiceError(400, "betting closed for this Round");
  const runner = bettingRound.runners.find((candidate) => candidate.playerId === ticket.targetId);
  if (!runner) throw new ServiceError(400, "that runner is not on this Round's board");
  const spent = spendCoins(db, account.id, ticket.amount);
  if (!spent) throw new ServiceError(400, "not enough jelly beans for that stake");
  const bet = insertBet(
    db,
    {
      matchId: ticket.matchId,
      round: ticket.round,
      accountId: account.id,
      nickname: account.displayName,
      targetId: runner.playerId,
      targetNickname: runner.nickname,
      amount: ticket.amount,
    },
    nowMs,
  );
  return { betId: bet.id, coins: spent.coins };
};

/** One Round's board, pools, live odds and ticker — the Spectator panel's poll behind `GET /bets/:matchId/:round`. */
export const getBettingState = (db: ApiDb, matchId: string, round: number, nowMs: number): BettingState =>
  stateOf(db, matchId, round, nowMs);

/**
 * Settles a Round — the match server's call when the Round ends. Idempotent:
 * an already-settled Round keeps its first answer (the DAO), so a retried
 * settle can't pay twice. Winners are the placement-1 runners; with none
 * backed, every stake refunds (`settlePayouts`' void round).
 */
export const settleBettingRound = (
  db: ApiDb,
  settle: { matchId: string; round: number; winnerIds: string[] },
  nowMs: number,
): { matchId: string; round: number; settled: boolean; payouts: { bettorId: string; payout: number }[] } => {
  if (typeof settle.matchId !== "string" || settle.matchId.length === 0) {
    throw new ServiceError(400, "matchId is required");
  }
  if (!Number.isInteger(settle.round) || settle.round < 1) throw new ServiceError(400, "round must be a positive integer");
  if (!Array.isArray(settle.winnerIds) || settle.winnerIds.length === 0) {
    throw new ServiceError(400, "winnerIds must name the Round's winners");
  }
  const bettingRound = getBetRound(db, settle.matchId, settle.round);
  if (!bettingRound) throw new ServiceError(404, "no betting round for this Match and Round");
  for (const winnerId of settle.winnerIds) {
    if (!bettingRound.runners.some((runner) => runner.playerId === winnerId)) {
      throw new ServiceError(400, "winners must come from this Round's board");
    }
  }
  const placed = listBets(db, settle.matchId, settle.round);
  const totalPool = placed.reduce((sum, bet) => sum + bet.amount, 0);
  const winners = new Set(settle.winnerIds);
  // Pure, so a retried settle recomputes the identical answer instead of
  // paying again — the DAO's settled flag is what makes the credits below
  // run once, this is what makes the response say the same thing twice.
  const payouts = settlePayouts(
    placed.map((bet) => ({ bettorId: bet.accountId, stake: bet.amount, won: winners.has(bet.targetId) })),
    totalPool,
  );
  if (!bettingRound.settled) {
    for (const payout of payouts) {
      if (payout.payout > 0) creditAccountEarnings(db, payout.bettorId, { xp: 0, coins: payout.payout });
    }
    markSettled(db, settle.matchId, settle.round, [...winners], nowMs);
  }
  return { matchId: settle.matchId, round: settle.round, settled: true, payouts };
};

export const getAccountCoins = (db: ApiDb, accountId: string): number => {
  const earnings = getAccountEarnings(db, accountId);
  if (!earnings) throw new ServiceError(401, "not logged in");
  return earnings.coins;
};

import { earningsForMatch, roundScore, type PersistedMatchResult } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { creditAccountEarnings, getAccountEarnings } from "../auth/accounts.dao.js";
import { betWinningsFor } from "../bets/bets.service.js";
import { getMatchResult } from "../matches/matches.dao.js";
import { getRewardClaim, insertRewardClaim } from "./rewards.dao.js";

export interface ClaimedRound {
  /** 1-based placement in that Round. */
  placement: number;
  /** Ranked field size of that Round. */
  playerCount: number;
  /** That Round's own `roundScore` for the placement. */
  score: number;
}

export interface RewardsClaim {
  gainedXp: number;
  gainedCoins: number;
  xpBefore: number;
  xpAfter: number;
  coinsBefore: number;
  coinsAfter: number;
}

/** A claim as the Rewards screen reads it: the credit, the Rounds it was paid for, and what bets won (ADR 0110). */
export interface RewardsClaimView extends RewardsClaim {
  /** This Account's own Rounds of the Match, oldest first — Rounds it sat out are left out. */
  rounds: ClaimedRound[];
  /** Coins this Account's bets on the Match won — already credited when each Round settled. */
  betWinnings: number;
}

/**
 * The caller's own Rounds of a stored Match (ADR 0110): every seat the Match
 * recorded under this Account, each Round's placement, field and Score, from
 * the server's own results. What earnings are paid on — never rows a client
 * sends.
 */
export const roundsPlayedBy = (result: PersistedMatchResult, accountId: string): ClaimedRound[] => {
  const seats = new Set(
    Object.entries(result.accountIds ?? {})
      .filter(([, owner]) => owner === accountId)
      .map(([seat]) => seat),
  );
  return result.results.flatMap((round) => {
    const row = round.rows.find((candidate) => seats.has(candidate.id));
    return row === undefined
      ? []
      : [{ placement: row.placement, playerCount: round.rows.length, score: roundScore(row.placement, round.rows.length, row.qualified) }];
  });
};

/**
 * Banks one Match's earnings onto the caller's Account (full-economy slice,
 * ADR 0052): the Rewards screen's claim behind `POST /rewards/claim`. The
 * Rounds are the server's own (ADR 0110): the claim names only the Match, and
 * the Account is found in it — a caller who did not race it is refused. The
 * formula is shared (`earningsForMatch`), so the screen's breakdown and this
 * credit can never disagree.
 *
 * Idempotent per Match (ADR 0059): a second claim for the same Match replays
 * the stored numbers instead of crediting again. Unknown match ids are
 * refused, so a claim always points at a Match that happened.
 */
export const claimMatchRewards = (
  db: ApiDb,
  accountId: string,
  body: unknown,
  nowMs = Date.now(),
): RewardsClaimView => {
  const { matchId } = typeof body === "object" && body !== null ? (body as { matchId?: unknown }) : {};
  if (typeof matchId !== "string" || matchId.length === 0) {
    throw new ServiceError(400, "matchId must be a non-empty string");
  }
  const result = getMatchResult(db, matchId);
  if (result === undefined) throw new ServiceError(404, `no finished Match "${matchId}"`);
  const rounds = roundsPlayedBy(result, accountId);
  const betWinnings = betWinningsFor(db, matchId, accountId);
  const existing = getRewardClaim(db, accountId, matchId);
  if (existing) return { ...existing, rounds, betWinnings };
  if (rounds.length === 0) throw new ServiceError(403, "you did not race in this Match");
  const gained = earningsForMatch(rounds);
  const credited = creditAccountEarnings(db, accountId, { xp: gained.xp, coins: gained.beans });
  if (!credited) throw new ServiceError(401, "not logged in");
  const claim: RewardsClaim = {
    gainedXp: gained.xp,
    gainedCoins: gained.beans,
    xpBefore: credited.before.xp,
    xpAfter: credited.after.xp,
    coinsBefore: credited.before.coins,
    coinsAfter: credited.after.coins,
  };
  insertRewardClaim(db, accountId, matchId, claim, nowMs);
  return { ...claim, rounds, betWinnings };
};

/** Current lifetime totals — the menu/profile half of the economy. */
export const getRewardsBalance = (db: ApiDb, accountId: string): { xp: number; coins: number } => {
  const earnings = getAccountEarnings(db, accountId);
  if (!earnings) throw new ServiceError(401, "not logged in");
  return earnings;
};

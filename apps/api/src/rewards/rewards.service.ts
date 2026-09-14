import { earningsForMatch } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { creditAccountEarnings, getAccountEarnings } from "../auth/accounts.dao.js";
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

const invalidRoundReason = (round: unknown): string | undefined => {
  if (typeof round !== "object" || round === null) return "each round needs { placement, playerCount, score }";
  const { placement, playerCount, score } = round as Record<string, unknown>;
  if (!Number.isInteger(placement) || (placement as number) < 1) return "placement must be a positive integer";
  if (!Number.isInteger(playerCount) || (playerCount as number) < 1) return "playerCount must be a positive integer";
  if ((placement as number) > (playerCount as number)) return "placement cannot outrank the field";
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) return "score must be a non-negative number";
  return undefined;
};

/**
 * Banks one Match's earnings onto the caller's Account (full-economy slice,
 * ADR 0052): the Rewards screen's claim behind `POST /rewards/claim`.
 * The formula is shared (`earningsForMatch`) — the client's own breakdown
 * and this credit can never disagree.
 *
 * Idempotent per Match (ADR 0059): the claim names its `matchId`, and a
 * second claim for the same Match replays the stored numbers instead of
 * crediting again — a refresh on the rewards screen stops minting. Unknown
 * match ids are refused, so a claim always points at a Match that happened.
 *
 * One honest limitation left, still structural: the claim trusts the
 * client's own placement rows (match sockets don't know Accounts yet, so the
 * server can't re-derive them — a liar can still mint earnings until account
 * linking lands, now bounded to one claim per real Match instead of one per
 * refresh).
 */
export const claimMatchRewards = (
  db: ApiDb,
  accountId: string,
  body: unknown,
  nowMs = Date.now(),
): RewardsClaim => {
  const { matchId, rounds } =
    typeof body === "object" && body !== null ? (body as { matchId?: unknown; rounds?: unknown }) : {};
  if (typeof matchId !== "string" || matchId.length === 0) {
    throw new ServiceError(400, "matchId must be a non-empty string");
  }
  if (getMatchResult(db, matchId) === undefined) throw new ServiceError(404, `no finished Match "${matchId}"`);
  const existing = getRewardClaim(db, accountId, matchId);
  if (existing) return existing;
  if (!Array.isArray(rounds) || rounds.length === 0 || rounds.length > 64) {
    throw new ServiceError(400, "rounds must be a non-empty list of played Rounds");
  }
  const claimed: ClaimedRound[] = rounds.map((round) => {
    const reason = invalidRoundReason(round);
    if (reason) throw new ServiceError(400, reason);
    const { placement, playerCount, score } = round as ClaimedRound;
    return { placement, playerCount, score };
  });
  const gained = earningsForMatch(claimed);
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
  return claim;
};

/** Current lifetime totals — the menu/profile half of the economy. */
export const getRewardsBalance = (db: ApiDb, accountId: string): { xp: number; coins: number } => {
  const earnings = getAccountEarnings(db, accountId);
  if (!earnings) throw new ServiceError(401, "not logged in");
  return earnings;
};

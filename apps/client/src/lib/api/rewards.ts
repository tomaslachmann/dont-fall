import { apiGet, apiPost } from "./base.js";

/**
 * The client's half of `/rewards/*` — the economy's claim + read side.
 * One Match's rows in, lifetime totals out; the Rewards screen renders its
 * breakdown from the same shared formula the server credits, so the two
 * can never disagree.
 */
export interface ClaimedRound {
  placement: number;
  playerCount: number;
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

export interface RewardsBalance {
  xp: number;
  coins: number;
}

/** Banks one Match — idempotent per `matchId` (ADR 0059): a replay returns the stored numbers, never a second credit. */
export const claimRewards = (rounds: ClaimedRound[], matchId: string): Promise<RewardsClaim> =>
  apiPost<RewardsClaim>("/rewards/claim", { matchId, rounds });

/** Lifetime totals — menu/profile half of the economy. */
export const getRewardsBalance = (): Promise<RewardsBalance> => apiGet<RewardsBalance>("/rewards/me");

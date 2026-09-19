import { apiGet, apiPost } from "./base.js";

/**
 * The client's half of `/rewards/*` — the economy's claim + read side. A
 * Match's id in; the server finds your Rounds in it (ADR 0110) and answers
 * with them, the credit, and what your bets won — the Rewards screen renders
 * all of it, computing nothing of its own.
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
  /** Your own Rounds of the Match, as the server stored them — what the credit was paid on. */
  rounds: ClaimedRound[];
  /** Coins your bets on the Match won, credited as each Round settled. */
  betWinnings: number;
}

export interface RewardsBalance {
  xp: number;
  coins: number;
}

/**
 * Banks one Match — idempotent per `matchId` (ADR 0059): a replay returns the
 * stored numbers, never a second credit. A 403 when you did not race it.
 */
export const claimRewards = (matchId: string): Promise<RewardsClaim> => apiPost<RewardsClaim>("/rewards/claim", { matchId });

/** Lifetime totals — menu/profile half of the economy. */
export const getRewardsBalance = (): Promise<RewardsBalance> => apiGet<RewardsBalance>("/rewards/me");

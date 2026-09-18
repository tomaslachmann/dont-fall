import { BEANS_PARTICIPATION_FLOOR, BEANS_PER_PLACEMENT_STEP, XP_LEVEL_BASE, XP_PER_MATCH_SCORE } from "./tuning/economy.js";

/**
 * Match earnings — the persisted-identity economy's first slice (ADR 0052):
 * what one Match pays one Player, in XP (progression) and beans (prize
 * currency). Both derive from what the Match already computed, never from
 * anything new the server would have to track:
 *
 * - XP is linear on Match Score (`roundScore` is already
 *   percentile-normalised per Round, so earnings compare across field
 *   sizes for free).
 * - Beans are per-Round placement prices, so a prize reads as a rank.
 *
 * The API credits these exact functions' answers on claim, and the client
 * renders its Rewards breakdown from the same functions — one formula, two
 * readers, no drift between "what the screen promised" and "what landed".
 */

export interface RoundEarning {
  /** 1-based placement in that Round. */
  placement: number;
  /** Ranked field size of that Round. */
  playerCount: number;
  /** That Round's own `roundScore` for the placement. */
  score: number;
}

/** XP one Round's Score pays. */
export const xpForRoundScore = (score: number): number => Math.max(0, Math.floor(score * XP_PER_MATCH_SCORE));

/** Beans one Round's placement pays — winner takes the field, last takes the floor. */
export const beansForPlacement = (placement: number, playerCount: number): number =>
  Math.max(BEANS_PARTICIPATION_FLOOR, (playerCount - placement + 1) * BEANS_PER_PLACEMENT_STEP);

/** What a whole Match pays: XP over the Score sum, beans over each Round. */
export const earningsForMatch = (rounds: readonly RoundEarning[]): { xp: number; beans: number } => ({
  xp: rounds.reduce((sum, round) => sum + xpForRoundScore(round.score), 0),
  beans: rounds.reduce((sum, round) => sum + beansForPlacement(round.placement, round.playerCount), 0),
});

/**
 * Spectator wagering — the persisted-identity economy's second slice (ticket
 * 14, ADR 0052): dynamic pari-mutuel odds driven by live stake volume, no
 * house cut. One formula, two readers again: the API settles with these, the
 * client previews its ticket with the current odds.
 *
 * Odds on a runner are `totalPool / runnerPool` — they shorten as more beans
 * land on them relative to the pool. A runner nobody backed has no odds
 * (`undefined`: nothing divides the pool yet), which the panel renders as a
 * dash rather than a made-up number.
 */
export type StakePools = { readonly [targetId: string]: number };

/** Live odds per runner from this Round's pools so far. */
export const parimutuelOdds = (pools: StakePools): { [targetId: string]: number | undefined } => {
  const total = Object.values(pools).reduce((sum, pool) => sum + pool, 0);
  return Object.fromEntries(
    Object.entries(pools).map(([targetId, pool]) => [targetId, pool > 0 ? total / pool : undefined]),
  );
};

export interface SettledBet {
  bettorId: string;
  payout: number;
}

/**
 * What each bettor is paid when the Round settles (ticket 14) — one row per
 * bettor, stakes already summed. Winning stakes share the whole pool
 * proportionally (`stake * total / winnersPool`), so the pot redistributes
 * in full — no house cut. Coins are integers, so floors leave dust: the
 * largest remainder method hands the leftover coins out deterministically
 * (biggest fraction first, ties broken by bigger stake, then bettor id),
 * never vanishing them into a hidden cut.
 *
 * Nobody backed a winner: every stake refunds in full instead — a void
 * round, not a confiscation. Losing bets pay 0 and still appear, so the
 * caller can tell \"paid nothing\" from \"was never there\".
 */
export const settlePayouts = (
  bets: readonly { bettorId: string; stake: number; won: boolean }[],
  totalPool: number,
): SettledBet[] => {
  const order: string[] = [];
  const stakes = new Map<string, number>();
  for (const bet of bets) {
    if (!stakes.has(bet.bettorId)) {
      stakes.set(bet.bettorId, 0);
      order.push(bet.bettorId);
    }
    stakes.set(bet.bettorId, stakes.get(bet.bettorId)! + bet.stake);
  }
  if (order.length === 0) return [];
  const wonStakes = new Map<string, number>();
  for (const bet of bets) {
    if (bet.won) wonStakes.set(bet.bettorId, (wonStakes.get(bet.bettorId) ?? 0) + bet.stake);
  }
  const winnersPool = [...wonStakes.values()].reduce((sum, stake) => sum + stake, 0);
  if (winnersPool <= 0) return order.map((bettorId) => ({ bettorId, payout: stakes.get(bettorId)! }));
  const floored = [...wonStakes.entries()].map(([bettorId, stake]) => {
    const exact = (stake * totalPool) / winnersPool;
    return { bettorId, stake, base: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = totalPool - floored.reduce((sum, row) => sum + row.base, 0);
  const ranked = [...floored].sort(
    (a, b) => b.fraction - a.fraction || b.stake - a.stake || (a.bettorId < b.bettorId ? -1 : 1),
  );
  const bonus = new Map<string, number>();
  for (const row of ranked) {
    if (remainder <= 0) break;
    bonus.set(row.bettorId, (bonus.get(row.bettorId) ?? 0) + 1);
    remainder -= 1;
  }
  const paid = new Map(floored.map((row) => [row.bettorId, row.base + (bonus.get(row.bettorId) ?? 0)]));
  return order.map((bettorId) => ({ bettorId, payout: paid.get(bettorId) ?? 0 }));
};

/** Total XP a level costs to leave — triangular, no table. Level 1 starts at 0 XP. */
export const xpToLeaveLevel = (level: number): number => XP_LEVEL_BASE * level;

/** Cumulative XP where `level` starts (level 1 starts at 0). */
export const xpLevelStart = (level: number): number => (XP_LEVEL_BASE * (level - 1) * level) / 2;

/** Which level `xp` total sits in — always >= 1. */
export const levelForXp = (xp: number): number => {
  let level = 1;
  while (xp >= xpLevelStart(level + 1)) level++;
  return level;
};

/**
 * Where `beforeXp` sits on its level's bar, and how much of `gainedXp`
 * fills after it — the Rewards screen's `xpBefore`/`xpEarned` fractions.
 * Overflow past the bar end clamps (a double level-up still fills one bar
 * visually; the level number itself comes from `levelForXp` on the total).
 */
export const xpBarFractions = (beforeXp: number, gainedXp: number): { before: number; earned: number } => {
  const level = levelForXp(Math.max(0, beforeXp));
  const start = xpLevelStart(level);
  const span = xpToLeaveLevel(level);
  const before = Math.min(1, Math.max(0, (beforeXp - start) / span));
  return { before, earned: Math.min(1 - before, Math.max(0, gainedXp) / span) };
};

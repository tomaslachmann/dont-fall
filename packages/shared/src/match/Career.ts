/**
 * A career at a glance (the Profile screen's numbers) — aggregates over one
 * Account's finished Matches, computed by the API from its participant rows
 * and evaluated here. Badges are deliberately derived, never stored: each
 * badge is a predicate over these aggregates, so an earned set can never
 * drift from the career it was earned in — no award events, no backfills.
 */

export interface CareerStats {
  /** Finished Matches this Account raced in. */
  matches: number;
  /** Matches finished at placement 1 (a shared rank 1 counts — one rule, "rank 1 is a win"). */
  wins: number;
  /** Matches finished at placement 3 or better — every win is a podium too. */
  podiums: number;
  /** Falls across every Match raced. */
  falls: number;
  /** Best Match placement, or null before the first finished Match. */
  bestPlacement: number | null;
  /** Matches finished without a single fall. */
  cleanMatches: number;
}

export interface BadgeDef {
  id: string;
  name: string;
  blurb: string;
  unlockedBy: (stats: CareerStats) => boolean;
}

/** The whole catalog, in display order — the Profile screen's `total`. */
export const BADGES: readonly BadgeDef[] = [
  { id: "first-steps", name: "First Steps", blurb: "Finish your first Match.", unlockedBy: (s) => s.matches >= 1 },
  { id: "contender", name: "Contender", blurb: "Finish 10 Matches.", unlockedBy: (s) => s.matches >= 10 },
  { id: "podium", name: "Podium", blurb: "Finish a Match in the top 3.", unlockedBy: (s) => s.podiums >= 1 },
  { id: "winner", name: "Winner", blurb: "Win a Match.", unlockedBy: (s) => s.wins >= 1 },
  { id: "champion", name: "Champion", blurb: "Win 5 Matches.", unlockedBy: (s) => s.wins >= 5 },
  { id: "flawless", name: "Flawless", blurb: "Finish a Match without falling.", unlockedBy: (s) => s.cleanMatches >= 1 },
];

/** Earned badge ids for a career, in catalog order. */
export const evaluateBadges = (stats: CareerStats): string[] =>
  BADGES.filter((badge) => badge.unlockedBy(stats)).map((badge) => badge.id);

export const badgeById = (id: string): BadgeDef | undefined => BADGES.find((badge) => badge.id === id);

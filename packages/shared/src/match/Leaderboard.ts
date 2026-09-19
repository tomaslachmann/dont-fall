/**
 * The Leaderboards screen's three boards (ADR 0110), the user's pick: most
 * Matches won, the best time on one Race Track, and the longest stay in a
 * Survival Round. Wire shapes shared so the API and the Screen cannot drift.
 */
export const LEADERBOARD_BOARDS = ["wins", "race", "survival"] as const;
export type LeaderboardBoard = (typeof LEADERBOARD_BOARDS)[number];

/** How many rows a board lists — the caller's own row rides along beside them when it is further down. */
export const LEADERBOARD_SIZE = 50;

export interface LeaderboardRow {
  /** 1-based, ties shared (a tie is the same number, and the next rank skips). */
  rank: number;
  accountId: string;
  displayName: string;
  /** The bean's Colour — what its avatar's disc wears without a picture. */
  color: number;
  /** Wins, or ms: a Race time (lower is better) or a Survival stay (higher is better). */
  value: number;
}

export interface Leaderboard {
  board: LeaderboardBoard;
  /** The Race board's Track — absent on the other two. */
  trackId?: string;
  rows: LeaderboardRow[];
  /** The caller's own row wherever it ranks, or `null` when it has none on this board. */
  you: LeaderboardRow | null;
}

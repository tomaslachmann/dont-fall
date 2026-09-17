import { BADGES, badgeById, UNTITLED_TRACK_NAME, type CareerStats } from "@dont-fall/shared";
import { formatAgo } from "./friendsView.js";
import type { CareerMatch } from "./api/career.js";

/**
 * Career wire data in, Profile screen props out — pure, so the tiles and
 * rows are pinned without a router or a query client. The shapes below are
 * structural twins of `Profile.tsx`'s own `ProfileStat`/`MatchRow` (kept
 * local so `lib` never imports a Screen); the Route passes them straight
 * through.
 */

export interface CareerStatTile {
  label: string;
  value: string;
  hero?: boolean;
}

export interface CareerMatchRow {
  rank: number;
  track: string;
  points: number;
  when: string;
}

/** Six tiles for any career — an empty one is zeros with em-dashes, never NaN. */
export const toCareerStatTiles = (stats: CareerStats): CareerStatTile[] => [
  { label: "MATCHES", value: `${stats.matches}` },
  { label: "WINS", value: `${stats.wins}`, hero: true },
  { label: "PODIUMS", value: `${stats.podiums}` },
  { label: "FALLS", value: `${stats.falls}` },
  { label: "BEST", value: stats.bestPlacement === null ? "—" : `#${stats.bestPlacement}` },
  { label: "WIN RATE", value: stats.matches === 0 ? "—" : `${Math.round((stats.wins / stats.matches) * 100)}%` },
];

/** Newest-first history rows — the score rides through raw, exactly as the results page showed it. */
export const toCareerMatchRows = (matches: readonly CareerMatch[], nowMs: number): CareerMatchRow[] =>
  matches.map((match) => ({
    rank: match.placement,
    track: match.trackNames.length === 0 ? UNTITLED_TRACK_NAME : match.trackNames.join(" · "),
    points: match.score,
    when: formatAgo(match.endedAtMs, nowMs),
  }));

/** Earned badge ids → display names in catalog order; unknown ids are skipped, never rendered. */
export const toEarnedBadgeNames = (earned: readonly string[]): string[] => {
  const order = new Map(BADGES.map((badge, i) => [badge.id, i]));
  return [...earned]
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!)
    .map((id) => badgeById(id)!.name);
};

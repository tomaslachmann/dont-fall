import { BADGES, evaluateBadges, UNTITLED_TRACK_NAME, type CareerStats } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { getMatchResult } from "../matches/matches.dao.js";
import { getTrackNamesByIds } from "../tracks/tracks.dao.js";
import { getCareerAggregates, listRecentParticipations } from "./career.dao.js";

/** How many finished Matches one `GET /career` carries — the Profile screen's SEE ALL ceiling. */
export const CAREER_RECENT_LIMIT = 20;

export interface CareerMatchRow {
  matchId: string;
  placement: number;
  score: number;
  falls: number;
  /** Rounds played in this Match. */
  rounds: number;
  /** Distinct Track names in Round order (`UNTITLED_TRACK_NAME` per unknown one; empty for pre-index saves). */
  trackNames: string[];
  endedAtMs: number;
}

export interface CareerResponse {
  stats: CareerStats;
  badges: { earned: string[]; total: number };
  matches: CareerMatchRow[];
}

/**
 * One Account's whole career (the Profile screen's fetch behind
 * `GET /career`): aggregates off the participant index, badges evaluated
 * from those same aggregates (derived, never stored — see `Career.ts`), and
 * the newest finished Matches with their Track names resolved.
 */
export const getCareer = (db: ApiDb, accountId: string): CareerResponse => {
  const stats = getCareerAggregates(db, accountId);
  const participations = listRecentParticipations(db, accountId, CAREER_RECENT_LIMIT);

  // Each saved Match is read once; Track ids across the whole page then
  // resolve in one query, not per row.
  const savedByMatch = new Map(participations.map((row) => [row.matchId, getMatchResult(db, row.matchId)]));
  const allIds = new Set<string>();
  for (const saved of savedByMatch.values()) {
    for (const id of saved?.roundTrackIds ?? []) allIds.add(id);
  }
  const names = getTrackNamesByIds(db, [...allIds]);

  const matches: CareerMatchRow[] = participations.map((row) => {
    const ids = savedByMatch.get(row.matchId)?.roundTrackIds ?? [];
    const trackNames = [...new Set(ids.map((id) => names.get(id) ?? UNTITLED_TRACK_NAME))];
    return {
      matchId: row.matchId,
      placement: row.placement,
      score: row.score,
      falls: row.falls,
      rounds: savedByMatch.get(row.matchId)?.results.length ?? 0,
      trackNames,
      endedAtMs: row.endedAtMs,
    };
  });

  return { stats, badges: { earned: evaluateBadges(stats), total: BADGES.length }, matches };
};

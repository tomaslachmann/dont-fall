/**
 * One Race Round's finished runs, as the match server reports them for
 * Personal Bests (ADR 0088) — `POST /internal/personal-bests`. Only seats
 * with an Account; the API keeps each Account's fastest per Track.
 */
export interface PersonalBestReport {
  trackId: string;
  matchId: string;
  runs: { accountId: string; raceTimeMs: number }[];
}

/** An Account's Personal Best on one Track — `GET /tracks/:id/personal-best`. `null` before any finished run. */
export interface PersonalBest {
  bestMs: number | null;
}

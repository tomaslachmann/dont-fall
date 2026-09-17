import type { PersonalBest, PersonalBestReport } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { getPersonalBestMs, offerPersonalBest } from "./personalBests.dao.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalidReportReason = (body: unknown): string | undefined => {
  if (!isRecord(body)) return "body must be a personal-best report";
  if (typeof body.trackId !== "string" || body.trackId.length === 0) return "trackId must be a non-empty string";
  if (typeof body.matchId !== "string" || body.matchId.length === 0) return "matchId must be a non-empty string";
  if (!Array.isArray(body.runs) || body.runs.length > 64) return "runs must be a list of finished runs";
  for (const run of body.runs) {
    if (!isRecord(run) || typeof run.accountId !== "string" || run.accountId.length === 0) {
      return "each run needs an accountId";
    }
    if (!Number.isInteger(run.raceTimeMs) || (run.raceTimeMs as number) < 0) {
      return "raceTimeMs must be a non-negative integer";
    }
  }
  return undefined;
};

/**
 * Records one Race Round's finished runs (ADR 0088) — the match server's
 * report behind `POST /internal/personal-bests`. Each run is offered as its
 * Account's Personal Best on the Track; only a faster one lands.
 */
export const recordPersonalBests = (db: ApiDb, body: unknown, nowMs: number = Date.now()): { recorded: number } => {
  const reason = invalidReportReason(body);
  if (reason) throw new ServiceError(400, reason);
  const report = body as PersonalBestReport;
  for (const run of report.runs) {
    offerPersonalBest(db, { ...run, trackId: report.trackId, matchId: report.matchId, atMs: nowMs });
  }
  return { recorded: report.runs.length };
};

/** The caller's own Personal Best on one Track — `GET /tracks/:id/personal-best`. */
export const readPersonalBest = (db: ApiDb, accountId: string, trackId: string): PersonalBest => ({
  bestMs: getPersonalBestMs(db, accountId, trackId),
});

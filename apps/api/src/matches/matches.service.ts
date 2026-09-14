import type { PersistedMatchResult, RoundResult } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { getMatchResult as readMatchResult, saveMatchResult as storeMatchResult } from "./matches.dao.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalidRoundResultReason = (result: unknown): string | undefined => {
  if (!isRecord(result) || !Array.isArray(result.rows) || result.rows.length === 0) {
    return "each result needs a non-empty rows list";
  }
  for (const row of result.rows) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id.length === 0) {
      return "each row needs a player id";
    }
    if (!Number.isInteger(row.placement) || (row.placement as number) < 1) {
      return "placement must be a positive integer";
    }
    if (typeof row.qualified !== "boolean") return "qualified must be a boolean";
  }
  return undefined;
};

const invalidMatchResultReason = (body: unknown): string | undefined => {
  if (!isRecord(body)) return "body must be a match result object";
  if (typeof body.matchId !== "string" || body.matchId.length === 0) return "matchId must be a non-empty string";
  if (!Array.isArray(body.results) || body.results.length === 0 || body.results.length > 64) {
    return "results must be a non-empty list of played Rounds";
  }
  for (const result of body.results) {
    const reason = invalidRoundResultReason(result);
    if (reason) return reason;
  }
  if (!isRecord(body.nicknames)) return "nicknames must be an object";
  // M9 ticket 11 phase 2b: pre-2b saves carry no such map at all (readers
  // default it) — but a present non-object is malformed, not legacy.
  if (body.accountIds !== undefined && !isRecord(body.accountIds)) return "accountIds must be an object";
  if (!isRecord(body.totalFalls)) return "totalFalls must be an object";
  if (typeof body.endedAtMs !== "number" || !Number.isFinite(body.endedAtMs)) {
    return "endedAtMs must be a number";
  }
  return undefined;
};

/**
 * Stores one finished Match's results (ADR 0059) — the match server's save
 * behind `POST /internal/match-results`. First write wins (a retried save is
 * a no-op, never an overwrite); what comes back is just the id, the results
 * page reads the row itself.
 */
export const saveMatchResult = (db: ApiDb, body: unknown): { matchId: string } => {
  const reason = invalidMatchResultReason(body);
  if (reason) throw new ServiceError(400, reason);
  const result = body as PersistedMatchResult;
  storeMatchResult(db, { ...result, accountIds: result.accountIds ?? {} });
  return { matchId: result.matchId };
};

/**
 * Reads one finished Match's results back — the results page's fetch behind
 * `GET /matches/:id`. 404 when nothing was ever saved under this id (a page
 * opened before the save landed, or a mistyped id).
 */
export const getMatchResult = (db: ApiDb, matchId: string): PersistedMatchResult & { results: RoundResult[] } => {
  const result = readMatchResult(db, matchId);
  if (!result) throw new ServiceError(404, `no finished Match "${matchId}"`);
  // Pre-2b rows carry no `accountIds` map — default it so the type stays honest.
  return { ...result, accountIds: result.accountIds ?? {} };
};

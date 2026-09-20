import { matchPlacements, type EmoteId, type MatchResultResponse, type PersistedMatchResult } from "@dont-fall/shared";
import { getAccountsByIds } from "../auth/accounts.dao.js";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import {
  getMatchResult as readMatchResult,
  insertMatchParticipants,
  saveMatchResult as storeMatchResult,
} from "./matches.dao.js";

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
  // Same posture for the podium colors: pre-colors saves carry no map
  // (readers default it) — but a present non-object is malformed, not legacy.
  if (body.colors !== undefined && !isRecord(body.colors)) return "colors must be an object";
  // And the podium skins (ADR 0091), the same way.
  if (body.skins !== undefined && !isRecord(body.skins)) return "skins must be an object";
  // And the podium hats (ADR 0083), the same way.
  if (body.hats !== undefined && !isRecord(body.hats)) return "hats must be an object";
  // And the same for the per-Round Track ids: pre-index saves carry no list
  // (readers default it) — but a present non-list, or a non-string id, is
  // malformed, not legacy.
  if (
    body.roundTrackIds !== undefined &&
    (!Array.isArray(body.roundTrackIds) || body.roundTrackIds.some((id) => typeof id !== "string"))
  ) {
    return "roundTrackIds must be a list of Track ids";
  }
  if (!isRecord(body.totalFalls)) return "totalFalls must be an object";
  // ADR 0110: the career's BEST SURVIVAL and GRABS BROKEN. Older saves carry
  // neither map (readers default them) — but a present non-object is malformed.
  if (body.survivalMs !== undefined && !isRecord(body.survivalMs)) return "survivalMs must be an object";
  if (body.grabsBroken !== undefined && !isRecord(body.grabsBroken)) return "grabsBroken must be an object";
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
 *
 * The same save indexes every authed racer's final standing for the career
 * reads — placements off `matchPlacements`, the exact numbers the results
 * page showed. Anonymous seats leave no row. The index insert is conflict-
 * silent, so a retried save stays a no-op here exactly as on the row itself.
 */
export const saveMatchResult = (db: ApiDb, body: unknown): { matchId: string } => {
  const reason = invalidMatchResultReason(body);
  if (reason) throw new ServiceError(400, reason);
  const result = body as PersistedMatchResult;
  const stored: PersistedMatchResult = {
    ...result,
    roundTrackIds: result.roundTrackIds ?? [],
    accountIds: result.accountIds ?? {},
    colors: result.colors ?? {},
    skins: result.skins ?? {},
    hats: result.hats ?? {},
    survivalMs: result.survivalMs ?? {},
    grabsBroken: result.grabsBroken ?? {},
  };
  storeMatchResult(db, stored);
  insertMatchParticipants(
    db,
    matchPlacements(stored.results)
      .filter((row) => stored.accountIds[row.id] !== undefined)
      .map((row) => ({
        matchId: stored.matchId,
        accountId: stored.accountIds[row.id]!,
        placement: row.placement,
        score: row.score,
        falls: stored.totalFalls[row.id] ?? 0,
        bestSurvivalMs: stored.survivalMs[row.id] ?? null,
        grabsBroken: stored.grabsBroken[row.id] ?? 0,
        endedAtMs: stored.endedAtMs,
      })),
  );
  return { matchId: result.matchId };
};

/**
 * Reads one finished Match's results back — the results page's fetch behind
 * `GET /matches/:id`. 404 when nothing was ever saved under this id (a page
 * opened before the save landed, or a mistyped id).
 */
export const getMatchResult = (
  db: ApiDb,
  matchId: string,
): MatchResultResponse => {
  const result = readMatchResult(db, matchId);
  if (!result) throw new ServiceError(404, `no finished Match "${matchId}"`);
  // Pre-2b rows carry no `accountIds` map — default it so the type stays honest.
  // Pre-colors rows likewise carry no `colors`, pre-skins rows no `skins`,
  // pre-hats rows no `hats`, pre-index rows no `roundTrackIds`.
  return {
    ...result,
    roundTrackIds: result.roundTrackIds ?? [],
    accountIds: result.accountIds ?? {},
    colors: result.colors ?? {},
    skins: result.skins ?? {},
    hats: result.hats ?? {},
    survivalMs: result.survivalMs ?? {},
    grabsBroken: result.grabsBroken ?? {},
    victoryPoses: victoryPosesOf(db, result.accountIds ?? {}),
  };
};

/**
 * Each authed seat's victory pose (ADR 0110) — read from its Account now, not
 * stored with the Match: it is a signature, what the podium plays for whoever
 * won, and a Player who changes it changes it everywhere.
 */
const victoryPosesOf = (db: ApiDb, accountIds: Record<string, string>): Record<string, EmoteId> => {
  const accounts = getAccountsByIds(db, [...new Set(Object.values(accountIds))]);
  return Object.fromEntries(
    Object.entries(accountIds).flatMap(([seat, accountId]) => {
      const account = accounts.get(accountId);
      return account ? [[seat, account.victoryPose] as const] : [];
    }),
  );
};

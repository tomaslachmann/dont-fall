import {
  DEFAULT_ROUND_TYPE,
  invalidEnvironmentReason,
  isEnvironmentId,
  ROUND_TYPES,
  type EnvironmentId,
  type RoundType,
  type Track,
  type TrackDraft,
  type TrackDraftListing,
} from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import {
  deleteDraft,
  getDraftById,
  listDrafts,
  patchDraftMeta,
  replaceDraftSegments,
  saveDraft,
} from "./drafts.dao.js";
import { fetchTrack, PUBLISH_MODULES } from "./tracks.service.js";
import {
  invalidSurvivorTargetReason,
  invalidTimeLimitReason,
  invalidTrackAttachmentReason,
  isTrack,
  unknownModuleIds,
} from "./tracks.validation.js";

/**
 * Shape validation for draft Segments — everything except course-completeness
 * (a draft is allowed to be half-built; `validate` judges the course).
 * Unknown module ids fail fast here: an LLM typo must not sit in a draft
 * until publish to be noticed.
 */
const assertDraftTrack = (track: unknown): Track => {
  if (!isTrack(track)) throw new ServiceError(400, "track must be an array of Segments");
  const badAttachment = invalidTrackAttachmentReason(track);
  if (badAttachment) throw new ServiceError(400, badAttachment);
  const unknown = unknownModuleIds(track, PUBLISH_MODULES);
  if (unknown.length > 0) throw new ServiceError(400, `unknown Module id(s): ${unknown.join(", ")}`);
  return track;
};

const assertRoundType = (value: unknown): RoundType => {
  if (value === undefined) return DEFAULT_ROUND_TYPE;
  if (typeof value === "string" && (ROUND_TYPES as readonly string[]).includes(value)) return value as RoundType;
  throw new ServiceError(400, `roundType must be one of ${ROUND_TYPES.join(", ")}, got ${JSON.stringify(value)}`);
};

export interface CreateDraftInput {
  id?: unknown;
  name?: unknown;
  roundType?: unknown;
  track?: unknown;
  from?: unknown;
  timeLimitMs?: unknown;
  survivorTarget?: unknown;
  environment?: unknown;
}

/**
 * Creates a draft (ADR 0114) — from explicit Segments, from an existing
 * Revision (`from: {trackId, revision?}`, copying its Segments and clock),
 * or empty (a bare `{roundType}`). Absent metadata means the publish
 * defaults, like `publishTrack` — publishing a draft copies the row's fields
 * into a Revision without re-reading anyone's mind.
 */
export const createDraft = (db: ApiDb, input: CreateDraftInput): { id: string; created: boolean } => {
  let track: Track = [];
  let timeLimitMs = input.timeLimitMs;
  let survivorTarget = input.survivorTarget;
  let environment = input.environment;
  if (input.from !== undefined) {
    const from = input.from as { trackId?: unknown; revision?: unknown };
    if (typeof from?.trackId !== "string" || from.trackId.length === 0) {
      throw new ServiceError(400, "from.trackId must be a non-empty string");
    }
    const revision = from.revision === undefined ? undefined : String(from.revision);
    const source = fetchTrack(db, from.trackId, revision);
    track = source.track;
    timeLimitMs ??= source.timeLimitMs;
    survivorTarget ??= source.survivorTarget;
    environment ??= source.environment;
  }
  if (input.track !== undefined) track = assertDraftTrack(input.track);
  else if (input.from !== undefined) assertDraftTrack(track);

  const badTimeLimit = invalidTimeLimitReason(timeLimitMs);
  if (badTimeLimit) throw new ServiceError(400, badTimeLimit);
  const badSurvivorTarget = invalidSurvivorTargetReason(survivorTarget);
  if (badSurvivorTarget) throw new ServiceError(400, badSurvivorTarget);
  const badEnvironment = environment === undefined ? undefined : invalidEnvironmentReason(environment);
  if (badEnvironment) throw new ServiceError(400, badEnvironment);
  if (input.name !== undefined && typeof input.name !== "string") {
    throw new ServiceError(400, `name must be a string, got ${JSON.stringify(input.name)}`);
  }

  return saveDraft(db, {
    ...(typeof input.id === "string" ? { id: input.id } : {}),
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    roundType: assertRoundType(input.roundType),
    track,
    ...(typeof timeLimitMs === "number" ? { timeLimitMs } : {}),
    ...(typeof survivorTarget === "number" ? { survivorTarget } : {}),
    ...(isEnvironmentId(environment) ? { environment } : {}),
  });
};

/** One draft with its Segments — 404 naming the miss, like `fetchTrack`. */
export const fetchDraft = (db: ApiDb, id: string): TrackDraft => {
  const draft = getDraftById(db, id);
  if (!draft) throw new ServiceError(404, `no draft with id "${id}"`);
  return draft;
};

/** Every draft without Segments, most recently touched first. */
export const listAllDrafts = (db: ApiDb): TrackDraftListing[] => listDrafts(db);

/** Replaces a draft's Segments whole — shape-validated, course unchecked. Returns the touched draft. */
export const replaceDraftTrack = (db: ApiDb, id: string, track: unknown): TrackDraft => {
  const valid = assertDraftTrack(track);
  if (!replaceDraftSegments(db, id, valid)) throw new ServiceError(404, `no draft with id "${id}"`);
  return fetchDraft(db, id);
};

export interface PatchDraftMetaInput {
  name?: unknown;
  roundType?: unknown;
  timeLimitMs?: unknown;
  survivorTarget?: unknown;
  environment?: unknown;
}

/** Patches a draft's publish metadata — absent fields keep their values. Returns the touched draft. */
export const patchDraft = (db: ApiDb, id: string, patch: PatchDraftMetaInput): TrackDraft => {
  if (patch.name !== undefined && patch.name !== null && typeof patch.name !== "string") {
    throw new ServiceError(400, `name must be a string or null, got ${JSON.stringify(patch.name)}`);
  }
  const badTimeLimit = patch.timeLimitMs === undefined ? undefined : invalidTimeLimitReason(patch.timeLimitMs);
  if (badTimeLimit) throw new ServiceError(400, badTimeLimit);
  const badSurvivorTarget = patch.survivorTarget === undefined ? undefined : invalidSurvivorTargetReason(patch.survivorTarget);
  if (badSurvivorTarget) throw new ServiceError(400, badSurvivorTarget);
  const badEnvironment = patch.environment === undefined ? undefined : invalidEnvironmentReason(patch.environment);
  if (badEnvironment) throw new ServiceError(400, badEnvironment);
  const roundType = patch.roundType === undefined ? undefined : assertRoundType(patch.roundType);

  const ok = patchDraftMeta(db, id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(roundType === undefined ? {} : { roundType }),
    ...(typeof patch.timeLimitMs === "number" ? { timeLimitMs: patch.timeLimitMs } : {}),
    ...(typeof patch.survivorTarget === "number" ? { survivorTarget: patch.survivorTarget } : {}),
    ...(isEnvironmentId(patch.environment) ? { environment: patch.environment as EnvironmentId } : {}),
  });
  if (!ok) throw new ServiceError(404, `no draft with id "${id}"`);
  return fetchDraft(db, id);
};

/** Discards a draft — 404 when there was nothing with that id, so typos stay loud. */
export const discardDraft = (db: ApiDb, id: string): { id: string } => {
  if (!deleteDraft(db, id)) throw new ServiceError(404, `no draft with id "${id}"`);
  return { id };
};

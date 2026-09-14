import {
  ASSET_PLACEMENT_MODULES,
  MODULE_LIBRARY,
  type Module,
  type StoredTrack,
  type Track,
  type TrackListing,
} from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { generateRandomTrack } from "./generate.js";
import { getAnyTrack, getTrackById, getTrackPlays, listTracks, recordTrackPlay, saveTrack } from "./tracks.dao.js";
import { invalidSurvivorTargetReason, invalidTimeLimitReason, isTrack, unknownModuleIds } from "./tracks.validation.js";

/**
 * Every Module id a publish may reference (M8 ticket 05): the procedural
 * registry composed with the asset defs' placement halves. Publish
 * validation is id-membership only — file geometry is validated at load
 * (match server boot, client track load), never here, so placement halves
 * are the complete input.
 */
export const PUBLISH_MODULES: Record<string, Module> = { ...MODULE_LIBRARY, ...ASSET_PLACEMENT_MODULES };

export interface PublishInput {
  id?: unknown;
  name?: unknown;
  track?: unknown;
  timeLimitMs?: unknown;
  survivorTarget?: unknown;
}

/**
 * Publishes a Track (ADR 0028/0032) — validates everything the immutable
 * Revision demands, then stores. Throws {@link ServiceError} (400) naming
 * the first thing unacceptable, so the controller stays a status-code
 * mapping with no domain opinions of its own.
 */
export const publishTrack = (db: ApiDb, input: PublishInput): { id: string } => {
  if (!isTrack(input.track)) {
    throw new ServiceError(
      400,
      "body.track must be a Segment[]: each entry needs a string moduleId, a position with finite x/y/z, " +
        "a finite rotation, and finite pitch/roll if present",
    );
  }
  const unknown = unknownModuleIds(input.track, PUBLISH_MODULES);
  if (unknown.length > 0) throw new ServiceError(400, `unknown Module id(s): ${unknown.join(", ")}`);
  const badTimeLimit = invalidTimeLimitReason(input.timeLimitMs);
  if (badTimeLimit) throw new ServiceError(400, badTimeLimit);
  const badSurvivorTarget = invalidSurvivorTargetReason(input.survivorTarget);
  if (badSurvivorTarget) throw new ServiceError(400, badSurvivorTarget);
  return saveTrack(db, {
    track: input.track,
    ...(typeof input.id === "string" ? { id: input.id } : {}),
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    // Absent is valid and means "the default" (ADR 0038/0041) — already
    // validated above, so anything still here is a real integer.
    ...(typeof input.timeLimitMs === "number" ? { timeLimitMs: input.timeLimitMs } : {}),
    ...(typeof input.survivorTarget === "number" ? { survivorTarget: input.survivorTarget } : {}),
  });
};

/**
 * Fetches one Revision by id — latest, or the exact `revision` the raw query
 * value names (ticket 11: a live Match's client fetches what its
 * `WelcomeMessage` named, not whatever happens to be latest). Throws 400 for
 * a malformed revision, 404 naming the miss — the same messages the old
 * route answered.
 */
export const fetchTrack = (db: ApiDb, id: string, revisionParam: string | string[] | undefined): StoredTrack => {
  const first = Array.isArray(revisionParam) ? revisionParam[0] : revisionParam;
  let revision: number | undefined;
  if (first !== undefined) {
    revision = Number(first);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new ServiceError(400, `revision must be a positive integer, got "${first}"`);
    }
  }
  const stored = getTrackById(db, id, revision);
  if (!stored) {
    throw new ServiceError(
      404,
      revision === undefined ? `no Track with id "${id}"` : `no Track with id "${id}" at revision ${revision}`,
    );
  }
  return stored;
};

export const fetchAnyTrack = (db: ApiDb): StoredTrack => {
  const stored = getAnyTrack(db);
  if (!stored) throw new ServiceError(404, "no Tracks stored");
  return stored;
};

export const listAllTracks = (db: ApiDb): TrackListing[] => listTracks(db, PUBLISH_MODULES);

/**
 * Counts one play on `id` (M9 ticket 16) — the match server's Round-start
 * report landing. 404s naming the miss for a `trackId` with no stored
 * Revision, the same message `fetchTrack` answers.
 */
export const recordPlay = (db: ApiDb, id: string): { id: string; plays: number } => {
  if (!recordTrackPlay(db, id)) throw new ServiceError(404, `no Track with id "${id}"`);
  return { id, plays: getTrackPlays(db, id) };
};

/**
 * Generates a random Track and persists it exactly like a hand-built one
 * (ADR 0028) — no separate runtime path, no flag distinguishing it. A
 * non-positive/non-numeric `count` means "the default", mirroring the old
 * route; a library that cannot produce one is a 500 with the generator's
 * own reason.
 */
export const generateTrack = (db: ApiDb, input: { name?: unknown; count?: unknown }): { id: string; track: Track } => {
  const count = typeof input.count === "number" && input.count > 0 ? Math.floor(input.count) : undefined;
  let track: Track;
  try {
    track = generateRandomTrack(MODULE_LIBRARY, count);
  } catch (err) {
    throw new ServiceError(500, (err as Error).message);
  }
  const saved = saveTrack(db, { track, ...(typeof input.name === "string" ? { name: input.name } : {}) });
  return { ...saved, track };
};

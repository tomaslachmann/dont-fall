import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  type EnvironmentId,
  type RoundType,
  type Track,
  type TrackDraft,
  type TrackDraftListing,
} from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { trackDrafts } from "../db/schema.js";

export type { TrackDraft, TrackDraftListing };

const toDraft = (row: typeof trackDrafts.$inferSelect): TrackDraft => ({
  id: row.id,
  name: row.name,
  roundType: row.roundType as RoundType,
  track: JSON.parse(row.data) as Track,
  timeLimitMs: row.timeLimitMs,
  survivorTarget: row.survivorTarget,
  environment: row.environment as EnvironmentId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Creates a draft (ADR 0114) — segments plus the publish metadata a future
 * Revision will carry. The opposite discipline to `saveTrack`: the row is
 * mutated freely until it is published or discarded, and nothing here judges
 * whether the course is complete (validation owns that, at `validate` time).
 * An explicit id that already exists resets that draft (upsert — `created`
 * tells which happened). Already-validated input only — the service
 * validated everything.
 */
export const saveDraft = (
  db: ApiDb,
  input: {
    id?: string;
    name?: string;
    roundType: RoundType;
    track: Track;
    timeLimitMs?: number;
    survivorTarget?: number;
    environment?: EnvironmentId;
  },
): { id: string; created: boolean } => {
  const id = input.id && input.id.length > 0 ? input.id : randomUUID();
  const created = getDraftById(db, id) === undefined;
  const now = Date.now();
  db.insert(trackDrafts)
    .values({
      id,
      name: input.name ?? null,
      roundType: input.roundType,
      data: JSON.stringify(input.track),
      timeLimitMs: input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
      survivorTarget: input.survivorTarget ?? DEFAULT_SURVIVOR_TARGET,
      environment: input.environment ?? DEFAULT_ENVIRONMENT_ID,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: trackDrafts.id,
      set: {
        name: input.name ?? null,
        roundType: input.roundType,
        data: JSON.stringify(input.track),
        timeLimitMs: input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
        survivorTarget: input.survivorTarget ?? DEFAULT_SURVIVOR_TARGET,
        environment: input.environment ?? DEFAULT_ENVIRONMENT_ID,
        updatedAt: now,
      },
    })
    .run();
  return { id, created };
};

/** One draft with its Segments, or `undefined` — the service owns the 404. */
export const getDraftById = (db: ApiDb, id: string): TrackDraft | undefined => {
  const row = db.select().from(trackDrafts).where(eq(trackDrafts.id, id)).get();
  return row === undefined ? undefined : toDraft(row);
};

/** Every draft without Segments, most recently touched first — resuming work never downloads unfinished Tracks. */
export const listDrafts = (db: ApiDb): TrackDraftListing[] =>
  db
    .select({
      id: trackDrafts.id,
      name: trackDrafts.name,
      roundType: trackDrafts.roundType,
      data: trackDrafts.data,
      updatedAt: trackDrafts.updatedAt,
    })
    .from(trackDrafts)
    .orderBy(desc(trackDrafts.updatedAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      roundType: row.roundType as RoundType,
      segmentCount: (JSON.parse(row.data) as Track).length,
      updatedAt: row.updatedAt,
    }));

/** Replaces a draft's Segments whole — the MCP server's bulk edits land here. `false` when the draft is gone. */
export const replaceDraftSegments = (db: ApiDb, id: string, track: Track): boolean => {
  const touched = db
    .update(trackDrafts)
    .set({ data: JSON.stringify(track), updatedAt: Date.now() })
    .where(eq(trackDrafts.id, id))
    .run().changes;
  return touched > 0;
};

/** Patches a draft's publish metadata — absent fields keep their values. `false` when the draft is gone. */
export const patchDraftMeta = (
  db: ApiDb,
  id: string,
  patch: { name?: string | null; roundType?: RoundType; timeLimitMs?: number; survivorTarget?: number; environment?: EnvironmentId },
): boolean => {
  const touched = db
    .update(trackDrafts)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(trackDrafts.id, id))
    .run().changes;
  return touched > 0;
};

/** Discards a draft. `false` when there was nothing with that id. */
export const deleteDraft = (db: ApiDb, id: string): boolean => {
  const touched = db.delete(trackDrafts).where(eq(trackDrafts.id, id)).run().changes;
  return touched > 0;
};

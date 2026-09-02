import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Track } from "@dont-fall/shared";
import type { TrackDb } from "./db.js";
import { tracks } from "./schema.js";

/**
 * Single hardcoded author for every published Revision (ADR 0032) —
 * deliberately and visibly mocked, not a placeholder that looks real. When a
 * real Account system lands, this becomes a foreign key; nothing about the
 * Revision shape needs to change, only what populates the field.
 */
export const DEFAULT_AUTHOR_ID = "local-author";

export interface StoredTrack {
  id: string;
  name: string | null;
  track: Track;
  revision: number;
  authorId: string;
  contentHash: string;
}

export interface TrackListing {
  id: string;
  name: string | null;
  authorId: string;
  createdAt: number;
}

const toStored = (row: typeof tracks.$inferSelect): StoredTrack => ({
  id: row.trackId,
  name: row.name,
  track: JSON.parse(row.data) as Track,
  revision: row.revision,
  authorId: row.authorId,
  contentHash: row.contentHash,
});

/** Canonical content hash — same Track content always hashes the same, independent of `trackId`/`revision`/`name`. */
const hashTrack = (track: Track): string => createHash("sha256").update(JSON.stringify(track)).digest("hex");

/**
 * Publishes a Track — a hand-built one from the builder (ticket 04) or a
 * randomly assembled one (ticket 06) are both just rows here (ADR 0028),
 * indistinguishable at this layer. Never mutates an existing Revision
 * (ADR 0032): publishing the same `trackId` again inserts Revision N+1.
 */
export const saveTrack = (db: TrackDb, input: { id?: string; name?: string; track: Track }): { id: string } => {
  const trackId = input.id ?? randomUUID();
  const latest = db
    .select({ revision: tracks.revision })
    .from(tracks)
    .where(eq(tracks.trackId, trackId))
    .orderBy(desc(tracks.revision))
    .limit(1)
    .get();
  const revision = (latest?.revision ?? 0) + 1;

  db.insert(tracks)
    .values({
      trackId,
      revision,
      name: input.name ?? null,
      authorId: DEFAULT_AUTHOR_ID,
      contentHash: hashTrack(input.track),
      data: JSON.stringify(input.track),
      createdAt: Date.now(),
    })
    .run();
  return { id: trackId };
};

/** Fetches the latest published Revision of `id` (a `trackId`), if any exist. */
export const getTrackById = (db: TrackDb, id: string): StoredTrack | undefined => {
  const row = db
    .select()
    .from(tracks)
    .where(eq(tracks.trackId, id))
    .orderBy(desc(tracks.revision))
    .limit(1)
    .get();
  return row ? toStored(row) : undefined;
};

/** Fetches the latest Revision of an arbitrary stored `trackId` (Match server's "give me any" — ADR 0028). */
export const getAnyTrack = (db: TrackDb): StoredTrack | undefined => {
  const ids = db.selectDistinct({ trackId: tracks.trackId }).from(tracks).all();
  if (ids.length === 0) return undefined;
  const picked = ids[Math.floor(Math.random() * ids.length)]!.trackId;
  return getTrackById(db, picked);
};

/**
 * Lists every distinct stored `trackId`'s latest Revision (id/name/authorId/
 * createdAt only, not the full Segment data — ticket 09: fetch-by-known-id-
 * only isn't a real "share" mechanism once there are multiple user-created
 * Tracks, so the builder needs something to Browse).
 */
export const listTracks = (db: TrackDb): TrackListing[] => {
  const rows = db
    .select({ trackId: tracks.trackId, name: tracks.name, authorId: tracks.authorId, createdAt: tracks.createdAt })
    .from(tracks)
    .orderBy(desc(tracks.createdAt))
    .all();
  const seen = new Set<string>();
  const latestPerTrack: TrackListing[] = [];
  for (const row of rows) {
    if (seen.has(row.trackId)) continue;
    seen.add(row.trackId);
    latestPerTrack.push({ id: row.trackId, name: row.name, authorId: row.authorId, createdAt: row.createdAt });
  }
  return latestPerTrack;
};

/** Seeds `track` under `id` only if no Track has ever been published (idempotent startup seeding). */
export const seedIfEmpty = (db: TrackDb, id: string, name: string, track: Track): void => {
  const existing = db.select({ trackId: tracks.trackId }).from(tracks).limit(1).get();
  if (existing) return;
  saveTrack(db, { id, name, track });
};

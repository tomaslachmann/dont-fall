import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { DEFAULT_SURVIVOR_TARGET, DEFAULT_TIME_LIMIT_MS, type StoredTrack, type Track, type TrackListing } from "@dont-fall/shared";
import type { TrackDb } from "./db.js";
import { tracks } from "./schema.js";

export type { StoredTrack, TrackListing };

/**
 * Single hardcoded author for every published Revision (ADR 0032) —
 * deliberately and visibly mocked, not a placeholder that looks real. When a
 * real Account system lands, this becomes a foreign key; nothing about the
 * Revision shape needs to change, only what populates the field.
 */
export const DEFAULT_AUTHOR_ID = "local-author";

const toStored = (row: typeof tracks.$inferSelect): StoredTrack => ({
  id: row.trackId,
  name: row.name,
  track: JSON.parse(row.data) as Track,
  revision: row.revision,
  authorId: row.authorId,
  contentHash: row.contentHash,
  timeLimitMs: row.timeLimitMs,
  survivorTarget: row.survivorTarget,
});

/**
 * Deterministic JSON serialization — object keys sorted recursively, array
 * element order preserved (a Track's Segment order is semantically
 * significant; only key order inside each Segment object is incidental).
 * Code review (ticket 10): plain `JSON.stringify` is key-order-sensitive, so
 * two requests encoding the identical Track with differently-ordered object
 * keys used to hash differently — breaking the "same content always hashes
 * the same" guarantee this exists for.
 */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/** Canonical content hash — same Track content always hashes the same, independent of `trackId`/`revision`/`name`. */
const hashTrack = (track: Track): string => createHash("sha256").update(canonicalJson(track)).digest("hex");

/**
 * Publishes a Track — a hand-built one from the builder (ticket 04) or a
 * randomly assembled one (ticket 06) are both just rows here (ADR 0028),
 * indistinguishable at this layer. Never mutates an existing Revision
 * (ADR 0032): publishing the same `trackId` again inserts Revision N+1.
 */
export const saveTrack = (
  db: TrackDb,
  input: { id?: string; name?: string; track: Track; timeLimitMs?: number; survivorTarget?: number },
): { id: string } => {
  // An empty string is treated the same as absent (code review, ticket 10) —
  // otherwise it becomes a real, permanently unfetchable trackId (the
  // `GET /tracks/:id` route requires at least one non-slash character).
  const trackId = input.id && input.id.length > 0 ? input.id : randomUUID();
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
      // Deliberately not part of the content hash (ADR 0038): the hash answers
      // "are these the same Segments?", and two Revisions differing only in
      // their clock are the same Track content by any useful definition.
      contentHash: hashTrack(input.track),
      data: JSON.stringify(input.track),
      createdAt: Date.now(),
      timeLimitMs: input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
      // Out of the content hash for the same reason the clock is (ADR 0038):
      // two Revisions differing only in this are the same Segments.
      survivorTarget: input.survivorTarget ?? DEFAULT_SURVIVOR_TARGET,
    })
    .run();
  return { id: trackId };
};

/**
 * Fetches a Revision of `id` (a `trackId`) — the latest published one, or (ticket
 * 11) an exact `revision` when the caller needs to pin against one that could
 * otherwise race a newer publish (a live Match's client fetching what its
 * `WelcomeMessage` named, not whatever happens to be latest by the time it asks).
 */
export const getTrackById = (db: TrackDb, id: string, revision?: number): StoredTrack | undefined => {
  const row =
    revision === undefined
      ? db.select().from(tracks).where(eq(tracks.trackId, id)).orderBy(desc(tracks.revision)).limit(1).get()
      : db
          .select()
          .from(tracks)
          .where(and(eq(tracks.trackId, id), eq(tracks.revision, revision)))
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
  // Code review (ticket 10): the previous version sorted by `createdAt` and
  // deduped in JS, which (a) ties can misorder on millisecond collisions —
  // "latest" must mean highest `revision`, not latest `createdAt` — and
  // (b) pulled every Revision of every Track out of SQLite just to throw
  // most of them away. This correlated subquery does the "latest per
  // trackId" selection in SQL directly.
  // No real pagination yet (code review, ticket 09/10) — premature for an
  // internal tool at today's scale (this project's own established
  // pattern: don't build for speculative scale). `LIMIT` is just a cheap
  // safety net against an unbounded payload/scan, not a paging UI.
  const rows = db.all<{ trackId: string; name: string | null; authorId: string; createdAt: number }>(sql`
    SELECT track_id as trackId, name, author_id as authorId, created_at as createdAt
    FROM tracks t1
    WHERE revision = (SELECT MAX(revision) FROM tracks t2 WHERE t2.track_id = t1.track_id)
    ORDER BY created_at DESC
    LIMIT 500
  `);
  return rows.map((row) => ({ id: row.trackId, name: row.name, authorId: row.authorId, createdAt: row.createdAt }));
};

/** Seeds `track` under `id` only if no Track has ever been published (idempotent startup seeding). */
export const seedIfEmpty = (db: TrackDb, id: string, name: string, track: Track): void => {
  const existing = db.select({ trackId: tracks.trackId }).from(tracks).limit(1).get();
  if (existing) return;
  saveTrack(db, { id, name, track });
};

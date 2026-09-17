import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  resolveEnvironmentId,
  trackHasFinishZone,
  type EnvironmentId,
  type Module,
  type StoredTrack,
  type Track,
  type TrackListing,
} from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { trackPlays, tracks } from "../db/schema.js";

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
  // Validated on publish, so this only ever falls back for a row this build
  // could not have written (a newer API's preset, after a rollback).
  environment: resolveEnvironmentId(row.environment).id,
  // The bytes stay behind `GET /tracks/:id/thumbnail` (ADR 0085) — this
  // shape only ever says whether they exist.
  hasThumbnail: row.thumbnail !== null,
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
  db: ApiDb,
  input: {
    id?: string;
    name?: string;
    track: Track;
    timeLimitMs?: number;
    survivorTarget?: number;
    environment?: EnvironmentId;
    /** The Revision's Thumbnail data URL (ADR 0085) — already validated, or absent for none. */
    thumbnail?: string;
  },
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
      // Out of the content hash too (ADR 0074): the same Segments under
      // another sky are the same Track content.
      environment: input.environment ?? DEFAULT_ENVIRONMENT_ID,
      // Out of the content hash for the same reason (ADR 0085): a
      // re-framed screenshot is not new Segments.
      thumbnail: input.thumbnail ?? null,
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
export const getTrackById = (db: ApiDb, id: string, revision?: number): StoredTrack | undefined => {
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

/**
 * One Revision's Thumbnail data URL (ADR 0085) — the latest, or the exact
 * `revision` when pinned. Reads only the `thumbnail` column, never the
 * Segment JSON: a thumbnail fetch must not pay for a Track parse. Three
 * outcomes, and the caller needs all three told apart: `undefined` (no such
 * Revision at all), `null` (a Revision published without one), or the data
 * URL itself.
 */
export const getTrackThumbnail = (
  db: ApiDb,
  id: string,
  revision?: number,
): string | null | undefined => {
  const row =
    revision === undefined
      ? db
          .select({ thumbnail: tracks.thumbnail })
          .from(tracks)
          .where(eq(tracks.trackId, id))
          .orderBy(desc(tracks.revision))
          .limit(1)
          .get()
      : db
          .select({ thumbnail: tracks.thumbnail })
          .from(tracks)
          .where(and(eq(tracks.trackId, id), eq(tracks.revision, revision)))
          .get();
  return row === undefined ? undefined : row.thumbnail;
};

/**
 * Latest-Revision display names for a batch of Track ids (the career
 * history's row names) — one query, whatever Revisions exist. Absent key, no
 * such Track; a present-but-null name, an unnamed Revision. Either way the
 * caller falls back to `UNTITLED_TRACK_NAME`, never to the id.
 */
export const getTrackNamesByIds = (db: ApiDb, ids: readonly string[]): Map<string, string | null> => {
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  const rows = db
    .select({ trackId: tracks.trackId, name: tracks.name, revision: tracks.revision })
    .from(tracks)
    .where(inArray(tracks.trackId, [...ids]))
    .all();
  const best = new Map<string, { name: string | null; revision: number }>();
  for (const row of rows) {
    if ((best.get(row.trackId)?.revision ?? -1) < row.revision) {
      best.set(row.trackId, { name: row.name, revision: row.revision });
    }
  }
  for (const [id, row] of best) names.set(id, row.name);
  return names;
};

/** Fetches the latest Revision of an arbitrary stored `trackId` (Match server's "give me any" — ADR 0028). */
export const getAnyTrack = (db: ApiDb): StoredTrack | undefined => {
  const ids = db.selectDistinct({ trackId: tracks.trackId }).from(tracks).all();
  if (ids.length === 0) return undefined;
  const picked = ids[Math.floor(Math.random() * ids.length)]!.trackId;
  return getTrackById(db, picked);
};

/**
 * Lists every distinct stored `trackId`'s latest Revision (id/name/authorId/
 * createdAt plus Discover's two filter facts — ticket 09: fetch-by-known-id-
 * only isn't a real "share" mechanism once there are multiple user-created
 * Tracks, so the builder needs something to Browse; M9 ticket 16: Discover
 * needs plays + raceability on the same row).
 *
 * `modules` is the library raceability is read against (the composed
 * publish library in production) — computed on read, not stored, so a
 * listing can never disagree with what the server would refuse today.
 */
export const listTracks = (db: ApiDb, modules: Record<string, Module>): TrackListing[] => {
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
  const rows = db.all<{
    trackId: string;
    name: string | null;
    authorId: string;
    createdAt: number;
    data: string;
    plays: number;
    hasThumbnail: number;
  }>(sql`
    SELECT track_id as trackId, name, author_id as authorId, created_at as createdAt, data,
      COALESCE((SELECT plays FROM track_plays WHERE track_plays.track_id = t1.track_id), 0) as plays,
      thumbnail IS NOT NULL as hasThumbnail
    FROM tracks t1
    WHERE revision = (SELECT MAX(revision) FROM tracks t2 WHERE t2.track_id = t1.track_id)
    ORDER BY created_at DESC
    LIMIT 500
  `);
  return rows.map((row) => ({
    id: row.trackId,
    name: row.name,
    authorId: row.authorId,
    createdAt: row.createdAt,
    hasThumbnail: row.hasThumbnail === 1,
    plays: row.plays,
    // Latest Revision's own Segments, against today's library — a republish
    // can gain or lose the Zone, and the listing follows it. Lenient on
    // unknown Modules (shared's own contract): one unparseable Track must
    // never fail the other 499.
    hasFinishZone: trackHasFinishZone(JSON.parse(row.data) as Track, modules),
  }));
};

/**
 * This Track's current play count (M9 ticket 16) — zero when nothing was
 * ever recorded. A single-row read, so reporting a play never re-scans the
 * whole catalogue for one number.
 */
export const getTrackPlays = (db: ApiDb, trackId: string): number =>
  db.select({ plays: trackPlays.plays }).from(trackPlays).where(eq(trackPlays.trackId, trackId)).get()?.plays ?? 0;

/**
 * Counts one play on `trackId` (M9 ticket 16) — called by the match server
 * on every Countdown entry (a fresh Countdown is a fresh Round, so an
 * aborted Countdown still counts: the Track was loaded and its Round
 * began). Upserts: the first play creates the row, later ones tick it.
 * Returns false (recording nothing) for a `trackId` with no stored
 * Revision — a play on nothing is a caller bug, not a row.
 */
export const recordTrackPlay = (db: ApiDb, trackId: string): boolean => {
  const existing = db.select({ trackId: tracks.trackId }).from(tracks).where(eq(tracks.trackId, trackId)).limit(1).get();
  if (!existing) return false;
  db.insert(trackPlays)
    .values({ trackId, plays: 1 })
    .onConflictDoUpdate({ target: trackPlays.trackId, set: { plays: sql`${trackPlays.plays} + 1` } })
    .run();
  return true;
};

/** A code-owned seed Track (ADR 0073/0078): its id, name, Segments and clock. */
export interface SeedTrack {
  id: string;
  name: string;
  track: Track;
  /** Absent means the default clock, exactly like a publish that omits it. */
  timeLimitMs?: number;
  /**
   * The seed's own Thumbnail as a data URL (ADR 0085) — a screenshot shipped
   * beside the code that owns the Track, so the Round loader has art for it
   * without anyone republishing it from the builder. Absent for a seed with
   * no picture.
   */
  thumbnail?: string;
}

/**
 * Keeps a code-owned seed Track on the code's content (ADR 0073) — missing
 * id → seeded; stored latest differs (its Segments or its clock) → a new
 * Revision with the code's content; already current → untouched. Revisions
 * stay immutable: drift heals forward, never by rewriting. Idempotent: a
 * synced boot writes nothing. (Replaces `seedIfEmpty`'s whole-DB gate and
 * `seedTrackIfMissing`'s write-once row — both left a drifted seed serving
 * code it no longer matches, which is exactly how a deleted Module bricked
 * the old M1 seed.)
 */
export const syncSeedTrack = (db: ApiDb, seed: SeedTrack): void => {
  const timeLimitMs = seed.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const latest = getTrackById(db, seed.id);
  // A seed that gained a picture is drift like any other (ADR 0085): the
  // stored Revision heals forward with it rather than staying art-less.
  // Only presence is compared — Revisions are immutable, so a Revision that
  // already has one has the one the code published with it.
  const thumbnailMissing = seed.thumbnail !== undefined && latest?.hasThumbnail === false;
  if (latest && !thumbnailMissing && latest.contentHash === hashTrack(seed.track) && latest.timeLimitMs === timeLimitMs) {
    return;
  }
  saveTrack(db, {
    id: seed.id,
    name: seed.name,
    track: seed.track,
    timeLimitMs,
    ...(seed.thumbnail === undefined ? {} : { thumbnail: seed.thumbnail }),
  });
};

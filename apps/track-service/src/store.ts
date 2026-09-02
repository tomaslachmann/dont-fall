import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Track } from "@dont-fall/shared";
import type { TrackDb } from "./db.js";
import { tracks } from "./schema.js";

export interface StoredTrack {
  id: string;
  name: string | null;
  track: Track;
}

const toStored = (row: typeof tracks.$inferSelect): StoredTrack => ({
  id: row.id,
  name: row.name,
  track: JSON.parse(row.data) as Track,
});

/** Saves a Track — a hand-built one from the builder (ticket 04) or a randomly
 * assembled one (ticket 06) are both just rows here (ADR 0028); nothing here
 * distinguishes them. */
export const saveTrack = (db: TrackDb, input: { id?: string; name?: string; track: Track }): { id: string } => {
  const id = input.id ?? randomUUID();
  db.insert(tracks)
    .values({ id, name: input.name ?? null, data: JSON.stringify(input.track), createdAt: Date.now() })
    .onConflictDoUpdate({
      target: tracks.id,
      set: { name: input.name ?? null, data: JSON.stringify(input.track) },
    })
    .run();
  return { id };
};

export const getTrackById = (db: TrackDb, id: string): StoredTrack | undefined => {
  const row = db.select().from(tracks).where(eq(tracks.id, id)).get();
  return row ? toStored(row) : undefined;
};

/** Fetches an arbitrary stored Track (Match server's "give me any" — ADR 0028). */
export const getAnyTrack = (db: TrackDb): StoredTrack | undefined => {
  const row = db.select().from(tracks).orderBy(sql`RANDOM()`).limit(1).get();
  return row ? toStored(row) : undefined;
};

/** Seeds `track` under `id` only if the table is currently empty (idempotent startup seeding). */
export const seedIfEmpty = (db: TrackDb, id: string, name: string, track: Track): void => {
  const existing = db.select({ id: tracks.id }).from(tracks).limit(1).get();
  if (existing) return;
  saveTrack(db, { id, name, track });
};

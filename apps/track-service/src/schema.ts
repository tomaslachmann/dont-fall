import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A Track (CONTEXT.md) is small and self-contained — an ordered list of
 * Segment placements, no relational structure — so it's stored as one JSON
 * text column rather than normalized tables (ADR 0029, `docs/research/
 * m3-track-storage.md`). Publishing never mutates a row (ADR 0032): each
 * publish of `trackId` inserts a new `revision`, so `(track_id, revision)` is
 * the primary key, not `track_id` alone. `author_id` is deliberately mocked
 * (`DEFAULT_AUTHOR_ID` in `store.ts`) until a real Account system exists.
 */
export const tracks = sqliteTable(
  "tracks",
  {
    trackId: text("track_id").notNull(),
    revision: integer("revision").notNull(),
    name: text("name"),
    authorId: text("author_id").notNull(),
    contentHash: text("content_hash").notNull(),
    /** JSON-serialized `Segment[]` (`@dont-fall/shared`'s `Track` type). */
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.trackId, table.revision] })],
);

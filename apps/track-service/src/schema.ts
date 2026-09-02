import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * A Track (CONTEXT.md) is small and self-contained — an ordered list of
 * Segment placements, no relational structure — so it's stored as one JSON
 * text column rather than normalized tables (ADR 0029, `docs/research/
 * m3-track-storage.md`). `name` is optional — the builder tool (ticket 04)
 * may not always ask for one.
 */
export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(),
  name: text("name"),
  /** JSON-serialized `Segment[]` (`@dont-fall/shared`'s `Track` type). */
  data: text("data").notNull(),
  createdAt: integer("created_at").notNull(),
});

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { DEFAULT_TIME_LIMIT_MS } from "@dont-fall/shared";
import * as schema from "./schema.js";

/**
 * Opens (creating if needed) the SQLite file at `path` and ensures the
 * `tracks` table exists. WAL mode per the Docker-named-volume guidance in
 * `docs/research/m3-track-storage.md` — safe as long as both the writer and
 * any reader share a volume on one host (never NFS/CIFS).
 */
export const openDb = (path: string): BetterSQLite3Database<typeof schema> => {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

  // Code review (ticket 10): `CREATE TABLE IF NOT EXISTS` is a no-op against
  // a pre-ticket-10 database (the old single-`id`-primary-key schema), which
  // would otherwise crash every query with "no such column: track_id". Ticket
  // 13 verified Docker + the named `/data` volume for real, but that's still
  // solo local dev, not a real deployment with content worth keeping — so on
  // detecting the old schema this still drops and recreates the table rather
  // than migrating data that doesn't exist. Revisit with a real migration
  // once that stops being true (an actual deployment with content worth
  // keeping — code review, ticket 13: don't let this drift further without
  // re-checking, now that the volume genuinely persists across restarts).
  const existingColumns = sqlite.pragma("table_info(tracks)") as { name: string }[];
  const hasOldSchema = existingColumns.length > 0 && !existingColumns.some((c) => c.name === "track_id");
  if (hasOldSchema) {
    console.warn("track-service: dropping tracks table with the pre-Revision schema (no data to migrate yet)");
    sqlite.exec("DROP TABLE tracks");
  }

  // ADR 0032: a (track_id, revision) row per publish — never mutated, never
  // upserted. `author_id` is deliberately mocked (`DEFAULT_AUTHOR_ID` in
  // `store.ts`) until a real Account system exists.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS tracks (
      track_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      name TEXT,
      author_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      time_limit_ms INTEGER NOT NULL DEFAULT ${sql.raw(String(DEFAULT_TIME_LIMIT_MS))},
      PRIMARY KEY (track_id, revision)
    )
  `);

  // M4 ticket 03 / ADR 0038: a real additive migration, not the
  // drop-and-recreate above. That escape hatch was justified while the schema
  // change was structural and there was nothing worth keeping; this one adds
  // a column to a volume that now genuinely persists published Revisions, and
  // a Revision is immutable (ADR 0032) — dropping them would destroy content
  // rather than reshape it.
  //
  // `ADD COLUMN ... NOT NULL DEFAULT` *is* the backfill: SQLite writes the
  // default into every existing row, so a Revision published before M4 (the
  // M1 seed included) comes back with the default clock and keeps loading and
  // playing unchanged.
  const columns = sqlite.pragma("table_info(tracks)") as { name: string }[];
  if (!columns.some((c) => c.name === "time_limit_ms")) {
    console.log(`track-service: backfilling time_limit_ms = ${DEFAULT_TIME_LIMIT_MS} onto pre-M4 Revisions`);
    sqlite.exec(`ALTER TABLE tracks ADD COLUMN time_limit_ms INTEGER NOT NULL DEFAULT ${DEFAULT_TIME_LIMIT_MS}`);
  }

  return db;
};

export type TrackDb = ReturnType<typeof openDb>;

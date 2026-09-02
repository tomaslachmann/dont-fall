import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
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
  db.run(sql`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      name TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return db;
};

export type TrackDb = ReturnType<typeof openDb>;

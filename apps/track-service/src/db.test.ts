import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { accounts } from "./schema.js";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "track-service-db-test-"));
  dbPath = join(dir, "test.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openDb migrating the pre-ADR-0053 accounts schema", () => {
  it("drops and recreates a Discord-only accounts table (commit 87b1426's shape) rather than crashing on missing columns", () => {
    // Write the exact pre-ADR-0053 shape by hand — no `email`/`password_hash`, `discord_id NOT NULL`.
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    raw.prepare("INSERT INTO accounts (id, discord_id, display_name, created_at) VALUES (?, ?, ?, ?)").run(
      "old-id",
      "old-discord-id",
      "Old Bean",
      Date.now(),
    );
    raw.close();

    const db = openDb(dbPath);

    // The migrated table accepts an email-only insert — impossible under the old `discord_id NOT NULL`.
    expect(() =>
      db
        .insert(accounts)
        .values({ id: "new-id", email: "a@example.com", passwordHash: "hash", displayName: "New Bean", createdAt: Date.now() })
        .run(),
    ).not.toThrow();
    // The old row (and its now-incompatible shape) is gone with it — nothing here claims to preserve pre-ADR-0053 data.
    expect(db.select().from(accounts).where(eq(accounts.id, "old-id")).get()).toBeUndefined();
  });

  it("leaves an already-current accounts schema (and its data) untouched on reopen", () => {
    const db = openDb(dbPath);
    db.insert(accounts)
      .values({ id: "kept-id", email: "kept@example.com", passwordHash: "hash", displayName: "Kept Bean", createdAt: Date.now() })
      .run();

    const reopened = openDb(dbPath);

    expect(reopened.select().from(accounts).where(eq(accounts.id, "kept-id")).get()).toMatchObject({ displayName: "Kept Bean" });
  });
});

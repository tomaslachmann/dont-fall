import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { DEFAULT_ENVIRONMENT_ID, DEFAULT_SURVIVOR_TARGET, DEFAULT_TIME_LIMIT_MS } from "@dont-fall/shared";
import * as schema from "./schema.js";

/**
 * Opens (creating if needed) the SQLite file at `path` and ensures every
 * table exists. WAL mode per the Docker-named-volume guidance in
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
    console.warn("api: dropping tracks table with the pre-Revision schema (no data to migrate yet)");
    sqlite.exec("DROP TABLE tracks");
  }

  // ADR 0032: a (track_id, revision) row per publish — never mutated, never
  // upserted. `author_id` is deliberately mocked (`DEFAULT_AUTHOR_ID` in
  // `tracks.dao.ts`) until a real Account system exists.
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
      survivor_target INTEGER NOT NULL DEFAULT ${sql.raw(String(DEFAULT_SURVIVOR_TARGET))},
      environment TEXT NOT NULL DEFAULT '${sql.raw(DEFAULT_ENVIRONMENT_ID)}',
      thumbnail TEXT,
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
    console.log(`api: backfilling time_limit_ms = ${DEFAULT_TIME_LIMIT_MS} onto pre-M4 Revisions`);
    sqlite.exec(`ALTER TABLE tracks ADD COLUMN time_limit_ms INTEGER NOT NULL DEFAULT ${DEFAULT_TIME_LIMIT_MS}`);
  }

  // M5 ticket 07 / ADR 0041, the same additive migration for the same
  // reasons: a Revision published before M5 backfills to the default
  // Survivor Target and keeps loading and playing unchanged. A Race never
  // reads the column at all, so every existing Track is entirely unaffected.
  if (!columns.some((c) => c.name === "survivor_target")) {
    console.log(`api: backfilling survivor_target = ${DEFAULT_SURVIVOR_TARGET} onto pre-M5 Revisions`);
    sqlite.exec(`ALTER TABLE tracks ADD COLUMN survivor_target INTEGER NOT NULL DEFAULT ${DEFAULT_SURVIVOR_TARGET}`);
  }

  // M12 ticket 09 / ADR 0074, the same additive migration: a Revision
  // published before Environments existed backfills to the default one and
  // is drawn under it. Presentation only, so nothing about play changes.
  if (!columns.some((c) => c.name === "environment")) {
    console.log(`api: backfilling environment = '${DEFAULT_ENVIRONMENT_ID}' onto pre-M12 Revisions`);
    sqlite.exec(`ALTER TABLE tracks ADD COLUMN environment TEXT NOT NULL DEFAULT '${DEFAULT_ENVIRONMENT_ID}'`);
  }

  // Thumbnails (ADR 0085): nullable, so pre-Thumbnail Revisions need no
  // backfill value — NULL reads as "no Thumbnail", exactly like the
  // account `bindings` column below. The old screenshot-less Revisions keep
  // loading and playing unchanged; clients fall back to generated art.
  if (!columns.some((c) => c.name === "thumbnail")) {
    sqlite.exec("ALTER TABLE tracks ADD COLUMN thumbnail TEXT");
  }

  // M9 ticket 11: `accounts` first shipped Discord-only (`discord_id TEXT
  // NOT NULL UNIQUE`, no `email`/`password_hash`) at commit 87b1426, before
  // ADR 0053 corrected the decision to "both login methods." That old shape
  // is real, committed history now — not just this session's own tests — so
  // it gets the same guard `tracks` above already uses: detect it, drop and
  // recreate (still nothing worth migrating: Accounts have no real
  // deployment yet either way).
  const accountsInfo = sqlite.pragma("table_info(accounts)") as { name: string }[];
  const hasDiscordOnlyAccountsSchema = accountsInfo.length > 0 && !accountsInfo.some((c) => c.name === "email");
  if (hasDiscordOnlyAccountsSchema) {
    console.warn("api: dropping accounts (+ sessions) for the email/password schema (ADR 0053) — no data to migrate yet");
    sqlite.exec("DROP TABLE accounts");
    sqlite.exec("DROP TABLE IF EXISTS sessions"); // sessions.accountId would otherwise dangle against the recreated table
  }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      discord_id TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      friend_code TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      coins INTEGER NOT NULL DEFAULT 0,
      body_skin INTEGER NOT NULL DEFAULT 0,
      bindings TEXT,
      hat TEXT
    )
  `);
  // Match earnings (economy slice): additive backfill in the same style as
  // `time_limit_ms` above — pre-economy Accounts start at zero and keep
  // everything they had. `ADD COLUMN ... NOT NULL DEFAULT` is the backfill.
  const accountColumns = sqlite.pragma("table_info(accounts)") as { name: string }[];
  for (const column of ["xp", "coins"] as const) {
    if (!accountColumns.some((c) => c.name === column)) {
      console.log(`api: backfilling ${column} = 0 onto pre-economy Accounts`);
      sqlite.exec(`ALTER TABLE accounts ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
  }
  // M9 ticket 15: the equipped body skin — same additive backfill, default
  // bean (skin 0) for every pre-skins Account.
  if (!accountColumns.some((c) => c.name === "body_skin")) {
    console.log("api: backfilling body_skin = 0 onto pre-skins Accounts");
    sqlite.exec("ALTER TABLE accounts ADD COLUMN body_skin INTEGER NOT NULL DEFAULT 0");
  }
  // M9 controls: the stored bindings — nullable, so pre-controls Accounts
  // need no backfill value; NULL reads as "never saved".
  if (!accountColumns.some((c) => c.name === "bindings")) {
    sqlite.exec("ALTER TABLE accounts ADD COLUMN bindings TEXT");
  }
  // ADR 0083: the equipped hat — nullable, and NULL is "no hat", so
  // pre-hats Accounts need no backfill value.
  if (!accountColumns.some((c) => c.name === "hat")) {
    sqlite.exec("ALTER TABLE accounts ADD COLUMN hat TEXT");
  }
  // M9 ticket 12: the friend code ADD BY CODE resolves. Nullable with no
  // backfill — codes generate lazily on first read, so there is nothing to
  // write for pre-Friends Accounts and no reason to touch them. SQLite
  // forbids UNIQUE on ADD COLUMN, so migrated DBs get the same uniqueness
  // as a separate index (fresh DBs declare it inline above — identical end
  // state).
  if (!accountColumns.some((c) => c.name === "friend_code")) {
    sqlite.exec("ALTER TABLE accounts ADD COLUMN friend_code TEXT");
    sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_friend_code ON accounts (friend_code)");
  }
  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  // Sessions are only pruned lazily, on the exact expired token being looked
  // up again (`accounts.dao.ts`) — a batch sweep is future work, not built here
  // (this project's established pattern: don't build for scale not yet
  // needed). This index is cheap now and is exactly what that future sweep,
  // or a "log out everywhere" feature, would need to query by account.
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions (account_id)`);

  // Spectator wagering (ticket 14): brand-new tables, so plain
  // `CREATE TABLE IF NOT EXISTS` — no backfill, nothing to migrate.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS bet_rounds (
      match_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      closes_at_ms INTEGER NOT NULL,
      runners TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0,
      winner_ids TEXT,
      settled_at_ms INTEGER,
      PRIMARY KEY (match_id, round)
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_nickname TEXT NOT NULL,
      amount INTEGER NOT NULL,
      placed_at_ms INTEGER NOT NULL
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_bets_round ON bets (match_id, round)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_bets_account ON bets (account_id)`);

  // Match results + idempotent rewards claims (ADR 0059): brand-new tables,
  // so plain `CREATE TABLE IF NOT EXISTS` — no backfill, nothing to migrate.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS match_results (
      match_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      ended_at_ms INTEGER NOT NULL
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS reward_claims (
      account_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      gained_xp INTEGER NOT NULL,
      gained_coins INTEGER NOT NULL,
      xp_before INTEGER NOT NULL,
      xp_after INTEGER NOT NULL,
      coins_before INTEGER NOT NULL,
      coins_after INTEGER NOT NULL,
      claimed_at_ms INTEGER NOT NULL,
      PRIMARY KEY (account_id, match_id)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reward_claims_account ON reward_claims (account_id)`);
  // Career index (the Profile screen's history): brand-new table, same deal.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS match_participants (
      match_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      placement INTEGER NOT NULL,
      score REAL NOT NULL,
      falls INTEGER NOT NULL,
      ended_at_ms INTEGER NOT NULL,
      PRIMARY KEY (match_id, account_id)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_match_participants_account ON match_participants (account_id)`);

  // Anonymous per-Track play counts (M9 ticket 16): brand-new table, so
  // plain `CREATE TABLE IF NOT EXISTS` — no backfill, nothing to migrate.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS track_plays (
      track_id TEXT PRIMARY KEY,
      plays INTEGER NOT NULL
    )
  `);

  // Friends (M9 ticket 12): four brand-new tables, same deal — nothing to
  // migrate. Requests are directional with a pair unique (same-direction
  // double-sends fail at the DB); friendships canonical (a, b) PK; invites
  // expire lazily; beats hold one row per Account.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_account_id TEXT NOT NULL,
      to_account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (from_account_id, to_account_id)
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS friendships (
      account_a TEXT NOT NULL,
      account_b TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (account_a, account_b)
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS lobby_invites (
      id TEXT PRIMARY KEY,
      from_account_id TEXT NOT NULL,
      to_account_id TEXT NOT NULL,
      lobby_ref TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      delivered_at INTEGER
    )
  `);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS presence_beats (
      account_id TEXT PRIMARY KEY,
      beat_at INTEGER NOT NULL
    )
  `);

  return db;
};

export type ApiDb = ReturnType<typeof openDb>;

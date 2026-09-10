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
    /**
     * How long a Round on this Revision gets, in milliseconds (M4 ticket 03,
     * ADR 0038). A row attribute, keyed per `(track_id, revision)` like
     * everything else here — deliberately NOT folded into `data`, which stays
     * exactly the `Segment[]` every existing consumer already parses and which
     * `resolveTrack` never needs this to do its job.
     */
    timeLimitMs: integer("time_limit_ms").notNull(),
    /**
     * The Survivor Target a Survival Round on this Revision runs to (M5
     * ticket 07, ADR 0041). A row attribute for exactly the reasons
     * `time_limit_ms` is one: per `(track_id, revision)`, and deliberately
     * not folded into `data`, which stays the `Segment[]` every existing
     * consumer parses.
     */
    survivorTarget: integer("survivor_target").notNull(),
  },
  (table) => [primaryKey({ columns: [table.trackId, table.revision] })],
);

/**
 * An Account (CONTEXT.md, ADR 0052/0053) — a Player's persistent identity.
 * `id` is this game's own stable identifier, independent of either login
 * method, so nothing else in the schema needs to key on a third-party id
 * directly. Two independent, optional login methods may point at the same
 * Account (ADR 0053: both allowed together, not mutually exclusive):
 * `discordId` (the Discord user id from OAuth's `/users/@me`) and
 * `email`/`passwordHash` (this game's own credential store). At least one of
 * the two is always present — enforced in `accounts.ts`, not a DB
 * constraint, since "at least one of two nullable columns" isn't expressible
 * as a single SQLite `NOT NULL`.
 */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  discordId: text("discord_id").unique(),
  email: text("email").unique(),
  /** `scrypt(password, salt)` as `"<salt-hex>:<hash-hex>"` (`password.ts`) — null when this Account has no email/password login linked. */
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
});

/**
 * A logged-in session — an opaque bearer token (ADR 0024's existing
 * `sessionToken` pattern, `randomBytes(32).toString("base64url")`, reused
 * rather than introducing JWTs) mapped to the Account it authenticates.
 * Verified by lookup, not decoded — the same posture the match server
 * already uses for its own reconnect token.
 */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  accountId: text("account_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

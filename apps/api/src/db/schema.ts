import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { LobbyRef, PersistedMatchResult } from "@dont-fall/shared";

/**
 * A Track (CONTEXT.md) is small and self-contained — an ordered list of
 * Segment placements, no relational structure — so it's stored as one JSON
 * text column rather than normalized tables (ADR 0029, `docs/research/
 * m3-track-storage.md`). Publishing never mutates a row (ADR 0032): each
 * publish of `trackId` inserts a new `revision`, so `(track_id, revision)` is
 * the primary key, not `track_id` alone. `author_id` is deliberately mocked
 * (`DEFAULT_AUTHOR_ID` in `tracks.dao.ts`) until a real Account system exists.
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
 * the two is always present — enforced in `accounts.dao.ts`, not a DB
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
  /**
   * This Account's friend code (M9 ticket 12) — the 6-char readable string
   * ADD BY CODE resolves. Nullable: generated lazily on first read, so
   * pre-Friends Accounts need no backfill.
   */
  friendCode: text("friend_code").unique(),
  createdAt: integer("created_at").notNull(),
  /** Lifetime match earnings — the rewards claim credits, betting debits/pays (`accounts.dao.ts` owns both writers). */
  xp: integer("xp").notNull().default(0),
  coins: integer("coins").notNull().default(0),
});

/**
 * A logged-in session — an opaque Bearer [REDACTED] (ADR 0024's existing
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

/**
 * One Round open for spectator wagering (ticket 14) — written by the match
 * server when its Countdown starts, read by every spectator's panel.
 * `(match_id, round)` is the whole key: a Match's Round N opens exactly
 * once (first write wins, a retried open can't move the close), and settles
 * exactly once (`settled`, with the winners it paid).
 */
export const betRounds = sqliteTable(
  "bet_rounds",
  {
    matchId: text("match_id").notNull(),
    round: integer("round").notNull(),
    closesAtMs: integer("closes_at_ms").notNull(),
    /** The board at open: `[{ playerId, nickname }]` — odds derive from pools, never stored. */
    runners: text("runners", { mode: "json" }).notNull().$type<{ playerId: string; nickname: string }[]>(),
    settled: integer("settled").notNull().default(0),
    winnerIds: text("winner_ids", { mode: "json" }).$type<string[]>(),
    settledAtMs: integer("settled_at_ms"),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.round] })],
);

/**
 * One stake (ticket 14) — a bettor's beans on one runner in one Round.
 * Debited at placement (the coins leave the Account immediately, win or
 * lose); the settle pays `settlePayouts`' answer back per bettor. Multiple
 * bets per bettor per Round are separate rows — there is no upsert, only
 * append, so a ticket always means exactly what it says.
 */
export const bets = sqliteTable("bets", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull(),
  round: integer("round").notNull(),
  accountId: text("account_id").notNull(),
  /** The bettor's display name at placement — what the ticker shows. */
  nickname: text("nickname").notNull(),
  targetId: text("target_id").notNull(),
  targetNickname: text("target_nickname").notNull(),
  amount: integer("amount").notNull(),
  placedAtMs: integer("placed_at_ms").notNull(),
});

/**
 * One finished Match's results (ADR 0059) — written by the match server at
 * its terminal RESULTS, read back by the post-Match results page. Written
 * once, never mutated (first write wins, a retried save is a no-op), the
 * same posture as `bet_rounds`' open. The whole `PersistedMatchResult` is one
 * JSON column — small, self-contained, no relational structure to normalize
 * (the tracks-table reasoning, ADR 0029, at a smaller scale).
 */
export const matchResults = sqliteTable("match_results", {
  matchId: text("match_id").primaryKey(),
  data: text("data", { mode: "json" }).notNull().$type<PersistedMatchResult>(),
  endedAtMs: integer("ended_at_ms").notNull(),
});

/**
 * One banked rewards claim (ADR 0059) — what makes `POST /rewards/claim`
 * idempotent per Match. `(account_id, match_id)` is the whole key: a second
 * claim for the same Match replays these stored numbers instead of crediting
 * again, so a refresh on the rewards screen stops minting.
 */
export const rewardClaims = sqliteTable(
  "reward_claims",
  {
    accountId: text("account_id").notNull(),
    matchId: text("match_id").notNull(),
    gainedXp: integer("gained_xp").notNull(),
    gainedCoins: integer("gained_coins").notNull(),
    xpBefore: integer("xp_before").notNull(),
    xpAfter: integer("xp_after").notNull(),
    coinsBefore: integer("coins_before").notNull(),
    coinsAfter: integer("coins_after").notNull(),
    claimedAtMs: integer("claimed_at_ms").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.matchId] })],
);

/**
 * Anonymous play counts, one row per Track (M9 ticket 16) — what Discover's
 * TRENDING tab sorts on. Deliberately NOT a column on `tracks`: a Revision
 * is immutable (ADR 0032), and a counter that ticks on every Round start is
 * the opposite of immutable. Keyed by `track_id` alone, so plays survive
 * republishes; no per-Account data (ADR 0052's scope for discovery: heat,
 * not identity).
 */
export const trackPlays = sqliteTable("track_plays", {
  trackId: text("track_id").primaryKey(),
  plays: integer("plays").notNull(),
});

/**
 * Pending friend requests (M9 ticket 12) — directional (who asked whom
 * matters for the inbox) and deleted on accept/decline, so a declined
 * stranger can be re-requested later. The pair unique blocks same-direction
 * double-sends at the DB level; the cross-direction race is closed by
 * accept clearing both directions.
 */
export const friendRequests = sqliteTable(
  "friend_requests",
  {
    id: text("id").primaryKey(),
    fromAccountId: text("from_account_id").notNull(),
    toAccountId: text("to_account_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [unique("uq_friend_requests_pair").on(table.fromAccountId, table.toAccountId)],
);

/**
 * Confirmed friendships (M9 ticket 12) — one row per pair, canonically
 * ordered (`accountA < accountB`, enforced in the DAO), so "are X and Y
 * friends" is one PK lookup either way around.
 */
export const friendships = sqliteTable(
  "friendships",
  {
    accountA: text("account_a").notNull(),
    accountB: text("account_b").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountA, table.accountB] })],
);

/**
 * Lobby invites in flight (M9 ticket 12) — written by INVITE, read once by
 * the recipient's next presence heartbeat (which marks them delivered), and
 * lazily pruned past `expiresAt`. Accepting is joining (no server-side
 * accept exists — the JOIN is the accept); declining is a local dismiss.
 */
export const lobbyInvites = sqliteTable("lobby_invites", {
  id: text("id").primaryKey(),
  fromAccountId: text("from_account_id").notNull(),
  toAccountId: text("to_account_id").notNull(),
  lobbyRef: text("lobby_ref", { mode: "json" }).notNull().$type<LobbyRef>(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  deliveredAt: integer("delivered_at"),
});

/**
 * Last presence heartbeat per Account (M9 ticket 12) — the "online" half
 * of presence. The "doing" half is never stored: the API reads it live off
 * the lobbies' `/status` rosters at request time, so activity can never go
 * stale.
 */
export const presenceBeats = sqliteTable("presence_beats", {
  accountId: text("account_id").primaryKey(),
  beatAt: integer("beat_at").notNull(),
});

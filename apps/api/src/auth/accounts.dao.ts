import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { invalidBindingsReason, randomBearerToken, type KeyBindings } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { accounts, sessions } from "../db/schema.js";

export interface Account {
  id: string;
  discordId: string | null;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Lifetime match earnings — the economy's persisted half. */
  xp: number;
  coins: number;
  /** The body's equipped skin id (M9 ticket 15) — a small int, default bean until picked. */
  bodySkin: number;
  /** The equipped hat's id (ADR 0083) — `null` for no hat. */
  hat: string | null;
  /** The stored key bindings (M9 controls) — `null` when never saved, which the client resolves to defaults. */
  bindings: KeyBindings | null;
}

/** The Discord identity a successful OAuth exchange resolves to (`discordAuth.ts`). */
export interface DiscordIdentity {
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface EmailSignup {
  email: string;
  password: string;
  displayName: string;
}

/** How long a session stays valid without being used again (ADR 0052: mandatory login, but not naggingly short-lived). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Stored bindings JSON into a record — `null` for never-saved AND for
 * anything that no longer parses or validates (a corrupt row degrades to
 * defaults on the client, never to a broken Account).
 */
const toBindings = (stored: string | null): KeyBindings | null => {
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return invalidBindingsReason(parsed) ? null : (parsed as KeyBindings);
  } catch {
    return null;
  }
};

const toAccount = (row: typeof accounts.$inferSelect): Account => ({
  id: row.id,
  discordId: row.discordId,
  email: row.email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
  xp: row.xp,
  coins: row.coins,
  bodySkin: row.bodySkin,
  hat: row.hat,
  bindings: toBindings(row.bindings),
});

/** What one cosmetics write changes — any slot left out keeps what it had. */
export interface CosmeticsPatch {
  bodySkin?: number;
  hat?: string | null;
}

/**
 * Equips cosmetics (M9 ticket 15, ADR 0083) — the only writer of `bodySkin`
 * and `hat`, called with already-validated values (the service owns the
 * rules, shared owns their shape). Both slots land in one statement, so a
 * save never half-applies. Returns the updated Account, or `undefined` for
 * an unknown id.
 */
export const setCosmetics = (db: ApiDb, accountId: string, patch: CosmeticsPatch): Account | undefined => {
  const updated = db.update(accounts).set(patch).where(eq(accounts.id, accountId)).run();
  if (updated.changes === 0) return undefined;
  return getAccountById(db, accountId);
};

/**
 * Stores key bindings (M9 controls) — the only writer of `bindings`, called
 * with an already-validated record (the service owns the rule, shared owns
 * its shape). Returns the updated Account, or `undefined` for an unknown id.
 */
export const setBindings = (db: ApiDb, accountId: string, bindings: KeyBindings): Account | undefined => {
  const updated = db
    .update(accounts)
    .set({ bindings: JSON.stringify(bindings) })
    .where(eq(accounts.id, accountId))
    .run();
  if (updated.changes === 0) return undefined;
  return getAccountById(db, accountId);
};

/** Lifetime match earnings for one Account — `undefined` for an unknown id. */
export const getAccountEarnings = (db: ApiDb, accountId: string): { xp: number; coins: number } | undefined => {
  const row = db.select({ xp: accounts.xp, coins: accounts.coins }).from(accounts).where(eq(accounts.id, accountId)).get();
  return row === undefined ? undefined : { xp: row.xp, coins: row.coins };
};

/**
 * Banks match earnings onto an Account — with `spendCoins` below, the only
 * writers of `xp`/`coins` (betting moves coins both ways through exactly
 * these two). Returns before/after totals for the Rewards screen's bar;
 * `undefined` for an unknown id (callers authenticate first, so this is a
 * race, not a flow — a logout mid-claim).
 */
export const creditAccountEarnings = (
  db: ApiDb,
  accountId: string,
  gained: { xp: number; coins: number },
): { before: { xp: number; coins: number }; after: { xp: number; coins: number } } | undefined => {
  const before = getAccountEarnings(db, accountId);
  if (before === undefined) return undefined;
  const after = { xp: before.xp + gained.xp, coins: before.coins + gained.coins };
  db.update(accounts).set({ xp: after.xp, coins: after.coins }).where(eq(accounts.id, accountId)).run();
  return { before, after };
};

/**
 * Takes beans off an Account for one stake (ticket 14) — the debit half of
 * wagering, atomic by construction: a single conditional UPDATE, so two
 * tickets racing the same balance can't both spend what only covers one.
 * Returns the new balance, or `undefined` when the Account is unknown or
 * can't cover the stake (callers read that as insufficient funds).
 */
export const spendCoins = (db: ApiDb, accountId: string, amount: number): { coins: number } | undefined => {
  const updated = db
    .update(accounts)
    .set({ coins: sql`${accounts.coins} - ${amount}` })
    .where(and(eq(accounts.id, accountId), gte(accounts.coins, amount)))
    .run();
  if (updated.changes === 0) return undefined;
  const earnings = getAccountEarnings(db, accountId);
  return earnings === undefined ? undefined : { coins: earnings.coins };
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Plain-enough email check (matches this file's existing validation style, e.g. `validate.ts`) — not RFC 5322-complete, doesn't need to be. */
export const invalidEmailReason = (email: unknown): string | undefined => {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "a valid email is required";
  return undefined;
};

export const invalidPasswordReason = (password: unknown): string | undefined => {
  if (typeof password !== "string" || password.length < 8) return "password must be at least 8 characters";
  return undefined;
};

export const invalidDisplayNameReason = (displayName: unknown): string | undefined => {
  if (typeof displayName !== "string" || displayName.trim().length === 0) return "a display name is required";
  return undefined;
};

/**
 * True for a UNIQUE-constraint violation from better-sqlite3 (e.g. an email
 * or Discord id already claimed by another Account) — the one error shape
 * every `insert`/`update` below expects a caller to specifically catch and
 * turn into a 409, rather than an opaque 500. Centralized here so `index.ts`
 * never has to know better-sqlite3's own error shape.
 */
export const isUniqueConstraintError = (err: unknown): boolean =>
  err instanceof Error && "code" in err && (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";

/**
 * Finds the Account for a returning Discord user, or creates one on first
 * login — one atomic `INSERT ... ON CONFLICT (discord_id) DO UPDATE`, not a
 * check-then-insert: two near-simultaneous callbacks for the same brand-new
 * `discordId` (a browser back-button resubmit, a client retry) would
 * otherwise both see "no existing row" and race the UNIQUE constraint,
 * surfacing as an opaque 500 for one of them. A repeat login always
 * refreshes `displayName`/`avatarUrl` — Discord profile info drifts (a
 * Discord nickname change) and there's no reason this Account should hold a
 * stale copy. On conflict, SQLite keeps the existing row's `id`; the
 * `randomUUID()` generated for this call is simply unused in that case.
 */
export const upsertAccountFromDiscord = (db: ApiDb, identity: DiscordIdentity): Account =>
  toAccount(
    db
      .insert(accounts)
      .values({
        id: randomUUID(),
        discordId: identity.discordId,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: accounts.discordId,
        set: { displayName: identity.displayName, avatarUrl: identity.avatarUrl },
      })
      .returning()
      .get(),
  );

/**
 * Creates a brand-new Account with email/password credentials (ADR 0053) —
 * signup, never a login. Throws (`isUniqueConstraintError`) if `email` is
 * already registered to any Account, Discord-linked or not; the caller
 * turns that into a 409, never a silent overwrite.
 */
export const createAccountWithPassword = (db: ApiDb, signup: EmailSignup): Account =>
  toAccount(
    db
      .insert(accounts)
      .values({
        id: randomUUID(),
        email: normalizeEmail(signup.email),
        passwordHash: hashPassword(signup.password),
        displayName: signup.displayName.trim(),
        createdAt: Date.now(),
      })
      .returning()
      .get(),
  );

/**
 * Email/password login. Deliberately returns `undefined` for both "no
 * Account with that email" and "wrong password" — distinguishing the two
 * lets a caller enumerate which emails are registered, which this never
 * exposes. The password hash itself never leaves this function.
 */
export const verifyEmailPassword = (db: ApiDb, email: string, password: string): Account | undefined => {
  const row = db.select().from(accounts).where(eq(accounts.email, normalizeEmail(email))).get();
  if (!row || !row.passwordHash) return undefined;
  return verifyPassword(password, row.passwordHash) ? toAccount(row) : undefined;
};

/**
 * Links a Discord identity onto an *existing*, already-authenticated
 * Account (ADR 0053: both login methods may coexist on one Account) —
 * distinct from `upsertAccountFromDiscord`, which is the no-existing-session
 * login path and would otherwise create a second Account for the same
 * person. Throws (`isUniqueConstraintError`) if that Discord identity is
 * already linked to a *different* Account.
 *
 * Only sets `discordId`/`avatarUrl` — never `displayName`. A Player who
 * signed up with email/password already chose that name; linking Discord
 * onto their Account must not silently overwrite it with their Discord
 * username. (`upsertAccountFromDiscord`'s own repeat-login refresh of
 * `displayName` is a different case: there, Discord *is* the only identity
 * source, so there's no chosen name to clobber.)
 */
export const linkDiscordToAccount = (db: ApiDb, accountId: string, identity: DiscordIdentity): Account =>
  toAccount(
    db
      .update(accounts)
      .set({ discordId: identity.discordId, avatarUrl: identity.avatarUrl })
      .where(eq(accounts.id, accountId))
      .returning()
      .get(),
  );

/**
 * Sets (or replaces) email/password credentials on an *existing*,
 * already-authenticated Account — the Discord-first counterpart to
 * `linkDiscordToAccount`. Throws (`isUniqueConstraintError`) if `email` is
 * already registered to a *different* Account.
 */
export const linkPasswordToAccount = (
  db: ApiDb,
  accountId: string,
  credentials: { email: string; password: string },
): Account =>
  toAccount(
    db
      .update(accounts)
      .set({ email: normalizeEmail(credentials.email), passwordHash: hashPassword(credentials.password) })
      .where(eq(accounts.id, accountId))
      .returning()
      .get(),
  );

/** Issues a new opaque bearer session token for `accountId` (ADR 0024's existing token pattern, reused). */
export const createSession = (db: ApiDb, accountId: string): { token: string; expiresAt: number } => {
  const token = randomBearerToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.insert(sessions).values({ token, accountId, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
};

/**
 * Resolves a bearer token to its Account — verified by lookup, never
 * decoded. An expired session is treated exactly like an unknown one (and
 * opportunistically pruned) rather than surfacing a distinct "expired" error:
 * both cases mean the same thing to a caller — log in again.
 */
export const getAccountBySessionToken = (db: ApiDb, token: string): Account | undefined => {
  const session = db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return undefined;
  }
  const account = db.select().from(accounts).where(eq(accounts.id, session.accountId)).get();
  return account ? toAccount(account) : undefined;
};

/** Ends a session (logout). Deleting an already-gone/unknown token is a no-op, not an error. */
export const deleteSession = (db: ApiDb, token: string): void => {
  db.delete(sessions).where(eq(sessions.token, token)).run();
};

/**
 * One Account by id — `undefined` for an unknown id. Used where a single row's
 * existence gates an action (friend request, Lobby invite).
 */
export const getAccountById = (db: ApiDb, accountId: string): Account | undefined => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  return account ? toAccount(account) : undefined;
};

/**
 * Display Accounts for a batch of ids, keyed by id. Unknown ids are absent
 * from the map. Used where a derived list (RECENT co-players) must be enriched
 * with names after the fact.
 */
export const getAccountsByIds = (db: ApiDb, accountIds: readonly string[]): Map<string, Account> => {
  const rows =
    accountIds.length === 0
      ? []
      : db.select().from(accounts).where(inArray(accounts.id, [...accountIds])).all();
  return new Map(rows.map((row) => [row.id, toAccount(row)]));
};

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { randomBearerToken } from "@dont-fall/shared";
import type { TrackDb } from "./db.js";
import { accounts, sessions } from "./schema.js";

export interface Account {
  id: string;
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** The Discord identity a successful OAuth exchange resolves to (`discordAuth.ts`). */
export interface DiscordIdentity {
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** How long a session stays valid without being used again (ADR 0052: mandatory login, but not naggingly short-lived). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const toAccount = (row: typeof accounts.$inferSelect): Account => ({
  id: row.id,
  discordId: row.discordId,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
});

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
export const upsertAccountFromDiscord = (db: TrackDb, identity: DiscordIdentity): Account =>
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

/** Issues a new opaque bearer session token for `accountId` (ADR 0024's existing token pattern, reused). */
export const createSession = (db: TrackDb, accountId: string): { token: string; expiresAt: number } => {
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
export const getAccountBySessionToken = (db: TrackDb, token: string): Account | undefined => {
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
export const deleteSession = (db: TrackDb, token: string): void => {
  db.delete(sessions).where(eq(sessions.token, token)).run();
};

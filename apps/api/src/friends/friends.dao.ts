import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { FRIEND_CODE_LENGTH, type LobbyRef } from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { accounts, friendRequests, friendships, lobbyInvites, matchResults, presenceBeats } from "../db/schema.js";
import { isUniqueConstraintError } from "../auth/accounts.dao.js";
import { ONLINE_WINDOW_MS } from "./presence.js";

// Same shape as the lobby broker's join codes (`lobbies.registry.ts`) — a
// human reading this off a friend's screen is the entire point, so the same
// ambiguous glyphs (0/O, 1/I) stay excluded. Colocated, not shared: two
// lines, two owners, no reason to couple the modules.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * `length` random characters of the friend code's alphabet. A Party code is
 * drawn from here too (ADR 0112): the same glyphs a human can read aloud,
 * never the same namespace — nothing stores it, and a lookup tries a live
 * Party code before a friend code.
 */
export const randomFriendAlphabetCode = (length: number): string =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

const generateCode = (): string => randomFriendAlphabetCode(FRIEND_CODE_LENGTH);

/**
 * This Account's friend code (M9 ticket 12) — generated lazily on first
 * read, stable forever after. Retries on the (astronomically unlikely)
 * collision: the UNIQUE column is the arbiter, never a check-then-insert.
 */
export const ensureFriendCode = (db: ApiDb, accountId: string): string => {
  for (;;) {
    const row = db
      .select({ friendCode: accounts.friendCode })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    if (row?.friendCode) return row.friendCode;
    try {
      db.update(accounts)
        .set({ friendCode: generateCode() })
        .where(and(eq(accounts.id, accountId), isNull(accounts.friendCode)))
        .run();
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }
  }
};

/** Resolves a friend code back to its Account — case-insensitive, like the lobby broker's codes. */
export const accountIdByFriendCode = (db: ApiDb, code: string): string | undefined =>
  db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.friendCode, code.toUpperCase()))
    .get()?.id;

/**
 * Sends a friend request — the pair unique throws on a same-direction
 * double-send (the service pre-checks; this is the race guard, and the
 * caller maps it to the same friendly 409).
 */
export const sendRequest = (db: ApiDb, fromAccountId: string, toAccountId: string, nowMs: number): string => {
  const id = randomUUID();
  db.insert(friendRequests).values({ id, fromAccountId, toAccountId, createdAt: nowMs }).run();
  return id;
};

/** Whether a pending request runs between these Accounts in either direction. */
export const pendingBetween = (db: ApiDb, a: string, b: string): boolean => {
  const row = db
    .select({ id: friendRequests.id })
    .from(friendRequests)
    .where(
      or(
        and(eq(friendRequests.fromAccountId, a), eq(friendRequests.toAccountId, b)),
        and(eq(friendRequests.fromAccountId, b), eq(friendRequests.toAccountId, a)),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
};

/** This Account's inbox, newest last — with each sender's display name attached. */
export const incomingRequests = (
  db: ApiDb,
  accountId: string,
): {
  id: string;
  fromAccountId: string;
  fromDisplayName: string;
  fromAvatarUrl: string | null;
  fromColor: number;
  createdAt: number;
}[] =>
  db
    .select({
      id: friendRequests.id,
      fromAccountId: friendRequests.fromAccountId,
      fromDisplayName: accounts.displayName,
      fromAvatarUrl: accounts.avatarUrl,
      fromColor: accounts.color,
      createdAt: friendRequests.createdAt,
    })
    .from(friendRequests)
    .innerJoin(accounts, eq(accounts.id, friendRequests.fromAccountId))
    .where(eq(friendRequests.toAccountId, accountId))
    .orderBy(friendRequests.createdAt)
    .all();

/**
 * Accepts a pending request addressed to this Account — befriends the pair
 * and clears the request. Returns the new friend's id, or `null` when no
 * such pending request to this Account exists (phantom id, or someone
 * else's inbox — the caller answers 404 either way, never which). Also
 * clears a cross-direction row from the double-send race, so no orphan
 * survives an accept.
 */
export const acceptRequest = (
  db: ApiDb,
  requestId: string,
  accountId: string,
  nowMs: number,
): string | null => {
  const request = db.select().from(friendRequests).where(eq(friendRequests.id, requestId)).get();
  if (!request || request.toAccountId !== accountId) return null;
  const [a, b] =
    request.fromAccountId < accountId
      ? [request.fromAccountId, accountId]
      : [accountId, request.fromAccountId];
  db.insert(friendships)
    .values({ accountA: a, accountB: b, createdAt: nowMs })
    .onConflictDoNothing({ target: [friendships.accountA, friendships.accountB] })
    .run();
  db.delete(friendRequests)
    .where(
      or(
        and(
          eq(friendRequests.fromAccountId, request.fromAccountId),
          eq(friendRequests.toAccountId, accountId),
        ),
        and(
          eq(friendRequests.fromAccountId, accountId),
          eq(friendRequests.toAccountId, request.fromAccountId),
        ),
      ),
    )
    .run();
  return request.fromAccountId;
};

/** Declines a pending request addressed to this Account — `false` when there is no such request. */
export const declineRequest = (db: ApiDb, requestId: string, accountId: string): boolean => {
  const request = db.select().from(friendRequests).where(eq(friendRequests.id, requestId)).get();
  if (!request || request.toAccountId !== accountId) return false;
  db.delete(friendRequests).where(eq(friendRequests.id, requestId)).run();
  return true;
};

/** Accepts every pending request in this Account's inbox — returns the new friends' ids. */
export const acceptAllRequests = (db: ApiDb, accountId: string, nowMs: number): string[] => {
  const inbox = db.select().from(friendRequests).where(eq(friendRequests.toAccountId, accountId)).all();
  const accepted: string[] = [];
  for (const request of inbox) {
    const friend = acceptRequest(db, request.id, accountId, nowMs);
    if (friend) accepted.push(friend);
  }
  return accepted;
};

/**
 * Removes a friendship — `true` when a row existed either way around (the
 * pair is canonical, so one delete covers both), `false` for strangers.
 */
export const removeFriendship = (db: ApiDb, a: string, b: string): boolean => {
  const [first, second] = a < b ? [a, b] : [b, a];
  const result = db
    .delete(friendships)
    .where(and(eq(friendships.accountA, first), eq(friendships.accountB, second)))
    .run();
  return result.changes > 0;
};

/** Whether these Accounts are friends — one PK lookup on the canonical pair. */
export const areFriends = (db: ApiDb, a: string, b: string): boolean => {
  const [first, second] = a < b ? [a, b] : [b, a];
  const row = db
    .select({ accountA: friendships.accountA })
    .from(friendships)
    .where(and(eq(friendships.accountA, first), eq(friendships.accountB, second)))
    .limit(1)
    .get();
  return row !== undefined;
};

/** Every friendship this Account is in, either side — with names and formation time attached. */
export const listFriends = (
  db: ApiDb,
  accountId: string,
): { accountId: string; displayName: string; avatarUrl: string | null; color: number; friendsSince: number }[] => {
  const rows = db
    .select({
      accountA: friendships.accountA,
      accountB: friendships.accountB,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .where(or(eq(friendships.accountA, accountId), eq(friendships.accountB, accountId)))
    .orderBy(friendships.createdAt)
    .all();
  if (rows.length === 0) return [];
  const otherIds = rows.map((row) => (row.accountA === accountId ? row.accountB : row.accountA));
  const accountsById = new Map(
    db
      .select({ id: accounts.id, displayName: accounts.displayName, avatarUrl: accounts.avatarUrl, color: accounts.color })
      .from(accounts)
      .where(inArray(accounts.id, otherIds))
      .all()
      .map((p) => [p.id, p] as const),
  );
  return rows.flatMap((row) => {
    const other = row.accountA === accountId ? row.accountB : row.accountA;
    const account = accountsById.get(other);
    return account === undefined
      ? []
      : [
          {
            accountId: other,
            displayName: account.displayName,
            avatarUrl: account.avatarUrl,
            color: account.color,
            friendsSince: row.createdAt,
          },
        ];
  });
};

/**
 * Beans online (`GET /game-settings`, ADR 0110): every Account whose presence
 * heartbeat is younger than the same window friends presence reads as online.
 * The API beats for every open Account socket (ADR 0112), so a Player in the
 * menu counts, not only one seated in a Lobby.
 */
export const countOnlineAccounts = (db: ApiDb, nowMs: number): number =>
  db.select({ online: count() }).from(presenceBeats).where(gt(presenceBeats.beatAt, nowMs - ONLINE_WINDOW_MS)).get()?.online ?? 0;

/**
 * Records this Account's presence heartbeat — one row per Account, latest
 * wins. Its one writer is the Account socket (ADR 0112): on connect, then
 * every `ACCOUNT_BEAT_MS` while it stays open.
 */
export const recordBeat = (db: ApiDb, accountId: string, nowMs: number): void => {
  db.insert(presenceBeats)
    .values({ accountId, beatAt: nowMs })
    .onConflictDoUpdate({ target: presenceBeats.accountId, set: { beatAt: nowMs } })
    .run();
};

/** Last beats for these Accounts — missing Accounts simply miss from the map. */
export const beatsFor = (db: ApiDb, accountIds: string[]): Map<string, number> => {
  if (accountIds.length === 0) return new Map();
  return new Map(
    db
      .select({ accountId: presenceBeats.accountId, beatAt: presenceBeats.beatAt })
      .from(presenceBeats)
      .where(inArray(presenceBeats.accountId, accountIds))
      .all()
      .map((row) => [row.accountId, row.beatAt] as const),
  );
};

/**
 * Stores a lobby invite in flight — pushed at once over the recipient's
 * Account socket when it is open, otherwise on its next connect (ADR 0112).
 */
export const createInvite = (
  db: ApiDb,
  invite: { fromAccountId: string; toAccountId: string; lobbyRef: LobbyRef; createdAt: number; expiresAt: number },
): string => {
  const id = randomUUID();
  db.insert(lobbyInvites).values({ id, ...invite, deliveredAt: null }).run();
  return id;
};

/**
 * This Account's unexpired invites — with each sender's name attached, and
 * whether one has been sent before. Delivered ones are included on purpose
 * (ADR 0112): an invite is marked delivered as soon as a socket accepted the
 * bytes, including a half-open one nobody has noticed yet, and leaving it out
 * here would lose it for good. Prunes this Account's expired rows on the way
 * (lazy, like session pruning: the read that would surface them deletes them
 * instead).
 */
export const liveInvites = (
  db: ApiDb,
  accountId: string,
  nowMs: number,
): {
  id: string;
  fromAccountId: string;
  fromDisplayName: string;
  fromColor: number;
  lobbyRef: LobbyRef;
  createdAt: number;
  deliveredAt: number | null;
}[] => {
  db.delete(lobbyInvites)
    .where(and(eq(lobbyInvites.toAccountId, accountId), lte(lobbyInvites.expiresAt, nowMs)))
    .run();
  return db
    .select({
      id: lobbyInvites.id,
      fromAccountId: lobbyInvites.fromAccountId,
      fromDisplayName: accounts.displayName,
      fromColor: accounts.color,
      lobbyRef: lobbyInvites.lobbyRef,
      createdAt: lobbyInvites.createdAt,
      deliveredAt: lobbyInvites.deliveredAt,
    })
    .from(lobbyInvites)
    .innerJoin(accounts, eq(accounts.id, lobbyInvites.fromAccountId))
    .where(eq(lobbyInvites.toAccountId, accountId))
    .orderBy(lobbyInvites.createdAt)
    .all();
};

/** Marks invites delivered — `deliveredAt` records that one reached a socket at least once. */
export const markInvitesDelivered = (db: ApiDb, ids: string[], nowMs: number): void => {
  if (ids.length === 0) return;
  db.update(lobbyInvites).set({ deliveredAt: nowMs }).where(inArray(lobbyInvites.id, ids)).run();
};

/**
 * Every Account this one shared a finished Match with (M9 ticket 12) — what
 * RECENT and the request context ("PLAYED N MATCHES TOGETHER") read. Scans
 * every saved Match's `accountIds` map; pre-2b rows carry none and simply
 * contribute nothing. A full-table scan per call (this project's own
 * established pattern at this scale); Match rows are small JSON and few.
 */
export const coPlayedWith = (
  db: ApiDb,
  accountId: string,
): Map<string, { matchesTogether: number; lastPlayedAt: number }> => {
  const out = new Map<string, { matchesTogether: number; lastPlayedAt: number }>();
  const rows = db.select({ data: matchResults.data, endedAtMs: matchResults.endedAtMs }).from(matchResults).all();
  for (const row of rows) {
    const ids = Object.values(row.data.accountIds ?? {});
    if (!ids.includes(accountId)) continue;
    for (const other of new Set(ids)) {
      if (other === accountId) continue;
      const prev = out.get(other);
      out.set(other, {
        matchesTogether: (prev?.matchesTogether ?? 0) + 1,
        lastPlayedAt: Math.max(prev?.lastPlayedAt ?? 0, row.endedAtMs),
      });
    }
  }
  return out;
};

import {
  type FriendPresence,
  type FriendRequestView,
  type FriendView,
  type LobbyInviteView,
  type LobbyRef,
  type RecentPlayerView,
} from "@dont-fall/shared";
import type { ApiDb } from "../db/db.js";
import { ServiceError } from "../http/errors.js";
import { derivePresence, type LobbySeat } from "./presence.js";
import { getAccountById, getAccountsByIds, isUniqueConstraintError } from "../auth/accounts.dao.js";
import {
  acceptAllRequests,
  acceptRequest,
  accountIdByFriendCode,
  areFriends,
  beatsFor,
  coPlayedWith,
  createInvite,
  declineRequest,
  ensureFriendCode,
  incomingRequests,
  listFriends,
  liveInvites,
  markInvitesDelivered,
  pendingBetween,
  removeFriendship,
  sendRequest,
} from "./friends.dao.js";

/**
 * One live Lobby as presence derivation sees it: a `LobbySeat` plus every
 * authed Account sitting in it.
 */
export type LiveLobbySeat = LobbySeat & { accountIds: readonly string[] };

/** The live-roster half of presence: derived from Lobbies that exist right now, never from stored rows. */
export interface PresenceSource {
  liveSeats(): Promise<readonly LiveLobbySeat[]>;
}

export interface FriendsEnv {
  presence: PresenceSource;
  /** Overridable clock; production callers omit it. */
  now?: () => number;
  /**
   * Pushes a Lobby invite over the recipient's Account socket (ADR 0112) —
   * `true` when one was open to take it. Absent, or `false`, the invite
   * waits for that socket's next connect.
   */
  pushLobbyInvite?: (toAccountId: string, invite: LobbyInviteView) => boolean;
}

/** A sent Lobby invite stops being offered after five minutes. */
export const INVITE_TTL_MS = 5 * 60_000;

/** The RECENT tab never shows more than this many co-players. */
export const RECENT_LIMIT = 20;

const clock = (env: FriendsEnv): (() => number) => env.now ?? Date.now;

/** `GET /friends/code` — the caller's own add-code, stable for the lifetime of the Account. */
export const ownFriendCode = (db: ApiDb, accountId: string): { code: string } => ({
  code: ensureFriendCode(db, accountId),
});

const resolveRecipient = (db: ApiDb, body: { accountId?: unknown; code?: unknown }): string => {
  if (typeof body.accountId === "string" && body.accountId.length > 0) {
    if (!getAccountById(db, body.accountId)) throw new ServiceError(404, "no player with that id");
    return body.accountId;
  }
  if (typeof body.code === "string" && body.code.trim().length > 0) {
    const resolved = accountIdByFriendCode(db, body.code);
    if (!resolved) throw new ServiceError(404, "no player with that friend code");
    return resolved;
  }
  throw new ServiceError(400, "send either a friend code or an account id");
};

/**
 * `POST /friends/requests` — send a request by friend code or account id.
 * Self-adds and duplicates are 400/409, never silent no-ops.
 */
export const sendFriendRequest = (
  db: ApiDb,
  env: FriendsEnv,
  fromAccountId: string,
  body: { accountId?: unknown; code?: unknown },
): { id: string } => {
  const toAccountId = resolveRecipient(db, body);
  if (toAccountId === fromAccountId) throw new ServiceError(400, "you cannot befriend yourself");
  if (areFriends(db, fromAccountId, toAccountId)) throw new ServiceError(409, "already friends");
  if (pendingBetween(db, fromAccountId, toAccountId)) {
    throw new ServiceError(409, "a request is already pending");
  }
  try {
    return { id: sendRequest(db, fromAccountId, toAccountId, clock(env)()) };
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new ServiceError(409, "a request is already pending");
    throw err;
  }
};

const withMatchesTogether = (db: ApiDb, accountId: string): FriendRequestView[] => {
  const together = coPlayedWith(db, accountId);
  return incomingRequests(db, accountId).map((request) => ({
    id: request.id,
    fromAccountId: request.fromAccountId,
    fromDisplayName: request.fromDisplayName,
    fromAvatarUrl: request.fromAvatarUrl,
    fromColor: request.fromColor,
    sentAt: request.createdAt,
    matchesTogether: together.get(request.fromAccountId)?.matchesTogether ?? 0,
  }));
};

/** `GET /friends/requests` — incoming requests, each with matches played together. */
export const friendRequests = (db: ApiDb, accountId: string): { requests: FriendRequestView[] } => ({
  requests: withMatchesTogether(db, accountId),
});

/** `POST /friends/requests/:id/accept` — accept, returning the new friend. */
export const acceptFriendRequest = (
  db: ApiDb,
  env: FriendsEnv,
  accountId: string,
  id: string,
): { friend: { accountId: string; displayName: string; avatarUrl: string | null } } => {
  const friendId = acceptRequest(db, id, accountId, clock(env)());
  if (!friendId) throw new ServiceError(404, "no such friend request");
  const account = getAccountById(db, friendId);
  return {
    friend: {
      accountId: friendId,
      displayName: account?.displayName ?? "Unknown player",
      avatarUrl: account?.avatarUrl ?? null,
    },
  };
};

/** `POST /friends/requests/:id/decline` — decline one request. */
export const declineFriendRequest = (db: ApiDb, accountId: string, id: string): { id: string } => {
  if (!declineRequest(db, id, accountId)) throw new ServiceError(404, "no such friend request");
  return { id };
};

/** `POST /friends/requests/accept-all` — accept every pending incoming request. */
export const acceptAllFriendRequests = (db: ApiDb, env: FriendsEnv, accountId: string): { accepted: number } => ({
  accepted: acceptAllRequests(db, accountId, clock(env)()).length,
});

/** `DELETE /friends/:accountId` — remove a friend (both directions at once). */
export const unfriend = (db: ApiDb, accountId: string, friendAccountId: string): { removed: boolean } => ({
  removed: removeFriendship(db, accountId, friendAccountId),
});

/**
 * The Lobby invites an Account socket pushes when it connects (ADR 0112) —
 * every unexpired one this Account holds, whether or not it has been sent
 * before. A send is only ever "the socket accepted the bytes", which a
 * half-open connection the ping sweep has not caught yet does too, so an
 * invite pushed once and never again is an invite lost for good; the client
 * drops a duplicate by id. `deliveredAt` stays what it was — the record that
 * one reached a socket at least once, not permission to forget it.
 */
export const invitesOnConnect = (db: ApiDb, accountId: string, nowMs: number): LobbyInviteView[] => {
  const invites = liveInvites(db, accountId, nowMs);
  markInvitesDelivered(
    db,
    invites.filter((invite) => invite.deliveredAt === null).map((invite) => invite.id),
    nowMs,
  );
  return invites.map((invite) => ({
    id: invite.id,
    fromAccountId: invite.fromAccountId,
    fromDisplayName: invite.fromDisplayName,
    fromColor: invite.fromColor,
    lobby: invite.lobbyRef,
    sentAt: invite.createdAt,
  }));
};

/**
 * `GET /friends` — the roster with live presence plus pending requests. The
 * seat always wins over the beat (see `derivePresence`); friends in no Lobby
 * with no fresh beat read as offline, and nothing about them is stored.
 */
export const friendsOverview = async (
  db: ApiDb,
  env: FriendsEnv,
  accountId: string,
): Promise<{ friends: FriendView[]; online: number; total: number; requests: FriendRequestView[] }> => {
  const now = clock(env)();
  const rows = listFriends(db, accountId);
  const ids = rows.map((row) => row.accountId);
  const beats = beatsFor(db, ids);
  const live = await env.presence.liveSeats();
  const seats = new Map<string, LobbySeat>();
  for (const { accountIds, ...seat } of live) for (const id of accountIds) seats.set(id, seat);
  const presences = derivePresence(ids, beats, seats, now);
  const friends: FriendView[] = rows.map((row) => {
    const presence: FriendPresence = presences.get(row.accountId) ?? { status: "offline" };
    return {
      accountId: row.accountId,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      color: row.color,
      friendsSince: row.friendsSince,
      presence,
    };
  });
  return {
    friends,
    online: friends.filter((friend) => friend.presence.status !== "offline").length,
    total: friends.length,
    requests: withMatchesTogether(db, accountId),
  };
};

const parseLobbyRef = (value: unknown): LobbyRef | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const ref = value as { kind?: unknown; lobbyId?: unknown; code?: unknown };
  if (ref.kind === "private") {
    if (typeof ref.code !== "string" || ref.code.length === 0) return undefined;
    return { kind: "private", code: ref.code };
  }
  if (ref.kind === "public") {
    if (typeof ref.lobbyId !== "string" || ref.lobbyId.length === 0) return undefined;
    return { kind: "public", lobbyId: ref.lobbyId };
  }
  return undefined;
};

/**
 * `POST /friends/invite` — invite a friend to a Lobby. Friends-only (403 for
 * strangers); the invite itself is a bearer capability that expires. Pushed
 * at once when the friend's Account socket is open (ADR 0112), and stored
 * either way, so one sent to a closed game arrives on its next connect.
 */
export const inviteFriend = (
  db: ApiDb,
  env: FriendsEnv,
  fromAccountId: string,
  body: { accountId?: unknown; lobby?: unknown },
): { id: string } => {
  const lobby = parseLobbyRef(body.lobby);
  if (!lobby) throw new ServiceError(400, "lobby must be a private { code } or public { lobbyId } ref");
  if (typeof body.accountId !== "string" || body.accountId.length === 0) {
    throw new ServiceError(400, "accountId is required");
  }
  if (body.accountId === fromAccountId) throw new ServiceError(400, "you cannot invite yourself");
  if (!getAccountById(db, body.accountId)) throw new ServiceError(404, "no player with that id");
  if (!areFriends(db, fromAccountId, body.accountId)) {
    throw new ServiceError(403, "you can only invite friends");
  }
  const now = clock(env)();
  const id = createInvite(db, {
    fromAccountId,
    toAccountId: body.accountId,
    lobbyRef: lobby,
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
  });
  const from = getAccountById(db, fromAccountId);
  const view: LobbyInviteView = {
    id,
    fromAccountId,
    fromDisplayName: from?.displayName ?? "Unknown player",
    fromColor: from?.color ?? 0,
    lobby,
    sentAt: now,
  };
  if (env.pushLobbyInvite?.(body.accountId, view) === true) markInvitesDelivered(db, [id], now);
  return { id };
};

/**
 * `GET /friends/recent` — co-players from finished Matches, most recent first.
 * Derived, never stored; unknown Accounts (impossible in practice — Matches
 * only ever record real ones) are skipped, never surfaced nameless.
 */
export const recentPlayers = (db: ApiDb, accountId: string): { recent: RecentPlayerView[] } => {
  const played = [...coPlayedWith(db, accountId).entries()]
    .sort((a, b) => b[1].lastPlayedAt - a[1].lastPlayedAt)
    .slice(0, RECENT_LIMIT);
  const accountsByIds = getAccountsByIds(
    db,
    played.map(([id]) => id),
  );
  const recent: RecentPlayerView[] = [];
  for (const [id, stats] of played) {
    const account = accountsByIds.get(id);
    if (!account) continue;
    recent.push({
      accountId: id,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      color: account.color,
      matchesTogether: stats.matchesTogether,
      lastPlayedAt: stats.lastPlayedAt,
    });
  }
  return { recent };
};

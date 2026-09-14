/**
 * Friends wire shapes (M9 ticket 12) — what the API's `/friends/*` routes
 * return and the Friends screen renders. Shared (not declared twice) for
 * the same reason as `TrackListing`: producer and consumer must never
 * silently drift apart.
 */

/** Where a friend is right now, as the API derived it — never self-reported. */
export type FriendPresenceStatus = "in-lobby" | "in-match" | "online" | "idle" | "offline";

/**
 * How to reach the friend's Lobby — only ever present on an `in-lobby`
 * presence, the one state a JOIN can land in. Private lobbies travel by
 * join code (resolved through the broker as usual); public ones by id.
 */
export type LobbyRef = { kind: "private"; code: string } | { kind: "public"; lobbyId: string };

export interface FriendPresence {
  status: FriendPresenceStatus;
  /** In a Match: which Round is running (the mock's "ROUND 2"). */
  round?: number;
  /** In a Lobby: open seats (the mock's "3 SLOTS OPEN"). */
  slotsOpen?: number;
  /** Idle/offline: when the friend was last seen (ms epoch, for "2 DAYS AGO"). Absent when never. */
  lastSeenAt?: number;
  /** In a Lobby: how a JOIN would travel. Always present there — the JOIN button's own gate is `joinable`. */
  lobby?: LobbyRef;
  /** In a Lobby, LOBBY phase, capacity left — the JOIN button's own gate. */
  joinable?: boolean;
}

export interface FriendView {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  /** When the friendship formed (ms epoch). */
  friendsSince: number;
  presence: FriendPresence;
}

export interface FriendRequestView {
  id: string;
  fromAccountId: string;
  fromDisplayName: string;
  fromAvatarUrl: string | null;
  /** When the request was sent (ms epoch). */
  sentAt: number;
  /** Finished matches you shared — the request's honest context (0 hides the line). */
  matchesTogether: number;
}

export interface LobbyInviteView {
  id: string;
  fromAccountId: string;
  fromDisplayName: string;
  lobby: LobbyRef;
  /** When the invite was sent (ms epoch). */
  sentAt: number;
}

export interface RecentPlayerView {
  accountId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Finished matches you shared. */
  matchesTogether: number;
  /** When you last shared one (ms epoch). */
  lastPlayedAt: number;
}

/**
 * Friend-code length, shared so the generator (API) and the input cap
 * (client) can never drift apart. Deliberately not shared with the lobby
 * broker's join codes: same shape, different concept, different owner.
 */
export const FRIEND_CODE_LENGTH = 6;

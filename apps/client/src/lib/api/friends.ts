/**
 * The client half of `/friends/*` (M9 ticket 12) — the roster, requests,
 * recent co-players, and Lobby invites behind the Friends screen. Thin by
 * contract: typed paths over `apiGet`/`apiPost`, one `apiJson` DELETE. All
 * wire shapes come from `@dont-fall/shared`, so producer and consumer can
 * never silently drift apart.
 */

import type {
  FriendRequestView,
  FriendView,
  LobbyInviteView,
  LobbyRef,
  RecentPlayerView,
} from "@dont-fall/shared";
import { apiGet, apiJson, apiPost } from "./base.js";

/** `GET /friends` — the whole screen in one round trip. */
export interface FriendsOverview {
  friends: FriendView[];
  online: number;
  total: number;
  requests: FriendRequestView[];
}

export const getFriendsOverview = (): Promise<FriendsOverview> => apiGet<FriendsOverview>("/friends");

/** `GET /friends/recent` — co-players from finished Matches, most recent first. */
export const getRecentPlayers = (): Promise<{ recent: RecentPlayerView[] }> =>
  apiGet<{ recent: RecentPlayerView[] }>("/friends/recent");

/** `GET /friends/code` — this Account's own add-code, stable forever. */
export const getOwnFriendCode = (): Promise<{ code: string }> => apiGet<{ code: string }>("/friends/code");

/**
 * `POST /friends/heartbeat` — "I am here", every 30 s. Doubles as the moment
 * pending Lobby invites surface: each arrives on exactly one heartbeat.
 */
export const postHeartbeat = (): Promise<{ ok: true; invites: LobbyInviteView[] }> =>
  apiPost<{ ok: true; invites: LobbyInviteView[] }>("/friends/heartbeat");

/** `POST /friends/requests` — by friend code or, from RECENT, by account id. */
export const sendFriendRequest = (to: { code?: string; accountId?: string }): Promise<{ id: string }> =>
  apiPost<{ id: string }>("/friends/requests", to);

/** `POST /friends/requests/:id/accept` — accept, learning the new friend's profile. */
export const acceptFriendRequest = (
  id: string,
): Promise<{ friend: { accountId: string; displayName: string; avatarUrl: string | null } }> =>
  apiPost(`/friends/requests/${encodeURIComponent(id)}/accept`);

/** `POST /friends/requests/:id/decline` — decline one request. */
export const declineFriendRequest = (id: string): Promise<{ id: string }> =>
  apiPost(`/friends/requests/${encodeURIComponent(id)}/decline`);

/** `POST /friends/requests/accept-all` — accept the whole inbox at once. */
export const acceptAllFriendRequests = (): Promise<{ accepted: number }> =>
  apiPost<{ accepted: number }>("/friends/requests/accept-all");

/** `POST /friends/invite` — invite a friend to a Lobby. Friends-only, server-side. */
export const sendLobbyInvite = (invite: { accountId: string; lobby: LobbyRef }): Promise<{ id: string }> =>
  apiPost<{ id: string }>("/friends/invite", invite);

/** `DELETE /friends/:accountId` — remove a friend, both directions at once. */
export const removeFriend = (accountId: string): Promise<{ removed: boolean }> =>
  apiJson<{ removed: boolean }>(`/friends/${encodeURIComponent(accountId)}`, { method: "DELETE" });

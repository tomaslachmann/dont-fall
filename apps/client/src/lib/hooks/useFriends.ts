import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendRequestView, FriendView, LobbyRef, RecentPlayerView } from "@dont-fall/shared";
import {
  acceptAllFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  getFriendsOverview,
  getOwnFriendCode,
  getRecentPlayers,
  removeFriend,
  sendFriendRequest,
  sendLobbyInvite,
} from "../api/friends.js";

/** Presence goes stale fast — the roster re-polls twice per presence beat (`ACCOUNT_BEAT_MS`). */
const OVERVIEW_POLL_MS = 15_000;

export interface UseFriends {
  friends: FriendView[];
  online: number;
  total: number;
  requests: FriendRequestView[];
  recent: RecentPlayerView[];
  /** This Account's own add-code — `null` until it loads. */
  code: string | null;
  /** Account ids ADDed from RECENT this session — their rows read SENT, never ADD again. */
  requestedIds: string[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
  sendRequest: (to: { code?: string; accountId?: string }) => Promise<void>;
  acceptRequest: (id: string) => Promise<{ displayName: string }>;
  declineRequest: (id: string) => Promise<void>;
  acceptAll: () => Promise<number>;
  unfriend: (accountId: string) => Promise<boolean>;
  invite: (accountId: string, lobby: LobbyRef) => Promise<void>;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/**
 * The Friends screen's (and the Main Menu's badge's) data — one cached
 * `["friends","overview"]` query both residents share, so the menu badge and
 * the screen never fetch the roster twice. The overview re-polls for live
 * presence. Presence beats and Lobby invites are the Account socket's (ADR
 * 0112, `lib/social/accountSocket.ts`) — one owner, never every Screen that
 * mounts this.
 */
export const useFriends = (): UseFriends => {
  const queryClient = useQueryClient();
  const [requestedIds, setRequestedIds] = useState<string[]>([]);

  const overview = useQuery({
    queryKey: ["friends", "overview"],
    queryFn: getFriendsOverview,
    refetchInterval: OVERVIEW_POLL_MS,
  });
  const recent = useQuery({
    queryKey: ["friends", "recent"],
    queryFn: async () => (await getRecentPlayers()).recent,
    staleTime: 60_000,
  });
  const code = useQuery({
    queryKey: ["friends", "code"],
    queryFn: async () => (await getOwnFriendCode()).code,
    staleTime: Infinity,
  });

  const invalidateOverview = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["friends", "overview"] });
  };

  const error = overview.error ?? recent.error ?? code.error;

  return {
    friends: overview.data?.friends ?? [],
    online: overview.data?.online ?? 0,
    total: overview.data?.total ?? 0,
    requests: overview.data?.requests ?? [],
    recent: recent.data ?? [],
    code: code.data ?? null,
    requestedIds,
    isLoading: overview.isLoading || recent.isLoading || code.isLoading,
    error: error ? messageOf(error, "Could not load friends.") : null,
    retry: () => {
      void overview.refetch();
      void recent.refetch();
      void code.refetch();
    },
    sendRequest: async (to) => {
      const requestedAccountId = to.accountId;
      await sendFriendRequest(to);
      if (requestedAccountId !== undefined) setRequestedIds((prev) => [...prev, requestedAccountId]);
      await invalidateOverview();
    },
    acceptRequest: async (id) => {
      const { friend } = await acceptFriendRequest(id);
      await invalidateOverview();
      return { displayName: friend.displayName };
    },
    declineRequest: async (id) => {
      await declineFriendRequest(id);
      await invalidateOverview();
    },
    acceptAll: async () => {
      const { accepted } = await acceptAllFriendRequests();
      await invalidateOverview();
      return accepted;
    },
    unfriend: async (accountId) => {
      const { removed } = await removeFriend(accountId);
      await invalidateOverview();
      return removed;
    },
    invite: (accountId, lobby) => sendLobbyInvite({ accountId, lobby }).then(() => undefined),
  };
};

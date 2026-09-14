import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendRequestView, FriendView, LobbyInviteView, LobbyRef, RecentPlayerView } from "@dont-fall/shared";
import {
  acceptAllFriendRequests,
  acceptFriendRequest,
  declineFriendRequest,
  getFriendsOverview,
  getOwnFriendCode,
  getRecentPlayers,
  postHeartbeat,
  removeFriend,
  sendFriendRequest,
  sendLobbyInvite,
} from "../api/friends.js";

/** Presence goes stale fast — the roster re-polls twice per heartbeat. */
const OVERVIEW_POLL_MS = 15_000;
/** The beat the server's online window (90 s) is measured against. */
const HEARTBEAT_MS = 30_000;

export interface UseFriends {
  friends: FriendView[];
  online: number;
  total: number;
  requests: FriendRequestView[];
  recent: RecentPlayerView[];
  /** This Account's own add-code — `null` until it loads. */
  code: string | null;
  /** Lobby invites arrived this session and not yet dismissed. */
  invites: LobbyInviteView[];
  dismissInvite: (id: string) => void;
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
 * presence; the heartbeat runs its own 30 s cadence and is the only way
 * Lobby invites arrive.
 */
export const useFriends = (): UseFriends => {
  const queryClient = useQueryClient();
  const [invites, setInvites] = useState<LobbyInviteView[]>([]);
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

  const { mutate: beat } = useMutation({
    mutationFn: postHeartbeat,
    onSuccess: (data) =>
      setInvites((prev) => {
        const known = new Set(prev.map((invite) => invite.id));
        return [...prev, ...(data.invites ?? []).filter((invite) => !known.has(invite.id))];
      }),
  });

  useEffect(() => {
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [beat]);

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
    invites,
    dismissInvite: (id) => setInvites((prev) => prev.filter((invite) => invite.id !== id)),
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

import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { LobbyInviteView, LobbyRef } from "@dont-fall/shared";
import { lobbyPath, resolveLobbyRef } from "../lib/api/lobbyBroker.js";
import { useFriends } from "../lib/hooks/useFriends.js";
import { skinForPlayerId } from "../lib/avatarSkins.js";
import { recentNote, requestNote, tabOf, toFriendRow } from "../lib/friendsView.js";
import FriendAlerts from "./FriendAlerts.js";
import Friends from "./Friends.js";

/**
 * `/friends` — the roster, requests, and recent co-players (M9 ticket 12),
 * reached from the Main Menu. JOIN resolves the friend's Lobby ref through
 * the broker and lands on `/lobby?port=` like any other join. INVITE needs a
 * Lobby to invite to: the Lobby screen passes its own ref in navigation
 * state when it links here — standalone, the buttons say to join one first
 * instead of failing.
 */
export function FriendsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const friends = useFriends();
  const [notice, setNotice] = useState<string | null>(null);

  const lobbyRef = (location.state as { lobbyRef?: LobbyRef } | null)?.lobbyRef ?? null;

  const rows = useMemo(() => {
    const now = Date.now();
    const friendIds = new Set(friends.friends.map((f) => f.accountId));
    return {
      requests: friends.requests.map((request) => ({
        id: request.id,
        name: request.fromDisplayName,
        skin: skinForPlayerId(request.fromAccountId),
        note: requestNote(request.matchesTogether),
      })),
      friends: friends.friends.map((friend) => {
        const row = toFriendRow(friend, now);
        return {
          accountId: row.accountId,
          name: row.displayName,
          skin: skinForPlayerId(row.accountId),
          status: row.status,
          tab: tabOf(friend),
          ...(row.joinable ? { joinable: true as const } : {}),
          ...(row.busy ? { busy: true as const } : {}),
          ...(row.offline ? { offline: true as const } : {}),
        };
      }),
      recent: friends.recent.map((player) => ({
        accountId: player.accountId,
        name: player.displayName,
        skin: skinForPlayerId(player.accountId),
        note: recentNote(player, now),
        requested: friendIds.has(player.accountId) || friends.requestedIds.includes(player.accountId),
      })),
    };
  }, [friends.friends, friends.requests, friends.recent, friends.requestedIds]);

  const fail = (err: unknown, fallback: string): void => {
    setNotice(err instanceof Error ? err.message : fallback);
  };

  const joinRef = async (ref: LobbyRef): Promise<void> => {
    try {
      navigate(lobbyPath(await resolveLobbyRef(ref)));
    } catch (err) {
      fail(err, "Could not join that Lobby.");
    }
  };

  const joinFriend = (accountId: string): void => {
    const ref = friends.friends.find((friend) => friend.accountId === accountId)?.presence.lobby;
    if (!ref) {
      setNotice("They left that Lobby — the roster refreshes every 15 seconds.");
      return;
    }
    void joinRef(ref);
  };

  const joinInvite = (invite: LobbyInviteView): void => {
    friends.dismissInvite(invite.id);
    void joinRef(invite.lobby);
  };

  const inviteFriend = (accountId: string): void => {
    if (!lobbyRef) {
      setNotice("Join a Lobby first — invites need somewhere to go.");
      return;
    }
    friends.invite(accountId, lobbyRef).then(
      () => setNotice("Invite sent."),
      (err: unknown) => fail(err, "Could not send that invite."),
    );
  };

  const inviteAll = (): void => {
    if (!lobbyRef) {
      setNotice("Join a Lobby first — invites need somewhere to go.");
      return;
    }
    const targets = friends.friends.filter(
      (friend) => friend.presence.status !== "offline" && friend.presence.status !== "in-match",
    );
    if (targets.length === 0) {
      setNotice("Nobody online to invite.");
      return;
    }
    void Promise.allSettled(targets.map((target) => friends.invite(target.accountId, lobbyRef))).then(
      (results) => {
        const sent = results.filter((result) => result.status === "fulfilled").length;
        setNotice(sent === targets.length ? `Invited ${sent}.` : `Invited ${sent} of ${targets.length}.`);
      },
    );
  };

  return (
    <>
      <Friends
        online={friends.online}
        total={friends.total}
        requests={rows.requests}
        friends={rows.friends}
        recent={rows.recent}
        ownCode={friends.code}
        notice={notice}
        isLoading={friends.isLoading}
        error={friends.error}
        onBack={() => navigate("/")}
        onInviteAll={inviteAll}
        onAccept={(id) => friends.acceptRequest(id).then(
          ({ displayName }) => setNotice(`${displayName} is now your friend.`),
          (err: unknown) => fail(err, "Could not accept that request."),
        )}
        onDecline={(id) => friends.declineRequest(id).then(
          () => undefined,
          (err: unknown) => fail(err, "Could not decline that request."),
        )}
        onAcceptAll={() => friends.acceptAll().then(
          (accepted) => setNotice(accepted === 1 ? "Accepted 1 request." : `Accepted ${accepted} requests.`),
          (err: unknown) => fail(err, "Could not accept those requests."),
        )}
        onJoin={joinFriend}
        onInvite={inviteFriend}
        onRemove={(accountId) => friends.unfriend(accountId).then(
          () => undefined,
          (err: unknown) => fail(err, "Could not remove that friend."),
        )}
        onAddByCode={(code) => friends.sendRequest({ code }).then(() => setNotice("Request sent."))}
        onAddRecent={(accountId) => friends.sendRequest({ accountId }).then(
          () => undefined,
          (err: unknown) => fail(err, "Could not send that request."),
        )}
        onRetry={friends.retry}
        onDismissNotice={() => setNotice(null)}
      />
      <FriendAlerts
        requests={[]}
        invites={friends.invites}
        onAccept={(id) => friends.acceptRequest(id).then(
          () => undefined,
          (err: unknown) => fail(err, "Could not accept that request."),
        )}
        onDecline={(id) => friends.declineRequest(id).then(
          () => undefined,
          (err: unknown) => fail(err, "Could not decline that request."),
        )}
        onJoinInvite={joinInvite}
        onDismissInvite={friends.dismissInvite}
      />
    </>
  );
}

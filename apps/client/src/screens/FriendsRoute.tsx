import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import type { LobbyRef } from "@dont-fall/shared";
import { lobbyPath, resolveLobbyRef } from "../lib/api/lobbyBroker.js";
import { flash } from "../lib/flash.js";
import { useFriends } from "../lib/hooks/useFriends.js";
import { avatarLook } from "../lib/avatar.js";
import { recentNote, requestNote, tabOf, toFriendRow } from "../lib/friendsView.js";
import Friends from "./Friends.js";

/**
 * `/friends` — the roster, requests, and recent co-players (M9 ticket 12),
 * reached from the Main Menu. JOIN resolves the friend's Lobby ref through
 * the broker and lands on `/lobby?port=` like any other join. INVITE needs a
 * Lobby to invite to: the Lobby screen passes its own ref in navigation
 * state when it links here — standalone, the buttons say to join one first
 * instead of failing.
 *
 * Every confirmation and failure here is a flash message on the global
 * stack — the Screen itself carries no notice line. Lobby invites overlay
 * from `<GlobalAlerts>` (which also suppresses its request toasts on this
 * route, since the requests render inline below).
 */
export function FriendsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const lobbyRef = (location.state as { lobbyRef?: LobbyRef } | null)?.lobbyRef ?? null;
  return <FriendsPanel lobbyRef={lobbyRef} onBack={() => navigate("/")} />;
}

/**
 * The Friends screen with its handlers — the route's, and the Lobby's own
 * INVITE FRIENDS (ADR 0110), which opens it in place with its Lobby to invite
 * to: leaving the Lobby's route would close its socket. Every invite reports
 * on the flash stack either way.
 */
export function FriendsPanel({ lobbyRef, onBack }: { lobbyRef: LobbyRef | null; onBack: () => void }) {
  const navigate = useNavigate();
  const friends = useFriends();

  const rows = useMemo(() => {
    const now = Date.now();
    const friendIds = new Set(friends.friends.map((f) => f.accountId));
    return {
      requests: friends.requests.map((request) => ({
        id: request.id,
        name: request.fromDisplayName,
        look: avatarLook(request.fromAccountId, request.fromColor),
        note: requestNote(request.matchesTogether),
      })),
      friends: friends.friends.map((friend) => {
        const row = toFriendRow(friend, now);
        return {
          accountId: row.accountId,
          name: row.displayName,
          look: avatarLook(friend.accountId, friend.color),
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
        look: avatarLook(player.accountId, player.color),
        note: recentNote(player, now),
        requested: friendIds.has(player.accountId) || friends.requestedIds.includes(player.accountId),
      })),
    };
  }, [friends.friends, friends.requests, friends.recent, friends.requestedIds]);

  const fail = (err: unknown, fallback: string): void => {
    flash(err instanceof Error ? err.message : fallback, "error");
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
      flash("They left that Lobby — the roster refreshes every 15 seconds.", "info");
      return;
    }
    void joinRef(ref);
  };

  const inviteFriend = (accountId: string): void => {
    if (!lobbyRef) {
      flash("Join a Lobby first — invites need somewhere to go.", "info");
      return;
    }
    friends.invite(accountId, lobbyRef).then(
      () => flash("Invite sent."),
      (err: unknown) => fail(err, "Could not send that invite."),
    );
  };

  const inviteAll = (): void => {
    if (!lobbyRef) {
      flash("Join a Lobby first — invites need somewhere to go.", "info");
      return;
    }
    const targets = friends.friends.filter(
      (friend) => friend.presence.status !== "offline" && friend.presence.status !== "in-match",
    );
    if (targets.length === 0) {
      flash("Nobody online to invite.", "info");
      return;
    }
    void Promise.allSettled(targets.map((target) => friends.invite(target.accountId, lobbyRef))).then(
      (results) => {
        const sent = results.filter((result) => result.status === "fulfilled").length;
        flash(sent === targets.length ? `Invited ${sent}.` : `Invited ${sent} of ${targets.length}.`);
      },
    );
  };

  return (
    <Friends
      online={friends.online}
      total={friends.total}
      requests={rows.requests}
      friends={rows.friends}
      recent={rows.recent}
      ownCode={friends.code}
      isLoading={friends.isLoading}
      error={friends.error}
      onBack={onBack}
      onInviteAll={inviteAll}
      onAccept={(id) => friends.acceptRequest(id).then(
        ({ displayName }) => flash(`${displayName} is now your friend.`),
        (err: unknown) => fail(err, "Could not accept that request."),
      )}
      onDecline={(id) => friends.declineRequest(id).then(
        () => undefined,
        (err: unknown) => fail(err, "Could not decline that request."),
      )}
      onAcceptAll={() => friends.acceptAll().then(
        (accepted) => flash(accepted === 1 ? "Accepted 1 request." : `Accepted ${accepted} requests.`),
        (err: unknown) => fail(err, "Could not accept those requests."),
      )}
      onJoin={joinFriend}
      onInvite={inviteFriend}
      onRemove={(accountId) => friends.unfriend(accountId).then(
        () => undefined,
        (err: unknown) => fail(err, "Could not remove that friend."),
      )}
      onAddByCode={(code) => friends.sendRequest({ code }).then(() => {
        flash("Request sent.");
      })}
      onAddRecent={(accountId) => friends.sendRequest({ accountId }).then(
        () => undefined,
        (err: unknown) => fail(err, "Could not send that request."),
      )}
      onRetry={friends.retry}
    />
  );
}

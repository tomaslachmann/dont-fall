import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import type { LobbyRef } from "@dont-fall/shared";
import { lobbyPath, resolveLobbyRef } from "../lib/api/lobbyBroker.js";
import { inviteToParty } from "../lib/api/party.js";
import { flash } from "../lib/flash.js";
import { useFriends } from "../lib/hooks/useFriends.js";
import { avatarLook } from "../lib/avatar.js";
import { recentNote, requestNote, tabOf, toFriendRow } from "../lib/friendsView.js";
import Friends from "./Friends.js";

/**
 * `/friends` — the roster, requests, and recent co-players (M9 ticket 12),
 * reached from the Main Menu. JOIN resolves the friend's Lobby ref through
 * the broker and lands on `/lobby?port=` like any other join. INVITE sends
 * whichever invite the Screen was opened for: the Lobby screen passes its own
 * ref in navigation state when it links here, so its INVITE is a Lobby
 * invite — and from the menu, with no ref, it is a Party invite, which is how
 * a lone bean starts a Party (ADR 0112).
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
 *
 * `lobbyRef` decides which invite INVITE and INVITE ALL ONLINE send: a Lobby
 * one with a Lobby to send it to, a Party one without (ADR 0112).
 */
export function FriendsPanel({ lobbyRef, onBack }: { lobbyRef: LobbyRef | null; onBack: () => void }) {
  const navigate = useNavigate();
  const friends = useFriends();
  /** No Lobby to invite to: these buttons start a Party instead (ADR 0112). */
  const toParty = lobbyRef === null;

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
          // `busy` means "cannot be invited", and mid-Match is only that for a
          // Lobby invite. A bean still in a Match can be pulled into a Party —
          // IN A MATCH · CAN STILL JOIN (ADR 0112) — so on that path the row
          // is not busy, and INVITE ALL ONLINE takes them too. The IN A MATCH
          // tab they sit under already says where they are.
          ...(row.busy && !toParty ? { busy: true as const } : {}),
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
  }, [friends.friends, friends.requests, friends.recent, friends.requestedIds, toParty]);

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

  /**
   * One invite to one bean, of whichever kind this Screen was opened for. The
   * API owns every refusal a Party invite can meet (not the host, the Party
   * full, the bean busy, offline or already invited), so its own reason is
   * what the flash says — this Screen guesses at none of them.
   */
  const inviteOne = (accountId: string): Promise<unknown> =>
    lobbyRef === null ? inviteToParty(accountId) : friends.invite(accountId, lobbyRef);

  const inviteFriend = (accountId: string): void => {
    void inviteOne(accountId).then(
      () => flash("Invite sent."),
      (err: unknown) => fail(err, "Could not send that invite."),
    );
  };

  const inviteAll = (): void => {
    const targets = friends.friends.filter(
      (friend) =>
        friend.presence.status !== "offline" &&
        // A Lobby invite has nowhere to put a bean mid-Match; a Party one does (ADR 0112).
        (toParty || friend.presence.status !== "in-match"),
    );
    if (targets.length === 0) {
      flash("Nobody online to invite.", "info");
      return;
    }
    void Promise.allSettled(targets.map((target) => inviteOne(target.accountId))).then(
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

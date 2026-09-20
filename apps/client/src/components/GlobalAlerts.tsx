import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import type { LobbyInviteView, PartyInviteView } from "@dont-fall/shared";
import { ApiError } from "../lib/api/base.js";
import { lobbyPath, resolveLobbyRef } from "../lib/api/lobbyBroker.js";
import { acceptPartyInvite, declinePartyInvite } from "../lib/api/party.js";
import { avatarLook, NO_AVATAR } from "../lib/avatar.js";
import { flash } from "../lib/flash.js";
import { getGameActiveSnapshot, subscribeGameActive } from "../lib/gamePresence.js";
import { useFriends } from "../lib/hooks/useFriends.js";
import { onAccountSocketEvent, useSocialInbox } from "../lib/social/accountSocket.js";
import FlashHost from "../ui/FlashHost.js";
import FriendAlerts, { type PartyRemoval } from "../screens/FriendAlerts.js";

/**
 * The shell's global overlay stack (mounted once by `<AuthGate>`, above the
 * authed routes): flash messages on every route, plus the live social
 * toasts — one per pending friend request (answerable in place), one per
 * Lobby invite (JOIN or dismiss), one per Party invite (JOIN or decline), and
 * the Party mock's toast when the Party host removed you (ADR 0112).
 *
 * Invites arrive over the Account socket (`useSocialInbox`) and are sticky:
 * they never fade on their own and survive navigation — each leaves only when
 * the Player answers it, or while their game runs (the toasts hide while a
 * Match owns the screen — practice boots leave them up — while flashes keep
 * showing). On `/friends` the requests stay inline on the Screen, so only
 * invites overlay there.
 *
 * It is also where the Account socket's acts land (ADR 0112): `follow` takes
 * the Player into the Lobby their Party host just entered, `left` brings
 * them back to the menu when the host walked out of it, and a replaced
 * socket says this tab went quiet. Those run whether or not a game owns the
 * screen — only the toasts step aside for it.
 */
export default function GlobalAlerts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const friends = useFriends();
  const inbox = useSocialInbox();
  const gameActive = useSyncExternalStore(subscribeGameActive, getGameActiveSnapshot, getGameActiveSnapshot);
  const [removal, setRemoval] = useState<PartyRemoval | null>(null);

  // The socket's acts arrive outside any render — they read the route as it
  // is when they land, and subscribe once.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  useEffect(
    () =>
      onAccountSocketEvent((event) => {
        switch (event.type) {
          case "follow":
            flash(`Following ${event.hostDisplayName} into their Lobby.`, "info");
            navigateRef.current(lobbyPath({ ...event.lobby, reservation: event.reservation }));
            return;
          case "left":
            flash(`${event.hostDisplayName} left the Lobby.`, "info");
            // Only a Player still in that Lobby goes back — one already in the
            // menus stays on whatever Screen they are on.
            if (pathnameRef.current === "/lobby") navigateRef.current("/");
            return;
          case "removed":
            setRemoval({
              byName: event.byDisplayName,
              look: event.by === null ? NO_AVATAR : avatarLook(event.by.accountId, event.by.color, event.by.avatarUploadedAt),
            });
            return;
          case "replaced":
            flash("The game is open in another tab — this one stopped hearing from your party.", "error");
            return;
        }
      }),
    [],
  );

  const fail = (err: unknown, fallback: string): void => {
    flash(err instanceof Error ? err.message : fallback, "error");
  };

  const joinInvite = (invite: LobbyInviteView): void => {
    // Dismissed only once the Lobby actually resolves — a failed JOIN keeps
    // the invite up (no game started, nothing was answered) and flashes why.
    resolveLobbyRef(invite.lobby).then(
      (lobby) => {
        inbox.dismissLobbyInvite(invite.id);
        navigate(lobbyPath(lobby));
      },
      (err: unknown) => fail(err, "Could not join that Lobby."),
    );
  };

  const joinParty = (invite: PartyInviteView): void => {
    // As a Lobby invite's JOIN: gone only once it worked. The Party itself
    // arrives over the socket, and a `follow` with it when the host sits in a
    // Lobby with room.
    acceptPartyInvite(invite.id).then(
      () => {
        inbox.dismissPartyInvite(invite.id);
        flash(`You're in ${invite.fromDisplayName}'s party.`);
      },
      (err: unknown) => fail(err, "Could not join that party."),
    );
  };

  const declineParty = (invite: PartyInviteView): void => {
    inbox.dismissPartyInvite(invite.id);
    declinePartyInvite(invite.id).catch((err: unknown) => {
      // Already gone (expired, cancelled) is what declining wanted anyway.
      if (!(err instanceof ApiError && err.status === 404)) fail(err, "Could not decline that invite.");
    });
  };

  return (
    <>
      <FlashHost />
      {!gameActive && (
        <FriendAlerts
          requests={pathname === "/friends" ? [] : friends.requests}
          invites={inbox.lobbyInvites}
          partyInvites={inbox.partyInvites}
          removal={removal}
          onAccept={(id) =>
            friends.acceptRequest(id).then(
              ({ displayName }) => flash(`${displayName} is now your friend.`),
              (err: unknown) => fail(err, "Could not accept that request."),
            )
          }
          onDecline={(id) =>
            friends.declineRequest(id).then(
              () => undefined,
              (err: unknown) => fail(err, "Could not decline that request."),
            )
          }
          onJoinInvite={joinInvite}
          onDismissInvite={inbox.dismissLobbyInvite}
          onJoinPartyInvite={joinParty}
          onDeclinePartyInvite={declineParty}
          onDismissRemoval={() => setRemoval(null)}
        />
      )}
    </>
  );
}

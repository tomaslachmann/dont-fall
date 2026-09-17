import { useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import type { LobbyInviteView } from "@dont-fall/shared";
import { lobbyPath, resolveLobbyRef } from "../lib/api/lobbyBroker.js";
import { flash } from "../lib/flash.js";
import { getGameActiveSnapshot, subscribeGameActive } from "../lib/gamePresence.js";
import { useFriends } from "../lib/hooks/useFriends.js";
import FlashHost from "../ui/FlashHost.js";
import FriendAlerts from "../screens/FriendAlerts.js";

/**
 * The shell's global overlay stack (mounted once by `<AuthGate>`, above the
 * authed routes): flash messages on every route, plus the live friend
 * toasts — one per pending request (answerable in place) and one per Lobby
 * invite (JOIN or dismiss).
 *
 * A Lobby invite is sticky: it never fades on its own and survives
 * navigation — it leaves only when the Player JOINS or dismisses it, or
 * when their game starts (the alerts hide while a Match owns the screen —
 * practice boots leave them up — while flashes keep showing). On
 * `/friends` the requests stay inline on the Screen, so only invites
 * overlay there.
 */
export default function GlobalAlerts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const friends = useFriends();
  const gameActive = useSyncExternalStore(subscribeGameActive, getGameActiveSnapshot, getGameActiveSnapshot);

  const fail = (err: unknown, fallback: string): void => {
    flash(err instanceof Error ? err.message : fallback, "error");
  };

  const joinInvite = (invite: LobbyInviteView): void => {
    // Dismissed only once the Lobby actually resolves — a failed JOIN keeps
    // the invite up (no game started, nothing was answered) and flashes why.
    resolveLobbyRef(invite.lobby).then(
      (lobby) => {
        friends.dismissInvite(invite.id);
        navigate(lobbyPath(lobby));
      },
      (err: unknown) => fail(err, "Could not join that Lobby."),
    );
  };

  return (
    <>
      <FlashHost />
      {!gameActive && (
        <FriendAlerts
          requests={pathname === "/friends" ? [] : friends.requests}
          invites={friends.invites}
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
          onDismissInvite={friends.dismissInvite}
        />
      )}
    </>
  );
}

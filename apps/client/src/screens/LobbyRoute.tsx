import { Navigate, useNavigate, useSearchParams } from "react-router";
import type { LobbyRef } from "@dont-fall/shared";
import { GameCanvas } from "../components/GameCanvas.js";
import { ConnectionError } from "../lib/errors.js";
import { useLobbyConnection } from "../lib/hooks/useLobbyConnection.js";
import { useMatchMusic } from "../lib/hooks/useMatchMusic.js";
import { useLobbyPresence } from "../lib/social/place.js";
import { parseLobbyParams } from "../lib/utils/routeParams.js";
import Lobby from "./Lobby.js";
import { LoadingScreen } from "./LoadingScreen.js";

/**
 * `/lobby` — one shell-owned socket for the whole visit (ADR 0056). While
 * the Match is still in LOBBY the route renders the Lobby Screen directly —
 * no game boots for a roster, a Ready switch and a Track pick. The moment
 * the server leaves LOBBY, the same live connection hands over to
 * `<GameCanvas>`, which attaches its snapshot/sim feed to it instead of
 * dialing a second socket (a second socket would rejoin as a stranger: new
 * id, lost Ready, lost host).
 *
 * `?reservation=` is the seat the broker kept (ADR 0112); the socket carries
 * it to the Match server, which uses it up — a reload afterwards connects as
 * an ordinary join.
 */
export function LobbyRoute() {
  const [searchParams] = useSearchParams();
  const { port, code, id, reservation } = parseLobbyParams(searchParams);
  // With no `?port=` there is no Lobby to connect to — back to `/play` to
  // pick a way in rather than guessing at one.
  if (port === undefined) return <Navigate to="/play" replace />;
  // Where an invite sends a friend (ADR 0110): a private Lobby by its code, a
  // public one by the broker's id.
  const inviteRef: LobbyRef | undefined =
    code !== undefined ? { kind: "private", code } : id !== undefined ? { kind: "public", lobbyId: id } : undefined;
  return (
    <BrokeredLobby
      serverPort={port}
      {...(code === undefined ? {} : { code })}
      {...(inviteRef === undefined ? {} : { inviteRef })}
      {...(reservation === undefined ? {} : { reservation })}
    />
  );
}

function BrokeredLobby({
  serverPort,
  code,
  inviteRef,
  reservation,
}: {
  serverPort: number;
  code?: string;
  inviteRef?: LobbyRef;
  reservation?: string;
}) {
  const navigate = useNavigate();
  const { connection, lobby, actions, error, closed } = useLobbyConnection(
    serverPort,
    reservation === undefined ? {} : { reservation },
  );
  // The music follows the Match for the whole visit (M14 ticket 11), Lobby and game alike.
  useMatchMusic(lobby?.phase ?? null);
  // Where this client is, for its Party (ADR 0112): in this Lobby, then in its
  // Match once it leaves LOBBY — until this route unmounts.
  useLobbyPresence(serverPort, lobby?.phase ?? null);

  // Expected connectivity failures go to the app-wide boundary — one
  // ErrorScreen for the whole app, not one per component. A refused welcome
  // or a dropped socket throws a ConnectionError during render (the only
  // thing a boundary can catch); the boundary renders the connection kind,
  // and its TRY AGAIN remounts this route for a fresh handshake. No
  // auto-retry countdown: redialing a dead lobby on a timer is the lobby
  // tick lesson all over again — the Player asks for it explicitly.
  // The server's own reason when it gave one — "server is full", a Track that
  // would not load, or this Account taking its seat somewhere else (ADR 0090).
  if (error !== null || closed !== null) {
    // An ordinary drop carries no reason at all (an empty string), and gets
    // the generic line.
    throw new ConnectionError(error?.message ?? (closed?.reason || "The connection dropped."));
  }

  const onHome = () => navigate("/");
  if (connection !== null && lobby !== null && lobby.phase !== "LOBBY") {
    return <GameCanvas connection={connection} lobbyAtHandover={lobby} onExit={onHome} onMatchEnd={onHome} />;
  }

  if (lobby !== null) {
    return (
      <Lobby
        lobby={lobby}
        {...(code === undefined ? {} : { code })}
        {...(inviteRef === undefined ? {} : { inviteRef })}
        onSetReady={actions.setReady}
        onSelectTrack={actions.selectTrack}
        onSetRoundType={actions.setRoundType}
        onSetMatchLength={actions.setMatchLength}
        onPickRoundSlot={actions.pickRoundSlot}
        onSetBots={actions.setBots}
        onStart={actions.start}
      />
    );
  }

  return <LoadingScreen label="CONNECTING TO THE LOBBY…" />;
}

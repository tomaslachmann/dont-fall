import { Navigate, useNavigate, useSearchParams } from "react-router";
import { GameCanvas } from "../components/GameCanvas.js";
import { ConnectionError } from "../lib/errors.js";
import { useLobbyConnection } from "../lib/hooks/useLobbyConnection.js";
import { useMatchMusic } from "../lib/hooks/useMatchMusic.js";
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
 */
export function LobbyRoute() {
  const [searchParams] = useSearchParams();
  const { port, code } = parseLobbyParams(searchParams);
  // With no `?port=` there is no Lobby to connect to — back to `/play` to
  // pick a way in rather than guessing at one.
  if (port === undefined) return <Navigate to="/play" replace />;
  return <BrokeredLobby serverPort={port} {...(code === undefined ? {} : { code })} />;
}

function BrokeredLobby({ serverPort, code }: { serverPort: number; code?: string }) {
  const navigate = useNavigate();
  const { connection, lobby, actions, error, closed } = useLobbyConnection(serverPort);
  // The music follows the Match for the whole visit (M14 ticket 11), Lobby and game alike.
  useMatchMusic(lobby?.phase ?? null);

  // Expected connectivity failures go to the app-wide boundary — one
  // ErrorScreen for the whole app, not one per component. A refused welcome
  // or a dropped socket throws a ConnectionError during render (the only
  // thing a boundary can catch); the boundary renders the connection kind,
  // and its TRY AGAIN remounts this route for a fresh handshake. No
  // auto-retry countdown: redialing a dead lobby on a timer is the lobby
  // tick lesson all over again — the Player asks for it explicitly.
  if (error !== null || closed) throw new ConnectionError(error?.message ?? "The connection dropped.");

  const onHome = () => navigate("/");
  if (connection !== null && lobby !== null && lobby.phase !== "LOBBY") {
    return <GameCanvas connection={connection} onExit={onHome} onMatchEnd={onHome} />;
  }

  if (lobby !== null) {
    return (
      <Lobby
        lobby={lobby}
        {...(code === undefined ? {} : { code })}
        onSetNickname={actions.setNickname}
        onSetReady={actions.setReady}
        onSelectTrack={actions.selectTrack}
        onSetRoundType={actions.setRoundType}
        onSetMatchLength={actions.setMatchLength}
        onPickRoundSlot={actions.pickRoundSlot}
        onStart={actions.start}
      />
    );
  }

  return <LoadingScreen label="Connecting to the Lobby…" />;
}

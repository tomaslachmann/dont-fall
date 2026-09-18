import { useEffect, useMemo, useRef, useState } from "react";
import {
  createLobbyConnection,
  type LobbyActions,
  type LobbyConnection,
  type LobbySnapshot,
  type SocketClose,
} from "../socket/lobbyConnection.js";

export interface LobbyConnectionState {
  /**
   * The live connection, or `null` while it is still being established (or
   * when establishing it failed — see `error`). Identity is stable per
   * `serverPort`: handing it to `<GameCanvas>` never reboots the game over
   * an identity change.
   */
  connection: LobbyConnection | null;
  /** Latest Lobby content, or `null` before the first snapshot arrives. */
  lobby: LobbySnapshot | null;
  /**
   * The connection's actions behind a stable identity (a fresh closure every
   * render would re-fire every Screen effect that lists one as a
   * dependency). Delegates to whatever connection is current; a no-op until
   * one is.
   */
  actions: LobbyActions;
  /** Establishing the connection failed (unreachable broker port, refused welcome). */
  error: Error | null;
  /** The socket dropped after connecting. M2 does not reconnect (ADR 0011) — the route goes back. */
  /** Why the socket closed, when it has — carries the server's own reason (ADR 0090). `null` while it is open. */
  closed: SocketClose | null;
}

/**
 * Owns one Match-server socket for a React route (ADR 0056): connects on
 * mount, publishes Lobby snapshots as state, closes on unmount. StrictMode's
 * dev-only double mount is safe — the first effect's cleanup closes the
 * still-connecting socket before the second one dials.
 */
export const useLobbyConnection = (serverPort: number, host?: string): LobbyConnectionState => {
  const [connection, setConnection] = useState<LobbyConnection | null>(null);
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [closed, setClosed] = useState<SocketClose | null>(null);
  const connectionRef = useRef<LobbyConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    let conn: LobbyConnection | null = null;
    const stops: (() => void)[] = [];
    setConnection(null);
    setLobby(null);
    setError(null);
    setClosed(null);
    connectionRef.current = null;

    createLobbyConnection({ ...(host === undefined ? {} : { host }), serverPort })
      .then((created) => {
        if (cancelled) {
          created.close(); // unmounted while connecting — leave nothing behind
          return;
        }
        conn = created;
        connectionRef.current = created;
        setConnection(created);
        stops.push(
          created.subscribeLobby((next) => {
            if (!cancelled) setLobby(next);
          }),
          created.onClose((why) => {
            if (!cancelled) setClosed(why);
          }),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      for (const stop of stops) stop();
      conn?.close();
      if (connectionRef.current === conn) connectionRef.current = null;
    };
  }, [serverPort, host]);

  const actions = useMemo<LobbyActions>(
    () => ({
      setReady: (ready) => connectionRef.current?.setReady(ready),
      selectTrack: (trackId) => connectionRef.current?.selectTrack(trackId),
      setRoundType: (roundType) => connectionRef.current?.setRoundType(roundType),
      setMatchLength: (matchLength) => connectionRef.current?.setMatchLength(matchLength),
      pickRoundSlot: (roundIndex, trackId, roundType) =>
        connectionRef.current?.pickRoundSlot(roundIndex, trackId, roundType),
      start: () => connectionRef.current?.start(),
      standingsReady: () => connectionRef.current?.standingsReady(),
    }),
    [],
  );

  return { connection, lobby, actions, error, closed };
};

import type {
  ClientMessage,
  LobbyPlayer,
  MatchPhase,
  RoundType,
  ServerMessage,
  SnapshotMessage,
  WelcomeMessage,
} from "@dont-fall/shared";
import { awaitWelcome, resolveEndpoints } from "./connection.js";
import { listen } from "./listeners.js";
import { getStoredToken } from "../api/base.js";

/**
 * The Lobby as the server currently reports it (ADR 0040) — rendered, never
 * computed. Canonical home (ADR 0056): this module owns the Match-server
 * socket for the shell, so a pure React Screen can live on a Lobby without
 * booting the game. `game/index.ts` only borrows the socket/welcome from
 * here once the Match itself starts.
 */
export interface LobbySnapshot {
  myId: string;
  /**
   * Which Match this is (ticket 14) — straight off the snapshot, so the
   * Spectator panel can key its betting pool by `(matchId, round)` without
   * a second handshake to learn the Match's name.
   */
  matchId: string;
  phase: MatchPhase;
  /**
   * Set once the Match is over AND its results are persisted (ADR 0059) —
   * `null` in every other state. The game navigates to the results page on
   * this and unmounts; the server closes itself once everyone has left.
   */
  matchOver: { matchId: string } | null;
  /**
   * ms left on the server's synchronous Countdown (M4 ticket 04, ADR 0040) —
   * what the Countdown overlay counts down from. Rendered straight off the
   * snapshot, never a local clock: the server re-sends it every snapshot
   * while `phase` is COUNTDOWN, so the overlay's beat can never drift from
   * the Round's real start.
   */
  countdownMsLeft: number;
  hostId: string | undefined;
  players: LobbyPlayer[];
  trackId: string;
  /**
   * Ids whose client has this Round's Track built (ADR 0089) — what the
   * loading Screen counts while LOADING holds the Round.
   */
  loaded: string[];
  trackRevision: number;
  /**
   * The currently-loaded Track's Time Limit (ADR 0038: "the Lobby only ever
   * reads" it) — this IS `SnapshotMessage.timeLeftMs`, which already holds at
   * the full clock until the Round is RUNNING, so it needs no separate
   * "authored Time Limit" field of its own.
   */
  timeLimitMs: number;
  /**
   * The Round type this Lobby will start, and how many survivors a Survival
   * Round here would run to (M5 ticket 07) — both shown before the start, so
   * nobody learns what kind of Round they're in by falling into it.
   *
   * `survivorTarget` is the Track's own authored default under whatever this
   * Match overrides (it is read straight off the snapshot's `roundRules`,
   * the same resolved record the simulation runs by) — never re-derived
   * here, and meaningless while `roundType` is `"race"`.
   */
  roundType: RoundType;
  survivorTarget: number;
  /**
   * Why the host can't start on this Track, in words to show, or `undefined`
   * when they can (M5 ticket 07). The server's own answer, rendered — the
   * client never computes a second opinion about a gate it doesn't enforce.
   */
  startBlockedReason: string | undefined;
  /** How many Rounds this Match will run (M7 ticket 05, ADR 0049) — the host's own setting. */
  matchLength: number;
  /**
   * How many connections this server accepts before refusing the next one
   * outright (grilling session, 2026-09) — `welcome.config.maxPlayers`
   * echoed here so a Lobby Screen's "N slots open" reads the server's own
   * configured number instead of a guessed constant (ADR 0040: clients
   * render what the server decides).
   */
  maxPlayers: number;
  /**
   * The host's own picks for Rounds after the one about to start (M7 ticket
   * 05) — `roundPicks[i]` is Round `i + 2`'s pick; Round 1 is `trackId`/
   * `roundType` above, with its own pick mechanism. `null` in either field
   * means "the server draws this" — never the drawn answer itself, which
   * stays unknown to every client until that Round actually starts.
   */
  roundPicks: { trackId: string | null; roundType: RoundType | null }[];
}

/**
 * Pure projection of one server snapshot onto what a Lobby Screen renders —
 * the same mapping `game/index.ts` used to do inline before the socket moved
 * out of the game (ADR 0056). Pure so the shell's tests can pin it without a
 * socket, a game, or a browser.
 */
export const toLobbySnapshot = (myId: string, maxPlayers: number, message: SnapshotMessage): LobbySnapshot => ({
  myId,
  matchId: message.matchId,
  phase: message.phase,
  matchOver: message.matchOver,
  countdownMsLeft: message.countdownMsLeft,
  hostId: message.lobby.hostId,
  players: message.lobby.players,
  trackId: message.trackId,
  trackRevision: message.trackRevision,
  loaded: message.loaded,
  timeLimitMs: message.timeLeftMs,
  roundType: message.lobby.roundType,
  survivorTarget: message.roundRules.survivorTarget,
  startBlockedReason: message.lobby.startBlockedReason,
  matchLength: message.lobby.matchLength,
  roundPicks: message.lobby.roundPicks,
  maxPlayers,
});

/**
 * The eight Lobby actions a Screen can send (M4 ticket 07, M5 ticket 07, M7
 * tickets 05/10) — the same set `GameHandle` exposes, minus the game-lifetime
 * `stop`. Every gate (host-only, LOBBY-only, RESULTS-only) is enforced by the
 * server, never by which client happens to send it.
 */
export interface LobbyActions {
  /** Sets this connection's own nickname. Cosmetic — never a start gate. */
  setNickname: (nickname: string) => void;
  /** Sets this connection's own Ready state. Only meaningful in LOBBY. */
  setReady: (ready: boolean) => void;
  /** Host-only: picks a different Track for this Lobby. Ignored if not host or not in LOBBY. */
  selectTrack: (trackId: string) => void;
  /** Host-only: picks this Lobby's Round type. Ignored if not host or not in LOBBY. */
  setRoundType: (roundType: RoundType) => void;
  /** Host-only: sets this Match's length. Ignored if not host, not in LOBBY, or out of bounds. */
  setMatchLength: (matchLength: number) => void;
  /**
   * Host-only: picks (or clears) a Track/Round type for a Round after the one
   * about to start — `roundIndex` is 0-based from Round 1, so `1` is Round 2's
   * slot. `null` leaves it to the server's draw.
   */
  pickRoundSlot: (roundIndex: number, trackId: string | null, roundType: RoundType | null) => void;
  /** Host-only: asks the server to start the Round. Ignored unless the server's own gate passes. */
  start: () => void;
  /** Confirms this Player's own Ready for the next Round. Not host-only. Ignored outside RESULTS. */
  standingsReady: () => void;
}

/**
 * A live Match-server socket owned by the shell (ADR 0056) — what a React
 * Screen connects through, and what the game attaches to once the Match
 * starts. The socket survives the LOBBY → COUNTDOWN handoff by design: the
 * server binds Player identity to the connection (`welcome.playerId`), so a
 * second socket for the Match would rejoin as a stranger — new id, lost
 * Ready, lost host.
 */
export interface LobbyConnection extends LobbyActions {
  /** The underlying socket — handed to the game, which attaches its snapshot/sim feed to it. Never re-created. */
  readonly socket: WebSocket;
  /** The server's one-time welcome (ADR 0024): this Player's id, spawn, and the exact Track Revision. */
  readonly welcome: WelcomeMessage;
  /** This connection's own Player id (`welcome.playerId`) — what `toLobbySnapshot` needs alongside each message. */
  readonly myId: string;
  /** Latest Lobby content, or `null` before the first snapshot arrives. */
  getLobby: () => LobbySnapshot | null;
  /** Fires on every snapshot whose Lobby content actually changed (JSON-deduped against the snapshot rate). */
  subscribeLobby: (listener: (lobby: LobbySnapshot) => void) => () => void;
  /** Fires once when the socket drops. M2 does not reconnect (ADR 0011) — the shell routes away. */
  onClose: (listener: () => void) => () => void;
  /** Tears the socket down. Idempotent — safe under StrictMode's double unmount and game handoff races. */
  close: () => void;
}

export interface LobbyConnectionOptions {
  /** Host serving the Match server. Defaults to the host serving the page. */
  host?: string;
  /**
   * The port of the Lobby the broker sent this Player to (ADR 0054).
   * Omitted, this falls back to the fixed-port standalone Match server
   * `scripts/dev.sh` still starts for a single-Lobby test.
   */
  serverPort?: number;
}

/**
 * Opens the socket and resolves once the server's welcome arrives (rejects on
 * unreachable/refused, releasing the socket — a failed connect leaks
 * nothing). The caller owns the lifetime from here: `close()` on unmount.
 */
export const createLobbyConnection = async (options: LobbyConnectionOptions = {}): Promise<LobbyConnection> => {
  const endpoints = resolveEndpoints(options.host ?? location.hostname, {
    ...(options.serverPort === undefined ? {} : { matchServerPort: options.serverPort }),
  });
  const socket = new WebSocket(endpoints.matchServerUrl);
  let welcome: WelcomeMessage;
  try {
    welcome = await awaitWelcome(socket);
  } catch (err) {
    socket.close();
    throw err;
  }

  const myId = welcome.playerId;
  const maxPlayers = welcome.config.maxPlayers;
  let lobby: LobbySnapshot | null = null;
  let lastLobbyJson: string | null = null;
  const lobbyListeners = new Set<(lobby: LobbySnapshot) => void>();
  const closeListeners = new Set<() => void>();

  const send = (message: ClientMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  // Ask for the current state outright (ADR 0057): idle phases broadcast
  // only on change, and this listener may have attached after the join-push
  // already went out — without this, a late attach sits on nothing until the
  // next mutation. A duplicate push changes nothing (JSON-deduped below).
  send({ type: "sync" });
  // Bind this connection to its Account (M9 ticket 11 phase 2b) — the same
  // Bearer [REDACTED] the API routes verify. Skipped when none is stored (defensive
  // only: AuthGate guarantees one, but an anonymous socket must still work);
  // the server leaves such a seat unattributed rather than closing it.
  const token = getStoredToken();
  if (token) send({ type: "auth", token });
  const stopMessage = listen(socket, "message", (event) => {
    const message = JSON.parse((event as MessageEvent<string>).data) as ServerMessage;
    if (message.type !== "snapshot") return;
    const next = toLobbySnapshot(myId, maxPlayers, message);
    const nextJson = JSON.stringify(next);
    if (nextJson === lastLobbyJson) return; // snapshot rate is far too chatty to forward untouched
    lastLobbyJson = nextJson;
    lobby = next;
    for (const listener of [...lobbyListeners]) listener(next);
  });
  const stopClose = listen(socket, "close", () => {
    for (const listener of [...closeListeners]) listener();
  });
  void stopMessage;
  void stopClose;

  let closed = false;
  return {
    socket,
    welcome,
    myId,
    getLobby: () => lobby,
    subscribeLobby: (listener) => {
      lobbyListeners.add(listener);
      return () => {
        lobbyListeners.delete(listener);
      };
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      stopMessage();
      stopClose();
      socket.close();
    },
    setNickname: (nickname) => send({ type: "setNickname", nickname }),
    setReady: (ready) => send({ type: "setReady", ready }),
    selectTrack: (trackId) => send({ type: "selectTrack", trackId }),
    setRoundType: (roundType) => send({ type: "setRoundType", roundType }),
    setMatchLength: (matchLength) => send({ type: "setMatchLength", matchLength }),
    pickRoundSlot: (roundIndex, trackId, roundType) =>
      send({ type: "pickRoundSlot", roundIndex, trackId, roundType }),
    start: () => send({ type: "start" }),
    standingsReady: () => send({ type: "standingsReady" }),
  };
};

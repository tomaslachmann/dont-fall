import type { Vec3 } from "../math/vec3.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { LobbyPlayer } from "../match/Lobby.js";
import type { MatchPhase } from "../match/MatchPhase.js";
import type { SimState } from "../state/SimState.js";

/**
 * The wire protocol (ADR 0011): plain WebSocket carrying JSON. Both client and
 * server import these types so the two ends can't drift — there is no separate
 * schema/codegen step. Full spec: `docs/networking-model.md` §3. Binary encoding
 * is deferred (model doc §9).
 *
 * v2 (2026-09 grilling session, ADR 0018–0025). Field-level changes still to land
 * are tracked in `.scratch/m2-netcode/issues/11-protocol-v2-index.md`.
 */

/**
 * Server → client, once on connect.
 * - `playerId` — stable, public identity; keys this client's Character in every
 *   `SnapshotMessage`. Other clients see it. NOT a credential (ADR 0024).
 * - `sessionToken` — secret bearer credential (32 bytes crypto-random). Sent
 *   only here, never rebroadcast; presented in a {@link ReclaimMessage} on
 *   reconnect. M2 issues it but runs no reconnect logic.
 * - `spawn` — where the server placed the Character; the client seeds its local
 *   prediction from this (ticket 04).
 * - `config` — server rates the client needs before the first snapshot.
 */
export interface WelcomeMessage {
  type: "welcome";
  playerId: string;
  sessionToken: string;
  spawn: Vec3;
  /**
   * The exact Track (ADR 0028) this Match server fetched at startup —
   * `trackId`/`revision` from track-service's Revision model (ADR 0032).
   * Every client fetches this exact Revision (ticket 11), not "latest",
   * so a publish landing mid-Match can never desync client from server.
   */
  trackId: string;
  trackRevision: number;
  config: {
    /** How often the server sends snapshots (Hz). May be ≤ the sim tick rate (ADR 0020). */
    snapshotHz: number;
    /** How long a disconnected Character is parked / the session token stays valid (ms) (ADR 0024). */
    graceWindowMs: number;
    /**
     * How many connected Players this server waits for before starting a
     * Round (M4 ticket 04). Sent rather than assumed: it is configurable, and
     * a client that hardcoded the default would tell a player they were
     * waiting for someone who was never going to be needed (ADR 0040 —
     * clients render what the server decides, they never compute it).
     */
    playersToStart: number;
  };
}

/** Server → client, broadcast at the snapshot rate (`config.snapshotHz`). */
export interface SnapshotMessage {
  type: "snapshot";
  /** The authoritative world state; carries `tick`. */
  state: SimState;
  /**
   * The server's own `performance.now()` when this snapshot was built — the
   * client's clock reference for time sync (ADR 0019). `tick` alone assumes a
   * perfect `setInterval` cadence.
   */
  serverTimeMs: number;
  /**
   * How many of this client's commands the server has buffered but not yet
   * applied. Feeds the client's LEAD adjustment (ADR 0021). Only meaningful to
   * the client that owns this Character.
   */
  commandQueueDepth: number;
  /**
   * Milliseconds left on this Round's Time Limit (M4 ticket 03, ADR 0038),
   * counted down by the server from its own Tick against the value the
   * Revision was published with.
   *
   * A Match-level field rather than part of {@link SimState}: the clock is
   * Round state the server owns, not something the shared simulation derives
   * — which is exactly why the client never computes it and only renders what
   * arrives here. Reaching 0 does not end anything yet (M4 ticket 05).
   *
   * Holds at the Revision's full Time Limit until the Round is actually
   * RUNNING — the clock starts when the Countdown ends, not when the server did.
   */
  timeLeftMs: number;
  /**
   * Where the Match is (M4 ticket 04, ADR 0040). The server owns every
   * transition; clients render this rather than computing it, which is what
   * makes the start synchronous instead of two clients each deciding when
   * their own Countdown ran out.
   */
  phase: MatchPhase;
  /**
   * Milliseconds left on the Countdown, or 0 in every other phase (M4 ticket
   * 04) — what the client's "3, 2, 1" overlay renders. Derived by the server
   * from its own Tick, never from a client's wall clock.
   */
  countdownMsLeft: number;
  /**
   * Players who dropped while this Round was being raced (M4 ticket 05) — a
   * DNF. Their Characters are gone from {@link SimState}, so this is the only
   * thing that still says they were here; the Results screen (ticket 08) is
   * what reads it.
   *
   * Distinct from Elimination, which needs nothing on the wire at all: an
   * Eliminated Player is simply one who is still here with no `finishTick`
   * when the Round ends, which both sides can already see (`isEliminated`).
   */
  dnf: string[];
  /**
   * The Track this server currently has loaded, and who's connected to the
   * Lobby around it (M4 ticket 07, ADR 0040). Sent every snapshot — not just
   * once at `welcome` — because both can change live during LOBBY: the host
   * picking a different Track (`trackId`/`trackRevision`), or anyone's
   * nickname/ready state changing. `hostId` is recomputed by the server on
   * every read (see `resolveHostId`), never stored, so it reassigns itself
   * the instant the original host disconnects.
   *
   * `timeLeftMs` above already *is* this Track's Time Limit while still in
   * LOBBY (ADR 0038: "the Lobby only ever reads" it) — there is deliberately
   * no second field repeating that value.
   */
  trackId: string;
  trackRevision: number;
  lobby: {
    hostId: string | undefined;
    players: LobbyPlayer[];
  };
}

/** Server → client, reply to a {@link PingMessage} (time sync, ADR 0019). */
export interface PongMessage {
  type: "pong";
  /** Echoed `PingMessage.clientTimeMs` (T1). */
  clientTimeMs: number;
  /** The server's `performance.now()` when it handled the ping (T3 ≈ T2 at this scale). */
  serverTimeMs: number;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | PongMessage;

/**
 * Client → server, once per predicted tick. Carries the current tick's input
 * plus a redundant tail of the last few unacknowledged inputs (ADR 0021) — the
 * server dedupes by `tick` (ignores `tick <= lastInputTick`), so a WebSocket
 * head-of-line burst or out-of-order delivery loses nothing. The server echoes
 * the highest applied `tick` in `CharacterSnapshot.lastInputTick` (ADR 0013).
 */
export interface InputMessage {
  type: "input";
  inputs: { tick: number; input: SimInputs }[];
}

/** Client → server, time-sync probe (ADR 0019). */
export interface PingMessage {
  type: "ping";
  /** The client's monotonic-clock reading at send (T1). Never `Date.now()`. */
  clientTimeMs: number;
}

/**
 * Client → server, on reconnect: re-attach to the Character parked under this
 * token (ADR 0024). M2 defines the shape; the server does not act on it yet.
 */
export interface ReclaimMessage {
  type: "reclaim";
  sessionToken: string;
}

/**
 * Client → server: sets this connection's own nickname (M4 ticket 07). Any
 * connected Player may send this at any time — a nickname is cosmetic, never
 * a start gate. The server trims/caps it ({@link NICKNAME_MAX_LENGTH}); an
 * empty result is left as whatever it was.
 */
export interface SetNicknameMessage {
  type: "setNickname";
  nickname: string;
}

/**
 * Client → server: sets this connection's own Ready state (M4 ticket 07,
 * ADR 0040). Only meaningful in LOBBY; the server ignores it in every other
 * phase — there is no "getting un-ready" mid-Round.
 */
export interface SetReadyMessage {
  type: "setReady";
  ready: boolean;
}

/**
 * Client → server: the host picks a different Track for this Lobby (M4
 * ticket 07). Host-only and LOBBY-only, both enforced by the server, not by
 * which client happens to send it — the same reload machinery Track
 * Builder's own Playtest `?track=` already uses, just triggered from inside
 * an already-open Lobby instead of at connection time.
 */
export interface SelectTrackMessage {
  type: "selectTrack";
  trackId: string;
}

/**
 * Client → server: the host asks to start the Round (M4 ticket 07, ADR
 * 0040). The server is the only thing that decides whether this actually
 * moves the Match out of LOBBY — enough Players connected and everyone
 * Ready — never the sender's own belief that it's time; a non-host or a
 * premature `start` is simply ignored.
 */
export interface StartMessage {
  type: "start";
}

export type ClientMessage =
  | InputMessage
  | PingMessage
  | ReclaimMessage
  | SetNicknameMessage
  | SetReadyMessage
  | SelectTrackMessage
  | StartMessage;

/** A nickname longer than this is truncated (M4 ticket 07) — long enough for a real name, short enough not to blow out a Lobby row. */
export const NICKNAME_MAX_LENGTH = 24;

/** Default port the server listens on and the client connects to when nothing else is configured. */
export const DEFAULT_SERVER_PORT = 8080;

/**
 * Default port track-service (ADR 0028/0029) listens on. The Match server
 * fetches its Track from here at startup — a real runtime dependency, not
 * optional (ADR 0028's accepted trade-off).
 */
export const DEFAULT_TRACK_SERVICE_PORT = 8081;

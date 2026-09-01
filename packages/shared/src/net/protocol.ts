import type { Vec3 } from "../math/vec3.js";
import type { SimInputs } from "../simulation/SimInputs.js";
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
  config: {
    /** How often the server sends snapshots (Hz). May be ≤ the sim tick rate (ADR 0020). */
    snapshotHz: number;
    /** How long a disconnected Character is parked / the session token stays valid (ms) (ADR 0024). */
    graceWindowMs: number;
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

export type ClientMessage = InputMessage | PingMessage | ReclaimMessage;

/** Default port the server listens on and the client connects to when nothing else is configured. */
export const DEFAULT_SERVER_PORT = 8080;

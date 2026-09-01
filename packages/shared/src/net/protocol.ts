import type { Vec3 } from "../math/vec3.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { SimState } from "../state/SimState.js";

/**
 * The M2 wire protocol (ticket 02, ADR 0011): plain WebSocket carrying JSON.
 * Both client and server import these types so the two ends can't drift —
 * there is no separate schema/codegen step (ADR 0011).
 */

/**
 * Server → client, once on connect: the session ID identifying the client's
 * own Character in every `SnapshotMessage`, and the spawn point the server
 * placed it at — the client seeds its local prediction sim from this so its
 * prediction starts aligned with the authority (per-player spawn grid, ticket 04).
 */
export interface WelcomeMessage {
  type: "welcome";
  id: string;
  spawn: Vec3;
}

/** Server → client, broadcast once per simulation tick (30 Hz) to every connected client. */
export interface SnapshotMessage {
  type: "snapshot";
  state: SimState;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage;

/** Client → server, sent once per simulation tick: this client's current input. */
export interface InputMessage {
  type: "input";
  input: SimInputs;
}

export type ClientMessage = InputMessage;

/** Default port the server listens on and the client connects to when nothing else is configured. */
export const DEFAULT_SERVER_PORT = 8080;

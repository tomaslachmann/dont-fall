import type { Box } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";

/**
 * A single Socket type for M3-v2 (ADR 0031) — every Module is still a
 * walkable floor piece today, so compatibility checking is trivial (any
 * Socket accepts any Socket). Extensible later (e.g. `"rail"`,
 * `"mechanism_input"`) without a rewrite: nothing reads this except future
 * type-filtering logic that doesn't exist yet.
 */
export type SocketType = "floor";

/**
 * A Module's named local connection point (CONTEXT.md) — a position and yaw
 * (radians) another Module's matching Socket aligns against. `"entry"`/
 * `"exit"` are the two every current Module has; nothing requires exactly
 * two or those exact names, but `chainTrack`/the builder default to them.
 */
export interface Socket {
  id: string;
  type: SocketType;
  position: Vec3;
  /** Which way this Socket faces, in the Module's own local frame (radians). */
  yaw: number;
}

/**
 * A Module's declared occupied space and clearance (CONTEXT.md) — a
 * placement/overlap contract independent of its visual geometry or Rapier
 * collider.
 */
export interface Footprint {
  bounds: Box;
  clearance: number;
}

/**
 * A reusable Track piece (CONTEXT.md: Module), authored once in local space —
 * geometry/Props/Spinners/Checkpoint are all relative to the Module's own
 * origin, translated (and, since ADR 0031, rotated) into world space
 * wherever a Track places it (a Segment).
 */
export interface Module {
  id: string;
  statics: Box[];
  props?: PropConfig[];
  spinners?: SpinnerConfig[];
  checkpoint?: Checkpoint;
  sockets: Socket[];
  footprint: Footprint;
}

export const findSocket = (module: Module, socketId: string): Socket => {
  const socket = module.sockets.find((s) => s.id === socketId);
  if (!socket) throw new Error(`Module "${module.id}" has no Socket "${socketId}"`);
  return socket;
};

import type { Box } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpeedPadConfig } from "../simulation/SpeedPad.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import type { SurfaceId } from "./Surface.js";

/**
 * A single Socket type for M3-v2 (ADR 0031) — every Module is still a
 * walkable floor piece today, so compatibility checking is trivial (any
 * Socket accepts any Socket). Extensible later (e.g. `"rail"`,
 * `"mechanism_input"`) without a rewrite: nothing reads this except future
 * type-filtering logic that doesn't exist yet.
 */
export type SocketType = "floor";

/**
 * A Module's named local connection point (CONTEXT.md) — a position and
 * orientation another Module's matching Socket aligns against. `"entry"`/
 * `"exit"` are the two every current Module has; nothing requires exactly
 * two or those exact names, but `chainTrack`/the builder default to them.
 *
 * `pitch`/`roll` (ADR 0034) are additive, optional, and default to 0 — every
 * Socket authored before this had only `yaw`, and still works unchanged.
 */
export interface Socket {
  id: string;
  type: SocketType;
  position: Vec3;
  /** Which way this Socket faces, in the Module's own local frame (radians). */
  yaw: number;
  /** Tilt-forward/back component of this Socket's local orientation (radians). Defaults to 0. */
  pitch?: number;
  /** Bank/tilt-sideways component of this Socket's local orientation (radians). Defaults to 0. */
  roll?: number;
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
 * One of a Module's floor pieces — a plain {@link Box} plus its own optional
 * Surface override (ADR 0036). A separate type from `Box` deliberately
 * (code review, ticket 01): `Box` is a pure geometry primitive used well
 * beyond Module floors (`Footprint.bounds`, `Checkpoint.trigger`), and giving
 * *it* a `surface` field would mean every one of those unrelated uses
 * silently inherits a property with no meaning there.
 */
export interface FloorBox extends Box {
  /**
   * This floor piece's Surface id (CONTEXT.md), when it's more specific than
   * the Module it belongs to — additive and optional, exactly like ADR
   * 0034's `pitch`/`roll`. Resolved (`FloorBox.surface ?? Module.surface ??
   * "default"`) by `track/Track.ts`'s `resolveTrack`.
   */
  surface?: SurfaceId;
}

/**
 * A reusable Track piece (CONTEXT.md: Module), authored once in local space —
 * geometry/Props/Spinners/Checkpoint are all relative to the Module's own
 * origin, translated (and, since ADR 0031, rotated) into world space
 * wherever a Track places it (a Segment).
 */
export interface Module {
  id: string;
  statics: FloorBox[];
  props?: PropConfig[];
  spinners?: SpinnerConfig[];
  checkpoint?: Checkpoint;
  /** Speed/slow pads this Module places (M3.7 ticket 01) — zero or more, unlike the singular `checkpoint`. */
  speedPads?: SpeedPadConfig[];
  sockets: Socket[];
  footprint: Footprint;
  /**
   * This whole Module's Surface id (CONTEXT.md) — "this whole piece is
   * mud/ice" without annotating every floor `Box` in `statics` individually.
   * A more specific `Box.surface` on one of those wins over this (ADR 0036).
   * Additive and optional, exactly like ADR 0034's `pitch`/`roll`.
   */
  surface?: SurfaceId;
}

export const findSocket = (module: Module, socketId: string): Socket => {
  const socket = module.sockets.find((s) => s.id === socketId);
  if (!socket) throw new Error(`Module "${module.id}" has no Socket "${socketId}"`);
  return socket;
};

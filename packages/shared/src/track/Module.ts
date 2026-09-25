import type { Box } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import type { TriggerCheckpoint } from "../simulation/Checkpoint.js";
import type { LaunchPadConfig } from "../simulation/LaunchPad.js";
import type { PropConfig } from "../simulation/Prop.js";
import type { SpinnerConfig } from "../simulation/Spinner.js";
import type { VolumeConfig } from "../simulation/Volume.js";
import type { AssetPart } from "./AssetPart.js";
import type { BeltPath } from "./BeltPath.js";
import type { PunchCycle } from "./Punch.js";
import type { BombDef } from "./Bomb.js";
import type { FragileDef } from "./Fragile.js";
import type { ShooterDef } from "./Shooter.js";
import type { SegmentAttachments } from "./Track.js";
import type { ValidatedAssetMesh, ValidatedSolidPart } from "./asset.js";
import type { GateDef } from "./Gate.js";
import type { LaunchDef } from "./Launch.js";
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
  /**
   * Authored collision geometry (M8 ticket 02, ADR 0050) — present exactly
   * on asset Modules, whose `statics` stays empty. `resolveTrack` bakes
   * these meshes into world-space trimeshes; a Module carrying both is an
   * authoring error it refuses. Attached per-consumer by
   * `attachAssetGeometry` (never shipped inside `M1_MODULES`), so the static
   * registry never holds bytes.
   */
  asset?: { meshes: ValidatedAssetMesh[]; solid?: ValidatedSolidPart[] };
  props?: PropConfig[];
  spinners?: SpinnerConfig[];
  checkpoint?: TriggerCheckpoint;
  /**
   * An optional Finish Zone (M4 ticket 02, ADR 0039) — singular like
   * `checkpoint`, because a Module is one authored piece and "the finish" is
   * one region within it. Typically authored on the last Segment of a Race
   * Track, but nothing here requires it: "finish" is wherever the trigger is.
   * Every Module authored before M4 simply has none, and resolves unchanged.
   */
  finishZone?: { trigger: Box };
  /** Launch pads this Module places (M3.7 ticket 02) — zero or more, same shape as `volumes`. */
  launchPads?: LaunchPadConfig[];
  /**
   * Volumes this Module places (M3.7 ticket 04, ADR 0036) — zero or more,
   * same shape as `launchPads`. A Volume is its own entity kind,
   * never a collider wearing a special Surface (ADR 0036) — it carries no
   * `statics` geometry of its own, just the region and the force.
   */
  volumes?: VolumeConfig[];
  sockets: Socket[];
  footprint: Footprint;
  /**
   * This whole Module's Surface id (CONTEXT.md) — "this whole piece is
   * mud/ice" without annotating every floor `Box` in `statics` individually.
   * A more specific `Box.surface` on one of those wins over this (ADR 0036).
   * Additive and optional, exactly like ADR 0034's `pitch`/`roll`.
   */
  surface?: SurfaceId;
  /**
   * What touching this Module's collision does beyond the ordinary physics
   * (CONTEXT.md: Spiked, ADR 0061). Authored on an Asset's def, never guessed
   * from a name at runtime; a Module without one is harmless to touch.
   */
  hazard?: Hazard;
  /**
   * This Module is a Spring (CONTEXT.md: Spring, ADR 0069) — its trigger and
   * its default throw, from its Asset's def. Unlike `launchPads`, whose vector
   * is fixed where it was authored, a Spring's height is the placed Segment's
   * to override (`Segment.launch`).
   */
  launch?: LaunchDef;
  /**
   * The opening a Character passes through and what passing does (CONTEXT.md:
   * Gate, ADR 0068) — on Gate Assets only, from their def. A finish sign's
   * always Qualifies; a hoop's or an arch's counts only on a Segment switched
   * on as a Checkpoint.
   */
  gate?: GateDef;
  /**
   * The Parts this Asset resolves into (CONTEXT.md: Part, ADR 0116) — on
   * Assets built from more than one body, from their def. Absent everywhere
   * else, and an absent one means what it always meant: one rigid piece.
   */
  parts?: AssetPart[];
  /**
   * This Module is a floor that breaks under you (CONTEXT.md: Fragile, ADR
   * 0118), from its Asset's def. A placed Segment's `fragile` Attachment
   * retunes how long it stays gone; it can never make a Module one.
   */
  fragile?: FragileDef;
  /**
   * This Module is a Bomb (CONTEXT.md: Bomb, ADR 0126), from its Asset's def:
   * a placed Segment of it is a Prop, and its `bomb` Attachment retunes the
   * fuse and the return.
   */
  bomb?: BombDef;
  /** This Asset fires a ball along its barrel (CONTEXT.md: Shooter, ADR 0119) — where the muzzle is, and what it does by default. */
  shooter?: ShooterDef;
  /** What a placed Segment of this Asset arrives carrying (ADR 0120) — its own value always wins. */
  attachments?: Pick<SegmentAttachments, "conveyor">;
  /** The loop this Asset's slats ride (ADR 0120) — drawn only, at the speed its Conveyor runs. */
  belt?: BeltPath;
  /** This Asset punches (CONTEXT.md: Punching Glove, ADR 0121) — the authored swing its Parts share. */
  punch?: PunchCycle;
}

/**
 * `"spiked"`: any Character contact is a knockdown, whatever the speed —
 * standing on it, running into it, or being moved into it (ADR 0061).
 */
export type Hazard = "spiked";

/**
 * Whether `module` has a Socket named `socketId` — the question
 * {@link findSocket} answers by throwing.
 *
 * Not every Module has Sockets. One meant to be dropped on its own by free
 * placement (ADR 0034) — every converted asset — carries none at all, and
 * nothing in ADR 0031's model requires it to: a Socket is a connection
 * point, and a piece nothing connects to has no connection points.
 * Anything that chains Modules has to be able to ask this before assuming it
 * can (`chainTrack`, and the builder's own re-chaining).
 */
export const hasSocket = (module: Module, socketId: string): boolean =>
  module.sockets.some((s) => s.id === socketId);

export const findSocket = (module: Module, socketId: string): Socket => {
  const socket = module.sockets.find((s) => s.id === socketId);
  if (!socket) throw new Error(`Module "${module.id}" has no Socket "${socketId}"`);
  return socket;
};

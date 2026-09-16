import { yawQuat, type Quat } from "../math/quat.js";
import { rotateVec3ByQuat, scaleVec3, type Vec3 } from "../math/vec3.js";

/**
 * A Conveyor's speed preset (CONTEXT.md, ADR 0064) — the whole speed
 * vocabulary a Track author gets. A free m/s number was rejected: three
 * tuned presets keep belt feel consistent across Tracks instead of every
 * author inventing their own 7.35.
 */
export type ConveyorPreset = "slow" | "medium" | "fast";

/** Every {@link ConveyorPreset}, slowest first — iteration order for UI and validation. */
export const CONVEYOR_PRESETS: readonly ConveyorPreset[] = ["slow", "medium", "fast"];

/**
 * Belt speed in units/s per preset (ADR 0064), against `WALK_SPEED` 6.
 * Provisional tuning — "a measurement, not a decision" like `SURFACES`' own
 * numbers. Fast deliberately beats a run, so a belt running against you can
 * hold you still or push you back: the retired slow pad's whole job, emerged
 * from one mechanism rather than authored as a second one.
 */
export const CONVEYOR_SPEEDS: Record<ConveyorPreset, number> = {
  slow: 2,
  medium: 4,
  fast: 8,
};

/**
 * A belt attached to one Segment (ADR 0064) — the whole asset carries
 * whoever stands on it. Additive and optional on `Segment` like
 * `pitch`/`roll`/`motion`/`scale`, so every Track stored before it reads
 * unchanged.
 */
export interface SegmentConveyor {
  /** Which belt speed this Segment runs at. */
  preset: ConveyorPreset;
  /**
   * Which way the belt runs, as a yaw in the Segment's local frame
   * (radians, free angle — not snapped). 0 is module forward, toward the
   * exit Socket (local -Z, the same forward the launch pad's own local
   * velocity is authored against). `resolveTrack` rotates this by the
   * Segment's own yaw into a world-space horizontal flow — pitch/roll
   * deliberately never tilt it (ADR 0064).
   */
  angle: number;
}

/**
 * Why `value` is not a storable {@link SegmentConveyor}, or `undefined`
 * when it is — a known preset plus a finite angle. The API's publish
 * validation reports this reason in its 400 (a Revision is immutable, so a
 * malformed belt must fail at publish, not in a Match); {@link
 * isSegmentConveyor} is the boolean half over the same definition, so the
 * two can never disagree about what a Conveyor is.
 */
export const invalidConveyorReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return "conveyor must be an object with a preset and an angle";
  const { preset, angle } = value as { preset?: unknown; angle?: unknown };
  if (typeof preset !== "string" || !(CONVEYOR_PRESETS as readonly string[]).includes(preset)) {
    return `conveyor.preset must be one of ${CONVEYOR_PRESETS.join(", ")}, got ${JSON.stringify(preset)}`;
  }
  if (typeof angle !== "number" || !Number.isFinite(angle)) {
    return `conveyor.angle must be a finite number of radians, got ${JSON.stringify(angle)}`;
  }
  return undefined;
};

/** Whether `value` is a storable {@link SegmentConveyor} — see {@link invalidConveyorReason}. */
export const isSegmentConveyor = (value: unknown): value is SegmentConveyor =>
  invalidConveyorReason(value) === undefined;

/** Module forward in a Module's local frame (local -Z, toward the exit Socket) — a Conveyor at angle 0. */
const MODULE_FORWARD: Vec3 = { x: 0, y: 0, z: -1 };

/**
 * A Conveyor's world-space belt flow (ADR 0064): its local `angle` composed
 * with its Segment's world yaw, at its preset's speed — horizontal, always.
 * Yaw-only deliberately (the Spinner precedent): a belt has a compass
 * direction on the map, and grounding resolves whatever slope it runs over.
 */
export const conveyorWorldVelocity = (conveyor: SegmentConveyor, segmentYaw: number): Vec3 =>
  scaleVec3(
    rotateVec3ByQuat(MODULE_FORWARD, yawQuat(segmentYaw + conveyor.angle)),
    CONVEYOR_SPEEDS[conveyor.preset],
  );

/**
 * Module ids retired by ADR 0064 (the pads, whose behaviour moved to the
 * Segment Conveyor), ADR 0066 (ice) and ADR 0067 (mud, whose authoring moved
 * to the Segment) that must still load: their geometry was always an
 * ordinary 2×4 deck, so old Tracks keep every Segment — pads lose
 * the pad that no longer exists, ice/mud keep their Surface. `resolveTrack`
 * warns per Segment; the builder palette hides these ids outright. ADR 0068
 * retires the course blocks the same way — `start`, `finish`, both
 * `checkpoint-*` blocks and `sandbox` — which keep their triggers so an old
 * Track still starts, respawns and finishes where it always did. ADR 0075
 * retires the `updraft` last of all: its field moved onto the fan asset,
 * and the stub keeps only the deck it always stood on.
 */
export const DEPRECATED_MODULE_IDS: ReadonlySet<string> = new Set([
  "speed-pad",
  "slow-pad",
  "ice",
  "mud",
  "start",
  "finish",
  "checkpoint-spinner",
  "checkpoint-end-props",
  "sandbox",
  "updraft",
]);

/**
 * Where a deck overlay sits (ADR 0064/0066): the Segment's footprint frame
 * (XZ centre and half-extents, scaled) on its deck top (the top of its own
 * collision in the Module's frame — never the footprint's own top, which
 * floats ~1 above the deck on every straight Module), placed with the
 * Segment. Chevron strips and ice sheets share it, so the two can never
 * disagree about where the deck is.
 */
export interface DeckFrame {
  /** The deck top's centre in world space — in the deck's own plane, so on a ramp it is the middle of the slope, not its high edge. */
  center: Vec3;
  yaw: number;
  /**
   * The Segment's whole orientation (ADR 0034). An overlay lies in the deck's
   * own plane, pitched and rolled with it — a yaw-only sheet stays flat over
   * a ramp and floats above its low end.
   */
  orientation: Quat;
  halfX: number;
  halfZ: number;
}

/**
 * One resolved belt for the renderers (ADR 0064) — physics needs nothing of
 * this (it reads the belt off the ground collider), but a belt's whole point
 * is a direction a player must read at a glance, so both the game scene and
 * the builder viewport draw it.
 */
export interface ConveyorBelt {
  /** Which Segment carries this belt — the game client re-parents it under a Moving Segment's own group. */
  segmentIndex: number;
  /** World-space belt flow, horizontal — what the chevrons point along. */
  velocity: Vec3;
  /** Where the chevron strip sits. */
  deck: DeckFrame;
}

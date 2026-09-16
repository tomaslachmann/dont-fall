import type { Box } from "../math/box.js";
import type { Vec3 } from "../math/vec3.js";
import {
  CAPSULE_BOTTOM_OFFSET,
  LAUNCH_HEIGHT_MAX,
  LAUNCH_HEIGHT_MIN,
  LAUNCH_TRIGGER_MARGIN,
  launchHeightToSpeed,
} from "../tuning.js";

/**
 * How high one placed Spring throws (CONTEXT.md: Spring, ADR 0069) — metres
 * above the deck it fires from. Additive and optional on `Segment` like
 * `conveyor`/`motion`/`scale`, so every Track stored before it reads
 * unchanged, and it is an *override*: a Spring with no `Segment.launch` still
 * launches, at its Asset's own default.
 *
 * A height, not a speed, because that is the number an author reasons about —
 * "does this clear the gap". {@link launchHeightToSpeed} converts, once, at
 * resolve time.
 */
export interface SegmentLaunch {
  /** Apex height in metres, within {@link LAUNCH_HEIGHT_MIN}..{@link LAUNCH_HEIGHT_MAX}. */
  height: number;
}

/**
 * The Asset half of a Spring (ADR 0069): which Assets throw, how high by
 * default, and the region that fires them. Assigned per stem by the
 * converters, exactly like `hazard`/`gate` — never guessed at runtime from a
 * name. A placed Spring always launches; there is no switch.
 */
export interface LaunchDef {
  /**
   * The region a Character's capsule centre must enter, in the Module's own
   * local frame — derived from the Asset's measured footprint (its deck top,
   * up by a capsule), never hand-authored.
   */
  trigger: Box;
  /** Where this Asset throws to when the placed Segment doesn't say otherwise. */
  height: number;
}

/**
 * Why `value` is not a storable {@link SegmentLaunch}, or `undefined` when it
 * is. The API's publish validation reports this reason in its 400 (a Revision
 * is immutable, so a malformed Spring must fail at publish, not in a Match);
 * {@link isSegmentLaunch} is the boolean half over the same definition, so the
 * two can never disagree about what a launch is.
 */
export const invalidLaunchReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return "launch must be an object with a height";
  const { height } = value as { height?: unknown };
  if (typeof height !== "number" || !Number.isFinite(height)) {
    return `launch.height must be a finite number of metres, got ${JSON.stringify(height)}`;
  }
  if (height < LAUNCH_HEIGHT_MIN || height > LAUNCH_HEIGHT_MAX) {
    return `launch.height must be between ${LAUNCH_HEIGHT_MIN} and ${LAUNCH_HEIGHT_MAX} metres, got ${height}`;
  }
  return undefined;
};

/** Whether `value` is a storable {@link SegmentLaunch} — see {@link invalidLaunchReason}. */
export const isSegmentLaunch = (value: unknown): value is SegmentLaunch =>
  invalidLaunchReason(value) === undefined;

/** `height` pulled into the storable range — the builder's stepper clamps rather than storing an invalid Track. */
export const clampLaunchHeight = (height: number): number =>
  Math.min(LAUNCH_HEIGHT_MAX, Math.max(LAUNCH_HEIGHT_MIN, height));

/**
 * What a placed Spring actually throws at: the Segment's own height when it
 * overrides, else its Asset's default. One definition, so `resolveTrack`, the
 * builder's inspector and its arc preview can never disagree.
 */
export const launchHeightOf = (launch: SegmentLaunch | undefined, def: LaunchDef): number =>
  launch?.height ?? def.height;

/**
 * A Spring's throw in its own Module frame (ADR 0069) — straight up its local
 * +Y, always. `resolveTrack` rotates it by the Segment's orientation, so a
 * Spring tilted with ADR 0034's pitch/roll throws at an angle with no extra
 * authoring: **you aim a Spring by tilting it**, and the visual can never lie
 * about where it sends you.
 */
export const launchVelocityFor = (height: number): Vec3 => ({ x: 0, y: launchHeightToSpeed(height), z: 0 });

/**
 * One Spring Asset's {@link LaunchDef}, derived from its measured footprint —
 * the converters' one definition of where a Spring fires from, so nine Assets
 * (and every Spring a future pack brings) get the same box by construction
 * rather than nine hand-typed ones.
 *
 * The box is centred on a standing Character's capsule *centre* — what the
 * trigger actually tests — one {@link CAPSULE_BOTTOM_OFFSET} above the deck
 * top, and reaches only {@link LAUNCH_TRIGGER_MARGIN} past it either way, so
 * it fires on contact rather than on approach. Its x/z is the footprint's:
 * the whole deck throws you, edge included.
 */
export const launchDefFor = (bounds: Box, height: number): LaunchDef => {
  // Rounded like the measured footprints themselves: the derivation is written
  // into a generated source file, where `3.0500000000000003` is just noise.
  const deckTop = bounds.center.y + bounds.halfExtents.y;
  const standing = Math.round((deckTop + CAPSULE_BOTTOM_OFFSET) * 1000) / 1000;
  return {
    trigger: {
      center: { x: bounds.center.x, y: standing, z: bounds.center.z },
      halfExtents: { x: bounds.halfExtents.x, y: LAUNCH_TRIGGER_MARGIN, z: bounds.halfExtents.z },
    },
    height,
  };
};

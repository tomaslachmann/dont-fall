import {
  invalidCheckpointReason,
  invalidConveyorReason,
  invalidStartReason,
  invalidIceReason,
  invalidBounceReason,
  invalidLaunchReason,
  invalidMotionReason,
  invalidMudReason,
  MAX_SEGMENT_SCALE,
  MAX_SURVIVOR_TARGET,
  MIN_SEGMENT_SCALE,
  MAX_TIME_LIMIT_MS,
  MIN_SURVIVOR_TARGET,
  MIN_TIME_LIMIT_MS,
  type Module,
  type Track,
} from "@dont-fall/shared";

/**
 * Every `Segment.moduleId` in `track` must reference a real Module — before
 * this ticket, only the JSON shape was checked, so a garbage `moduleId`
 * saved fine and only surfaced when the Match server later tried to run it
 * (`resolveTrack` throwing at Round start). Returns the distinct unknown
 * ids, or an empty array if `track` is valid.
 */
export const unknownModuleIds = (track: Track, modules: Record<string, Module>): string[] => {
  const unknown = new Set<string>();
  for (const segment of track) {
    // `Object.hasOwn`, not `in` (code review): `in` walks the prototype
    // chain, so a moduleId like "toString"/"constructor"/"hasOwnProperty"
    // would wrongly read as "known" against any plain object literal,
    // passing validation and then crashing `resolveTrack` downstream with a
    // TypeError instead of a clear rejection here.
    if (!Object.hasOwn(modules, segment.moduleId)) unknown.add(segment.moduleId);
  }
  return [...unknown];
};

/**
 * Validates an authored Time Limit (M4 ticket 03, ADR 0038), returning the
 * reason it is unacceptable or `undefined` if it's fine. `undefined` input is
 * valid — a publish that omits it takes the default, which is what keeps
 * every pre-M4 caller working unchanged.
 *
 * Rejected here rather than clamped: a Revision is immutable (ADR 0032), so a
 * silently-corrected clock would be permanent and invisible to the author who
 * typed it.
 */
export const invalidTimeLimitReason = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `timeLimitMs must be an integer number of milliseconds, got ${JSON.stringify(value)}`;
  }
  if (value < MIN_TIME_LIMIT_MS || value > MAX_TIME_LIMIT_MS) {
    return `timeLimitMs must be between ${MIN_TIME_LIMIT_MS} and ${MAX_TIME_LIMIT_MS}, got ${value}`;
  }
  return undefined;
};

/**
 * Validates an authored Survivor Target (M5 ticket 07, ADR 0041), returning
 * the reason it is unacceptable or `undefined` if it's fine — the exact
 * counterpart of {@link invalidTimeLimitReason}, down to rejecting rather
 * than clamping: a Revision is immutable (ADR 0032), so a silently-corrected
 * number would be permanent and invisible to the author who typed it.
 *
 * `undefined` input is valid and means "the default", which is what keeps
 * every pre-M5 caller (and every Revision already published) working
 * unchanged.
 */
export const invalidSurvivorTargetReason = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `survivorTarget must be a whole number of Players, got ${JSON.stringify(value)}`;
  }
  if (value < MIN_SURVIVOR_TARGET || value > MAX_SURVIVOR_TARGET) {
    return `survivorTarget must be between ${MIN_SURVIVOR_TARGET} and ${MAX_SURVIVOR_TARGET}, got ${value}`;
  }
  return undefined;
};

/** A finite number — rejects NaN and Infinity, neither of which may reach `segmentOrientation`. */
export const isFiniteNumber = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

/** Present-and-finite, or absent. `pitch`/`roll` are optional and default to 0 (ADR 0034). */
export const isOptionalFiniteNumber = (value: unknown): boolean => value === undefined || isFiniteNumber(value);

export const isVec3 = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, z } = value as { x?: unknown; y?: unknown; z?: unknown };
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z);
};

/**
 * Validates the published `Segment[]` contract (ADR 0038 keeps `data` exactly
 * this shape) against `Track.ts`'s `Segment`.
 *
 * Checked properly rather than loosely, because a Revision is immutable
 * (ADR 0032): anything that gets past here is stored forever and only fails
 * much later, somewhere far away. The two holes this closes were both of that
 * kind — `typeof null === "object"` let a null `position` through, and
 * `rotation` was not checked at all, so an absent one reached
 * `segmentOrientation` (`Track.ts`) as `undefined` and produced a NaN
 * quaternion instead of a 400 here.
 */
export const isSegment = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as {
    moduleId?: unknown;
    position?: unknown;
    rotation?: unknown;
    pitch?: unknown;
    roll?: unknown;
    motion?: unknown;
    scale?: unknown;
    conveyor?: unknown;
    ice?: unknown;
    mud?: unknown;
    bounce?: unknown;
    launch?: unknown;
    start?: unknown;
    checkpoint?: unknown;
  };
  return (
    typeof segment.moduleId === "string" &&
    isVec3(segment.position) &&
    isFiniteNumber(segment.rotation) &&
    isOptionalFiniteNumber(segment.pitch) &&
    isOptionalFiniteNumber(segment.roll) &&
    (segment.motion === undefined || invalidMotionReason(segment.motion) === undefined) &&
    (segment.scale === undefined || isSegmentScale(segment.scale)) &&
    (segment.conveyor === undefined || invalidConveyorReason(segment.conveyor) === undefined) &&
    (segment.ice === undefined || invalidIceReason(segment.ice) === undefined) &&
    (segment.mud === undefined || invalidMudReason(segment.mud) === undefined) &&
    (segment.bounce === undefined || invalidBounceReason(segment.bounce) === undefined) &&
    (segment.launch === undefined || invalidLaunchReason(segment.launch) === undefined) &&
    (segment.start === undefined || invalidStartReason(segment.start) === undefined) &&
    (segment.checkpoint === undefined || invalidCheckpointReason(segment.checkpoint) === undefined)
  );
};

/** A uniform `Segment.scale` inside the bounds a Revision may store (ADR 0062). */
export const isSegmentScale = (value: unknown): boolean =>
  isFiniteNumber(value) && (value as number) >= MIN_SEGMENT_SCALE && (value as number) <= MAX_SEGMENT_SCALE;

/**
 * The first Segment Motion (ADR 0061) that is not valid, named by index — so
 * a refused publish says which Segment and why, not only "not a Segment[]".
 */
export const invalidTrackMotionReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const motion = (segment as { motion?: unknown } | null)?.motion;
    if (motion === undefined) continue;
    const reason = invalidMotionReason(motion);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment Conveyor (ADR 0064) that is not valid, named by index —
 * the exact counterpart of {@link invalidTrackMotionReason}, for the same
 * reason: a refused publish says which Segment and why.
 */
export const invalidTrackConveyorReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const conveyor = (segment as { conveyor?: unknown } | null)?.conveyor;
    if (conveyor === undefined) continue;
    const reason = invalidConveyorReason(conveyor);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment ice attachment (ADR 0066) that is not valid, named by
 * index — the exact counterpart of {@link invalidTrackConveyorReason}, for
 * the same reason: a refused publish says which Segment and why.
 */
export const invalidTrackIceReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const ice = (segment as { ice?: unknown } | null)?.ice;
    if (ice === undefined) continue;
    const reason = invalidIceReason(ice);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment mud attachment (ADR 0067) that is not valid, named by
 * index — the same counterpart as {@link invalidTrackIceReason}.
 */
export const invalidTrackMudReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const mud = (segment as { mud?: unknown } | null)?.mud;
    if (mud === undefined) continue;
    const reason = invalidMudReason(mud);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment bounce attachment (ADR 0070) that is not valid, named by
 * index — the same counterpart as {@link invalidTrackMudReason}.
 */
export const invalidTrackBounceReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const bounce = (segment as { bounce?: unknown } | null)?.bounce;
    if (bounce === undefined) continue;
    const reason = invalidBounceReason(bounce);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment launch height (ADR 0069) that is not valid, named by index
 * — the same counterpart as {@link invalidTrackMudReason}.
 */
export const invalidTrackLaunchReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const launch = (segment as { launch?: unknown } | null)?.launch;
    if (launch === undefined) continue;
    const reason = invalidLaunchReason(launch);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment Start mark or Checkpoint (ADR 0068) whose own shape is not
 * valid, named by index — the course rules across Segments (one Start, unique
 * numbers, nothing moving) are `invalidTrackCourseReason`'s, once the Track is
 * known to be a Track.
 */
export const invalidTrackCourseFieldsReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const { start, checkpoint } = (segment as { start?: unknown; checkpoint?: unknown } | null) ?? {};
    const reason =
      (start === undefined ? undefined : invalidStartReason(start)) ??
      (checkpoint === undefined ? undefined : invalidCheckpointReason(checkpoint));
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

/**
 * The first Segment carrying both ice and mud (ADR 0067), named by index —
 * one deck, one Surface. Publish refuses the pair outright; `resolveTrack`
 * still defines mud-wins precedence for Tracks that arrive unvalidated
 * (the builder never validates on place).
 */
export const invalidTrackSurfaceConflictReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    const { ice, mud, bounce } =
      (segment as { ice?: unknown; mud?: unknown; bounce?: unknown } | null) ?? {};
    // One deck, one Surface (ADR 0066/0067/0070) — any pair among the three is
    // refused, not just the original ice+mud one.
    const attached = [
      ice === undefined ? undefined : "ice",
      mud === undefined ? undefined : "mud",
      bounce === undefined ? undefined : "bounce",
    ].filter((name): name is string => name !== undefined);
    if (attached.length > 1) {
      return `track[${index}].${attached.join(" and ")} are mutually exclusive — one deck, one Surface, so detach all but one`;
    }
  }
  return undefined;
};

export const isTrack = (value: unknown): value is Track => Array.isArray(value) && value.every(isSegment);

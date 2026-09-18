import {
  attachmentConflictReason,
  invalidAttachmentReason,
  MAX_SEGMENT_SCALE,
  MAX_SURVIVOR_TARGET,
  MAX_TRACK_THUMBNAIL_CHARS,
  MIN_SEGMENT_SCALE,
  TRACK_THUMBNAIL_DATA_URL_PREFIX,
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
const isOptionalFiniteNumber = (value: unknown): boolean => value === undefined || isFiniteNumber(value);

const isVec3 = (value: unknown): boolean => {
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
const isSegment = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as {
    moduleId?: unknown;
    position?: unknown;
    rotation?: unknown;
    pitch?: unknown;
    roll?: unknown;
    scale?: unknown;
  };
  return (
    typeof segment.moduleId === "string" &&
    isVec3(segment.position) &&
    isFiniteNumber(segment.rotation) &&
    isOptionalFiniteNumber(segment.pitch) &&
    isOptionalFiniteNumber(segment.roll) &&
    (segment.scale === undefined || isSegmentScale(segment.scale)) &&
    invalidAttachmentReason(segment) === undefined
  );
};

/** A uniform `Segment.scale` inside the bounds a Revision may store (ADR 0062). */
const isSegmentScale = (value: unknown): boolean =>
  isFiniteNumber(value) && (value as number) >= MIN_SEGMENT_SCALE && (value as number) <= MAX_SEGMENT_SCALE;

/**
 * The first Segment whose Attachments (ADR 0099) are not storable, named by
 * index — each value's own shape first, then the ones it may not carry
 * together — so a refused publish says which Segment and why, not only "not a
 * Segment[]". The course rules *across* Segments (one Start, unique
 * Checkpoint numbers, nothing moving) are `invalidTrackCourseReason`'s, once
 * the Track is known to be a Track.
 */
export const invalidTrackAttachmentReason = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const [index, segment] of value.entries()) {
    if (typeof segment !== "object" || segment === null) continue;
    const reason = invalidAttachmentReason(segment) ?? attachmentConflictReason(segment);
    if (reason) return `track[${index}].${reason}`;
  }
  return undefined;
};

export const isTrack = (value: unknown): value is Track => Array.isArray(value) && value.every(isSegment);

/** Base64 payload characters — what `canvas.toDataURL("image/jpeg")` emits after the prefix, nothing else. */
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validates a published Thumbnail (ADR 0085), returning the reason it is
 * unacceptable or `undefined` if it's fine. `undefined` input is valid — a
 * publish that omits it stores no Thumbnail, which is what keeps every
 * pre-Thumbnail caller (and the playtest publish) working unchanged.
 *
 * Rejected rather than clamped or re-encoded, like the Time Limit above: a
 * Revision is immutable (ADR 0032), so a silently-altered screenshot would
 * be permanent and invisible to the author who framed it. The payload check
 * is shape-only (prefix, alphabet, length) — the API never decodes the
 * JPEG, it just refuses anything that could not be one.
 */
export const invalidTrackThumbnailReason = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.startsWith(TRACK_THUMBNAIL_DATA_URL_PREFIX)) {
    return `thumbnail must be a "${TRACK_THUMBNAIL_DATA_URL_PREFIX}…" data URL`;
  }
  if (value.length > MAX_TRACK_THUMBNAIL_CHARS) {
    return `thumbnail must be at most ${MAX_TRACK_THUMBNAIL_CHARS} characters, got ${value.length}`;
  }
  const payload = value.slice(TRACK_THUMBNAIL_DATA_URL_PREFIX.length);
  if (payload.length === 0 || payload.length % 4 !== 0 || !BASE64_PAYLOAD.test(payload)) {
    return "thumbnail payload must be non-empty base64";
  }
  return undefined;
};

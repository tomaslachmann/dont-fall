import {
  MAX_SURVIVOR_TARGET,
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

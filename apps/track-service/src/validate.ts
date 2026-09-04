import { MAX_TIME_LIMIT_MS, MIN_TIME_LIMIT_MS, type Module, type Track } from "@dont-fall/shared";

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

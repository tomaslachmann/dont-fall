import type { Module, Track } from "@dont-fall/shared";

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

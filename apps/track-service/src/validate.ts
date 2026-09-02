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
    if (!(segment.moduleId in modules)) unknown.add(segment.moduleId);
  }
  return [...unknown];
};

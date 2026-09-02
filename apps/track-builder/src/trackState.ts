import { MODULE_STEP, addVec3, type Segment, type Track } from "@dont-fall/shared";

/**
 * Appends `moduleId` right after the last placed Segment, `MODULE_STEP` away —
 * the same uniform-footprint chaining `chainTrack` (`@dont-fall/shared`) uses,
 * so a hand-built Track can never produce a gap/overlap (ADR 0030).
 */
export const appendModule = (track: Track, moduleId: string): Track => {
  const last = track[track.length - 1];
  const position = last ? addVec3(last.position, MODULE_STEP) : { x: 0, y: 0, z: 0 };
  const segment: Segment = { moduleId, position, rotation: 0 };
  return [...track, segment];
};

/** Removes the most recently placed Segment. A no-op on an empty Track. */
export const removeLast = (track: Track): Track => track.slice(0, -1);

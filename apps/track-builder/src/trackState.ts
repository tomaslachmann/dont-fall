import { placeAfter, type Module, type Segment, type Track } from "@dont-fall/shared";

/**
 * Appends `moduleId` right after the last placed Segment, aligning its entry
 * Socket against the previous Module's exit Socket (ADR 0031) — a hand-built
 * Track can never produce a gap/overlap this way, since every current Socket
 * is the same type.
 */
export const appendModule = (track: Track, moduleId: string, modules: Record<string, Module>): Track => {
  const module = modules[moduleId];
  if (!module) throw new Error(`appendModule: unknown Module "${moduleId}"`);

  const last = track[track.length - 1];
  if (!last) return [{ moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

  const prevModule = modules[last.moduleId];
  if (!prevModule) throw new Error(`appendModule: unknown Module "${last.moduleId}" already in the Track`);

  const segment: Segment = placeAfter(last, prevModule, moduleId, module);
  return [...track, segment];
};

/** Removes the most recently placed Segment. A no-op on an empty Track. */
export const removeLast = (track: Track): Track => track.slice(0, -1);

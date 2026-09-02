import {
  addVec3,
  findSocket,
  placeAfter,
  rotateYaw,
  subVec3,
  type Module,
  type Segment,
  type Track,
} from "@dont-fall/shared";

/**
 * Re-derives every Segment from `fromIndex` onward via `placeAfter`, chained
 * from whatever sits at `fromIndex - 1` — the single operation every edit
 * (delete/insert/duplicate/rotate) reduces to (ticket 08). `fromIndex`'s own
 * `moduleId` is kept; its position/rotation is recomputed unless it's index
 * 0, which has no predecessor to chain from and keeps its own values as-is.
 */
export const rechainFrom = (track: Track, modules: Record<string, Module>, fromIndex: number): Track => {
  const result: Track = track.slice(0, fromIndex);
  for (let i = fromIndex; i < track.length; i += 1) {
    const moduleId = track[i]!.moduleId;
    const module = modules[moduleId];
    if (!module) throw new Error(`rechainFrom: unknown Module "${moduleId}"`);

    if (i === 0) {
      result.push({ moduleId, position: track[i]!.position, rotation: track[i]!.rotation });
    } else {
      const prevSegment = result[i - 1]!;
      const prevModule = modules[prevSegment.moduleId];
      if (!prevModule) throw new Error(`rechainFrom: unknown Module "${prevSegment.moduleId}"`);
      result.push(placeAfter(prevSegment, prevModule, moduleId, module));
    }
  }
  return result;
};

/** Inserts `moduleId` at `index` (pushing anything already there later) and re-chains from it onward. */
export const insertSegment = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  moduleId: string,
): Track => {
  const placeholder: Segment = { moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 };
  const withPlaceholder = [...track.slice(0, index), placeholder, ...track.slice(index)];
  return rechainFrom(withPlaceholder, modules, index);
};

/** Appends `moduleId` at the end — the common case of {@link insertSegment}. */
export const appendModule = (track: Track, moduleId: string, modules: Record<string, Module>): Track =>
  insertSegment(track, modules, track.length, moduleId);

/** Removes the Segment at `index` (any index, not just the last) and re-chains everything after it. */
export const deleteSegment = (track: Track, modules: Record<string, Module>, index: number): Track => {
  const without = track.filter((_, i) => i !== index);
  return rechainFrom(without, modules, Math.min(index, without.length));
};

/** Removes the most recently placed Segment. A no-op on an empty Track. */
export const removeLast = (track: Track): Track => track.slice(0, -1);

/** Duplicates the Segment at `index`, inserting the copy right after it. */
export const duplicateSegment = (track: Track, modules: Record<string, Module>, index: number): Track =>
  insertSegment(track, modules, index + 1, track[index]!.moduleId);

const TWO_PI = Math.PI * 2;
const normalizeYaw = (yaw: number): number => ((yaw % TWO_PI) + TWO_PI) % TWO_PI;

/**
 * Rotates the Segment at `index` by `deltaRadians` (a multiple of 90°) around
 * its own entry Socket — the world point where it connects to whatever's
 * before it stays fixed, only its facing (and, since it pivots around an
 * off-centre Socket, its own position) changes. Everything after `index` is
 * then re-chained naturally from the newly-rotated Segment.
 *
 * Simplification: rotating Segment `index` does not try to preserve any
 * rotation a later Segment already had independently — re-chaining always
 * continues "straight" (0 additional twist) from `index` onward. Every
 * current Module is a straight corridor anyway (no authored turn variant
 * exists yet), so there is nothing downstream to preserve in practice; this
 * is a deliberate v1 boundary, not an oversight (ticket 08).
 */
export const rotateSegment = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  deltaRadians: number,
): Track => {
  const settled = rechainFrom(track, modules, index);
  const segment = settled[index]!;
  const module = modules[segment.moduleId];
  if (!module) throw new Error(`rotateSegment: unknown Module "${segment.moduleId}"`);

  const newRotation = normalizeYaw(segment.rotation + deltaRadians);
  let rotated: Segment;
  if (index === 0) {
    rotated = { ...segment, rotation: newRotation };
  } else {
    const entry = findSocket(module, "entry");
    const anchor = addVec3(segment.position, rotateYaw(entry.position, segment.rotation));
    const newPosition = subVec3(anchor, rotateYaw(entry.position, newRotation));
    rotated = { moduleId: segment.moduleId, position: newPosition, rotation: newRotation };
  }

  const withRotated = [...settled.slice(0, index), rotated, ...settled.slice(index + 1)];
  return rechainFrom(withRotated, modules, index + 1);
};

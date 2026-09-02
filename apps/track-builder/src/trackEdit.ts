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

const assertIndexInRange = (fn: string, track: Track, index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= track.length) {
    throw new Error(`${fn}: index ${index} is out of range for a Track of length ${track.length}`);
  }
};

/** Same bound as {@link assertIndexInRange} but allows `index === track.length` (an append/insert-at-end). */
const assertInsertIndexInRange = (fn: string, track: Track, index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index > track.length) {
    throw new Error(`${fn}: index ${index} is out of range for a Track of length ${track.length}`);
  }
};

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
  assertInsertIndexInRange("insertSegment", track, index);
  const placeholder: Segment = { moduleId, position: { x: 0, y: 0, z: 0 }, rotation: 0 };
  const withPlaceholder = [...track.slice(0, index), placeholder, ...track.slice(index)];
  return rechainFrom(withPlaceholder, modules, index);
};

/** Appends `moduleId` at the end — the common case of {@link insertSegment}. */
export const appendModule = (track: Track, moduleId: string, modules: Record<string, Module>): Track =>
  insertSegment(track, modules, track.length, moduleId);

/** Removes the Segment at `index` (any index, not just the last) and re-chains everything after it. */
export const deleteSegment = (track: Track, modules: Record<string, Module>, index: number): Track => {
  assertIndexInRange("deleteSegment", track, index);
  const without = track.filter((_, i) => i !== index);
  return rechainFrom(without, modules, Math.min(index, without.length));
};

/** Removes the most recently placed Segment. A no-op on an empty Track. */
export const removeLast = (track: Track): Track => track.slice(0, -1);

/** Duplicates the Segment at `index`, inserting the copy right after it. */
export const duplicateSegment = (track: Track, modules: Record<string, Module>, index: number): Track => {
  assertIndexInRange("duplicateSegment", track, index);
  return insertSegment(track, modules, index + 1, track[index]!.moduleId);
};

const TWO_PI = Math.PI * 2;
const normalizeYaw = (yaw: number): number => ((yaw % TWO_PI) + TWO_PI) % TWO_PI;

/**
 * Rotates the Segment at `index` by `deltaRadians` (yaw only — ticket 01/02
 * generalize the Track/Segment data model to full 3D orientation, but this
 * editor function stays yaw-only until ticket 02/03 build real free-rotation
 * UI) around its own entry Socket — the world point where it connects to
 * whatever's before it stays fixed, only its facing (and, since it pivots
 * around an off-centre Socket, its own position) changes. Everything after
 * `index` is then re-chained naturally from the newly-rotated Segment.
 *
 * No longer restricted to a multiple of 90° (ADR 0034 lifted ADR 0031's
 * restriction at the data-model/physics level) — today's two toolbar buttons
 * still only ever call this with exactly ±90°, so this is a forward-
 * compatibility unblock for ticket 02/03's free-rotation UI, not a behavior
 * change for the current UI.
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
  assertIndexInRange("rotateSegment", track, index);
  // Defensive, not redundant: `track` isn't guaranteed already-settled — it
  // may have come from `history.reset` (a Track loaded from track-service,
  // possibly saved by a different, less careful caller than this module's
  // own edit functions).
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
    // Code review: this used to build a fresh `{ moduleId, position,
    // rotation }` literal instead of spreading `segment`, silently dropping
    // any `pitch`/`roll` a Segment already had — this yaw-only rotate never
    // touches those fields, so they must survive exactly like the index-0
    // branch above already preserves them.
    rotated = { ...segment, position: newPosition, rotation: newRotation };
  }

  const withRotated = [...settled.slice(0, index), rotated, ...settled.slice(index + 1)];
  return rechainFrom(withRotated, modules, index + 1);
};

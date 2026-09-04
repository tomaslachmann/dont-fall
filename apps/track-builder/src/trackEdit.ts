import {
  addVec3,
  findSocket,
  inflateBox,
  lengthVec3,
  obbsOverlap,
  orientBox,
  placeAfter,
  rotateVec3ByQuat,
  segmentOrientation,
  subVec3,
  type Module,
  type Quat,
  type Segment,
  type Track,
  type Vec3,
} from "@dont-fall/shared";

/**
 * An absolute Segment position/orientation — what `setSegmentTransform`/
 * `setSegmentTransforms` set wholesale, and what the on-canvas gizmo's
 * drag-end commit produces (ticket 03/05). Canonical home for this shape:
 * `viewport.ts` re-exports it as `SegmentTransform` rather than declaring
 * its own copy (code review, ticket 05), since `trackEdit.ts` can't import
 * from `viewport.ts` (which already imports the other direction, from here).
 */
export interface SegmentTransform {
  position: Vec3;
  rotation: number;
  pitch: number;
  roll: number;
}

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
 * (delete/insert/duplicate/rotate/move) reduces to (ticket 08). `fromIndex`'s
 * own `moduleId` is kept; its position/rotation/pitch/roll are recomputed
 * unless it's index 0 (no predecessor to chain from) or it's flagged
 * `manuallyPlaced` (ticket 02) — either way it keeps its own values as-is,
 * and whatever comes after it still chains from wherever it actually is.
 */
export const rechainFrom = (track: Track, modules: Record<string, Module>, fromIndex: number): Track => {
  const result: Track = track.slice(0, fromIndex);
  for (let i = fromIndex; i < track.length; i += 1) {
    const segment = track[i]!;
    const moduleId = segment.moduleId;
    const module = modules[moduleId];
    if (!module) throw new Error(`rechainFrom: unknown Module "${moduleId}"`);

    if (i === 0 || segment.manuallyPlaced) {
      result.push({ ...segment });
    } else {
      const prevSegment = result[i - 1]!;
      const prevModule = modules[prevSegment.moduleId];
      if (!prevModule) throw new Error(`rechainFrom: unknown Module "${prevSegment.moduleId}"`);
      result.push(placeAfter(prevSegment, prevModule, moduleId, module));
    }
  }
  return result;
};

/**
 * Settles just Segment `index` — the one entry `rechainFrom(track, modules,
 * index)` computes that `moveSegment`/`rotateSegment`/`setSegmentTransform`
 * actually need before overwriting it, without also computing (and
 * immediately discarding) every entry after it, which `rechainFrom` would
 * otherwise do in the same pass (code review, ticket 03: those three
 * functions were calling `rechainFrom` twice per edit — once here, then
 * again after the mutation — recomputing the same downstream tail both
 * times for no reason, since the first pass's tail is invalidated by the
 * mutation before it's ever used). Same "trust the prefix" assumption
 * `rechainFrom` itself already makes: `track[index - 1]` is taken as
 * correct as-is, not re-settled recursively.
 */
const settleOne = (fn: string, track: Track, modules: Record<string, Module>, index: number): Segment => {
  const segment = track[index]!;
  const module = modules[segment.moduleId];
  if (!module) throw new Error(`${fn}: unknown Module "${segment.moduleId}"`);
  if (index === 0 || segment.manuallyPlaced) return { ...segment };

  const prevSegment = track[index - 1]!;
  const prevModule = modules[prevSegment.moduleId];
  if (!prevModule) throw new Error(`${fn}: unknown Module "${prevSegment.moduleId}"`);
  return placeAfter(prevSegment, prevModule, segment.moduleId, module);
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

// Two-tier snap steps (ADR 0034). `MOVE_STEP_FINE`/`ROTATE_STEP`/
// `ROTATE_STEP_FINE` are shared by the keyboard nudge (ticket 02) and the
// on-canvas gizmo (ticket 03), so the two interaction paths can never
// silently drift apart on what "coarse"/"fine" mean. `MOVE_STEP` (the
// keyboard's *coarse* position step) has no gizmo equivalent — the gizmo's
// default position tier is Socket-snap, not a fixed grid — but lives here
// too (code review, ticket 03) rather than as a local magic number in
// main.ts, alongside the three constants it's a sibling of.
export const MOVE_STEP = 0.5;
export const MOVE_STEP_FINE = 0.1;
export const ROTATE_STEP = (15 * Math.PI) / 180;
export const ROTATE_STEP_FINE = (5 * Math.PI) / 180;

const TWO_PI = Math.PI * 2;
const normalizeAngle = (radians: number): number => ((radians % TWO_PI) + TWO_PI) % TWO_PI;

/** Which of a Segment's three orientation fields a rotate step turns (ADR 0034/ticket 02). */
export type RotateAxis = "yaw" | "pitch" | "roll";

const FIELD_BY_AXIS: Record<RotateAxis, "rotation" | "pitch" | "roll"> = {
  yaw: "rotation",
  pitch: "pitch",
  roll: "roll",
};

/**
 * Rotates the Segment at `index` by `deltaRadians` on `axis` (defaults to
 * `"yaw"`, matching every existing caller — the toolbar's ±90° buttons)
 * around its own entry Socket — the world point where it connects to
 * whatever's before it stays fixed, only its facing (and, since it pivots
 * around an off-centre Socket, its own position) changes. Everything after
 * `index` is then re-chained naturally from the newly-rotated Segment.
 * Marks the Segment `manuallyPlaced` (ticket 02) — an explicit rotation
 * exempts it from a later unrelated edit silently resetting it.
 *
 * No longer restricted to a multiple of 90° (ADR 0034 lifted ADR 0031's
 * restriction at the data-model/physics level) — the toolbar's two buttons
 * still only ever call this with exactly ±90° on the yaw axis; `axis` and
 * finer deltas exist for ticket 02's keyboard nudge / ticket 03's gizmo.
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
  axis: RotateAxis = "yaw",
): Track => {
  assertIndexInRange("rotateSegment", track, index);
  // Defensive, not redundant: `track` isn't guaranteed already-settled — it
  // may have come from `history.reset` (a Track loaded from track-service,
  // possibly saved by a different, less careful caller than this module's
  // own edit functions).
  const segment = settleOne("rotateSegment", track, modules, index);
  const module = modules[segment.moduleId]!; // settleOne already validated this exists

  const field = FIELD_BY_AXIS[axis];
  const newValue = normalizeAngle((segment[field] ?? 0) + deltaRadians);
  const withNewAngle: Segment = { ...segment, [field]: newValue, manuallyPlaced: true };

  let rotated: Segment;
  if (index === 0) {
    rotated = withNewAngle;
  } else {
    const entry = findSocket(module, "entry");
    const anchor = addVec3(segment.position, rotateVec3ByQuat(entry.position, segmentOrientation(segment)));
    const newPosition = subVec3(anchor, rotateVec3ByQuat(entry.position, segmentOrientation(withNewAngle)));
    rotated = { ...withNewAngle, position: newPosition };
  }

  // `track.slice(index + 1)` is a placeholder only — `rechainFrom` below
  // recomputes every one of those entries from `rotated` onward regardless.
  const withRotated = [...track.slice(0, index), rotated, ...track.slice(index + 1)];
  return rechainFrom(withRotated, modules, index + 1);
};

/**
 * Moves the Segment at `index` by `delta` (world-space, ticket 02's keyboard
 * nudge) — unlike `rotateSegment`, there's no Socket to keep anchored; the
 * Segment's position is simply offset. Marks it `manuallyPlaced`, then
 * re-chains everything after it from the new position, exactly like every
 * other edit in this module.
 */
export const moveSegment = (track: Track, modules: Record<string, Module>, index: number, delta: Vec3): Track => {
  assertIndexInRange("moveSegment", track, index);
  const segment = settleOne("moveSegment", track, modules, index);
  const moved: Segment = { ...segment, position: addVec3(segment.position, delta), manuallyPlaced: true };

  // `track.slice(index + 1)` is a placeholder only — see `rotateSegment`.
  const withMoved = [...track.slice(0, index), moved, ...track.slice(index + 1)];
  return rechainFrom(withMoved, modules, index + 1);
};

/**
 * Sets the Segment at `index`'s position/orientation to an absolute value —
 * the on-canvas gizmo's drag-end commit (ticket 03), unlike `moveSegment`/
 * `rotateSegment`'s deltas. Marks it `manuallyPlaced`, then re-chains
 * everything after it, exactly like every other edit in this module.
 */
export const setSegmentTransform = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  transform: SegmentTransform,
): Track => {
  assertIndexInRange("setSegmentTransform", track, index);
  const segment = settleOne("setSegmentTransform", track, modules, index);
  const updated: Segment = { ...segment, ...transform, manuallyPlaced: true };

  // `track.slice(index + 1)` is a placeholder only — see `rotateSegment`.
  const withUpdated = [...track.slice(0, index), updated, ...track.slice(index + 1)];
  return rechainFrom(withUpdated, modules, index + 1);
};

/**
 * Batched form of {@link setSegmentTransform} — the multi-select gizmo's
 * rigid-group drag-end commit (ticket 05): every Segment named in `updates`
 * gets its own absolute transform and `manuallyPlaced` flag, exactly as a
 * single-Segment drag would. Implemented as a straight fold over the
 * single-Segment function rather than a new algorithm — each update already
 * carries its own final absolute transform (computed live by the caller from
 * the dragged pivot's offset), so there's nothing about "doing several at
 * once" that isn't just "do each one, in turn."
 */
export const setSegmentTransforms = (
  track: Track,
  modules: Record<string, Module>,
  updates: { index: number; transform: SegmentTransform }[],
): Track => updates.reduce((acc, { index, transform }) => setSegmentTransform(acc, modules, index, transform), track);

/** Snap radius (world units) for Socket-snapping a translate drag (ticket 03). */
export const SOCKET_SNAP_RADIUS = 1.5;

/**
 * If the Segment at `index`, placed at `candidatePosition` (its rotation
 * unchanged — Socket-snap and rotate-snap are independent concerns, per the
 * ticket), would land its own entry or exit Socket within
 * {@link SOCKET_SNAP_RADIUS} of the matching Socket on its immediate
 * neighbor in the sequence — the predecessor's exit, or the successor's
 * entry — returns `candidatePosition` adjusted so that Socket lands exactly
 * on the neighbor's. Otherwise returns `candidatePosition` unchanged.
 *
 * Deliberately scoped to the Track's own two natural connection points
 * (immediate predecessor/successor), not a track-wide nearest-Socket search
 * across every Segment — Track topology is still a single linear,
 * non-branching sequence (ADR 0030, unchanged by ADR 0034), so "the nearest
 * compatible Socket" for a Segment in that sequence means reconnecting to
 * whichever neighbor it already has, not grabbing onto an arbitrary distant
 * Segment's Socket.
 */
export const snapPositionToNeighborSocket = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  candidatePosition: Vec3,
): Vec3 => {
  const segment = track[index];
  const module = segment && modules[segment.moduleId];
  if (!segment || !module) return candidatePosition;
  const orientation = segmentOrientation(segment);

  const neighbors: { localSocketId: string; targetWorld: Vec3 }[] = [];
  const prev = track[index - 1];
  const prevModule = prev && modules[prev.moduleId];
  if (prev && prevModule) {
    const exit = findSocket(prevModule, "exit");
    neighbors.push({ localSocketId: "entry", targetWorld: addVec3(prev.position, rotateVec3ByQuat(exit.position, segmentOrientation(prev))) });
  }
  const next = track[index + 1];
  const nextModule = next && modules[next.moduleId];
  if (next && nextModule) {
    const entry = findSocket(nextModule, "entry");
    neighbors.push({ localSocketId: "exit", targetWorld: addVec3(next.position, rotateVec3ByQuat(entry.position, segmentOrientation(next))) });
  }

  let best: { position: Vec3; distance: number } | undefined;
  for (const neighbor of neighbors) {
    const localSocket = findSocket(module, neighbor.localSocketId);
    const socketWorld = addVec3(candidatePosition, rotateVec3ByQuat(localSocket.position, orientation));
    const offset = subVec3(neighbor.targetWorld, socketWorld);
    const distance = lengthVec3(offset);
    if (distance <= SOCKET_SNAP_RADIUS && (!best || distance < best.distance)) {
      best = { position: addVec3(candidatePosition, offset), distance };
    }
  }
  return best?.position ?? candidatePosition;
};

/**
 * Whether the Segment at `index`, placed at `candidatePosition`/
 * `candidateOrientation` (a live drag's candidate transform, not necessarily
 * its currently-stored one), overlaps any *other* Segment's Footprint — the
 * live overlap-feedback primitive (ticket 04). Each Footprint is grown by its
 * own `clearance` before testing (`inflateBox`), and overlap itself is the
 * full oriented-box SAT test (`obbsOverlap`), so this is robust to any
 * rotation either Segment is at, not just axis-aligned placements.
 *
 * Deliberately excludes the Segment's own immediate chain neighbors (`index -
 * 1`, `index + 1`) — their Footprints are *supposed* to touch exactly at the
 * shared Socket by construction (every Module's Footprint reaches its Socket
 * boundary), so flagging that as "overlap" would make ordinary,
 * correctly-connected Segments permanently show red. Same "the Track's own
 * two natural connection points are special" scoping `snapPositionToNeighborSocket`
 * already uses.
 */
export const segmentOverlapsAnyOther = (
  track: Track,
  modules: Record<string, Module>,
  index: number,
  candidatePosition: Vec3,
  candidateOrientation: Quat,
): boolean => {
  const segment = track[index];
  const module = segment && modules[segment.moduleId];
  if (!module) return false;
  const candidateBox = inflateBox(
    orientBox(module.footprint.bounds, candidatePosition, candidateOrientation),
    module.footprint.clearance,
  );

  return track.some((other, otherIndex) => {
    if (otherIndex === index || otherIndex === index - 1 || otherIndex === index + 1) return false;
    const otherModule = modules[other.moduleId];
    if (!otherModule) return false;
    const otherBox = inflateBox(
      orientBox(otherModule.footprint.bounds, other.position, segmentOrientation(other)),
      otherModule.footprint.clearance,
    );
    return obbsOverlap(candidateBox, otherBox);
  });
};

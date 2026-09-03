import { conjugateQuat, IDENTITY_QUAT, type Quat } from "./quat.js";
import { addVec3, rotateVec3ByQuat, subVec3, type Vec3 } from "./vec3.js";

/** An axis-aligned box, in whatever local frame it's authored in: a centre and half-extents on each axis. */
export interface Box {
  center: Vec3;
  halfExtents: Vec3;
}

/** Whether `point` lies inside the axis-aligned box (inclusive of the surface). */
export const pointInBox = (point: Vec3, box: Box): boolean =>
  Math.abs(point.x - box.center.x) <= box.halfExtents.x &&
  Math.abs(point.y - box.center.y) <= box.halfExtents.y &&
  Math.abs(point.z - box.center.z) <= box.halfExtents.z;

/**
 * A `Box` placed into world space with a full 3D rotation (ADR 0034) —
 * `RapierSimulation`'s static colliders consume this directly via a real
 * `setRotation()`, so `halfExtents` never needs adjusting for the rotation
 * the way the old AABB-swap trick did. `rotation` is carried through
 * unchanged from whatever placed it (a Segment's orientation, ultimately).
 * Optional, defaulting to identity (unrotated) — so a plain `Box` literal
 * (every static geometry test written before ADR 0034) is still a valid
 * `OrientedBox` as-is, with no rotation to speak of.
 */
export interface OrientedBox {
  center: Vec3;
  halfExtents: Vec3;
  rotation?: Quat;
}

/**
 * Whether `point` lies inside `box`, honoring its rotation (ADR 0034 code
 * review) — un-rotates `point` into the box's own local frame (subtract the
 * centre, then apply the inverse rotation) and reuses {@link pointInBox}'s
 * plain axis-aligned check there. Used for Checkpoint containment: the old
 * `rotateBoxYaw90`-based placement kept an axis-aligned trigger volume
 * correctly sized at 90°/270° by swapping its halfExtents; a genuinely
 * rotated volume needs this instead, and it works at any angle, not just a
 * multiple of 90°.
 */
export const pointInOrientedBox = (point: Vec3, box: OrientedBox): boolean => {
  const local = rotateVec3ByQuat(subVec3(point, box.center), conjugateQuat(box.rotation ?? IDENTITY_QUAT));
  return pointInBox(local, { center: { x: 0, y: 0, z: 0 }, halfExtents: box.halfExtents });
};

/**
 * Places a local `box` into world space by `translation` + `rotation`
 * (ADR 0034) — replaces `rotateBoxYaw90`'s axis-aligned-only placement.
 * `halfExtents` pass through untouched: the box's own local shape never
 * changes, only where and how it's oriented in the world. Accepts any
 * rotation, not just a multiple of 90° — the previous restriction existed
 * only because the old placement scheme pre-rotated an AABB by hand instead
 * of giving the physics engine a real rotated collider.
 */
export const orientBox = (box: Box, translation: Vec3, rotation: Quat): OrientedBox => ({
  center: addVec3(rotateVec3ByQuat(box.center, rotation), translation),
  halfExtents: box.halfExtents,
  rotation,
});

/** Grows `box`'s half-extents by `amount` on every axis, leaving its centre/rotation untouched — a Footprint's `clearance` (ticket 04), before overlap-checking. */
export const inflateBox = (box: OrientedBox, amount: number): OrientedBox => ({
  ...box,
  halfExtents: { x: box.halfExtents.x + amount, y: box.halfExtents.y + amount, z: box.halfExtents.z + amount },
});

/**
 * Whether two oriented boxes overlap — the standard 15-axis Separating Axis
 * Theorem test for two OBBs (Ericson, *Real-Time Collision Detection* §4.4.1;
 * ticket 04's live overlap-feedback primitive). Checks each box's own 3 face
 * normals, then the 9 axes formed by every pair of the two boxes' edge
 * directions; if any of the 15 is a separating axis (the boxes' projections
 * onto it don't overlap), the boxes don't overlap. Inclusive at exact
 * contact, matching {@link pointInBox}'s convention.
 *
 * `EPSILON` guards the edge-cross-product axes against the classic
 * near-parallel-edges failure mode (a cross product of two nearly-parallel
 * vectors is tiny and numerically unreliable) — the standard fix from the
 * same reference.
 */
const SAT_EPSILON = 1e-6;

export const obbsOverlap = (a: OrientedBox, b: OrientedBox): boolean => {
  const rotA = a.rotation ?? IDENTITY_QUAT;
  const rotB = b.rotation ?? IDENTITY_QUAT;

  // Each box's own local axes, as world-space unit vectors.
  const axesA = [
    rotateVec3ByQuat({ x: 1, y: 0, z: 0 }, rotA),
    rotateVec3ByQuat({ x: 0, y: 1, z: 0 }, rotA),
    rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, rotA),
  ];
  const axesB = [
    rotateVec3ByQuat({ x: 1, y: 0, z: 0 }, rotB),
    rotateVec3ByQuat({ x: 0, y: 1, z: 0 }, rotB),
    rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, rotB),
  ];
  const eA = [a.halfExtents.x, a.halfExtents.y, a.halfExtents.z];
  const eB = [b.halfExtents.x, b.halfExtents.y, b.halfExtents.z];
  const dot = (u: Vec3, v: Vec3): number => u.x * v.x + u.y * v.y + u.z * v.z;

  // R[i][j] = dot(axesA[i], axesB[j]) — B's axes expressed in A's frame.
  const R: number[][] = axesA.map((ai) => axesB.map((bj) => dot(ai, bj)));
  const AbsR: number[][] = R.map((row) => row.map((v) => Math.abs(v) + SAT_EPSILON));

  // Centre-to-centre offset, expressed in A's frame.
  const d = subVec3(b.center, a.center);
  const t = axesA.map((ai) => dot(ai, d));

  // Axes L = A's own face normals (A0, A1, A2).
  for (let i = 0; i < 3; i += 1) {
    const ra = eA[i]!;
    const rb = eB[0]! * AbsR[i]![0]! + eB[1]! * AbsR[i]![1]! + eB[2]! * AbsR[i]![2]!;
    if (Math.abs(t[i]!) > ra + rb) return false;
  }

  // Axes L = B's own face normals (B0, B1, B2).
  for (let j = 0; j < 3; j += 1) {
    const ra = eA[0]! * AbsR[0]![j]! + eA[1]! * AbsR[1]![j]! + eA[2]! * AbsR[2]![j]!;
    const rb = eB[j]!;
    const tProj = t[0]! * R[0]![j]! + t[1]! * R[1]![j]! + t[2]! * R[2]![j]!;
    if (Math.abs(tProj) > ra + rb) return false;
  }

  // Axes L = Ai × Bj, the 9 cross-products of the two boxes' edge directions.
  // Indices used below follow the standard reference table exactly (each
  // `(i, j)` pair has its own `ra`/`rb`/projection formula — these are not
  // interchangeable with a generic loop without the specific index pattern).
  const edgeAxisChecks: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ];
  for (const [i, j] of edgeAxisChecks) {
    // i1/i2 are the two axis indices other than i (cyclic), same for j1/j2.
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    const j1 = (j + 1) % 3;
    const j2 = (j + 2) % 3;
    const ra = eA[i1]! * AbsR[i2]![j]! + eA[i2]! * AbsR[i1]![j]!;
    const rb = eB[j1]! * AbsR[i]![j2]! + eB[j2]! * AbsR[i]![j1]!;
    const tProj = Math.abs(t[i2]! * R[i1]![j]! - t[i1]! * R[i2]![j]!);
    if (tProj > ra + rb) return false;
  }

  return true;
};

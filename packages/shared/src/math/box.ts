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

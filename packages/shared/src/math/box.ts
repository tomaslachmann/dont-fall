import { rotateYaw, type Vec3 } from "./vec3.js";

/** An axis-aligned box: a centre and half-extents on each axis. */
export interface Box {
  center: Vec3;
  halfExtents: Vec3;
}

/** Whether `point` lies inside the axis-aligned box (inclusive of the surface). */
export const pointInBox = (point: Vec3, box: Box): boolean =>
  Math.abs(point.x - box.center.x) <= box.halfExtents.x &&
  Math.abs(point.y - box.center.y) <= box.halfExtents.y &&
  Math.abs(point.z - box.center.z) <= box.halfExtents.z;

const HALF_PI_EPSILON = 1e-6;

/**
 * Rotates an axis-aligned `box` by `yaw` radians around Y, staying
 * axis-aligned — required by ADR 0031: `RapierSimulation`'s static colliders
 * (`ColliderDesc.cuboid`) are translation-only, with no rotation on the
 * fixed rigid body, so a Segment's placement rotation is restricted to
 * multiples of 90° specifically so every Box stays a valid AABB after
 * rotation (at 90°/270° the local X/Z half-extents swap; the box's own
 * dimensions never change at 0°/180°). Throws if `yaw` isn't close to a
 * multiple of 90° — silently rotating a Box by an arbitrary angle would
 * desync the visual/logical placement from what actually collides.
 */
export const rotateBoxYaw90 = (box: Box, yaw: number): Box => {
  const center = rotateYaw(box.center, yaw);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const isAxisAligned = Math.abs(cos) < HALF_PI_EPSILON || Math.abs(sin) < HALF_PI_EPSILON;
  if (!isAxisAligned) {
    throw new Error(
      `rotateBoxYaw90: yaw ${yaw} rad is not a multiple of 90° — a Box must stay axis-aligned ` +
        `(ADR 0031, static colliders don't rotate)`,
    );
  }
  // At 0°/180° cos ≈ ±1 (no swap); at 90°/270° cos ≈ 0 (swap X/Z).
  const swapped = Math.abs(cos) < HALF_PI_EPSILON;
  const halfExtents = swapped
    ? { x: box.halfExtents.z, y: box.halfExtents.y, z: box.halfExtents.x }
    : { x: box.halfExtents.x, y: box.halfExtents.y, z: box.halfExtents.z };
  return { center, halfExtents };
};

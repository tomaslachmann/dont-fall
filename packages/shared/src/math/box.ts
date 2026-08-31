import type { Vec3 } from "./vec3.js";

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

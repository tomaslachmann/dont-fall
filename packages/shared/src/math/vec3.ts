/** A 3D vector in world space. Plain data so it serialises into snapshots cleanly. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A unit quaternion (x, y, z, w). Plain data so it serialises into snapshots.
 * Defined here rather than in `quat.ts` (which re-exports it) so this file
 * can freely use quaternion-taking functions like {@link rotateVec3ByQuat}
 * without an import cycle — `quat.ts` needs `Vec3` for exactly the same
 * reason (`quatToEuler` calls `rotateVec3ByQuat` directly instead of keeping
 * its own private duplicate of the rotation formula).
 */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const addVec3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const subVec3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scaleVec3 = (v: Vec3, s: number): Vec3 => ({
  x: v.x * s,
  y: v.y * s,
  z: v.z * s,
});

export const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const lengthVec3 = (v: Vec3): number =>
  Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

export const dotVec3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Returns the unit vector, or a zero vector if `v` has no length. */
export const normalizeVec3 = (v: Vec3): Vec3 => {
  const len = lengthVec3(v);
  return len === 0 ? vec3() : { x: v.x / len, y: v.y / len, z: v.z / len };
};

/**
 * Rotates `v` by `yaw` radians around the world Y axis, matching Rapier's own
 * `yawQuat` (`../math/quat.ts`) and Three.js's `Object3D.rotation.y` — NOT
 * `movementDirection`'s convention (`forward(yaw) = (sin, 0, -cos)`), which is
 * its mirror image (verified by direct quaternion-rotation computation; a
 * pre-existing, already-worked-around mismatch — see `apps/client/src/scene.ts`'s
 * `π − yaw` reconciliation for the Character's own facing). `Segment.rotation`
 * (ADR 0031) and Socket alignment must agree with the convention that actually
 * rotates physics bodies (Spinners) and rendered meshes, not with input-facing
 * math, so this matches `yawQuat`/Three.js on purpose.
 */
export const rotateYaw = (v: Vec3, yaw: number): Vec3 => {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: v.x * cos + v.z * sin, y: v.y, z: -v.x * sin + v.z * cos };
};

/**
 * Rotates `v` by quaternion `q` — the standard `v + 2w(u×v) + 2(u×(u×v))`
 * sandwich-product formula (`u` = `q`'s vector part, `w` = its scalar part).
 * Generalizes {@link rotateYaw} to any orientation (ADR 0034: a Segment's
 * rotation is no longer yaw-only). `rotateYaw(v, yaw)` and
 * `rotateVec3ByQuat(v, yawQuat(yaw))` agree exactly — pinned by
 * `vec3.test.ts` — so every yaw-only call site keeps its existing behavior
 * unchanged when ported to this.
 */
export const rotateVec3ByQuat = (v: Vec3, q: Quat): Vec3 => {
  const ux = q.x;
  const uy = q.y;
  const uz = q.z;
  const uvx = uy * v.z - uz * v.y;
  const uvy = uz * v.x - ux * v.z;
  const uvz = ux * v.y - uy * v.x;
  const uuvx = uy * uvz - uz * uvy;
  const uuvy = uz * uvx - ux * uvz;
  const uuvz = ux * uvy - uy * uvx;
  return {
    x: v.x + 2 * q.w * uvx + 2 * uuvx,
    y: v.y + 2 * q.w * uvy + 2 * uuvy,
    z: v.z + 2 * q.w * uvz + 2 * uuvz,
  };
};

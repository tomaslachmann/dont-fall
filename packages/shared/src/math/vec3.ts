/** A 3D vector in world space. Plain data so it serialises into snapshots cleanly. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
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

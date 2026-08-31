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

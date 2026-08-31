/** A unit quaternion (x, y, z, w). Plain data so it serialises into snapshots. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Spherical linear interpolation between two unit quaternions. Falls back to a
 * normalised lerp for near-parallel inputs.
 */
export const slerpQuat = (a: Quat, b: Quat, t: number): Quat => {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (dot > 0.9995) {
    const x = a.x + (bx - a.x) * t;
    const y = a.y + (by - a.y) * t;
    const z = a.z + (bz - a.z) * t;
    const w = a.w + (bw - a.w) * t;
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return {
    x: a.x * s0 + bx * s1,
    y: a.y * s0 + by * s1,
    z: a.z * s0 + bz * s1,
    w: a.w * s0 + bw * s1,
  };
};

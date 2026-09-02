import { rotateVec3ByQuat, type Quat } from "./vec3.js";

export type { Quat };

export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Dot product of two quaternions — `|dot|` is 1 when the rotations are equal, 0 when 90° apart. */
export const dotQuat = (a: Quat, b: Quat): number => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

/** Conjugate (= inverse, for a unit quaternion). */
export const conjugateQuat = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** Hamilton product `a ∘ b` — apply `b`, then `a`. */
export const mulQuat = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** A rotation of `radians` around the world Y (up) axis. */
export const yawQuat = (radians: number): Quat => ({
  x: 0,
  y: Math.sin(radians / 2),
  z: 0,
  w: Math.cos(radians / 2),
});

/** A rotation of `radians` around the local X axis (ADR 0034 — a Segment's tilt-forward/back component). */
export const pitchQuat = (radians: number): Quat => ({
  x: Math.sin(radians / 2),
  y: 0,
  z: 0,
  w: Math.cos(radians / 2),
});

/** A rotation of `radians` around the local Z axis (ADR 0034 — a Segment's bank/tilt-sideways component). */
export const rollQuat = (radians: number): Quat => ({
  x: 0,
  y: 0,
  z: Math.sin(radians / 2),
  w: Math.cos(radians / 2),
});

/**
 * Composes a yaw/pitch/roll triple (radians) into one quaternion — yaw
 * (world Y) applied last/outermost, then pitch (local X), then roll (local
 * Z) applied first/innermost (ADR 0034: a Segment's full 3D orientation,
 * generalizing the old yaw-only `rotation`). Order matters — rotations don't
 * commute — and must match {@link quatToEuler}'s extraction exactly.
 */
export const eulerQuat = (yaw: number, pitch: number, roll: number): Quat =>
  mulQuat(mulQuat(yawQuat(yaw), pitchQuat(pitch)), rollQuat(roll));

/**
 * The inverse of {@link eulerQuat}: extracts a (yaw, pitch, roll) triple
 * (radians) whose composition reproduces `q` — used to store the result of a
 * quaternion computation (e.g. `placeAfter`'s Socket alignment) back into a
 * `Segment`'s three scalar fields (ADR 0034). Works by reading how `q`
 * rotates the local Z axis (gives yaw/pitch directly, since roll — applied
 * innermost, around Z — leaves the Z axis's own image alone) and then
 * un-rotating the local X axis by the recovered yaw+pitch to isolate roll.
 *
 * Degenerates at exactly ±90° pitch (gimbal lock: yaw and roll become the
 * same rotation split infinitely many ways) — a known, accepted limitation
 * of storing an orientation as three independent scalars, not a bug. Every
 * other orientation round-trips to an equivalent rotation (pinned by
 * `quat.test.ts`'s property test), though not necessarily the exact same
 * three numbers if the input wasn't itself produced by `eulerQuat`.
 */
export const quatToEuler = (q: Quat): { yaw: number; pitch: number; roll: number } => {
  const zAxis = rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, q);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, zAxis.y)));
  const yaw = Math.atan2(zAxis.x, zAxis.z);

  // Undo the recovered yaw+pitch to isolate the innermost roll component.
  const yawPitch = mulQuat(yawQuat(yaw), pitchQuat(pitch));
  const rollOnly = mulQuat(conjugateQuat(yawPitch), q);
  const xAxis = rotateVec3ByQuat({ x: 1, y: 0, z: 0 }, rollOnly);
  const roll = Math.atan2(xAxis.y, xAxis.x);

  return { yaw, pitch, roll };
};

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

import { lengthVec3, subVec3, type Vec3 } from "@dont-fall/shared";

/** Third-person camera feel. Presentation only — never touches the simulation (ADR 0009). */
export const CAMERA_DISTANCE = 7;
export const CAMERA_MIN_DISTANCE = 1.2;
/** Keeps the camera from clipping into the surface it collided with. */
export const CAMERA_SKIN = 0.2;
export const PITCH_MIN = 0.1;
export const PITCH_MAX = 0.85;

export const clampPitch = (pitch: number): number =>
  pitch < PITCH_MIN ? PITCH_MIN : pitch > PITCH_MAX ? PITCH_MAX : pitch;

/**
 * The camera's desired position: `distance` behind and above `target`, orbited
 * by `yaw` (about Y) and `pitch`.
 *
 * The horizontal offset is the negative of {@link movementDirection}'s forward
 * vector, so the camera sits *behind* the Character's facing at every yaw (not
 * just yaw 0). Yaw 0 / pitch 0 puts it directly behind a north-facing (−Z)
 * Character.
 */
export const springArmPosition = (
  target: Vec3,
  yaw: number,
  pitch: number,
  distance: number,
): Vec3 => {
  const cosPitch = Math.cos(pitch);
  return {
    x: target.x - distance * Math.sin(yaw) * cosPitch,
    y: target.y + distance * Math.sin(pitch),
    z: target.z + distance * Math.cos(yaw) * cosPitch,
  };
};

/**
 * Shorten the arm so the camera never ends up behind geometry. `cast` returns the
 * distance from `origin` to the first hit along the ray toward `desired`, or
 * `null` if the path is clear.
 */
export const resolveArm = (
  origin: Vec3,
  desired: Vec3,
  cast: (from: Vec3, to: Vec3) => number | null,
  minDistance: number,
  skin: number,
): Vec3 => {
  const offset = subVec3(desired, origin);
  const fullDistance = lengthVec3(offset);
  if (fullDistance === 0) return { ...desired };

  const hit = cast(origin, desired);
  if (hit === null) return { ...desired };

  const dir = { x: offset.x / fullDistance, y: offset.y / fullDistance, z: offset.z / fullDistance };
  const clamped = Math.min(fullDistance, Math.max(minDistance, hit - skin));
  return {
    x: origin.x + dir.x * clamped,
    y: origin.y + dir.y * clamped,
    z: origin.z + dir.z * clamped,
  };
};

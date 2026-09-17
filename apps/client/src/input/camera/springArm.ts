import { lengthVec3, subVec3, type Vec3 } from "@dont-fall/shared";

/** Third-person camera feel. Presentation only — never touches the simulation (ADR 0009). */
export const CAMERA_DISTANCE = 7;
export const CAMERA_MIN_DISTANCE = 1.2;
/** Keeps the camera from clipping into the surface it collided with. */
export const CAMERA_SKIN = 0.3;
/**
 * How far off the arm the four outer probe rays run (ADR 0086) — a thick probe
 * rather than one thin ray, so the camera doesn't catch on a block's edge the
 * centre ray only grazes.
 */
export const CAMERA_PROBE_RADIUS = 0.25;
/**
 * How fast the arm shortens when something comes between the camera and the
 * Character (s, a time constant: all but e⁻¹ of the way in this long). Quick,
 * so the camera spends only a frame or two behind a wall.
 */
export const CAMERA_ARM_IN_SECONDS = 0.06;
/** How fast the arm lets back out once the way is clear again (s, a time constant) — slow, so a flickering hit can't pump the camera (ADR 0086). */
export const CAMERA_ARM_OUT_SECONDS = 0.4;
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
 * How long the arm should be so the camera never ends up behind geometry:
 * the full distance to `desired`, or short of the first hit by `skin`, and
 * never under `minDistance`. `cast` returns the distance from `origin` to the
 * first hit along the ray toward `desired`, or `null` if the path is clear.
 *
 * A target, not where the camera goes this frame — {@link easeArmLength}
 * gets it there (ADR 0086).
 */
export const armTargetLength = (
  origin: Vec3,
  desired: Vec3,
  cast: (from: Vec3, to: Vec3) => number | null,
  minDistance: number,
  skin: number,
): number => {
  const fullDistance = lengthVec3(subVec3(desired, origin));
  if (fullDistance === 0) return 0;
  const hit = cast(origin, desired);
  if (hit === null) return fullDistance;
  return Math.min(fullDistance, Math.max(minDistance, hit - skin));
};

/**
 * The arm's length after `deltaSeconds` of closing on `target` (ADR 0086):
 * in toward a nearer wall at {@link CAMERA_ARM_IN_SECONDS}, back out at the
 * slower {@link CAMERA_ARM_OUT_SECONDS}. Exponential, so it never overshoots
 * and is the same at any frame rate.
 */
export const easeArmLength = (current: number, target: number, deltaSeconds: number): number => {
  const timeConstant = target < current ? CAMERA_ARM_IN_SECONDS : CAMERA_ARM_OUT_SECONDS;
  return target + (current - target) * Math.exp(-deltaSeconds / timeConstant);
};

/** The point `length` from `origin` along the arm toward `desired`. */
export const pointOnArm = (origin: Vec3, desired: Vec3, length: number): Vec3 => {
  const offset = subVec3(desired, origin);
  const fullDistance = lengthVec3(offset);
  if (fullDistance === 0) return { ...origin };
  const scale = length / fullDistance;
  return { x: origin.x + offset.x * scale, y: origin.y + offset.y * scale, z: origin.z + offset.z * scale };
};

/**
 * `cast` thickened into five parallel rays (ADR 0086): the arm itself and one
 * `radius` off it each way across the view — right, left, up and down —
 * reporting the nearest hit. Parallel, so each hit is already a distance
 * along the arm. The outer rays start inside the Character's own capsule,
 * which is wider than `radius`, so none starts inside a wall.
 */
export const thickCast =
  (cast: (from: Vec3, to: Vec3) => number | null, radius: number) =>
  (from: Vec3, to: Vec3): number | null => {
    const arm = subVec3(to, from);
    const length = lengthVec3(arm);
    if (length === 0) return cast(from, to);
    const dir = { x: arm.x / length, y: arm.y / length, z: arm.z / length };
    // Across the view: horizontal and perpendicular to the arm. The arm is
    // never vertical (pitch stays under PITCH_MAX), so this never degenerates.
    const flat = Math.hypot(dir.x, dir.z);
    const right = flat === 0 ? { x: 1, y: 0, z: 0 } : { x: -dir.z / flat, y: 0, z: dir.x / flat };
    const up = {
      x: right.y * dir.z - right.z * dir.y,
      y: right.z * dir.x - right.x * dir.z,
      z: right.x * dir.y - right.y * dir.x,
    };
    let nearest: number | null = cast(from, to);
    for (const side of [right, up]) {
      for (const sign of [1, -1]) {
        const shift = { x: side.x * radius * sign, y: side.y * radius * sign, z: side.z * radius * sign };
        const hit = cast(
          { x: from.x + shift.x, y: from.y + shift.y, z: from.z + shift.z },
          { x: to.x + shift.x, y: to.y + shift.y, z: to.z + shift.z },
        );
        if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
      }
    }
    return nearest;
  };

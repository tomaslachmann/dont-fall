import { axisAngleQuat, type MotionPose } from "./Motion.js";

/**
 * The loop a conveyor's slats ride (CONTEXT.md: Conveyor, ADR 0120): two
 * straight runs joined by a half turn round each roller.
 *
 * Four numbers rather than the authored clip's 121 samples, because the
 * authored path *is* these four: the slats run flat at the rollers' height
 * plus their radius, wrap the front roller, come back underneath and wrap the
 * back one. Checked against the export's own extras — `belt_loop_length`
 * 10.913 is exactly `2·(2·2.1) + 2π·0.4`, so what is stored here is the
 * authored loop, not an approximation of it.
 */
export interface BeltPath {
  /** Where the rollers stand on Z, either side of the Asset's origin. */
  rollerZ: number;
  /** The rollers' axis height. */
  rollerY: number;
  /** The rollers' radius — the slats ride this far out from the axis. */
  radius: number;
  /** How many slats share the loop, evenly spaced. */
  slats: number;
}

/** How far a slat travels in one full loop. */
export const beltLoopLength = (path: BeltPath): number => 4 * path.rollerZ + 2 * Math.PI * path.radius;

/**
 * Where a slat is, and which way up, `along` of the way round the loop
 * (0 to 1, wrapping). Phase 0 is the top run's downstream end — the front
 * roller — and the belt carries toward −Z, the way a Track travels.
 */
export const beltSlatPose = (path: BeltPath, along: number): MotionPose => {
  const straight = 2 * path.rollerZ;
  const half = Math.PI * path.radius;
  const loop = beltLoopLength(path);
  const at = ((along % 1) + 1) % 1 * loop;
  const top = path.rollerY + path.radius;
  const bottom = path.rollerY - path.radius;

  // 1. the top run, downstream (+Z to −Z)
  if (at < straight) {
    return { position: { x: 0, y: top, z: path.rollerZ - at }, rotation: axisAngleQuat(X, 0) };
  }
  // 2. round the back roller, over the top and under
  if (at < straight + half) {
    const angle = ((at - straight) / half) * Math.PI;
    return {
      position: { x: 0, y: path.rollerY + path.radius * Math.cos(angle), z: -path.rollerZ - path.radius * Math.sin(angle) },
      rotation: axisAngleQuat(X, -angle),
    };
  }
  // 3. the bottom run, back upstream
  if (at < 2 * straight + half) {
    return { position: { x: 0, y: bottom, z: -path.rollerZ + (at - straight - half) }, rotation: axisAngleQuat(X, Math.PI) };
  }
  // 4. round the front roller, back to the top
  const angle = ((at - 2 * straight - half) / half) * Math.PI;
  return {
    position: { x: 0, y: path.rollerY - path.radius * Math.cos(angle), z: path.rollerZ + path.radius * Math.sin(angle) },
    rotation: axisAngleQuat(X, Math.PI - angle),
  };
};

const X = { x: 1, y: 0, z: 0 };

/**
 * Where slat `index` of `path` is at `seconds`, for a belt running at
 * `speed` units per second. Drawn only — the push a Character feels is the
 * Conveyor's, and both read the same speed, so what you see is what carries
 * you.
 */
export const beltSlatAt = (path: BeltPath, index: number, speed: number, seconds: number): MotionPose =>
  beltSlatPose(path, index / path.slats + (seconds * speed) / beltLoopLength(path));

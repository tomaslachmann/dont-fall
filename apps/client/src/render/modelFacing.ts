import type { Vec3 } from "@dont-fall/shared";

/**
 * How quickly the Character's body closes on the direction it runs (1/s):
 * every second it covers all but e^−rate of the turn still left, so a turn
 * slows into a soft stop instead of halting on the spot (user call,
 * 2026-09-17: the old constant-speed turn read as jerky under WASD). Since
 * ADR 0085 this is also how fast the Character's aim turns. With
 * {@link FACING_TURN_SPEED_MAX}, a quarter turn comes within 10° in about
 * 0.2 s and turning around takes about 0.3 s.
 */
export const FACING_TURN_RATE = 12;

/** The fastest the body ever turns (rad/s), so turning around takes visibly longer than a quarter turn. */
export const FACING_TURN_SPEED_MAX = 12;

export interface ModelYawInput {
  /** The model's current cosmetic yaw (radians). */
  currentYaw: number;
  /** World-space movement direction this frame; zero while idle. */
  moveDirection: Vec3;
  deltaSeconds: number;
  /**
   * True while this Character is involved in a Grab hold, as EITHER role —
   * grabbing someone (`grabbingId`) or being grabbed (`heldByGrabberId`).
   *
   * A hold freezes the rendered model outright (M6.1, live feedback): a held
   * pair walks sideways and backwards with no visual rotation at all, rather
   * than the model swinging to face wherever it happens to be walking. Two
   * reasons, both visual. The rig has no Grab clip, so the hold reads
   * entirely through `armReach.ts` aiming the upper arms at the other
   * Character — and a model free to turn drags that reach around with it,
   * ending up with the arms coming out through its own back the moment it
   * turns away from whoever it is holding. And the pair is rigidly tethered
   * (`RapierSimulation.updateGrabs`), so backing off is a normal thing to do
   * mid-hold; it used to spin the model a full 180°. The server freezes the
   * replicated `facing` for the same span, so every OTHER client's rig stays
   * put too.
   */
  facingLocked: boolean;
}

/** Wraps an angle into (−π, π] so a turn always takes the shortest arc. */
const wrapAngle = (angle: number): number =>
  ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

/**
 * The Character model's yaw for this frame (M6.1) — extracted from
 * `scene.ts` as a pure rule so the Grab-hold lock has somewhere to be tested
 * without a WebGL context. Since ADR 0085 it is also the Character's
 * `facing`, through {@link facingFromModelYaw}.
 *
 * Eases toward `moveDirection` at {@link FACING_TURN_RATE}, never faster than
 * {@link FACING_TURN_SPEED_MAX} and never past it, and holds still whenever
 * there is no direction to turn toward — or whenever a hold has
 * {@link ModelYawInput.facingLocked | locked the facing}.
 */
export const nextModelYaw = ({ currentYaw, moveDirection, deltaSeconds, facingLocked }: ModelYawInput): number => {
  if (facingLocked) return currentYaw;
  if (moveDirection.x === 0 && moveDirection.z === 0) return currentYaw;
  const delta = wrapAngle(Math.atan2(moveDirection.x, moveDirection.z) - currentYaw);
  const eased = delta * (1 - Math.exp(-FACING_TURN_RATE * deltaSeconds));
  const maxStep = FACING_TURN_SPEED_MAX * deltaSeconds;
  return currentYaw + Math.max(-maxStep, Math.min(maxStep, eased));
};

/**
 * The `facing` (ADR 0045's convention: yaw 0 looks down −Z, like the camera)
 * of a body turned to `modelYaw` (`atan2(x, z)`: yaw 0 looks down +Z), wrapped
 * into (−π, π]. What the local client sends as its facing (ADR 0085), so every
 * other client draws the body where its owner sees it, and Hit and Grab aim
 * where it is turned.
 */
export const facingFromModelYaw = (modelYaw: number): number => -wrapAngle(modelYaw - Math.PI);

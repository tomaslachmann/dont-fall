import type { Vec3 } from "@dont-fall/shared";

/**
 * How fast the Character model turns toward its own movement direction
 * (rad/s). Cosmetic only (ADR 0045 keeps the *replicated* facing separate) —
 * an eased turn rather than a snap, so a direction change reads as weight
 * rather than a flick.
 */
export const FACING_TURN_SPEED = 14;

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
 * The Character model's cosmetic yaw for this frame (M6.1) — extracted from
 * `scene.ts` as a pure rule so the Grab-hold lock has somewhere to be tested
 * without a WebGL context.
 *
 * Turns toward `moveDirection` at {@link FACING_TURN_SPEED}, never
 * overshooting it, and holds still whenever there is no direction to turn
 * toward — or whenever a hold has {@link ModelYawInput.facingLocked | locked
 * the facing}.
 */
export const nextModelYaw = ({ currentYaw, moveDirection, deltaSeconds, facingLocked }: ModelYawInput): number => {
  if (facingLocked) return currentYaw;
  if (moveDirection.x === 0 && moveDirection.z === 0) return currentYaw;
  const delta = wrapAngle(Math.atan2(moveDirection.x, moveDirection.z) - currentYaw);
  const maxStep = FACING_TURN_SPEED * deltaSeconds;
  return currentYaw + Math.max(-maxStep, Math.min(maxStep, delta));
};

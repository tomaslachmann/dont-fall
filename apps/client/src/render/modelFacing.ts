import { FACING_TURN_RATE, FACING_TURN_SPEED_MAX, type Vec3 } from "@dont-fall/shared";

export interface ModelYawInput {
  /** The model's current cosmetic yaw (radians). */
  currentYaw: number;
  /** World-space movement direction this frame; zero while idle. */
  moveDirection: Vec3;
  deltaSeconds: number;
  /**
   * How fast the body turns, as a share of its usual rate (ADR 0104): 1, or
   * `GRAB_TURN_SPEED_MULTIPLIER` while carrying someone — the same slower
   * turn the step clamps a grabber's replicated facing to, so the facing this
   * client sends is one the server accepts as it is.
   *
   * Replaces M6.1's `facingLocked`, which froze the body outright for the
   * length of a hold, in either role: the grabber has to turn now to aim, and
   * a held body is not turned by its own client at all but pinned to its
   * grabber (`modelYawFromFacing`, by the caller).
   */
  turnScale: number;
}

/** Wraps an angle into (−π, π] so a turn always takes the shortest arc. */
const wrapAngle = (angle: number): number =>
  ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

/**
 * The Character model's yaw for this frame (M6.1) — extracted from
 * `scene.ts` as a pure rule so it has somewhere to be tested without a WebGL
 * context. Since ADR 0085 it is also the Character's `facing`, through
 * {@link facingFromModelYaw}.
 *
 * Eases toward `moveDirection` at {@link FACING_TURN_RATE}, never faster than
 * {@link FACING_TURN_SPEED_MAX} and never past it — both scaled by
 * {@link ModelYawInput.turnScale} — and holds still whenever there is no
 * direction to turn toward.
 */
export const nextModelYaw = ({ currentYaw, moveDirection, deltaSeconds, turnScale }: ModelYawInput): number => {
  if (moveDirection.x === 0 && moveDirection.z === 0) return currentYaw;
  const delta = wrapAngle(Math.atan2(moveDirection.x, moveDirection.z) - currentYaw);
  const eased = delta * (1 - Math.exp(-FACING_TURN_RATE * turnScale * deltaSeconds));
  const maxStep = FACING_TURN_SPEED_MAX * turnScale * deltaSeconds;
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

/**
 * The model yaw of a body whose `facing` is given — the inverse of
 * {@link facingFromModelYaw}. For a body the sim turns rather than its own
 * client (ADR 0104): one that is Held, or Spinning someone.
 */
export const modelYawFromFacing = (facing: number): number => wrapAngle(Math.PI - facing);

/**
 * The yaw rate (rad/s) a pinned body turned at this frame — measured off the
 * drawn yaw itself, so it is exactly the speed the Spin was seen at, whatever
 * interpolation produced it. Zero when the frame took no time.
 */
export const measuredYawRate = (yaw: number, previousYaw: number, deltaSeconds: number): number =>
  deltaSeconds > 0 ? wrapAngle(yaw - previousYaw) / deltaSeconds : 0;

/** How long (s) the released Spin's momentum takes to fall to 1/e — the follow-through's feel. */
export const SPIN_MOMENTUM_TAU = 0.18;
/** Below this yaw rate (rad/s) the follow-through is over and steering alone turns the body. */
export const SPIN_MOMENTUM_REST = 0.5;

/**
 * One frame of the Spin's follow-through (ADR 0104's drawn hold): a grabber
 * that lets go at full whirl keeps turning, bleeding the turn off
 * exponentially instead of freezing mid-frame — the sim stops its facing
 * dead, and since the drawn yaw IS the facing the client sends (ADR 0085),
 * this spin-down is also what the server and everyone else sees. Returns the
 * momentum left for next frame; the caller advances its yaw by
 * `momentum * deltaSeconds` first. Never seeded above
 * {@link FACING_TURN_SPEED_MAX}, so the facing this sends stays one the
 * server's clamp accepts as it is.
 */
export const decayedSpinMomentum = (momentum: number, deltaSeconds: number): number => {
  const next = momentum * Math.exp(-deltaSeconds / SPIN_MOMENTUM_TAU);
  return Math.abs(next) < SPIN_MOMENTUM_REST ? 0 : next;
};

/** Clamp a follow-through seed to what the server's facing clamp accepts. */
export const clampSpinMomentum = (rate: number): number =>
  Math.max(-FACING_TURN_SPEED_MAX, Math.min(FACING_TURN_SPEED_MAX, rate));

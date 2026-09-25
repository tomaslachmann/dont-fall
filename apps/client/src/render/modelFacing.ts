import { FACING_TURN_SPEED_MAX } from "@dont-fall/shared";

// The body's turn is shared since M17 (ADR 0129): a Bot on the authority turns
// its body by the same rule, so a Bot's facing reads like a Player's (ADR 0085).
export { facingFromModelYaw, modelYawFromFacing, nextModelYaw, type ModelYawInput } from "@dont-fall/shared";

/** Wraps an angle into (−π, π] so a turn always takes the shortest arc. */
const wrapAngle = (angle: number): number =>
  ((((angle + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

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

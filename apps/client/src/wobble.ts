import { scaleVec3, subVec3, type Vec3 } from "@dont-fall/shared";

/**
 * Procedural `Wobble` (ticket 07): a cosmetic lean of the Character's visual
 * mesh while `Controlled`, driven by inertia — accelerating throws the lean
 * backward (away from the new direction of travel), like a bus lurching, and
 * a hard stop throws it forward. Settles to upright at a constant velocity or
 * standing still. Purely presentational: it never reads or writes simulation
 * state (ADR 0006), only the render-rate position the renderer already has.
 */

/** Radians of lean per unit of horizontal acceleration (units/s²). */
export const WOBBLE_ACCEL_SCALE = 0.03;

/** Hard clamp on lean in either axis (radians), so a violent stop can't flip the mesh. */
export const WOBBLE_MAX_TILT = 0.5;

/** How fast the lean eases toward its target (1/s) — higher settles quicker. */
export const WOBBLE_SETTLE_RATE = 9;

export interface WobbleState {
  /** Lean forward (negative) / backward (positive), radians. */
  pitch: number;
  /** Lean left (negative) / right (positive), radians. */
  roll: number;
  /** Last computed horizontal velocity (units/s), carried to derive next frame's acceleration. */
  velocity: Vec3;
}

export const initialWobbleState: WobbleState = { pitch: 0, roll: 0, velocity: { x: 0, y: 0, z: 0 } };

const clamp = (v: number, limit: number): number => (v < -limit ? -limit : v > limit ? limit : v);

/**
 * Advance the wobble by one render frame. `position`/`previousPosition` are
 * the Character's world position this frame and last; `forward`/`right` are
 * its current facing basis (unit vectors, world space) — acceleration is
 * projected onto these so "lean forward" always means forward relative to
 * where the Character is currently facing, not a fixed world axis.
 */
export const stepWobble = (
  state: WobbleState,
  position: Vec3,
  previousPosition: Vec3,
  forward: Vec3,
  right: Vec3,
  deltaSeconds: number,
): WobbleState => {
  if (deltaSeconds <= 0) return state;

  const velocity = scaleVec3(subVec3(position, previousPosition), 1 / deltaSeconds);
  const acceleration = scaleVec3(subVec3(velocity, state.velocity), 1 / deltaSeconds);

  const forwardAccel = acceleration.x * forward.x + acceleration.z * forward.z;
  const rightAccel = acceleration.x * right.x + acceleration.z * right.z;

  const targetPitch = clamp(forwardAccel * WOBBLE_ACCEL_SCALE, WOBBLE_MAX_TILT);
  const targetRoll = clamp(rightAccel * WOBBLE_ACCEL_SCALE, WOBBLE_MAX_TILT);

  const ease = 1 - Math.exp(-WOBBLE_SETTLE_RATE * deltaSeconds);
  return {
    pitch: state.pitch + (targetPitch - state.pitch) * ease,
    roll: state.roll + (targetRoll - state.roll) * ease,
    velocity,
  };
};

import { GRAVITY_Y } from "@dont-fall/shared";

/**
 * The body leans where it is going (the user's ask, 2026-09-21: the feel of
 * Party Animals and Fall Guys). Two angles, both of them balance:
 *
 * - **Bank.** A body turning at `ω` while moving at `v` is thrown sideways at
 *   `v·ω`. Standing up through that means leaning into it, and the angle that
 *   balances it is `atan(v·ω / g)` — the same "load in gravities" reasoning
 *   `grabberLean.ts` is built on, which is why this file borrows its spring
 *   rather than inventing a second one.
 * - **Pitch.** The same sum along the direction of travel: speeding up leans
 *   the body forward over its feet, braking rocks it back.
 *
 * The honest balance angle is too much on a bean — a hard turn at running
 * speed solves to about 35°, which reads as a motorcycle — so both are taken
 * at a share of it and clamped. {@link BODY_LEAN}'s numbers are every one of
 * them a first guess: no test in this repo can rasterise a rig, so they are
 * found by driving `/drive.html` and nowhere else.
 *
 * Both angles are damped springs rather than eases, for the reason
 * `grabberLean.ts` gives: a body has mass and arrives at a new balance by
 * overshooting it. An ease would glide, which is the machine-like feel this
 * whole layer exists to remove.
 *
 * Render-only, on the same terms as the rest of this folder: nothing here
 * reaches the simulation, nothing is replicated, and the Capsule is untouched.
 * It writes the rig root's X (pitch) and Z (roll) under `rotation.order =
 * "YXZ"` — which both the local Character and `remoteCharacterPool` already
 * set, and whose Z slot both of them leave at 0.
 */

export interface BodyLeanTuning {
  bankShare: number;
  bankMax: number;
  pitchShare: number;
  pitchMax: number;
  hz: number;
  zeta: number;
  clamp: number;
  airShare: number;
  maxYawRate: number;
  maxForwardAccel: number;
  maxStepSeconds: number;
}

/**
 * Deliberately a plain mutable record rather than the `as const` the other
 * tuning objects in this folder use: `/drive.html` edits these live, which is
 * the only way any of them can be judged at all.
 */
export const BODY_LEAN: BodyLeanTuning = {
  /** How much of the honest bank angle the body actually takes. 1 would be a motorcycle. */
  bankShare: 0.5,
  /** The most it ever banks (rad) — about 20° at this value. */
  bankMax: 0.35,
  /** How much of the honest pitch angle the body takes, accelerating or braking. */
  pitchShare: 0.55,
  /** The most it ever pitches (rad). */
  pitchMax: 0.26,
  /** How fast both angles chase their target (rad/s — ω, not really Hz, same as `GRABBER_LEAN_HZ`). */
  hz: 8,
  /** Below 1 so it overshoots and settles, which is what makes it read as weight. */
  zeta: 0.55,
  /** Hard clamp on either angle whatever the spring is doing (rad). */
  clamp: 0.6,
  /**
   * How much of both leans survives while airborne. Not 0 — a jumped body
   * that snapped upright mid-air would read as a glitch — but well under 1,
   * because there are no feet to brace against.
   */
  airShare: 0.35,
  /**
   * The fastest turn the bank is allowed to be computed from (rad/s). A
   * reconciliation or a camera flick can move the drawn yaw a long way in one
   * frame, and an unclamped `v·ω` would throw the body on its side for it.
   */
  maxYawRate: 10,
  /** The same guard on the pitch driver (units/s²). */
  maxForwardAccel: 60,
  /** The longest frame either spring integrates in one step — a hitch must not blow it up. */
  maxStepSeconds: 1 / 30,
};

export interface BodyLean {
  /** Radians of forward lean; positive tips the face toward the floor. */
  pitch: number;
  pitchRate: number;
  /** Radians of bank; positive raises the body's left side. */
  roll: number;
  rollRate: number;
}

export const restBodyLean = (): BodyLean => ({ pitch: 0, pitchRate: 0, roll: 0, rollRate: 0 });

export interface BodyLeanInput {
  /** Horizontal speed (units/s). */
  speed: number;
  /**
   * How fast the drawn body is turning (rad/s), in the model-yaw convention
   * `nextModelYaw` works in: positive turns the body's nose toward +X, which
   * is its own left.
   */
  yawRate: number;
  /** Change in speed along the way the body is facing (units/s²) — positive is speeding up. */
  forwardAccel: number;
  grounded: boolean;
  deltaSeconds: number;
}

/** One frame of a spring chasing `target`, the shape `grabberLean.ts` uses. */
const chase = (angle: number, rate: number, target: number, dt: number, tuning: BodyLeanTuning): [number, number] => {
  const nextRate = rate + (tuning.hz * tuning.hz * (target - angle) - 2 * tuning.zeta * tuning.hz * rate) * dt;
  const nextAngle = Math.max(-tuning.clamp, Math.min(tuning.clamp, angle + nextRate * dt));
  return [nextAngle, nextRate];
};

const clampTo = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));

/**
 * The angle that balances a sideways (or fore-and-aft) acceleration of `a`,
 * taken at `share` of the honest value and clamped. Exported because it is
 * the whole design, and the bench prints it beside the angle actually drawn.
 */
export const balanceAngle = (acceleration: number, share: number, max: number): number =>
  clampTo(Math.atan(acceleration / Math.abs(GRAVITY_Y)) * share, max);

/**
 * One frame of the lean, mutating `lean`. Returns the two angles to draw,
 * ready for `rig.rotation.set(pitch, yaw, roll)` on a `"YXZ"` rig.
 */
export const advanceBodyLean = (
  lean: BodyLean,
  input: BodyLeanInput,
  tuning: BodyLeanTuning = BODY_LEAN,
): { pitch: number; roll: number } => {
  const dt = Math.min(Math.max(input.deltaSeconds, 0), tuning.maxStepSeconds);
  const share = input.grounded ? 1 : tuning.airShare;

  // Turning left (yaw rate positive) has to bank left, and a positive roll
  // raises the left side — hence the sign. See this file's header for why the
  // target is a balance angle rather than a plain scale on the turn rate.
  const lateral = input.speed * clampTo(input.yawRate, tuning.maxYawRate);
  const rollTarget = -balanceAngle(lateral, tuning.bankShare * share, tuning.bankMax);
  const pitchTarget = balanceAngle(
    clampTo(input.forwardAccel, tuning.maxForwardAccel),
    tuning.pitchShare * share,
    tuning.pitchMax,
  );

  [lean.roll, lean.rollRate] = chase(lean.roll, lean.rollRate, rollTarget, dt, tuning);
  [lean.pitch, lean.pitchRate] = chase(lean.pitch, lean.pitchRate, pitchTarget, dt, tuning);
  return { pitch: lean.pitch, roll: lean.roll };
};

import { GRAB_CARRY_DISTANCE, GRAVITY_Y, TICK_MS, spinSpeedAt } from "@dont-fall/shared";

/**
 * How a grabber leans while it whirls a body round, and what it does when it
 * lets go (`.scratch/physical-ragdoll` ticket 04, the rubber bench's spring).
 *
 * Spinning a body at arm's length pulls the grabber outward with the
 * centripetal load it is holding, `ω²·R`; leaning back against it is what
 * keeps a real thrower upright. So the lean's target is that load measured in
 * gravities, and the lean itself is a damped spring rather than an ease — a
 * body has mass, and it arrives at a new balance by overshooting it.
 *
 * At the release the load vanishes in one frame while the grabber is still
 * braced against it, which is exactly a spring given a velocity: the kick
 * below is sized by the load that just disappeared, so a flick barely rocks
 * the body and a full Spin sends it past its own lean before it catches
 * itself. Render-only: nothing here reaches the simulation.
 */

/** How fast the lean chases its target (rad/s). Higher catches the body sooner. */
export const GRABBER_LEAN_HZ = 9;

/**
 * How damped that chase is. Under 1 it overshoots and rocks back, which is
 * the whole point — at 1 it would glide into place like a machine.
 */
export const GRABBER_LEAN_ZETA = 0.45;

/** The most a held lean reaches (rad) — a brace, not a limbo. */
export const GRABBER_LEAN_MAX = 0.3;

/** How much of the measured load the held lean actually takes up. */
export const GRABBER_LEAN_LOAD_SHARE = 0.25;

/** The hardest the release can kick the spring (rad/s), so a wild Spin is still a stagger and not a cartwheel. */
export const GRABBER_LEAN_KICK_MAX = 2.2;

/** Past this the lean is clamped outright, whatever the spring is doing. */
export const GRABBER_LEAN_CLAMP = 0.6;

/** The longest frame the spring integrates in one step — a hitch must not blow it up. */
const MAX_STEP_SECONDS = 1 / 30;

export interface GrabberLean {
  /** Radians of backward lean; the rig is pitched by its negative. */
  angle: number;
  /** Radians per second. */
  rate: number;
  /** Whether the last frame was still holding — the release edge is where the kick lands. */
  wasSpinning: boolean;
  /** The spin rate (rad/s) the last held frame turned at: what the kick is sized from. */
  lastSpeed: number;
}

export const restGrabberLean = (): GrabberLean => ({ angle: 0, rate: 0, wasSpinning: false, lastSpeed: 0 });

/**
 * The load a body on the end of an arm pulls with, in gravities — `ω²·R/g`.
 * What the lean is braced against, and what vanishes at the release.
 */
export const spinLoad = (spinSpeed: number): number =>
  (spinSpeed * spinSpeed * GRAB_CARRY_DISTANCE) / Math.abs(GRAVITY_Y);

/**
 * One frame of the lean. `spinSpeed` is how fast the grabber is turning right
 * now (rad/s, 0 when it holds nobody or is not Spinning). Returns the pitch
 * to draw, mutating `lean` — a damped spring, kicked once at the release.
 */
export const advanceGrabberLean = (lean: GrabberLean, spinSpeed: number, deltaSeconds: number): number => {
  const dt = Math.min(Math.max(deltaSeconds, 0), MAX_STEP_SECONDS);
  const spinning = spinSpeed > 0;
  if (lean.wasSpinning && !spinning) {
    // The load it was braced against is gone: the brace itself is now a shove.
    lean.rate += Math.min(GRABBER_LEAN_KICK_MAX, spinLoad(lean.lastSpeed));
  }
  lean.wasSpinning = spinning;
  if (spinning) lean.lastSpeed = spinSpeed;

  const target = spinning ? Math.min(GRABBER_LEAN_MAX, spinLoad(spinSpeed) * GRABBER_LEAN_LOAD_SHARE) : 0;
  lean.rate += (GRABBER_LEAN_HZ * GRABBER_LEAN_HZ * (target - lean.angle) - 2 * GRABBER_LEAN_ZETA * GRABBER_LEAN_HZ * lean.rate) * dt;
  lean.angle = Math.max(-GRABBER_LEAN_CLAMP, Math.min(GRABBER_LEAN_CLAMP, lean.angle + lean.rate * dt));
  return lean.angle;
};

/**
 * The spin rate (rad/s) a grabber `spinMs` into its wind-up is turning at —
 * the replicated field read through the simulation's own wind-up curve, so
 * the lean is braced against the load the body is really pulling with.
 */
export const spinSpeedOf = (spinMs: number): number => (spinMs <= 0 ? 0 : spinSpeedAt(spinMs / TICK_MS));

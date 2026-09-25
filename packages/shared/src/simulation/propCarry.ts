import { CAPSULE_HALF_HEIGHT } from "../tuning/character.js";
import {
  PROP_CARRY_JUMP_HEAVY,
  PROP_CARRY_JUMP_LIGHT,
  PROP_CARRY_MASS_MAX,
  PROP_CARRY_SPEED_HEAVY,
  PROP_CARRY_SPEED_LIGHT,
  PROP_CARRY_TURN_HEAVY,
  PROP_CARRY_TURN_LIGHT,
  PROP_GRIP_BODY_FRONT,
  PROP_GRIP_LIFT,
  PROP_GRIP_REACH,
  PROP_GRIP_SPREAD,
  PROP_JUMP_MASS_MAX,
  PROP_LIFT_TICKS,
  PROP_SPIN_GRIP_BODY_FRONT,
  PROP_SPIN_GRIP_LIFT,
  PROP_SPIN_GRIP_REACH,
  PROP_SPIN_GRIP_SPREAD,
  PROP_THROW_HEAVY,
  PROP_THROW_LIGHT,
} from "../tuning/fight.js";

/**
 * What a carried Prop's weight does to its carrier (ADR 0125) — pure
 * functions of the Prop's mass, so the server and the carrier's own client,
 * which knows every Prop's mass from the Track, agree on every one of them.
 */

const between = (light: number, heavy: number, weight: number): number =>
  light + (heavy - light) * Math.min(1, Math.max(0, weight));

/** Whether a Prop of `mass` can be picked up at all. */
export const canLiftProp = (mass: number): boolean => mass <= PROP_CARRY_MASS_MAX;

/** The carrier's pace, as a fraction of its own. */
export const propCarrySpeed = (mass: number): number =>
  between(PROP_CARRY_SPEED_LIGHT, PROP_CARRY_SPEED_HEAVY, mass / PROP_CARRY_MASS_MAX);

/** The carrier's turn, as a fraction of its own. */
export const propCarryTurn = (mass: number): number =>
  between(PROP_CARRY_TURN_LIGHT, PROP_CARRY_TURN_HEAVY, mass / PROP_CARRY_MASS_MAX);

/** The carrier's jump, as a fraction of its own — 0 with a Prop too heavy to jump with. */
export const propCarryJump = (mass: number): number =>
  mass > PROP_JUMP_MASS_MAX ? 0 : between(PROP_CARRY_JUMP_LIGHT, PROP_CARRY_JUMP_HEAVY, mass / PROP_JUMP_MASS_MAX);

/** How fast a Prop of `mass` leaves a throw, as a multiple of the throw's own speed. */
export const propThrowScale = (mass: number): number =>
  between(PROP_THROW_LIGHT, PROP_THROW_HEAVY, mass / PROP_CARRY_MASS_MAX);

/**
 * Whether Tick `tick` is one a Lift that started on `startTick` holds its
 * carrier still for (ADR 0128): every Tick after the one it started on, for
 * `PROP_LIFT_TICKS`. The server and the carrier's own prediction ask the same
 * question of the same numbers, so they stand still over the same Ticks.
 */
export const liftHolds = (startTick: number, tick: number): boolean =>
  tick > startTick && tick - startTick <= PROP_LIFT_TICKS;

/**
 * Where a pose holds its hands (ADR 0128), as `propGripOffset` needs it:
 * ahead of the carrier's capsule centre, above it, how far apart, and how
 * far forward the body itself reaches at that height.
 */
export interface Grip {
  reach: number;
  lift: number;
  spread: number;
  bodyFront: number;
}

/** The hold every carry clip starts from: `Pickup_Ground`'s last frame. */
export const CARRY_GRIP: Grip = {
  reach: PROP_GRIP_REACH,
  lift: PROP_GRIP_LIFT,
  spread: PROP_GRIP_SPREAD,
  bodyFront: PROP_GRIP_BODY_FRONT,
};

/** A Spin's hold, at arm's length: `Grab_HoldOut`. */
export const SPIN_GRIP: Grip = {
  reach: PROP_SPIN_GRIP_REACH,
  lift: PROP_SPIN_GRIP_LIFT,
  spread: PROP_SPIN_GRIP_SPREAD,
  bodyFront: PROP_SPIN_GRIP_BODY_FRONT,
};

/** How finely {@link propGripOffset} tries tilts between straight up and straight ahead. */
const TILT_STEPS = 16;

/** How far a point `forward` of the carrier's centre and `up` above it is from the body's upright axis. */
const fromBodyAxis = (forward: number, up: number): number => {
  const above = Math.max(0, Math.abs(up) - CAPSULE_HALF_HEIGHT);
  return Math.hypot(forward, above);
};

/**
 * Where a Prop of `radius` sits in `grip`'s hands (ADR 0128): its middle,
 * `forward` of the carrier's capsule centre and `up` above it.
 *
 * One narrower than the hands' spread sits between them. A wider one is held
 * the way a person holds a big ball: its middle rises from the hands until its
 * cross-section at their height is exactly as wide as they are apart, so part
 * of it is always between them (the user's ask). It tilts from straight up
 * toward straight ahead only as far as it must to clear the body, which is an
 * upright capsule of the grip's `bodyFront` radius that the Prop may touch but
 * never enter. If not even straight ahead clears it, the Prop goes further out
 * at the hands' height.
 *
 * The server places a carried Prop with the measured grip. Every client
 * draws it the same distance from the hands the rig actually has that
 * frame (`handsOffset`).
 */
export const propGripOffset = (radius: number, grip: Grip): { forward: number; up: number } => {
  const rise = Math.sqrt(Math.max(0, radius * radius - (grip.spread / 2) ** 2));
  const clear = grip.bodyFront + radius;
  for (let step = 0; step <= TILT_STEPS; step += 1) {
    const tilt = (step / TILT_STEPS) * (Math.PI / 2);
    const forward = grip.reach + rise * Math.sin(tilt);
    const up = grip.lift + rise * Math.cos(tilt);
    if (fromBodyAxis(forward, up) >= clear) return { forward, up };
  }
  const above = Math.max(0, Math.abs(grip.lift) - CAPSULE_HALF_HEIGHT);
  return { forward: Math.max(grip.reach + rise, Math.sqrt(Math.max(0, clear * clear - above * above))), up: grip.lift };
};

/** {@link propGripOffset} measured from the hands rather than from the carrier's centre — what a client adds to the hands it draws. */
export const handsOffset = (radius: number, grip: Grip): { forward: number; up: number } => {
  const at = propGripOffset(radius, grip);
  return { forward: at.forward - grip.reach, up: at.up - grip.lift };
};

import { WALK_SPEED } from "@dont-fall/shared";

/** Which locomotion clip a Character's model should be playing this frame. */
export type LocomotionState = "idle" | "walk" | "run" | "sprint" | "jump" | "wobble" | "wobbleWalk";

/**
 * Horizontal speed (units/s) a walking Character must pass before it runs
 * (ADR 0081). The game is a race, so `Run` is the ordinary gait and `Walk`
 * only covers the slow end: the first metres on ice, a slow pad, pushing
 * against a wall. Under mud's half `WALK_SPEED` even up the steepest walkable
 * slope (about 2.27), so mud runs.
 */
export const RUN_FROM_SPEED = 0.35 * WALK_SPEED;

/**
 * Horizontal speed (units/s) a running Character must drop below before it
 * walks again. Lower than {@link RUN_FROM_SPEED}, so a speed sitting on the
 * boundary (an interpolated remote velocity, a Character slowing on ice)
 * keeps one gait instead of crossfading back and forth every frame.
 */
export const WALK_BELOW_SPEED = 0.25 * WALK_SPEED;

export interface LocomotionInput {
  /** Whether the Character is trying to move (local input) or visibly moving (a remote's velocity). */
  moving: boolean;
  grounded: boolean;
  dashing: boolean;
  /** The `Stagger` state (ADR 0072). */
  wobbling?: boolean;
  /** Standing on ice (ADR 0082). */
  onIce?: boolean;
  /** This Character's horizontal speed (units/s). */
  speed: number;
  /** Whether the rig is walking right now — the other half of the walk/run hysteresis. */
  walking?: boolean;
}

/**
 * Pure decision extracted from the local Character's own animation logic
 * (M6 ticket 02) so a real remote Character (ADR 0046) can reuse the exact
 * same rule instead of re-deriving it from different inputs (replicated
 * `velocity`/`grounded`/`dashing` rather than local `moveDirection`/keys).
 *
 * `moving` and `dashing` are independent: a Dash with no direction held still
 * plays a locomotion clip (`DashController`'s own "dash from last move dir"
 * behavior), so `dashing` alone is enough to leave idle.
 *
 * The gaits (ADR 0081): a Dash is the `Sprint`, for its whole burst, and
 * otherwise a moving Character runs, walking only below
 * {@link RUN_FROM_SPEED} (or, once running, below {@link WALK_BELOW_SPEED}).
 *
 * `wobbling` (ADR 0072) is the `Stagger` state — after a light hit, and for a
 * spell after a Respawn. It outranks everything on the ground because it is
 * the whole tell that a Character is slowed right now: running it off at full
 * stride would hide the one thing the state exists to communicate. Moving
 * while wobbling is its own clip (`Wobble_Walk`, the same unsteadiness with
 * legs that step), so the tell no longer costs the legs. In the air it loses
 * to the jump, because a wobble reads as feet under you.
 *
 * Ice wobbles the same way (ADR 0082), standing or moving, Dash included:
 * nobody is sure of their feet on it.
 */
export const selectLocomotion = ({
  moving,
  grounded,
  dashing,
  wobbling = false,
  onIce = false,
  speed,
  walking = false,
}: LocomotionInput): LocomotionState => {
  if (!grounded) return "jump";
  if (wobbling || onIce) return moving || dashing ? "wobbleWalk" : "wobble";
  if (dashing) return "sprint";
  if (!moving) return "idle";
  return speed < (walking ? RUN_FROM_SPEED : WALK_BELOW_SPEED) ? "walk" : "run";
};

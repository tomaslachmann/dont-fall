/** Which locomotion clip a Character's model should be playing this frame. */
export type LocomotionState = "idle" | "walk" | "run" | "jump" | "wobble" | "wobbleWalk";

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
 * `wobbling` (ADR 0072) is the `Stagger` state — after a light hit, and for a
 * spell after a Respawn. It outranks everything on the ground because it is
 * the whole tell that a Character is slowed right now: walking it off at full
 * stride would hide the one thing the state exists to communicate. Moving
 * while wobbling is its own clip (`Wobble_Walk`, the same unsteadiness with
 * legs that step), so the tell no longer costs the legs. In the air it loses
 * to the jump, because a wobble reads as feet under you.
 */
export const selectLocomotion = (
  moving: boolean,
  grounded: boolean,
  dashing: boolean,
  wobbling = false,
): LocomotionState => {
  if (!grounded) return "jump";
  if (wobbling) return moving || dashing ? "wobbleWalk" : "wobble";
  if (dashing) return "run";
  return moving ? "walk" : "idle";
};

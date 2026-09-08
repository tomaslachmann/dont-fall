/** Which locomotion clip a Character's model should be playing this frame. */
export type LocomotionState = "idle" | "walk" | "run" | "jump";

/**
 * Pure decision extracted from the local Character's own animation logic
 * (M6 ticket 02) so a real remote Character (ADR 0046) can reuse the exact
 * same rule instead of re-deriving it from different inputs (replicated
 * `velocity`/`grounded`/`dashing` rather than local `moveDirection`/keys).
 *
 * `moving` and `dashing` are independent: a Dash with no direction held still
 * plays a locomotion clip (`DashController`'s own "dash from last move dir"
 * behavior), so `dashing` alone is enough to leave idle.
 */
export const selectLocomotion = (moving: boolean, grounded: boolean, dashing: boolean): LocomotionState => {
  if (!grounded) return "jump";
  if (dashing) return "run";
  return moving ? "walk" : "idle";
};

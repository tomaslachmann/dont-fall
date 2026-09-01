import {
  GETUP_TICKS,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  RAGDOLL_MAX_TICKS,
  RAGDOLL_MIN_TICKS,
  STAGGER_INPUT_SCALE,
  STAGGER_TICKS,
} from "../tuning.js";

/**
 * The Character's motion state (ADR 0006, ticket 05).
 *
 * ```
 * Controlled → Stagger    (medium Impact — stays upright, input dampened)
 * Controlled → Ragdoll    (hard Impact or a Fall)
 * Stagger    → Controlled (after STAGGER_TICKS)
 * Stagger    → Ragdoll    (a hard Impact lands while staggering)
 * Ragdoll    → GettingUp  (past RAGDOLL_MIN_TICKS and settled, or at RAGDOLL_MAX_TICKS)
 * GettingUp  → Controlled (after GETUP_TICKS — uninterruptible, so continuous
 *                          Impacts can't soft-lock the Character while down)
 * ```
 */
export type CharacterMotionState = "Controlled" | "Stagger" | "Ragdoll" | "GettingUp";

/**
 * Drives the Character between its motion states. Pure with respect to the world
 * — the simulation feeds it Impact magnitudes and a "ragdoll settled" flag and
 * reads back the current state and the movement-input multiplier.
 */
export class CharacterStateMachine {
  private motionState: CharacterMotionState = "Controlled";
  private timer = 0; // ticks spent in the current state
  private pendingImpact = 0; // strongest Impact magnitude queued since the last tick
  private forcedRagdoll = false;

  get state(): CharacterMotionState {
    return this.motionState;
  }

  /** Movement-input multiplier for the current state. */
  get inputScale(): number {
    if (this.motionState === "Controlled") return 1;
    if (this.motionState === "Stagger") return STAGGER_INPUT_SCALE;
    return 0; // Ragdoll, GettingUp
  }

  /** Queue an Impact for the next {@link tick}. Only the strongest one counts. */
  impact(magnitude: number): void {
    this.pendingImpact = Math.max(this.pendingImpact, magnitude);
  }

  /** Force a Ragdoll on the next {@link tick}, whatever the current state (used by Fall). */
  forceRagdoll(): void {
    this.forcedRagdoll = true;
  }

  reset(): void {
    this.motionState = "Controlled";
    this.timer = 0;
    this.pendingImpact = 0;
    this.forcedRagdoll = false;
  }

  /**
   * Hard-set the state to the server's, discarding any queued Impact/force and
   * resetting the in-state timer (ticket 05 reconciliation, ADR 0013 — a
   * discrete-state correction snaps, never blends). `timer` seeds the new
   * state's elapsed ticks when the server's own progress through it is known
   * (e.g. a Stagger that is already partway done); it defaults to a fresh entry.
   */
  snapTo(state: CharacterMotionState, timer = 0): void {
    this.motionState = state;
    this.timer = timer;
    this.pendingImpact = 0;
    this.forcedRagdoll = false;
  }

  /**
   * Advance one tick. `ragdollSettled` is whether the ragdoll body's fastest bone
   * is below {@link RAGDOLL_SETTLE_SPEED} — only meaningful while in `Ragdoll`.
   */
  tick(ragdollSettled: boolean): CharacterMotionState {
    const impact = this.pendingImpact;
    const forced = this.forcedRagdoll;
    this.pendingImpact = 0;
    this.forcedRagdoll = false;

    const hardHit = forced || impact >= IMPACT_RAGDOLL_MIN;
    // A fresh hard hit downs a Controlled or Staggering Character. It is ignored
    // while already `Ragdoll` (so the timer keeps counting toward
    // RAGDOLL_MAX_TICKS) and while `GettingUp` (which always completes) — so
    // continuous impacts can never soft-lock the Character out of `Controlled`.
    if (hardHit && (this.motionState === "Controlled" || this.motionState === "Stagger")) {
      this.enter("Ragdoll");
      return this.motionState;
    }

    switch (this.motionState) {
      case "Controlled":
        if (impact >= IMPACT_STAGGER_MIN) this.enter("Stagger");
        break;
      case "Stagger":
        this.timer += 1;
        if (this.timer >= STAGGER_TICKS) this.enter("Controlled");
        break;
      case "Ragdoll":
        this.timer += 1;
        if (
          (this.timer >= RAGDOLL_MIN_TICKS && ragdollSettled) ||
          this.timer >= RAGDOLL_MAX_TICKS
        ) {
          this.enter("GettingUp");
        }
        break;
      case "GettingUp":
        this.timer += 1;
        if (this.timer >= GETUP_TICKS) this.enter("Controlled");
        break;
    }
    return this.motionState;
  }

  private enter(state: CharacterMotionState): void {
    this.motionState = state;
    this.timer = 0;
  }
}

import { GETUP_TOTAL_TICKS, IMPACT_RAGDOLL_MIN, IMPACT_STAGGER_MIN, RAGDOLL_MAX_TICKS, RAGDOLL_MIN_TICKS, STAGGER_INPUT_SCALE, STAGGER_TICKS } from "../tuning/knockdown.js";
import { SLIDE_INPUT_SCALE } from "../tuning/movement.js";

/**
 * The Character's motion state (ADR 0006, ticket 05; `Sliding` added ticket
 * 03, M3.6, ADR 0037).
 *
 * ```
 * Controlled → Stagger    (medium Impact — stays upright, input dampened)
 * Controlled → Sliding    (grounded on a Surface steeper than walkable)
 * Controlled → Ragdoll    (hard Impact or a Fall)
 * Sliding    → Controlled (the instant the too-steep condition no longer holds — no timer)
 * Sliding    → Ragdoll    (a hard Impact lands while sliding, exactly as from Stagger)
 * Stagger    → Controlled (after STAGGER_TICKS)
 * Stagger    → Ragdoll    (a hard Impact lands while staggering)
 * Ragdoll    → GettingUp  (past RAGDOLL_MIN_TICKS and settled, or at RAGDOLL_MAX_TICKS)
 * GettingUp  → Controlled (after GETUP_TOTAL_TICKS: the sweep onto the get-up
 *                          clip's first frame, then the clip to its planted
 *                          feet — uninterruptible, so continuous Impacts
 *                          can't soft-lock the Character while down)
 * any        ↔ Held       (only ever set from outside, by a Grab hold — ADR 0104)
 * ```
 *
 * `Held` (ADR 0104) is the one state this machine never enters or leaves on
 * its own: whether a Character is being carried is a cross-Character fact,
 * and only `GrabHolds` knows it. While Held the machine only waits — no timer
 * runs out, and no Impact or Wobble lands, because the body belongs to the
 * hold until the hold lets go of it.
 *
 * Every state transition is still exactly one per {@link CharacterStateMachine.tick}
 * call — recovering from Stagger onto a still-too-steep Surface reaches
 * Controlled this tick and Sliding the next, the same way GettingUp reaches
 * Controlled one tick before anything else about that tick is re-evaluated.
 */
export type CharacterMotionState = "Controlled" | "Stagger" | "Sliding" | "Ragdoll" | "GettingUp" | "Held";

/**
 * Whether a Character in this motion state is "down" — Ragdolled or getting
 * back up from one, as opposed to driving its own movement. The one
 * predicate every down-state check across client and server means (M4.5
 * ticket 03): ADR 0015's unconditional down-state reconciliation, ADR
 * 0023's prediction-tick guard, and the renderer's own pose selection all
 * ask exactly this question, and used to each answer it with their own
 * inline copy of the same two-state check.
 */
export const isDownMotionState = (state: CharacterMotionState): boolean =>
  state === "Ragdoll" || state === "GettingUp";

/**
 * Whether this Character's own Player moves its body in this motion state —
 * false while down and while Held (ADR 0104). Such a body is only ever where
 * the server says it is: a client never predicts it, and draws the server's.
 */
export const isPlayerDrivenMotionState = (state: CharacterMotionState): boolean =>
  !isDownMotionState(state) && state !== "Held";

/**
 * What a motion state *does* to the Character, as opposed to when it is
 * entered and left (that is {@link CharacterStateMachine}'s). The
 * `CharacterController` reads these fields and never asks which state it is
 * in — so a new state that moves like an existing one is a new row here, not
 * a new branch there (codebase audit 2026-09, ticket 10).
 */
export interface MotionMode {
  /** How much of the Player's movement input reaches the Character — walk, jump and Dash alike. */
  inputScale: number;
  /**
   * What moves the body: the kinematic capsule, the ragdoll's own physics with
   * the capsule switched off, or a Grab hold, which places the capsule itself
   * with its collider off (ADR 0104).
   */
  body: "capsule" | "ragdoll" | "held";
  /**
   * How the capsule's velocity is found each tick: accelerate toward the wish
   * velocity (ADR 0035), or gravity projected onto the slope and integrated
   * (ADR 0037) — which also keeps the ground-stick clamp and any Dash
   * contribution out of it. `none` while the ragdoll moves the body.
   */
  velocity: "accelerate" | "slide" | "none";
  /** Where the snapshot says the body is: the capsule, the ragdoll, or the get-up blend from one to the other. */
  pose: "capsule" | "ragdoll" | "gettingUp";
}

/** Every motion state's {@link MotionMode} — see ADR 0006/0037 for the states themselves. */
export const MOTION_MODES: { readonly [State in CharacterMotionState]: MotionMode } = {
  Controlled: { inputScale: 1, body: "capsule", velocity: "accelerate", pose: "capsule" },
  Stagger: { inputScale: STAGGER_INPUT_SCALE, body: "capsule", velocity: "accelerate", pose: "capsule" },
  Sliding: { inputScale: SLIDE_INPUT_SCALE, body: "capsule", velocity: "slide", pose: "capsule" },
  Ragdoll: { inputScale: 0, body: "ragdoll", velocity: "none", pose: "ragdoll" },
  GettingUp: { inputScale: 0, body: "capsule", velocity: "accelerate", pose: "gettingUp" },
  Held: { inputScale: 0, body: "held", velocity: "none", pose: "capsule" },
};

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
  private pendingWobbleTicks = 0; // a Stagger queued by something other than an Impact
  private staggerTicks = STAGGER_TICKS; // how long the Stagger currently running lasts

  get state(): CharacterMotionState {
    return this.motionState;
  }

  /** What the current state does to the Character — see {@link MOTION_MODES}. */
  get mode(): MotionMode {
    return MOTION_MODES[this.motionState];
  }

  /** Movement-input multiplier for the current state. */
  get inputScale(): number {
    return this.mode.inputScale;
  }

  /** Queue an Impact for the next {@link tick}. Only the strongest one counts. */
  impact(magnitude: number): void {
    this.pendingImpact = Math.max(this.pendingImpact, magnitude);
  }

  /** Force a Ragdoll on the next {@link tick}, whatever the current state. */
  forceRagdoll(): void {
    this.forcedRagdoll = true;
  }

  /**
   * Queue a Stagger of `ticks` for the next {@link tick} — a Wobble that no
   * Impact caused (ADR 0072: what a Character comes back from a Respawn with).
   *
   * Unlike {@link impact} this carries its own duration, because the reason
   * sets the length: a light hit wobbles for {@link STAGGER_TICKS}, a Respawn
   * for longer. A hard Impact queued for the same tick still wins — being
   * knocked down outranks being unsteady.
   */
  wobble(ticks: number): void {
    this.pendingWobbleTicks = Math.max(this.pendingWobbleTicks, ticks);
  }

  reset(): void {
    this.motionState = "Controlled";
    this.timer = 0;
    this.pendingImpact = 0;
    this.forcedRagdoll = false;
    this.pendingWobbleTicks = 0;
    this.staggerTicks = STAGGER_TICKS;
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
    this.pendingWobbleTicks = 0;
    // A correction says which state, never how long a Stagger it snapped into
    // was meant to run (the wire carries `motionState`, not this machine's
    // timer). The hit-length is the safe assumption: it is the shorter of the
    // two, so the worst a mis-guess can do is end a respawn wobble early
    // rather than strand a Character slowed for two seconds it never earned.
    this.staggerTicks = STAGGER_TICKS;
  }

  /**
   * Advance one tick. `ragdollSettled` is whether the ragdoll body's fastest bone
   * is below {@link RAGDOLL_SETTLE_SPEED} — only meaningful while in `Ragdoll`.
   *
   * `tooSteepToWalk` (ticket 03, M3.6) is whether the Character is currently
   * grounded on a Surface steeper than the walkable limit — a *condition*,
   * supplied fresh every tick by the caller (from the Character's own ground
   * contact), not state this machine tracks itself. Defaults to `false` so
   * every existing caller — none of which know or care about slopes — is
   * unaffected. Only consulted from `Controlled`/`Sliding` themselves, the
   * same way `Stagger`/`Ragdoll`/`GettingUp` only ever consult their own
   * timers: reusing `Stagger`'s recovery tick to also re-check this would
   * make one tick do two unrelated jobs.
   */
  tick(ragdollSettled: boolean, tooSteepToWalk = false): CharacterMotionState {
    const impact = this.pendingImpact;
    const forced = this.forcedRagdoll;
    const queuedWobble = this.pendingWobbleTicks;
    this.pendingImpact = 0;
    this.forcedRagdoll = false;
    this.pendingWobbleTicks = 0;

    // ADR 0104: a Held Character is the hold's to put down. Whatever was
    // queued while it was carried has already been dropped above.
    if (this.motionState === "Held") return this.motionState;

    const hardHit = forced || impact >= IMPACT_RAGDOLL_MIN;
    // A fresh hard hit downs a Controlled, Staggering or Sliding Character.
    // It is ignored while already `Ragdoll` (so the timer keeps counting
    // toward RAGDOLL_MAX_TICKS) and while `GettingUp` (which always
    // completes) — so continuous impacts can never soft-lock the Character
    // out of `Controlled`.
    if (
      hardHit &&
      (this.motionState === "Controlled" || this.motionState === "Stagger" || this.motionState === "Sliding")
    ) {
      this.enter("Ragdoll");
      return this.motionState;
    }

    // A queued Wobble lands from anywhere a hard hit would have (ADR 0072) —
    // a Character that respawns mid-Stagger or mid-Slide comes back wobbling
    // like any other, and it restarts the clock rather than inheriting
    // whatever was left of the old one.
    if (queuedWobble > 0 && !isDownMotionState(this.motionState)) {
      this.enter("Stagger");
      this.staggerTicks = queuedWobble;
      return this.motionState;
    }

    switch (this.motionState) {
      case "Controlled":
        // Slope condition takes priority over a mere Stagger-tier impact —
        // if both apply the same tick, sliding away from underfoot is more
        // urgent than a wobble in place.
        if (tooSteepToWalk) this.enter("Sliding");
        else if (impact >= IMPACT_STAGGER_MIN) {
          this.enter("Stagger");
          this.staggerTicks = STAGGER_TICKS;
        }
        break;
      case "Sliding":
        // Condition-held (CONTEXT.md), not timed — leaves the instant the
        // Character is no longer grounded on too-steep ground, whether that's
        // because the slope leveled out or because it walked/fell off it.
        if (!tooSteepToWalk) this.enter("Controlled");
        break;
      case "Stagger":
        this.timer += 1;
        if (this.timer >= this.staggerTicks) this.enter("Controlled");
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
        // The sweep onto the clip's first frame, then the clip to its
        // planted-feet frame (.scratch/physical-ragdoll ticket 03).
        if (this.timer >= GETUP_TOTAL_TICKS) this.enter("Controlled");
        break;
    }
    return this.motionState;
  }

  private enter(state: CharacterMotionState): void {
    this.motionState = state;
    this.timer = 0;
  }
}

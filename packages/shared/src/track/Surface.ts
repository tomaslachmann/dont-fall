import {
  BOUNCE_JUMP_MULTIPLIER,
  ICE_CRASH_MIN_SPEED,
  ICE_JUMP_MULTIPLIER,
  ICE_LANDING_KNOCKDOWN_CHANCE,
  ICE_LANDING_KNOCKDOWN_MIN_SPEED,
  ICE_TOP_SPEED_MULTIPLIER,
  MUD_JUMP_MULTIPLIER,
  MUD_LANDING_KNOCKDOWN_CHANCE,
  MUD_LANDING_KNOCKDOWN_MIN_SPEED,
  MUD_RUN_SLIP_CHANCE_PER_SECOND,
  MUD_SLIP_MIN_SPEED,
  MUD_TOP_SPEED_MULTIPLIER,
  MUD_TURN_SLIP_CHANCE,
  MUD_TURN_SLIP_MIN_ANGLE,
} from "../tuning/surfaces.js";

/**
 * A Track floor's Surface id (CONTEXT.md) — how well a Character grips a
 * piece of floor and how fast it may ultimately travel on it. Resolved from
 * `Box.surface ?? Module.surface ?? DEFAULT_SURFACE`, once, in `Track.ts`'s
 * `resolveTrack` (ADR 0036) — never re-resolved in the tick loop.
 *
 * An open string, not a closed union: a new Surface is added to
 * {@link SURFACES} below without touching this type or anywhere it's used —
 * exactly like `Module.id`/`Segment.moduleId`.
 */
export type SurfaceId = string;

/**
 * A Surface's effect on movement (ADR 0035/0036, amended by ADR 0094). Two
 * independent knobs,
 * per Source's own model:
 *
 * - `topSpeedMultiplier` — scales the *target* (`WALK_SPEED`) a Character's
 *   velocity is chasing. Mud's whole effect (ticket 01): a lower ceiling,
 *   acceleration/drag left alone.
 * - `grip` — one scalar multiplying **both** acceleration and drag
 *   (`movementVerbs.ts`'s `accelerateVelocity` factors, ticket 06) — how
 *   *quickly* that target is reached and how quickly you stop/turn,
 *   independent of what the target itself is. Ice's whole effect: near-zero
 *   grip, top speed untouched. "Ice makes you faster" is the intuitive
 *   answer and the wrong one — neither Quake nor Source touches max speed
 *   for slick surfaces; the feel is carried entirely by lost acceleration
 *   and lost turn authority.
 *
 * Before ticket 05's acceleration model, `grip` had nothing to multiply —
 * every Surface implicitly had "infinite" grip (velocity assigned outright
 * every tick). Now that accelerate/drag/cap is real, both knobs are ordinary
 * multipliers on the same pipeline, not two special cases.
 */
export interface SurfaceConfig {
  /**
   * No Dash starts while standing on it (the user, 2026-09-18: "Dash must not
   * turn on on any Surface like ice, mud and so on"). A burst already running
   * carries on across it; only the press is refused.
   */
  noDash?: true;
  /** Multiplies WALK_SPEED while standing on this Surface. 1 = unchanged. */
  topSpeedMultiplier: number;
  /**
   * Multiplies both `MOVE_ACCEL_FACTOR` and `MOVE_FRICTION_FACTOR` (ticket
   * 06). 1 = full grip (today's engineered-to-saturate default — reaches
   * target speed and stops within a single tick, ticket 05). Near-zero =
   * ice: acceleration and drag both slow to a crawl.
   */
  grip: number;
  /**
   * M3.7 ticket 02: if set, landing on this Surface reverses vertical
   * velocity instead of the ordinary ground-stick clamp — a trampoline, not
   * a launcher. Absent (the default) on every other Surface: a bounce is a
   * per-Surface property, not something every floor tile has an opinion on.
   */
  bounce?: SurfaceBounceConfig;
  /**
   * Multiplies {@link JUMP_VELOCITY} for a jump taken *off* this Surface
   * (ADR 0092). 1 (the default) on every Surface that has no opinion. Below
   * 1 on ice: you cannot push off something you have no purchase on, and
   * since height goes with the square of take-off speed, even a light
   * multiplier is felt.
   *
   * Deliberately a take-off knob and not a gravity one: a jump that *starts*
   * weak is legible ("I didn't get off the ice properly"), while a jump that
   * starts normally and is then pulled down mid-air reads as the game
   * cheating.
   */
  jumpMultiplier?: number;
  /**
   * If set, landing on this Surface hard enough may put the Character down
   * (ADR 0092) — ice's own hazard, and mud's (ADR 0102), the mirror of
   * {@link bounce}: both are "what this floor does to an arriving Character",
   * and both are a property of the floor rather than something every tile
   * has an opinion on.
   */
  landingKnockdown?: SurfaceLandingKnockdownConfig;
  /**
   * If set, running into anything while standing on this Surface knocks the
   * Character down from this closing speed instead of the wall-Impact rule's
   * own (ADR 0102) — ice's. "Anything" is meant: another Character counts
   * too, which off such a Surface it never does for the one running (a Bump
   * is one-sided, M2 ticket 04).
   */
  crashKnockdown?: SurfaceCrashKnockdownConfig;
  /**
   * If set, running on this Surface — and turning sharply on it — may take
   * the Character's feet (ADR 0102): mud's.
   */
  runningSlip?: SurfaceRunningSlipConfig;
}

/** A Surface on which any crash takes your feet (ADR 0102). */
export interface SurfaceCrashKnockdownConfig {
  /**
   * The closing speed (units/s, the Character's own velocity into whatever
   * it hit) at or above which a crash knocks it down. Low, never zero: a
   * Character resting against a rail is touching it, not crashing into it.
   */
  minSpeed: number;
}

/**
 * A Surface that may take the Character's feet while it moves on it (ADR
 * 0102). Both chances are drawn with the same deterministic `slipRoll` a
 * landing reads, for the same reason (ADR 0092): the client predicts it.
 */
export interface SurfaceRunningSlipConfig {
  /**
   * Below this horizontal speed (units/s, against the floor, so a belt
   * carrying you does not count) nothing slips: standing and creeping are
   * safe.
   */
  minSpeed: number;
  /** The chance of going down per second of running at or above {@link minSpeed}, 0–1. */
  chancePerSecond: number;
  /**
   * A change of direction sharper than this (radians), from one tick to the
   * next with both at or above {@link minSpeed}, is a turn the feet may not
   * survive.
   */
  turnMinAngle: number;
  /** The chance such a turn puts the Character down, 0–1. */
  turnChance: number;
}

/**
 * A slippery Surface's landing hazard (ADR 0092). Read on the tick ground
 * contact resolves, against the same `MovementController.airbornePeakFallSpeed`
 * a bounce reads — the speed the Character genuinely arrived at, not the
 * ground-stick residue left after the clamp.
 */
export interface SurfaceLandingKnockdownConfig {
  /**
   * Below this arrival speed (units/s, downward) a landing is always safe.
   * Set above a plain standing jump's own landing speed, so stepping and
   * hopping around on ice is never a coin flip — only a real drop is.
   */
  minSpeed: number;
  /**
   * The chance of going down on a landing at or above {@link minSpeed}, 0–1.
   * Drawn deterministically from the Character's id and the landing tick
   * (`slipRoll`), never `Math.random()`: the step is pure with respect to
   * `(state, inputs)` (ADR 0003/0005) and the client predicts it, so both
   * sides must draw the same number for the same landing or every slip
   * would be a correction.
   */
  chance: number;
}

/**
 * A bouncy Surface's landing physics (M3.7 ticket 02) — computed from the
 * Character's own impact velocity, per the research doc's own model
 * (`docs/research/surface-and-volume-mechanics.md` §1.4): "one-shot per
 * landing... that is what makes it a bounce rather than a launcher: a small
 * fall gives a small bounce." Contrast with a launch pad (`LaunchPad.ts`),
 * which sets a fixed velocity regardless of how you arrived.
 */
export interface SurfaceBounceConfig {
  /** Multiplies incoming downward speed on landing. 0.85 = loses 15% of vertical speed per bounce, not a perfectly elastic one. */
  restitution: number;
  /** Floor under the resulting upward speed, so even a slow landing still bounces noticeably — a walk-on shouldn't feel like nothing happened. */
  minSpeed: number;
}

/** What every Box/Module resolves to when it declares no Surface of its own. */
export const DEFAULT_SURFACE: SurfaceId = "default";

/**
 * Every Surface a resolved Track's floor can be (ADR 0036). Numeric values
 * are deliberately provisional — the milestone spec records the exact
 * multiplier as "a measurement, not a decision," to be tuned against a real
 * ramp/mud/ice Module once one exists, not re-litigated here. Mud and ice
 * are deliberately near-mirror images of each other (ticket 06): mud caps
 * the target speed and leaves grip alone, ice leaves the target speed alone
 * and caps grip — the two knobs are independent, and each Surface here only
 * ever needs to touch the one that carries its own feel.
 */
export const SURFACES: Record<SurfaceId, SurfaceConfig> = {
  [DEFAULT_SURFACE]: { topSpeedMultiplier: 1, grip: 1 },
  mud: {
    noDash: true,
    topSpeedMultiplier: MUD_TOP_SPEED_MULTIPLIER,
    grip: 1,
    jumpMultiplier: MUD_JUMP_MULTIPLIER,
    landingKnockdown: { minSpeed: MUD_LANDING_KNOCKDOWN_MIN_SPEED, chance: MUD_LANDING_KNOCKDOWN_CHANCE },
    runningSlip: {
      minSpeed: MUD_SLIP_MIN_SPEED,
      chancePerSecond: MUD_RUN_SLIP_CHANCE_PER_SECOND,
      turnMinAngle: MUD_TURN_SLIP_MIN_ANGLE,
      turnChance: MUD_TURN_SLIP_CHANCE,
    },
  },
  ice: {
    noDash: true,
    topSpeedMultiplier: ICE_TOP_SPEED_MULTIPLIER,
    grip: 0.001,
    jumpMultiplier: ICE_JUMP_MULTIPLIER,
    landingKnockdown: { minSpeed: ICE_LANDING_KNOCKDOWN_MIN_SPEED, chance: ICE_LANDING_KNOCKDOWN_CHANCE },
    crashKnockdown: { minSpeed: ICE_CRASH_MIN_SPEED },
  },
  bounce: { noDash: true, topSpeedMultiplier: 1, grip: 1, jumpMultiplier: BOUNCE_JUMP_MULTIPLIER, bounce: { restitution: 0.85, minSpeed: 6 } },
};

/**
 * A Surface's config, falling back to {@link DEFAULT_SURFACE} for `undefined`
 * (no ground contact, e.g. mid-air) or an id `SURFACES` doesn't recognise —
 * defensive: every id a resolved Track actually carries comes from
 * `SURFACES`' own keys, but a Surface could in principle be renamed/removed
 * out from under an already-published Track. The single place that decides
 * "no Surface found" resolves to `DEFAULT_SURFACE` (code review, ticket 01)
 * — a caller should never re-implement this fallback inline, or the two
 * could silently diverge if this policy ever changes.
 */
export const surfaceConfig = (id: SurfaceId | undefined): SurfaceConfig =>
  SURFACES[id ?? DEFAULT_SURFACE] ?? SURFACES[DEFAULT_SURFACE]!;

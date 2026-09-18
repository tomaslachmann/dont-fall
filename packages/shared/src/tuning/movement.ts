import { msToTicks } from "./clock.js";
import type { WALK_SPEED, WALL_NORMAL_MAX_Y } from "./character.js";
import type { WALL_IMPACT_MIN_SPEED, WALL_IMPACT_SCALE } from "./knockdown.js";

/**
 * How a Character gets around: the movement model, jump, Dash, slopes and
 * Sliding. Part of `tuning/` (see `index.ts`).
 */

// --- Movement model: accelerate -> drag -> cap (M3.6, ADR 0035) -------------

//
// `movementVerbs.ts`'s `accelerateVelocity` replaces the old direct
// `velocity.xz = wish` assignment with Source's own `Friction()`/
// `Accelerate()` shape (the reference implementation ADR 0035 names
// alongside Quake 3's `PM_Friction`/`PM_Accelerate`) — chosen deliberately
// over a naive "step by a flat units/s² amount every tick" design: a flat
// step's magnitude doesn't scale with anything, so a drag step and an
// accelerate step of comparable size can fully cancel each other at low
// speed, permanently stalling far short of the real target — verified
// during this ticket's own development, not a hypothetical. Source's shapes
// avoid this because `Accelerate()`'s magnitude scales with the *target*
// speed (`wishSpeed`, a roughly-constant, comparatively large quantity) while
// `Friction()`'s scales with the *current* speed (small until real motion
// has built up) — different quantities, not the same one racing itself.

/**
 * Defensive backstop on the Character's own horizontal move velocity — the
 * final "cap" stage of the pipeline. Comfortably above any speed the walk
 * model can currently produce (`WALK_SPEED` × the highest Surface/slope
 * multiplier, plus `DASH_SPEED`, ≈ 22.5 units/s), so it never actually fires
 * today — it exists so a future stacked combination of Surface/slope/Dash
 * effects fails safe instead of accumulating without bound.
 */
export const MOVE_VELOCITY_CAP = 30;

/**
 * Source's `sv_accelerate` — a dimensionless multiplier on `wishSpeed` (not
 * an absolute units/s² rate): `accelerateVelocity`'s Accelerate() stage adds
 * `min(MOVE_ACCEL_FACTOR * wishSpeed * TICK_DT, addSpeed)` toward the wish
 * velocity every tick. `* TICK_DT >= 1` (true here, with generous margin —
 * the exact threshold is `TICK_RATE_HZ`) guarantees the addable amount
 * always reaches (never merely approaches) `wishSpeed`, saturating every
 * tick — deliberate, not an oversight: this ticket's whole job is
 * introducing the accelerate → drag → cap *shape*, numerically **identical**
 * today to the direct assignment it replaces. A separately-tuned, genuinely
 * gradual value only appears once a Surface (ticket 06, ice/mud) supplies
 * its own, per the "one scalar per Surface multiplies both" rule (ADR 0035)
 * — that scalar multiplies this constant (and `MOVE_FRICTION_FACTOR` below)
 * directly, exactly like Source's own `surfaceFriction`.
 */
export const MOVE_ACCEL_FACTOR = 1000;

/**
 * Source's `sv_friction` — the Friction() stage's own dimensionless rate,
 * kept as an independent constant from {@link MOVE_ACCEL_FACTOR} (Source's
 * own reference values, 10 and 4, aren't equal either) even though both
 * happen to need the same "saturates every tick" property today. Drop this
 * tick is `max(speed, MOVE_STOP_SPEED) * MOVE_FRICTION_FACTOR * TICK_DT`;
 * saturating (same `* TICK_DT >= 1` reasoning as above) fully zeroes any
 * residual velocity every tick, matching the old model's implicit "no input
 * held, no memory of the last direction" behaviour exactly.
 */
export const MOVE_FRICTION_FACTOR = 1000;

/**
 * Source's `sv_stopspeed` — a floor under Friction()'s `control` term, so a
 * small residual speed gets a real, fast stop instead of an exponential tail
 * that never quite reaches zero. Inert today: at {@link MOVE_FRICTION_FACTOR}'s
 * current saturating value, drop already exceeds any realistic speed on its
 * own, so this floor is never what decides the outcome. It starts mattering
 * only once a Surface (ticket 06) supplies a much smaller friction scalar.
 */
export const MOVE_STOP_SPEED = 1;

// --- Jump -------------------------------------------------------------------

/**
 * Upward speed (units/s) applied at the moment of a jump — apexing at
 * `JUMP_VELOCITY² / (2·|GRAVITY_Y|)` ≈ 1.3 m before the hold boost.
 *
 * Cut from 10 (≈ 2.3 m) on 2026-09-17 (ADR 0092). At the old height a Player
 * mashing jump and Dash together cleared most of a course's geometry without
 * engaging with it — "the combination makes the track trivially beatable."
 * The jump is now a commitment: most obstacles have to be approached rather
 * than hopped over. Multiplied per-Surface by `SurfaceConfig.jumpMultiplier`
 * at take-off — ice pushes back weakly.
 */
export const JUMP_VELOCITY = 7.5;

/** How long holding jump keeps the ascent boosted after take-off (ms). */
export const JUMP_HOLD_MAX_MS = 260;

/** Gravity multiplier while jump is held and the Character is still rising (<1 = floatier). */
export const JUMP_HOLD_GRAVITY_SCALE = 0.5;

/** Grace period after walking off an edge during which a jump still works (ms). */
export const COYOTE_MS = 100;

/** {@link JUMP_HOLD_MAX_MS} in whole ticks. */
export const JUMP_HOLD_MAX_TICKS = msToTicks(JUMP_HOLD_MAX_MS);

/** {@link COYOTE_MS} in whole ticks. */
export const COYOTE_TICKS = msToTicks(COYOTE_MS);

// --- Dash (ADR 0092) --------------------------------------------------------

/**
 * Peak horizontal speed (units/s) the build-up reaches and the burst then
 * holds. Cut from 15 on 2026-09-17 (ADR 0092): a burst three times as long at
 * the old speed crossed 55 units, which is most of a Track section in one
 * press. 12 is still twice {@link WALK_SPEED}.
 *
 * {@link WALL_IMPACT_MIN_SPEED} and {@link WALL_IMPACT_SCALE} are both
 * derived from this on purpose, so retuning it keeps "a full-strength Dash
 * into a wall lands exactly as hard as it always did" true without a second
 * edit — see their own comments.
 */
export const DASH_SPEED = 12;

/**
 * How long the dash burst lasts (ms) — tripled from 1000 on 2026-09-17 (ADR
 * 0092). The Dash stopped being a move you spam and became a resource you
 * spend: one long committed burst, rationed by {@link DASH_COOLDOWN_MS}.
 */
export const DASH_DURATION_MS = 3000;

/**
 * How long the dash takes to build up to {@link DASH_SPEED} (ms) — the
 * "nitro" ramp. Held at 900 while {@link DASH_DURATION_MS} tripled, so the
 * burst still reaches full speed as quickly as it always did and then *holds*
 * there, rather than spending three seconds gently accelerating. Before ADR
 * 0092 the build ran across the whole burst, which at the old one-second
 * duration was this same ~0.9 s — so this constant is today's feel, written
 * down rather than derived.
 */
export const DASH_RAMP_MS = 900;

/**
 * How long the dash takes to release back to 0 at the very end (ms) — so the
 * burst eases out instead of cutting dead at full speed.
 */
export const DASH_RELEASE_MS = 90;

/**
 * Minimum time between dashes (ms), measured from the *start* of the previous
 * one — must stay comfortably above {@link DASH_DURATION_MS} or there is no
 * real rest after the burst ends (DashController's cooldown and duration
 * timers start together and count down in lockstep).
 *
 * 15 s since ADR 0092: long enough that a Dash is a decision about *where* to
 * spend it, and long enough to be worth drawing — the Round HUD carries a
 * meter of this recharge, which a 1.5 s cooldown would never have justified.
 */
export const DASH_COOLDOWN_MS = 15_000;

/** {@link DASH_DURATION_MS} in whole ticks. */
export const DASH_DURATION_TICKS = msToTicks(DASH_DURATION_MS);

/** {@link DASH_RAMP_MS} in whole ticks. */
export const DASH_RAMP_TICKS = msToTicks(DASH_RAMP_MS);

/** {@link DASH_RELEASE_MS} in whole ticks. */
export const DASH_RELEASE_TICKS = msToTicks(DASH_RELEASE_MS);

/** {@link DASH_COOLDOWN_MS} in whole ticks. */
export const DASH_COOLDOWN_TICKS = msToTicks(DASH_COOLDOWN_MS);

// --- Slopes and Sliding (M3.6, ADR 0037) ------------------------------------

/**
 * Steeper than this (radians, from horizontal) and a grounded Character
 * slides instead of walking with full control — the walkable/Sliding
 * boundary. Deliberately independent of {@link WALL_NORMAL_MAX_Y} (the
 * Sliding/wall boundary): a single threshold would make a steep ramp either
 * "walk up it" or "unclimbable wall," with no band to slide down in between
 * — the entire point of tilted geometry (ADR 0037). Replaces Rapier's own
 * coincident `maxSlopeClimbAngle`/`minSlopeSlideAngle` defaults (both 45°,
 * verified against the installed 0.20.0) — see `CharacterController`'s
 * constructor, which sets both of Rapier's own knobs to the *wall* angle
 * instead (derived from `WALL_NORMAL_MAX_Y`) and leaves the walkable/Sliding
 * split entirely to this project's own state machine. A placeholder value,
 * like every other number this milestone defers to real-ramp tuning.
 */
export const WALKABLE_SLOPE_MAX_ANGLE = (35 * Math.PI) / 180;

/**
 * How strongly walking speed scales with the signed slope angle (ticket 04,
 * M3.6) — `slopeSpeedMultiplier` (`movementVerbs.ts`) computes
 * `1 - SLOPE_SPEED_ANGLE_FACTOR * angle`, where `angle` is the slope's tilt
 * toward the direction of travel (positive uphill, negative downhill —
 * Unity's Character Controller package's own documented convention). Bounded
 * automatically by {@link WALKABLE_SLOPE_MAX_ANGLE}: since this multiplier
 * only ever applies while walking (never `Sliding`), the steepest angle it
 * ever sees is that limit, giving roughly 0.76x uphill / 1.24x downhill at
 * the walkable ceiling with this value — a provisional number, like every
 * other one this milestone defers to real-ramp tuning.
 */
export const SLOPE_SPEED_ANGLE_FACTOR = 0.4;

/**
 * Defensive floor on {@link import("../../simulation/movementVerbs.js").slopeSpeedMultiplier}'s
 * output — never lets an (unexpectedly, given the bound above) steep uphill
 * angle multiply speed down to zero or negative.
 */
export const SLOPE_SPEED_MULTIPLIER_MIN = 0.1;

/**
 * Movement input multiplier while Sliding (ticket 03, M3.6, ADR 0037) — some
 * steering authority remains (unlike Ragdoll/GettingUp's 0), but reduced
 * (unlike Controlled's 1), matching CONTEXT.md's "keeps reduced movement
 * input while gravity carries it down the slope." A placeholder value —
 * this milestone's numbers are deliberately provisional, tuned later against
 * a real ramp, not decided here.
 */
export const SLIDE_INPUT_SCALE = 0.3;

/**
 * How far the horizontal velocity blends toward the (already-reduced)
 * steering target each tick while Sliding (ticket 03, M3.6, ADR 0037) — 0
 * would mean no steering at all, 1 would mean instant full authority every
 * tick. Bounded blending, not integration (code review): steering is a
 * *velocity* target, and integrating it as if it were an acceleration grows
 * without bound the longer a direction is held. A placeholder value, like
 * every other number this milestone defers to real-ramp tuning.
 */
export const SLIDE_STEER_BLEND = 0.15;

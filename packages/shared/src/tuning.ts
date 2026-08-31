/**
 * Tuning constants for the DON'T FALL simulation.
 *
 * Every value the game's feel depends on lives here as a named constant — never
 * as a magic number scattered through the sim or the client. M1 fills this in as
 * movement verbs land (see docs/milestones/M1.md).
 */

/** Fixed simulation rate. The sim always steps at this cadence (ADR 0004). */
export const TICK_RATE_HZ = 30;

/** Seconds of simulated time advanced by one {@link TICK_RATE_HZ} tick. */
export const TICK_DT = 1 / TICK_RATE_HZ;

/** Milliseconds of simulated time advanced by one tick. */
export const TICK_MS = TICK_DT * 1000;

/** Convert a duration in milliseconds to whole simulation ticks. */
export const msToTicks = (ms: number): number => Math.round(ms / TICK_MS);

/**
 * Upper bound on how many sim steps a single frame may run before the loop
 * gives up catching up (avoids the "spiral of death" after a long stall).
 */
export const MAX_STEPS_PER_FRAME = 5;

// --- Character ---------------------------------------------------------------

/** Downward acceleration (units/s²). Stronger than real gravity for snappier falls. */
export const GRAVITY_Y = -22;

/** Ground movement speed (units/s) while Controlled. */
export const WALK_SPEED = 6;

/**
 * Small downward speed (units/s) kept while grounded so the character controller
 * always has a non-degenerate vertical to solve — a flat `0` makes Rapier's
 * controller stall when the capsule rests exactly flush after a step-down. The
 * controller's own depenetration keeps the capsule from actually sinking.
 */
export const GROUND_STICK_SPEED = 2;

// --- Jump ------------------------------------------------------------------

/** Upward speed (units/s) applied at the moment of a jump. */
export const JUMP_VELOCITY = 10;

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

// --- Dash ------------------------------------------------------------------

/** Peak horizontal speed (units/s) added at the middle of a dash burst. */
export const DASH_SPEED = 22;

/** How long the dash burst lasts (ms). */
export const DASH_DURATION_MS = 230;

/** Ease-in and ease-out time at each end of the dash (ms) — the "smooth" start/stop. */
export const DASH_RAMP_MS = 90;

/** Minimum time between dashes (ms). */
export const DASH_COOLDOWN_MS = 1000;

/** {@link DASH_DURATION_MS} in whole ticks. */
export const DASH_DURATION_TICKS = msToTicks(DASH_DURATION_MS);

/** {@link DASH_RAMP_MS} in whole ticks. */
export const DASH_RAMP_TICKS = msToTicks(DASH_RAMP_MS);

/** {@link DASH_COOLDOWN_MS} in whole ticks. */
export const DASH_COOLDOWN_TICKS = msToTicks(DASH_COOLDOWN_MS);

/** Capsule radius (units). */
export const CAPSULE_RADIUS = 0.35;

/** Half-height of the capsule's cylindrical part, excluding the hemispherical caps (units). */
export const CAPSULE_HALF_HEIGHT = 0.5;

/** Distance from the capsule centre to its lowest point. */
export const CAPSULE_BOTTOM_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

// --- Kinematic character controller -----------------------------------------

/** Skin width kept between the capsule and surfaces (units). */
export const CHARACTER_CONTROLLER_OFFSET = 0.01;

// --- Fall & respawn ---------------------------------------------------------

/** Default height below which a Character has Fallen out of the playground (units). */
export const DEFAULT_KILL_PLANE_Y = -8;

/** How long a Character is frozen at its Checkpoint after a Respawn — the Fall penalty (ms). */
export const RESPAWN_LOCKOUT_MS = 2000;

/** {@link RESPAWN_LOCKOUT_MS} rounded to whole ticks. */
export const RESPAWN_LOCKOUT_TICKS = msToTicks(RESPAWN_LOCKOUT_MS);

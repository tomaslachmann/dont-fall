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

/** Capsule radius (units). */
export const CAPSULE_RADIUS = 0.35;

/** Half-height of the capsule's cylindrical part, excluding the hemispherical caps (units). */
export const CAPSULE_HALF_HEIGHT = 0.5;

/** Distance from the capsule centre to its lowest point. */
export const CAPSULE_BOTTOM_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

// --- Kinematic character controller -----------------------------------------

/** Skin width kept between the capsule and surfaces (units). */
export const CHARACTER_CONTROLLER_OFFSET = 0.01;

/** Max drop the controller snaps down to stay grounded on small steps/slopes (units). */
export const CHARACTER_SNAP_TO_GROUND = 0.3;

/** Tallest step the character walks up automatically (units). */
export const CHARACTER_AUTOSTEP_MAX_HEIGHT = 0.3;

/** Minimum ledge width for autostep to engage (units). */
export const CHARACTER_AUTOSTEP_MIN_WIDTH = 0.15;

/**
 * The Character's body: gravity, its capsule, and how it meets the ground and
 * walls. Part of `tuning/` (see `index.ts`).
 */

// --- Character --------------------------------------------------------------

/** Downward acceleration (units/s²). Stronger than real gravity for snappier falls. */
export const GRAVITY_Y = -22;

/**
 * Ground movement **target** (units/s) while Controlled (ticket 05, M3.6,
 * ADR 0035) — not, since this ticket, an instantaneous value assigned
 * straight into velocity every tick. It is what `beginCapsuleTick`'s
 * accelerate → drag → cap pipeline (`movementVerbs.ts`'s `accelerateVelocity`)
 * chases; at today's (full-grip) `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR`
 * it still reaches this target within a single tick, so the change is
 * structural, not felt — a Surface with its own, slower factors (ticket 06,
 * ice/mud) is what turns "target reached over time" into something a player
 * can actually feel.
 */
export const WALK_SPEED = 6;

/**
 * Small downward speed (units/s) kept while grounded so the character controller
 * always has a non-degenerate vertical to solve — a flat `0` makes Rapier's
 * controller stall when the capsule rests exactly flush after a step-down. The
 * controller's own depenetration keeps the capsule from actually sinking.
 *
 * This is *not* what keeps the Character glued to a downhill slope (ticket 02,
 * M3.6) — that was the actual unit bug: a fixed velocity produces a per-tick
 * probe distance that shrinks relative to the ground the faster you're moving
 * or the steeper the slope, capping clean descent at `atan(2/WALK_SPEED) ≈
 * 18°` (about 5° mid-Dash). That job now belongs to Rapier's own
 * `enableSnapToGround` (a real distance, not a speed) — see
 * `GROUND_SNAP_DISTANCE`. This constant's remaining job is narrower: give the
 * controller a small, constant, non-zero downward velocity to solve each
 * grounded tick, so a Character walking off a ledge starts falling from a
 * small speed rather than whatever happened to accumulate while grounded.
 */
export const GROUND_STICK_SPEED = 2;

/**
 * How far below the capsule's feet Rapier's own snap-to-ground (ticket 02,
 * M3.6/ADR 0037) will look for ground to pull the Character down onto — the
 * actual fix for the ground-stick unit bug documented on
 * {@link GROUND_STICK_SPEED}. Settled by a spike: enabling it on the
 * installed `@dimforge/rapier3d-compat@0.20.0` was measured against the
 * M1-era edge-stalling/Dash-hitching symptoms it was originally disabled
 * for, and reproduced neither (see ticket 02's own notes for the numbers).
 * `0.5` comfortably covers the worst case this project cares about — a
 * ~40° slope at full Dash speed — while staying far short of any
 * intentional gap/Fall in the current Track (the M1 seed's smallest
 * kill-plane drop is 7.5 units).
 */
export const GROUND_SNAP_DISTANCE = 0.5;

// --- Capsule ----------------------------------------------------------------

/** Capsule radius (units). */
export const CAPSULE_RADIUS = 0.35;

/** Half-height of the capsule's cylindrical part, excluding the hemispherical caps (units). */
export const CAPSULE_HALF_HEIGHT = 0.5;

/** Distance from the capsule centre to its lowest point. */
export const CAPSULE_BOTTOM_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

/**
 * How quickly the Character's body closes on the direction it runs (1/s):
 * every second it covers all but e^−rate of the turn still left, so a turn
 * slows into a soft stop instead of halting on the spot (user call,
 * 2026-09-17: the old constant-speed turn read as jerky under WASD). Since
 * ADR 0085 this is also how fast the Character's aim turns. With
 * {@link FACING_TURN_SPEED_MAX}, a quarter turn comes within 10° in about
 * 0.2 s and turning around takes about 0.3 s.
 *
 * The client turns the body (`modelFacing.ts`); it lives here since ADR 0104,
 * because a grabber's turn is slowed by the step as well, and both sides have
 * to read one number.
 */
export const FACING_TURN_RATE = 12;

/** The fastest the body ever turns (rad/s), so turning around takes visibly longer than a quarter turn. */
export const FACING_TURN_SPEED_MAX = 12;

// --- Kinematic character controller -----------------------------------------

/** Skin width kept between the capsule and surfaces (units). */
export const CHARACTER_CONTROLLER_OFFSET = 0.01;

/**
 * How close another Character's capsule may be for the two to count as
 * touching (units) — five skin widths. What a crash into a Character on ice
 * is judged from (ADR 0102), since the sweep does not always report one: a
 * capsule the controller stops against sits within a skin width of it, and
 * this leaves room for the other having moved off by a hair since.
 */
export const CHARACTER_TOUCH_MARGIN = CHARACTER_CONTROLLER_OFFSET * 5;

// --- Contact normals: wall or ground (ADR 0036/0037) ------------------------

/**
 * A collision normal counts as a "wall" (not a floor or ceiling) when the
 * absolute value of its Y component is below this. Above it, the surface is
 * treated as roughly horizontal and ignored for the wall-Impact check.
 */
export const WALL_NORMAL_MAX_Y = 0.5;

/**
 * A collision normal counts as "ground" for Surface lookup (ticket 01, ADR
 * 0036) when its Y component is above this — deliberately a *separate*
 * constant from {@link WALL_NORMAL_MAX_Y} even though it starts at the same
 * value: that one is tuned for "is this steep enough to dash-crash into,"
 * this one for "is this floor-like enough to trust for a Surface lookup."
 * Sharing one knob between the two would mean a future dash-feel tuning pass
 * silently retunes which collisions report a Surface too (code review,
 * ticket 01).
 */
export const SURFACE_GROUND_NORMAL_MIN_Y = 0.5;

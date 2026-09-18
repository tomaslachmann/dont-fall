import { GRAVITY_Y } from "./character.js";
import { BUMP_IMPULSE_SCALE, BUMP_LIFT_RATIO } from "./fight.js";
import { IMPACT_RAGDOLL_MIN } from "./knockdown.js";

/**
 * What the Track does to a Character: falling off it, Obstacles, Props, Moving
 * Segments, Springs. Part of `tuning/` (see `index.ts`).
 */

// --- Fall -------------------------------------------------------------------

/** Default height below which a Character has Fallen out of the playground (units). */
export const DEFAULT_KILL_PLANE_Y = -8;

// --- Spinner Obstacle (M1 ticket 06) ----------------------------------------

/** Knockback imparted per unit of tangential speed (units/s) at the point hit. */
export const SPINNER_KNOCKBACK_SCALE = 0.6;

/** Extra upward Knockback (units/s) added to every Spinner hit, for a visible pop. */
export const SPINNER_KNOCKBACK_LIFT = 2;

// --- Props (M1 ticket 06, ADR 0095) -----------------------------------------

/** Push impulse applied to a Prop per unit of the Character's horizontal speed. */
export const PROP_PUSH_SCALE = 0.5;

/**
 * How heavy an Asset Prop is per cubic metre of its own footprint (ADR 0095).
 * A traffic cone and a two-metre ball are the same `PropConfig` with different
 * geometry, and giving both the procedural default would make the ball skitter
 * like a cone — the one thing a Player reads off a Prop before touching it is
 * how heavy it looks.
 */
export const PROP_ASSET_DENSITY = 2;

/** Nothing weighs less than this, however small — a Prop that flies off the map on a brush is a bug, not a feature. */
export const PROP_ASSET_MASS_MIN = 1.5;

/** Nor more than this: past it a Prop stops answering a Character at all, which reads as broken rather than heavy. */
export const PROP_ASSET_MASS_MAX = 40;

// --- Moving Segments (M11, ADR 0061) ----------------------------------------

/**
 * Impact magnitude per unit of closing speed when a Moving Segment moves into
 * a Character — Bump's own scale, on purpose: ADR 0061 makes being hit by a
 * moving piece the same Impact rule as being bumped, so a platform drifting
 * into you at walking pace (~3.6) only shoves, and a hammer head at ≳ 15
 * units/s knocks you down.
 */
export const MOVING_SEGMENT_IMPACT_SCALE = BUMP_IMPULSE_SCALE;

/** Upward bias mixed into a Moving Segment's knockback direction — Bump's own pop. */
export const MOVING_SEGMENT_LIFT_RATIO = BUMP_LIFT_RATIO;

/**
 * Impact magnitude of touching a Spiked Asset (ADR 0061) — exactly the Ragdoll
 * threshold, so it always knocks down and no harder than it must.
 */
export const SPIKED_IMPACT_MAGNITUDE = IMPACT_RAGDOLL_MIN;

/** Upward bias of a Spiked knockback — a bigger pop than a Bump's, so the body clears the spikes. */
export const SPIKED_LIFT_RATIO = 1;

// --- Launch (Springs and launch pads, ADR 0069) -----------------------------

/**
 * How far from *standing on the deck* a Character may be and still fire a
 * Spring (units, measured at its capsule centre) — small on purpose.
 *
 * The box wants to be tight around the standing pose, not tall enough to catch
 * a fall in mid-air: a Character dropping onto a Spring is stopped by the
 * Spring's own collision within the tick it arrives, so it is already standing
 * when the trigger is tested. A generous box instead fires while the feet are
 * still well above the piece, and the launch reads as bouncing off nothing
 * (found live, 2026-09-15).
 */
export const LAUNCH_TRIGGER_MARGIN = 0.4;

/**
 * The launch speed that apexes at `height` metres under {@link GRAVITY_Y} —
 * `v = √(2·g·h)`, straight out of `v² = 2·g·h` at the top of the arc, where
 * the vertical speed is zero. The whole reason a launch is authored as a
 * height: `h` is what an author reasons about ("does this clear the gap"),
 * `v` is what the simulation wants, and only one of the two should be typed by
 * a human. Exact in both directions — `launchHeightToSpeed(h)² / (2·|g|) === h`.
 */
export const launchHeightToSpeed = (height: number): number => Math.sqrt(2 * Math.abs(GRAVITY_Y) * height);

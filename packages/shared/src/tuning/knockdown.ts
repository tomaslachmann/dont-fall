import { msToTicks } from "./clock.js";
import { DASH_SPEED } from "./movement.js";
import type { HIT_IMPACT_MAGNITUDE } from "./fight.js";

/**
 * Impacts and what they do: Stagger, Ragdoll, getting up (ADR 0006). Part of
 * `tuning/` (see `index.ts`).
 */

// --- Impact (ADR 0006/0093) -------------------------------------------------

/** Impulse magnitude below which an Impact is ignored entirely. */
export const IMPACT_STAGGER_MIN = 4;

/** Impulse magnitude at or above which an Impact knocks the Character to Ragdoll. */
export const IMPACT_RAGDOLL_MIN = 9;

/**
 * How fast (units/s of horizontal shove) each unit of Impact magnitude moves
 * a Character that is staggered but NOT knocked down (ADR 0093).
 *
 * An Impact under {@link IMPACT_RAGDOLL_MIN} used to be felt and never seen:
 * the impulse it carried was only ever consumed by `beginRagdoll`, so a
 * connecting Hit that merely staggered left its target standing exactly where
 * it was. The user's own words, playing Survival: a Hit should "trochu
 * posunout" the other Character. A Hit landing at {@link HIT_IMPACT_MAGNITUDE}
 * (6) now shoves at 3.3 units/s — over half a walk, unmistakable without being
 * a launch.
 */
export const IMPACT_KNOCKBACK_SCALE = 0.55;

/**
 * Upward pop (units/s per unit of Impact magnitude) mixed into a staggering
 * shove, applied once rather than decayed — gravity is what takes it back.
 * Small: enough to break the target's footing so the shove reads as a shove,
 * not enough to be a launch pad.
 */
export const IMPACT_KNOCKBACK_LIFT = 0.18;

/**
 * What fraction of a shove survives each tick (ADR 0093). The horizontal
 * movement pipeline (ADR 0035) recomputes velocity toward the wish velocity
 * every tick and, at full grip, reaches it exactly within that same tick — so
 * a shove written straight into `velocity` is erased before anyone sees it.
 * A knockback is therefore its own contributor, added on top and decayed
 * here: at 0.82 a shove is ~90% spent after half a second, which is a stumble
 * rather than a slide.
 */
export const IMPACT_KNOCKBACK_DECAY = 0.82;

/** Below this (units/s) a spent shove is dropped outright rather than decayed forever. */
export const IMPACT_KNOCKBACK_MIN = 0.05;

/**
 * How fast (units/s per unit of Impact magnitude) a knockdown by ANOTHER
 * PLAYER throws the whole body (ADR 0093). Before it, the Impact reached only
 * the ragdoll's chest as an impulse — which tumbles it convincingly and moves
 * it almost nowhere — so a Character knocked down while standing still
 * dropped on the spot.
 *
 * **Measured, not guessed** (2026-09-17, after the first value played too
 * strong: "jedna rana ukoncila survivor"). Distance a Hit-knockdown carries a
 * Character, from a standstill on flat ground:
 *
 * | scale | min knockdown | full charge | charging pays |
 * |------:|--------------:|------------:|--------------:|
 * |     0 |         0.67u |       1.00u |        +0.33u |
 * |   0.3 |         1.92u |       2.35u |        +0.43u |
 * |  0.45 |         2.18u |       3.58u |        +1.40u |
 * |  0.55 |         3.60u |       4.43u |        +0.83u |
 * |   0.9 |         6.20u |       8.99u |        +2.79u |
 *
 * 0.45 is the sweet spot on both axes at once, which is why it is not merely
 * the midpoint. A Character is 0.7 units wide, so a full charge moves one
 * about five body widths: enough that being near a rim is genuinely
 * dangerous, not enough that one swing from open ground ends a Survival
 * Round — herding someone to the edge first is the skill. And the *spread* is
 * widest here: a full charge throws 64% further than the minimum knockdown,
 * so holding the button visibly pays. Below ~0.3 that collapses (at 0.2 a
 * full charge threw no further than a half one — friction eats the
 * difference and hold-to-charge stops meaning anything for displacement);
 * above it, everything slides out toward "one hit is lethal" while the
 * spread narrows again.
 *
 * Scenery is deliberately excluded (see {@link THROWING_RAGDOLL_CAUSES}): a
 * Spinner, a wall or a Moving Segment still drops you where it caught you.
 * Throwing for *every* cause made the seeded base race uncompletable — its
 * spinning squares knocked the walker off the deck it was rounding — and
 * would have been the wrong rule anyway. The mechanic the user asked for is
 * Players shoving each other, not scenery launching them.
 */
export const KNOCKDOWN_LAUNCH_SCALE = 0.3;

// --- Wall Impact (M3.7 ticket 03, ADR 0037) ---------------------------------

/** Upward bias mixed into the wall-Impact knockback direction, before normalising, for a visible pop. */
export const WALL_IMPACT_LIFT_RATIO = 0.3;

/**
 * Minimum closing speed (units/s) — how fast the Character is moving *into*
 * the wall along its own normal, not just "how fast is this Character" in
 * general — for hitting a near-vertical surface to force Ragdoll (M3.7
 * ticket 03, ADR 0037). Re-expressed from the old Dash-specific
 * `DASH_WALL_MIN_SPEED_RATIO * DASH_SPEED` ratio to this same numeric value
 * (`DASH_SPEED * 0.6 = 9`) as a standalone absolute speed: the rule cares
 * *how fast*, never *why* — a bounce, a launch pad or an updraft crossing
 * this same threshold qualifies exactly like a full-strength Dash always
 * did, with no second, parallel rule for "launched" states (two rules for
 * one event drift apart under tuning, and then neither can be blamed).
 * Below this — early in a Dash's build-up or late in its release
 * (`dashEnvelope`), or simply walking fast on a downhill Surface — a wall
 * hit is just an ordinary blocked walk, not a knockdown; only real speed
 * counts as a real crash.
 */
export const WALL_IMPACT_MIN_SPEED = DASH_SPEED * 0.7;

/**
 * Impact magnitude per unit of closing speed (M3.7 ticket 03) — replaces the
 * old flat `DASH_WALL_IMPACT_MAGNITUDE` (always 14, however fast the Dash
 * actually was) with a magnitude that genuinely scales, so a glancing,
 * barely-qualifying hit lands softer than someone launched into the same
 * wall at twice the speed. Derived from the two previous, separately-tuned
 * constants (`14 / DASH_SPEED`) so a full-strength Dash into a wall reaches
 * *exactly* the same magnitude it always did — "Dashing into a wall feels
 * as it did" is the ticket's own explicit requirement, not a coincidence.
 */
export const WALL_IMPACT_SCALE = 14 / DASH_SPEED;

// --- Stagger, Ragdoll and getting up (ADR 0006/0047) ------------------------

/**
 * How long a Stagger — the game's Wobble (ADR 0072) — lasts after a light
 * Impact before recovering to Controlled (ms).
 *
 * Long enough to read as "you're soft right now" and for whoever hit you to
 * arrive and hit you again; short enough that one light hit is a setback and
 * not a sentence. Was 350 ms, which was a stumble nobody could see (there was
 * no animation for it either).
 */
export const STAGGER_MS = 1200;

/**
 * How long a Character wobbles after a Respawn (ADR 0072) — longer than a
 * hit's, because it stands in for the whole knockdown a Fall used to cost.
 *
 * What it replaces was far harsher: a Fall used to ragdoll you for
 * {@link RAGDOLL_MIN_MS}..{@link RAGDOLL_MAX_MS} plus {@link GETUP_MS} of
 * getting up, all at zero input — one to four and a half seconds of no
 * control. Two seconds at {@link STAGGER_INPUT_SCALE} is both gentler and
 * predictable, which is what a Track author needs when placing a gap.
 */
export const RESPAWN_WOBBLE_MS = 2000;

/** Movement input multiplier while Staggered. */
export const STAGGER_INPUT_SCALE = 0.35;

/**
 * Minimum time spent in Ragdoll before it can begin getting up (ms). This is
 * the length of the rig's `KO_*` clips, 50 frames at 30 fps (ADR 0076), so a
 * Character never starts getting up before its fall has finished playing.
 * Was 500.
 */
export const RAGDOLL_MIN_MS = 1667;

/** Hard cap on Ragdoll time — get up even if the body has not settled (ms). */
export const RAGDOLL_MAX_MS = 4000;

/** Max speed (units/s) of any ragdoll bone for the body to count as settled. */
export const RAGDOLL_SETTLE_SPEED = 1.2;

/**
 * How long GettingUp lasts at zero input (ms). This is the frame where the
 * rig's `GetUp_*` clips plant both feet, frame 32 of 84 at 30 fps (ADR 0076).
 * Control returns there, and the rest of the get-up plays out only while the
 * Character stands still. Was 450.
 */
export const GETUP_MS = 1067;

/**
 * The get-up's opening stretch (ms): the settled heap is swept kinematically
 * onto the matching `GetUp_X` clip's first frame, so physics ends exactly
 * where the clip begins and the handover has nothing left to hide
 * (`.scratch/physical-ragdoll` ticket 03 — the rubber bench measured the
 * seam at 0.0002 u). GettingUp as a whole lasts this plus {@link GETUP_MS}.
 */
export const GETUP_DRIVE_MS = 900;

/** Where the capsule centre is placed above the settled pelvis when GettingUp begins (units). */
export const GETUP_CAPSULE_LIFT = 0.7;

/**
 * How far a ragdoll joint may bend, in radians (M6 ticket 05, ADR 0047).
 *
 * Before these, every joint was a free ball joint: elbows and knees bent both
 * ways, the neck spun, and a knocked-down Character folded into a single lump
 * — measured, under gravity alone, as pelvis→head collapsing from 0.75 to
 * 0.07. These are what make it settle as a body.
 *
 * Not balance values, and not anatomy either: they are the loosest limits that
 * still read as a body, because ADR 0006 wanted the flop and this keeps as
 * much of it as it can. The spine and neck are deliberately generous — a
 * ragdoll that holds itself straight looks like a mannequin.
 */
export const RAGDOLL_SPINE_LIMIT = 0.5;
export const RAGDOLL_NECK_LIMIT = 0.6;

/** Elbows and knees are hinges: one signed range each, bending the way a limb actually bends. */
export const RAGDOLL_ELBOW_MAX = 2.3;
export const RAGDOLL_KNEE_MIN = -2.3;

/** Angular / linear damping on ragdoll bones — higher settles the flop faster. */
export const RAGDOLL_ANGULAR_DAMPING = 3;
export const RAGDOLL_LINEAR_DAMPING = 0.12;

/**
 * Extra constraint-solver iterations on each ragdoll bone body (M2 ticket 08).
 * The joint solver's documented worst case is a jointed body "pushed with a
 * large force" against another body — exactly a dash-crash into a Prop, now
 * that ragdoll bones collide with Props. Extra iterations keep the skeleton
 * from tearing apart on the hit (research §3.2).
 */
export const RAGDOLL_SOLVER_ITERATIONS = 6;

/**
 * Contact skin (units) on ragdoll bone colliders — a small margin that keeps
 * bones from deep-penetrating a Prop on a fast hit, which Rapier's own docs
 * note "can increase performance, and in some cases, stability".
 */
export const RAGDOLL_CONTACT_SKIN = 0.01;

/** Friction on ragdoll bone colliders (they should slide a little, not stick). */
export const RAGDOLL_FRICTION = 0.9;

/**
 * Restitution on the authored ragdoll's hulls (`AuthoredRagdoll`,
 * `.scratch/physical-ragdoll` ticket 01) — a whisper of bounce so a hard
 * landing doesn't read as hitting wet clay. The rubber bench's own number.
 */
export const RAGDOLL_RESTITUTION = 0.05;

/**
 * Fraction of its pre-hit velocity a Character's ragdoll keeps when the
 * knockdown was a *crash* — a dash into a wall/Prop, a Bump, a Spinner (M2
 * ticket 08). The collision absorbs most of the forward momentum, so the
 * ragdoll tumbles rather than keeping full dash speed and rocketing through
 * whatever it hit. A Fall keeps its momentum (no impact impulse ⇒ this doesn't
 * apply).
 */
export const RAGDOLL_IMPACT_VELOCITY_SCALE = 0.2;

/** {@link STAGGER_MS} in whole ticks. */
export const STAGGER_TICKS = msToTicks(STAGGER_MS);

/** {@link RESPAWN_WOBBLE_MS} in whole ticks. */
export const RESPAWN_WOBBLE_TICKS = msToTicks(RESPAWN_WOBBLE_MS);

/** {@link RAGDOLL_MIN_MS} in whole ticks. */
export const RAGDOLL_MIN_TICKS = msToTicks(RAGDOLL_MIN_MS);

/** {@link RAGDOLL_MAX_MS} in whole ticks. */
export const RAGDOLL_MAX_TICKS = msToTicks(RAGDOLL_MAX_MS);

/** {@link GETUP_MS} in whole ticks. */
export const GETUP_TICKS = msToTicks(GETUP_MS);

/** {@link GETUP_DRIVE_MS} in whole ticks. */
export const GETUP_DRIVE_TICKS = msToTicks(GETUP_DRIVE_MS);

/** The whole of GettingUp: the sweep onto the clip's first frame, then the clip to its planted-feet frame. */
export const GETUP_TOTAL_TICKS = GETUP_DRIVE_TICKS + GETUP_TICKS;

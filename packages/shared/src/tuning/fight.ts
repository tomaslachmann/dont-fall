import { msToTicks } from "./clock.js";
import type { CAPSULE_RADIUS, FACING_TURN_RATE, FACING_TURN_SPEED_MAX, WALK_SPEED } from "./character.js";
import type { IMPACT_RAGDOLL_MIN, IMPACT_STAGGER_MIN, KNOCKDOWN_LAUNCH_SCALE, WALL_IMPACT_LIFT_RATIO } from "./knockdown.js";
import type { DASH_COOLDOWN_MS } from "./movement.js";

/**
 * What Players do to each other: Hit, Grab and Bump (M6, ADR 0093). Part of
 * `tuning/` (see `index.ts`).
 */

// --- Hit (M6 ticket 03, M6.1) -----------------------------------------------

/** Minimum time between swings (ms) — mirrors {@link DASH_COOLDOWN_MS}'s idiom, just with no duration of its own to also wait out (a swing is instant, not a burst). */
export const HIT_COOLDOWN_MS = 800;

/** {@link HIT_COOLDOWN_MS} in whole ticks. */
export const HIT_COOLDOWN_TICKS = msToTicks(HIT_COOLDOWN_MS);

/** How far (units, centre to centre) a swing reaches — short-range, comfortably beyond two capsules merely touching ({@link CAPSULE_RADIUS} × 2). */
export const HIT_RANGE = 1.8;

/**
 * Cosine of the half-angle of the forward cone a target must fall within to
 * be swung at — `0.5` = 60° either side of dead-ahead (120° total), generous
 * enough to feel responsive without landing on someone beside or behind you.
 */
export const HIT_FACING_COS_MIN = 0.5;

/**
 * Fixed Impact magnitude a landed swing delivers, unlike Bump's
 * closing-speed-scaled one — a Hit has no "how fast was I moving" to derive
 * from; it is a deliberate, static punch. Tuned to reliably clear
 * {@link IMPACT_STAGGER_MIN} but stay under {@link IMPACT_RAGDOLL_MIN} on its
 * own: one Hit always staggers, never immediately knocks someone down outright.
 */
export const HIT_IMPACT_MAGNITUDE = 6;

/** Upward bias mixed into a Hit's knockback direction — same idea as {@link BUMP_LIFT_RATIO}. */
export const HIT_LIFT_RATIO = 0.3;

/**
 * How long (ms) the Hit button must be held to reach full charge (M6.1:
 * hold-to-charge). Supersedes M6.1 ticket 01's original design, which scaled
 * a Hit's Impact off the striker's own approach speed so a swing thrown out
 * of a committed Dash could knock down — Dash now locks Hit (and Grab) out
 * entirely while a burst is playing ("dash locks everything until it
 * finishes"), so a swing can never overlap a Dash at all, and needs its own,
 * independent source of "how committed was this."
 *
 * A release short of full charge still swings, just for less — there is no
 * minimum hold, only a ceiling on how much longer holding keeps helping.
 * Chosen shorter than `DASH_DURATION_MS` (1000): charging is a windup, not a
 * second burst to commit to.
 */
export const HIT_CHARGE_MAX_MS = 600;

/** {@link HIT_CHARGE_MAX_MS} in whole ticks. */
export const HIT_CHARGE_MAX_TICKS = msToTicks(HIT_CHARGE_MAX_MS);

/**
 * How much a full charge adds on top of {@link HIT_IMPACT_MAGNITUDE} (M6.1:
 * hold-to-charge). Sized so a full charge (`6 + 6 = 12`) clears
 * `IMPACT_RAGDOLL_MIN` (9) with the same margin M6.1 ticket 01's own "wound
 * Dash" case had, and a half charge (`6 + 3 = 9`) lands right at the
 * threshold — a knockdown costs a real, deliberate hold, not a tap, the same
 * design intent ticket 01 had for a committed Dash.
 */
export const HIT_CHARGE_IMPACT_BONUS = 6;

/**
 * Ceiling on a Hit's Impact — a safety net, not an active clamp. A full
 * charge tops out at `12` (see {@link HIT_CHARGE_IMPACT_BONUS}), so this
 * never bites; it exists so a future power-up or charge retune cannot turn
 * the same swing into a launcher that punts someone off the arena.
 */
export const HIT_IMPACT_MAX = 14;

// --- Grab (M6 ticket 04, ADR 0104) -------------------------------------------

/** Same targeting reach as {@link HIT_RANGE} — latching on needs the Character to already be close, not a wider grab-specific range. */
export const GRAB_RANGE = 1.8;

/** Same targeting cone as {@link HIT_FACING_COS_MIN} — "the Character just ahead of you" (CONTEXT.md). */
export const GRAB_FACING_COS_MIN = 0.5;

/** Minimum time between grabs (ms), counted from the moment a hold *ends* (CONTEXT.md: "cooldown after") — not from when it started, unlike Dash's own idiom. */
export const GRAB_COOLDOWN_MS = 1000;

/** {@link GRAB_COOLDOWN_MS} in whole ticks. */
export const GRAB_COOLDOWN_TICKS = msToTicks(GRAB_COOLDOWN_MS);

/**
 * How long a Held Character has to win its Struggle (ms) before it goes Limp
 * (ADR 0104) — the length ADR 0093's whole hold used to have.
 */
export const GRAB_STRUGGLE_WINDOW_MS = 3000;

/** {@link GRAB_STRUGGLE_WINDOW_MS} in whole ticks. */
export const GRAB_STRUGGLE_WINDOW_TICKS = msToTicks(GRAB_STRUGGLE_WINDOW_MS);

/**
 * How many wiggles fill the escape meter from empty, if it never drained (ADR
 * 0104). A wiggle is one reversal of the movement input (A→D, W→S, a stick
 * waved side to side). With {@link GRAB_ESCAPE_DECAY_PER_S}, eight wiggles a
 * second — two keys alternated briskly — fill it in about two seconds, inside
 * the window; five a second never does.
 */
export const GRAB_ESCAPE_WIGGLES = 12;

/**
 * How much of the escape meter drains per second, all the time, while a
 * Character Struggles (ADR 0104) — so the meter only fills while the Player
 * keeps at it, and a pause costs what it took to earn.
 */
export const GRAB_ESCAPE_DECAY_PER_S = 0.2;

/**
 * How directly a move input must point back against the last one to count as
 * a wiggle, as a cosine — `-0.5` is anywhere within 60° of dead opposite. A→D
 * is −1; turning the camera a little between presses still counts.
 */
export const GRAB_WIGGLE_REVERSAL_DOT_MAX = -0.5;

/**
 * How fast (units/s) a Character that wins its Struggle is shoved away from
 * its grabber (ADR 0104) — a shove, never a knockdown: it lands on its feet.
 */
export const GRAB_ESCAPE_SHOVE_SPEED = 4;

/**
 * How long the grabber may carry a Limp Character (ms) before it is released
 * into a Ragdoll (ADR 0104). No get-up clock runs while Limp, so this is the
 * whole of the grabber's window, not a race against the knockdown's own.
 */
export const GRAB_CARRY_MS = 2000;

/** {@link GRAB_CARRY_MS} in whole ticks. */
export const GRAB_CARRY_TICKS = msToTicks(GRAB_CARRY_MS);

/**
 * The grabber's pace while holding someone, as a fraction of its own (ADR
 * 0104) — folded into the same `WALK_SPEED` chain a Surface's own
 * `topSpeedMultiplier` uses. 3.6 u/s against a walk of 6: carrying someone
 * to an edge takes long enough for them to Struggle.
 *
 * Supersedes ADR 0093's full-speed drag (`GRAB_SPEED_MULTIPLIER = 1`): "může
 * s ním nějak pomaleji chodit".
 */
export const GRAB_CARRY_SPEED_MULTIPLIER = 0.6;

/**
 * The grabber's body turns at this fraction of its usual rate while holding
 * someone (ADR 0104) — both {@link FACING_TURN_RATE} and
 * {@link FACING_TURN_SPEED_MAX}. The owning client turns its body slower, and
 * the step clamps the replicated facing to the same top speed, so a modified
 * client cannot whip a body round.
 */
export const GRAB_TURN_SPEED_MULTIPLIER = 0.5;

/**
 * How far in front of its grabber a Held Character is carried (units, centre
 * to centre, ADR 0104) — arm's length, clear of the grabber's own capsule
 * (2 × `CAPSULE_RADIUS` = 0.7).
 */
export const GRAB_CARRY_DISTANCE = 1.1;

/** How far above its grabber's capsule centre a Held Character is carried (units) — its feet off the ground. */
export const GRAB_CARRY_LIFT = 0.4;

/**
 * Where the grabber's grip holds a Limp body, above the chest bone's own
 * pivot (`.scratch/physical-ragdoll` ticket 04). At the collar: high enough
 * that the body hangs from it rather than balancing on it, low enough that
 * the head is not being carried by the neck. The rubber bench's own number,
 * converted from BLIP's units to the sim's.
 */
export const GRAB_GRIP_ABOVE_CHEST = 0.2;

/**
 * How long a Character released from a hold cannot be grabbed again, counted
 * from when it is standing (`Controlled`) once more (ms, ADR 0104) — Grab
 * immunity, so a Limp body cannot be dropped and picked straight back up.
 */
export const GRAB_IMMUNITY_MS = 1500;

/** {@link GRAB_IMMUNITY_MS} in whole ticks. */
export const GRAB_IMMUNITY_TICKS = msToTicks(GRAB_IMMUNITY_MS);

// --- Spin and Hurl (ADR 0104) ------------------------------------------------

/** How long (ms) a Spin takes to wind up from standing to {@link SPIN_MAX_SPEED}, speeding up evenly. */
export const SPIN_WINDUP_MS = 1200;

/** {@link SPIN_WINDUP_MS} in whole ticks. */
export const SPIN_WINDUP_TICKS = msToTicks(SPIN_WINDUP_MS);

/** A Spin's top speed (rad/s) — one and a half turns a second. */
export const SPIN_MAX_SPEED = 3 * Math.PI;

/**
 * How long (ms) a grabber may hold a Spin at full speed before it gets dizzy
 * and goes down (ADR 0104) — nobody can wait forever for the perfect angle.
 */
export const SPIN_OVERSPIN_MS = 1000;

/** {@link SPIN_OVERSPIN_MS} in whole ticks. */
export const SPIN_OVERSPIN_TICKS = msToTicks(SPIN_OVERSPIN_MS);

/**
 * How far off the circle's tangent a Hurl may be pulled toward the direction
 * the grabber is steering, in degrees (ADR 0104). At 30 Hz a fast Spin gives
 * aiming by timing alone a window of one to three ticks; with the pull, a
 * grabber who holds toward the edge and lets go roughly on time hits it.
 */
export const HURL_AIM_SNAP_DEG = 45;

/** {@link HURL_AIM_SNAP_DEG} as the cosine the aim is compared against. */
export const HURL_AIM_SNAP_COS = Math.cos((HURL_AIM_SNAP_DEG * Math.PI) / 180);

/**
 * The horizontal launch speed (units/s) of a Hurl with no wind-up at all, and
 * at a full one (ADR 0104) — lerped by how far the Spin had wound up. Measured
 * rather than guessed, the way ADR 0093 tuned `KNOCKDOWN_LAUNCH_SCALE`: how
 * far the body ends up from where it was let go, on flat ground, once it has
 * stopped (2026-09-18):
 *
 * | wind-up | 0.03 | 0.25 | 0.5 | 0.75 | 1 |
 * |---|---|---|---|---|---|
 * | distance (u) | 3.1 | 3.5 | 5.1 | 6.2 | 7.3 |
 *
 * A flick throws about as far as a fully charged Hit (3.6); a full Spin about
 * twice that. 5 and 11 threw 4.2 and 8.2 — a flick already out-throwing the
 * best Hit, which costs no catch and no Struggle.
 */
export const HURL_MIN_SPEED = 3;
export const HURL_MAX_SPEED = 10;

/** Upward speed (units/s) every Hurl leaves with, so the body clears the floor instead of skidding along it. */
export const HURL_LIFT_SPEED = 3;

/**
 * The share of a Hurl's speed a dizzy grabber flings its held Character with
 * (ADR 0104) — "flies off weakly", in a direction `slipRoll` draws.
 */
export const DIZZY_FLING_FRACTION = 0.4;

/**
 * The share of the Spin's own speed at the carry point a Character that wins
 * its Struggle mid-Spin leaves with (ADR 0104) — freed, on its feet, and
 * still flung. It can still carry it off an arena.
 */
export const SPIN_ESCAPE_FLING_FRACTION = 0.4;

/**
 * Impact per unit of the swung body's speed (units/s) on anyone it passes
 * through during a Spin, and per unit of a hurled body's speed on anyone it
 * lands on (ADR 0104). The carry point of a full Spin moves at
 * `SPIN_MAX_SPEED × GRAB_CARRY_DISTANCE` ≈ 10.4 u/s, which this puts at ~10.4
 * — over `IMPACT_RAGDOLL_MIN` (9): a full Spin knocks down, a slow one only
 * staggers.
 */
export const SWUNG_BODY_IMPACT_SCALE = 1;

/** Upward bias mixed into a swung or hurled body's knockback, as {@link BUMP_LIFT_RATIO} is for a Bump. */
export const SWUNG_BODY_LIFT_RATIO = 0.3;

/**
 * How close (units, centre to centre, horizontally) a swung or hurled body
 * has to come to another Character to hit it — two capsules touching, plus a
 * little for the limbs the capsule does not have.
 */
export const SWUNG_BODY_REACH = 0.9;

/** The slowest a hurled body can be moving (units/s) and still knock into anyone — below it, it is lying there, not flying. */
export const HURLED_BODY_MIN_SPEED = 4;

/** The longest (ms) a hurled body counts as flying, whatever its speed. */
export const HURLED_BODY_FLIGHT_MS = 1500;

/** {@link HURLED_BODY_FLIGHT_MS} in whole ticks. */
export const HURLED_BODY_FLIGHT_TICKS = msToTicks(HURLED_BODY_FLIGHT_MS);

/** How long (ms) after a swung body hits someone it cannot hit them again — once per pass of the circle, never once per tick of contact. */
export const SWUNG_BODY_REHIT_MS = 500;

/** {@link SWUNG_BODY_REHIT_MS} in whole ticks. */
export const SWUNG_BODY_REHIT_TICKS = msToTicks(SWUNG_BODY_REHIT_MS);

// --- Character-to-Character Bump (M2 ticket 04) -----------------------------

/**
 * Impact magnitude delivered to a Bumped Character per unit of *closing speed*
 * (units/s) — how fast the mover is approaching along the contact normal,
 * relative to the target's own motion. Tuned against the shared
 * {@link IMPACT_STAGGER_MIN} / {@link IMPACT_RAGDOLL_MIN} thresholds: a plain
 * walk into a standing player (closing ≈ {@link WALK_SPEED}) lands ~3.6, under
 * Stagger — a physical shove, no state change; a dash near full speed (closing
 * ≳ 15) clears {@link IMPACT_RAGDOLL_MIN} and knocks them down.
 */
export const BUMP_IMPULSE_SCALE = 0.6;

/**
 * Upward bias mixed into the Bump knockback direction before normalising, for
 * a visible pop off the ground — same idea as {@link WALL_IMPACT_LIFT_RATIO}.
 */
export const BUMP_LIFT_RATIO = 0.3;

// --- Elimination credit (ADR 0110) ------------------------------------------

/**
 * How long (ms) a grab, a throw or a Hit still counts as who put a Character
 * out, when it Falls out of a Survival Round — the knocked-out card's GRABBED /
 * HURLED / HIT BY. Long enough to cover a shove, the tumble and the drop off
 * the edge; short enough that a bump half a Round ago is not credited with a
 * Fall its victim walked into on their own.
 */
export const ELIMINATION_CREDIT_MS = 5_000;

/** {@link ELIMINATION_CREDIT_MS} in whole ticks. */
export const ELIMINATION_CREDIT_TICKS = msToTicks(ELIMINATION_CREDIT_MS);

/**
 * The heaviest Prop a Character can pick up (ADR 0125) — anything heavier is
 * only shoved, as before. A first guess from what the authored Tracks place: a
 * cone weighs 1.5, a 1.4 m ball 5.5 and a 1.8 m ball 11.7, so every Prop on
 * them lifts, and a two-metre ball (≥ 17) does not.
 */
export const PROP_CARRY_MASS_MAX = 15;

/** The heaviest Prop a Character can still jump with (ADR 0125): a cone and the smaller balls, not the 1.8 m one. */
export const PROP_JUMP_MASS_MAX = 8;

/**
 * The carrier's pace, turn and jump while carrying a Prop (ADR 0125), each a
 * fraction of its own: the first number with the lightest Prop, the second
 * with one at the limit ({@link PROP_CARRY_MASS_MAX}, or
 * {@link PROP_JUMP_MASS_MAX} for the jump), linear between. First guesses.
 */
export const PROP_CARRY_SPEED_LIGHT = 0.9;
export const PROP_CARRY_SPEED_HEAVY = 0.5;
export const PROP_CARRY_TURN_LIGHT = 0.9;
export const PROP_CARRY_TURN_HEAVY = 0.4;
export const PROP_CARRY_JUMP_LIGHT = 0.9;
export const PROP_CARRY_JUMP_HEAVY = 0.6;

/** A thrown Prop's speed, as a multiple of a toss's or a Hurl's own (ADR 0125): a cone flies further than a ball. */
export const PROP_THROW_LIGHT = 1.3;
export const PROP_THROW_HEAVY = 0.6;

/** The longest (ms) Hit can be held with a Prop in hand and still be a tap — a toss, not a Spin (ADR 0125). */
export const PROP_TOSS_TAP_MS = 200;

/** {@link PROP_TOSS_TAP_MS} in whole ticks. */
export const PROP_TOSS_TAP_TICKS = msToTicks(PROP_TOSS_TAP_MS);

/** A toss's speed (units/s) straight ahead, before the Prop's weight scales it, and its upward lift (ADR 0125). */
export const PROP_TOSS_SPEED = 8;
export const PROP_TOSS_LIFT = 3;

/**
 * How much faster than authored a Lift plays BLIP's `Pickup_Ground` (ADR
 * 0128): the clip is 1.8 s, which the user found too long to stand still for.
 */
export const PROP_LIFT_SPEEDUP = 1.5;

/**
 * BLIP's carry clips, as authored (ADR 0128) — measurements, not feel
 * numbers, read off the GLB's own clip events and held to the real file by
 * `modelBones.test.ts`: `Pickup_Ground`'s length and the moment its hands
 * reach the Prop (`pickup_contact`), and the moment `Throw_Item` lets go
 * (`item_release`). Seconds of clip time.
 */
export const PICKUP_CLIP_SECONDS = 1.8;
export const PICKUP_CONTACT_SECONDS = 0.8;
export const THROW_RELEASE_SECONDS = 0.4;

/** A Lift in whole ticks, and the tick of it on which the hands reach the Prop (ADR 0128). */
export const PROP_LIFT_TICKS = msToTicks((PICKUP_CLIP_SECONDS * 1000) / PROP_LIFT_SPEEDUP);
export const PROP_LIFT_CONTACT_TICKS = msToTicks((PICKUP_CONTACT_SECONDS * 1000) / PROP_LIFT_SPEEDUP);

/** A Toss's wind-up in whole ticks: from the tap to the Prop leaving the hands (ADR 0128). */
export const PROP_TOSS_RELEASE_TICKS = msToTicks(THROW_RELEASE_SECONDS * 1000);

/**
 * Where the carrier's hands are while it holds a Prop (ADR 0125, ADR 0128):
 * ahead of its capsule's centre, above it, and how far apart they are; with
 * how far forward its body reaches (arms aside) at that height (units). A
 * measurement, not a feel number — the hand bones of `Pickup_Ground`'s last
 * frame, the hold every carry clip starts from, drawn at the game's own scale
 * (`modelBones.test.ts` holds them together). `propGripOffset` places a
 * Prop from these.
 */
export const PROP_GRIP_REACH = 0.45;
export const PROP_GRIP_LIFT = 0.03;
export const PROP_GRIP_SPREAD = 0.59;
export const PROP_GRIP_BODY_FRONT = 0.44;

/** The same four for a Spin (ADR 0128), which still holds at arm's length: `Grab_HoldOut`, whose body leans into the hold. */
export const PROP_SPIN_GRIP_REACH = 0.88;
export const PROP_SPIN_GRIP_LIFT = 0.52;
export const PROP_SPIN_GRIP_SPREAD = 0.35;
export const PROP_SPIN_GRIP_BODY_FRONT = 0.76;

/** Where the hands are the moment a Toss lets go (ADR 0128): `Throw_Item` at its release, ahead and above as {@link PROP_GRIP_REACH} is. */
export const PROP_TOSS_RELEASE_REACH = 0.64;
export const PROP_TOSS_RELEASE_LIFT = 0.14;

// --- Bomb (ADR 0126) --------------------------------------------------------

/** How long (s) a bomb burns from the pick-up that lit it — its Asset's default, retuned per placed Segment. */
export const BOMB_FUSE_SECONDS = 5;

/** The last seconds of a fuse, drawn with the fast tick — the warning a Player reads. */
export const BOMB_WARN_SECONDS = 1.5;

/** How long (s) a spent bomb is gone before it lies where it was placed again — its Asset's default, retuned per placed Segment. */
export const BOMB_RETURN_SECONDS = 8;

/** How far (units) a blast reaches, from the bomb's middle to a Character's — 6 since the user asked it to reach further (ADR 0126, amended). */
export const BOMB_BLAST_RADIUS = 6;

/**
 * The Impact a blast deals at its middle and at the edge of its reach (ADR
 * 0126), falling off linearly between them: the middle well past
 * {@link IMPACT_RAGDOLL_MIN}, the edge just past {@link IMPACT_STAGGER_MIN}, so
 * the one holding it goes down hard and the one at the edge only stumbles.
 */
export const BOMB_BLAST_IMPACT_CENTRE = 18;
export const BOMB_BLAST_IMPACT_EDGE = 4.5;

/**
 * How fast (units/s) a blast throws a Character it knocks down from its very
 * middle, falling off with the Impact (ADR 0126, amended). A blast's own
 * throw rather than {@link KNOCKDOWN_LAUNCH_SCALE}, which gave it a charged
 * Hit's 5 u/s — about a third of this.
 */
export const BOMB_BLAST_LAUNCH_SPEED = 15;

/** The speed (units/s) a blast adds to a Prop at its middle, away from it, falling off like the Impact. */
export const BOMB_BLAST_PROP_SPEED = 9;

/** How long (s) a Shooter's bomb burns from the shot, unless the Shooter's own `lifeSeconds` says otherwise (ADR 0127). */
export const SHOOTER_BOMB_FUSE_SECONDS = 3;

/**
 * How long (s) a spent Shooter's bomb stays where it went off before its
 * Shooter may fire it again (ADR 0127) — as long as the explosion is drawn
 * (`Bomb_Explode`, 2.1 s), so a reused bomb never leaves mid-explosion.
 */
export const BOMB_SPENT_HOLD_SECONDS = 2.1;

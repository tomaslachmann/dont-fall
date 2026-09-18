import { WALK_SPEED } from "./character.js";
import { IMPACT_RAGDOLL_MIN, type WALL_IMPACT_MIN_SPEED } from "./knockdown.js";
import type { JUMP_VELOCITY } from "./movement.js";

/**
 * What each Surface costs or gives (ADR 0094) — the rest of a Surface lives in
 * `track/Surface.ts`. Part of `tuning/` (see `index.ts`).
 */

// --- Ice (ADR 0066/0092/0102) -----------------------------------------------

/**
 * How much of {@link JUMP_VELOCITY} a jump taken off ice keeps — you cannot
 * push hard off something you have no purchase on. Height goes with the
 * square of take-off speed, so 0.8 costs ~36% of the jump: felt at once, but
 * still unmistakably a jump.
 */
export const ICE_JUMP_MULTIPLIER = 0.8;

/**
 * What {@link WALK_SPEED} becomes on ice (ADR 0094, the user's call on
 * 2026-09-18 after playing the authored Tracks: "žádná penalizace rychlosti
 * na ledu a v blátě").
 *
 * This amends ADR 0035/0036, which said slick Surfaces must leave top speed
 * alone and carry their whole feel in `grip` — Quake's and Source's own rule.
 * That is still true of how ice *accelerates*: at `grip` 0.001 you barely
 * build speed and barely stop, and momentum you bring onto the ice is what
 * you keep. What the rule left out is that a Player who has come to a stop on
 * ice and is scrabbling along it should not be able to reach the same running
 * pace as on concrete. Ice's penalty stays the milder of the two — the floor
 * that takes your feet is not also the floor that takes your time.
 */
export const ICE_TOP_SPEED_MULTIPLIER = 0.8;

/**
 * How fast a Character must be coming down (units/s) for a landing on ice to
 * risk putting it down. Set above a plain jump's own landing speed — with
 * {@link JUMP_VELOCITY} at 7.5 plus the hold boost, a jump in place arrives
 * at roughly 9 — so hopping around on ice is never a coin flip. Only a real
 * drop is.
 */
export const ICE_LANDING_KNOCKDOWN_MIN_SPEED = 11;

/**
 * The chance a hard-enough landing on ice puts the Character down (0–1).
 * Deliberately not 1: the user's call was that ice *may* catch you out, not
 * that it always does — a certainty would make every icy drop a known tax
 * rather than a moment. Drawn deterministically per (Character, landing
 * tick) so client and server agree; see `slipRoll`.
 */
export const ICE_LANDING_KNOCKDOWN_CHANCE = 0.5;

/**
 * The closing speed (units/s) at which running into anything on ice knocks
 * the Character down (ADR 0102) — the user's rule, 2026-09-18: "na ICE
 * surface narážka do čehokoliv = ragdoll". Every other Surface keeps
 * {@link WALL_IMPACT_MIN_SPEED}, so this is the wall-Impact rule with its
 * threshold all but gone — and on ice, "anything" includes another Player.
 *
 * Not zero: a Character standing against a rail, or leaning into one at a
 * crawl, is not crashing, and a closing speed of exactly zero is every tick
 * a resting capsule touches a wall. One unit a second is far under the 4.8
 * ice lets you reach on your own legs, so any real slide into something
 * counts.
 */
export const ICE_CRASH_MIN_SPEED = 1;

// --- Mud (ADR 0067/0094/0102) -----------------------------------------------

/**
 * What {@link WALK_SPEED} becomes in mud — the harshest of any Surface, which
 * is the whole reason to route around a mud arm rather than through it. Cut
 * from 0.5 with the jump penalty below, so that a branch made of mud reads as
 * a real trade against a branch made of ice.
 */
export const MUD_TOP_SPEED_MULTIPLIER = 0.4;

/**
 * How much of {@link JUMP_VELOCITY} a jump taken out of mud keeps. Height goes
 * with the square of take-off speed, so 0.7 leaves under half of it — you can
 * still hop, and you cannot clear anything with it. The mirror of
 * {@link ICE_JUMP_MULTIPLIER}: ice gives you nothing to push against, mud
 * holds on to your feet.
 */
export const MUD_JUMP_MULTIPLIER = 0.7;

/**
 * Below this horizontal speed (units/s, against the floor — a belt carrying
 * you does not count) a Character in mud never slips running or turning (ADR
 * 0102): standing or creeping through it is safe. Half of mud's own top
 * speed, so it follows {@link MUD_TOP_SPEED_MULTIPLIER} through a retune; a
 * Staggering Character, at a third of that pace, is always under it.
 */
export const MUD_SLIP_MIN_SPEED = WALK_SPEED * MUD_TOP_SPEED_MULTIPLIER * 0.5;

/**
 * The chance, per second of running in mud at or above
 * {@link MUD_SLIP_MIN_SPEED}, that the Character's feet go (ADR 0102, the
 * user's pick). Drawn once a tick at the matching per-tick share, so it is
 * the same chance however the second is sliced. At 3% the mudflat in Slip
 * Stream — 63 m, about 26 s at mud pace — takes a Player's feet at least once
 * a little over half the time.
 */
export const MUD_RUN_SLIP_CHANCE_PER_SECOND = 0.03;

/**
 * How sharply (radians) a Character running in mud must change direction
 * from one tick to the next for the turn to risk its feet (ADR 0102). 120°:
 * a strafe (90°) is ordinary steering and safe; turning back on yourself,
 * square or on the diagonal, is not. Mud has full grip, so a turn on the keys
 * is a turn of the velocity within the same tick.
 */
export const MUD_TURN_SLIP_MIN_ANGLE = (2 * Math.PI) / 3;

/** The chance a sharp turn in mud puts the Character down (ADR 0102) — a coin flip, like a hard landing on ice. */
export const MUD_TURN_SLIP_CHANCE = 0.5;

/**
 * How fast a Character must be coming down (units/s) for a landing in mud to
 * risk its feet (ADR 0102). The same as ice's
 * {@link ICE_LANDING_KNOCKDOWN_MIN_SPEED}, for the same reason: stepping and
 * hopping around is never a coin flip, only a real drop is.
 */
export const MUD_LANDING_KNOCKDOWN_MIN_SPEED = 11;

/** The chance a hard-enough landing in mud puts the Character down (ADR 0102). */
export const MUD_LANDING_KNOCKDOWN_CHANCE = 0.5;

// --- Slips (ADR 0092/0102) --------------------------------------------------

/**
 * The impulse every slip applies — a landing that takes your feet on ice or
 * in mud, a run or a turn in mud — exactly {@link IMPACT_RAGDOLL_MIN}, the
 * smallest that actually puts a Character down, following the Spiked
 * obstacle's own precedent. A slip should sprawl you, not launch you.
 * (Was `ICE_LANDING_KNOCKDOWN_IMPULSE` while ice was the only Surface that
 * had one.)
 */
export const SLIP_IMPULSE = IMPACT_RAGDOLL_MIN;

// --- Bounce (ADR 0070/0094) -------------------------------------------------

/**
 * How much of {@link JUMP_VELOCITY} a jump taken off a bounce Surface gets
 * back — the only multiplier above 1. Height goes with its square, so 1.35
 * roughly doubles the jump: a deck that visibly bulges under you had to be
 * worth jumping on, and until ADR 0094 it gave a timed jump exactly what
 * concrete did.
 *
 * Bounded by construction: a jump taken on a bounce deck takes the greater of
 * this and the deck's own rebound, never their sum, so repeatedly timing a
 * jump converges on this height instead of climbing without limit.
 */
export const BOUNCE_JUMP_MULTIPLIER = 1.35;

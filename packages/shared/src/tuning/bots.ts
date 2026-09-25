import type { BotLevel } from "../match/LobbyBots.js";
import { WALKABLE_SLOPE_MAX_ANGLE } from "./movement.js";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, WALK_SPEED as WALK_SPEED_FOR_BOTS } from "./character.js";
import { ICE_CRASH_MIN_SPEED } from "./surfaces.js";
import { IMPACT_STAGGER_MIN } from "./knockdown.js";
import { MOVING_SEGMENT_IMPACT_SCALE } from "./world.js";

/**
 * How a Bot's navmesh is cut (M17, ADR 0129). Recast measures most of these
 * in voxels, so the world-unit values below are what an author reads and
 * `botNavConfig` converts them.
 *
 * The Character's own sizes are read, never copied: the navmesh is where a
 * *capsule* can stand, so it follows the capsule if the capsule changes.
 */

/** Horizontal voxel size, in metres. Half the capsule's radius keeps a railing's gap readable. */
export const NAV_CELL_SIZE = CAPSULE_RADIUS / 2;

/** Vertical voxel size, in metres. */
export const NAV_CELL_HEIGHT = 0.1;

/** The standing clearance a capsule needs: its whole height. */
export const NAV_AGENT_HEIGHT = 2 * (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);

/** How far the walkable area is kept from an edge or a wall: the capsule's radius. */
export const NAV_AGENT_RADIUS = CAPSULE_RADIUS;

/**
 * The highest ledge a walking capsule gets over without jumping. The
 * controller has no autostep (see `authoring.ts`), so this is only what the
 * capsule's rounded foot rides over: measured in the real simulation (M17
 * ticket 01), a walk gets over 0.15 and stops at 0.18. At `NAV_CELL_HEIGHT`
 * Recast rounds it down to 0.1, which only ever turns a walkable lip into a
 * jump, never the other way.
 */
export const NAV_AGENT_CLIMB = 0.15;

/** Walkable up to ADR 0037's walk/slide threshold; anything steeper is a slide, never a route. */
export const NAV_WALKABLE_SLOPE_DEGREES = (WALKABLE_SLOPE_MAX_ANGLE * 180) / Math.PI;

/**
 * How often a Bot plans its path again, in Ticks (M17 ticket 03). A plan is a
 * decision, and decisions may run slower than the Tick (ADR 0129); steering
 * along the plan still produces an input every Tick. Reaching a Checkpoint or
 * a Respawn plans at once, whatever this says.
 */
export const BOT_REPLAN_TICKS = 15;

/**
 * How close, across the ground, a Bot's capsule gets to a corner of its path
 * before it steers for the next one. A Bot aimed straight at a corner passes
 * within half a Tick's run of it, so this stays above half a Tick at a Dash's
 * speed, or a Bot could step past a corner without ever counting it.
 */
export const BOT_CORNER_REACHED_M = 0.3;

// --- Running a Race (M17 ticket 04) -----------------------------------------
// None of these is settled. Each is a first guess that the suites run and the
// user's live checks will move.

/**
 * How far across the ground a Bot may be from the stretch of path it is on
 * before it plans again at once, rather than at its next
 * {@link BOT_REPLAN_TICKS}. The same distance below the stretch's floor counts
 * too: a Bot knocked down onto a lower tier is off its corridor however close
 * it is across the ground.
 */
export const BOT_OFF_CORRIDOR_M = 1.5;

/**
 * How much straight, clear, Dash-friendly floor a Bot wants beyond where a
 * Dash would carry it before it spends one (ADR 0092: a resource). The
 * reach itself is read off the Dash's own tuning (`dashReach`), so this is
 * only the margin: the Dash's direction is locked at the press, and a corner
 * it reached too early would carry it on past the corner.
 */
export const BOT_DASH_MARGIN_M = 4;

/**
 * How far to either side of its line a Bot wants clear floor before it
 * spends a Dash (M17 ticket 06b). A path runs a capsule's radius from a wall
 * or a still obstacle, where a walk brushes past; a Dash brushing past the
 * same thing arrives at a wall Impact's speed and goes down (ADR 0037).
 */
export const BOT_DASH_SIDE_M = 0.5;

/**
 * Below this speed (units/s) a Bot on a slick floor stops braking. Half ice's
 * crash speed: slower than that, nothing it drifts into knocks it down
 * (ADR 0102), and braking any closer to zero only flips the steering back and
 * forth, which a Player would see as a Bot spinning on the spot.
 */
export const BOT_BRAKE_MIN_SPEED = ICE_CRASH_MIN_SPEED / 2;

/**
 * How far past a Checkpoint's or a Finish Zone's gate a Bot aims (ADR 0068):
 * a gate counts when the capsule's centre crosses it, and a Bot that stopped
 * at its centre would stand in front of it for good. More than
 * {@link BOT_CORNER_REACHED_M}, so the last corner is still short of it.
 */
export const BOT_GATE_THROUGH_M = 1.5;

/**
 * How close, across the ground, a path's last corner must come to where it
 * was asked to go for the navmesh to count the two as joined. A Checkpoint
 * behind a gap is not joined until ticket 05's links, and a fork is looked
 * for only on a joined leg.
 */
export const BOT_LEG_JOINED_M = 1;

/** The most arms of one fork a Lobby's Bots spread across. Three is the most an authored Track has (`walkTrack`'s arm sets). */
export const BOT_FORK_ARMS_MAX = 3;

/**
 * How much dearer than the best way a fork's arm may be (by the same cost a
 * path search reads, `navAreaCost`) and still be one a Bot takes. An arm
 * dearer than this is not a choice, it is a mistake; a mud arm beside a plain
 * one is usually one (mud costs 1 / its top speed).
 */
export const BOT_FORK_COST_SLACK = 1.25;

/**
 * What a way already found costs again, as a multiple, while the next arm is
 * looked for: the search then prefers any other way whose own stretch is
 * cheaper than that. Twice the slack, so an arm inside the slack is not
 * missed for being a little dearer.
 */
export const BOT_FORK_PENALTY = 2 * BOT_FORK_COST_SLACK;

/**
 * How far apart, across the ground, two ways must run at their widest to be
 * two arms of a fork rather than one way round a post. More than a lane's
 * worth of wandering, less than the narrowest gap between authored arms.
 */
export const BOT_FORK_SEPARATION_M = 3;

/** How close, across the ground, a Bot passes the middle of its chosen arm before it heads for the leg's end. */
export const BOT_FORK_VIA_REACHED_M = 1.5;

// --- Difficulty and the per-Bot spread (M17 ticket 08, ADR 0129) -----------
// The host picks one level; each Bot draws its own `BotProfile` from a seeded
// spread around it (`bot/profile.ts`). None of these ranges is settled — they
// are first guesses the ticket's own suite only proves are *ordered*, never
// that they play right. Never copy them into docs or tests.

/** A closed range a `BotProfile` field is drawn uniformly from. */
export interface BotRange {
  readonly min: number;
  readonly max: number;
}

/** Every numeric field `botProfile` draws, as the range one level picks from. */
export interface BotLevelSpread {
  /** Ticks of perception staleness a Bot's decisions run behind the world (`withPerceptionDelay`). */
  readonly reactionTicks: BotRange;
  /** 0 (steady) to 1 (stumbles almost every Tick): extra staleness on top of `reactionTicks`. */
  readonly clumsiness: BotRange;
  /** Ticks ahead a Bot foresees a Motion (M17 ticket 07's field; unread until then). */
  readonly lookAheadTicks: BotRange;
  /** Ticks of jitter on a foreseen Motion's timing (M17 ticket 07's field; unread until then). */
  readonly timingErrorTicks: BotRange;
  /** Radians of error on where a Hit or a throw is aimed (M17 ticket 09's Fight). */
  readonly aimError: BotRange;
  /** 0..1, how readily a Bot turns from its goal to a fight (M17 ticket 09's Fight). */
  readonly aggression: BotRange;
  /** 0..1, how often a Bot takes the riskier of two ways (M17 ticket 09's Fight). */
  readonly chanceTaking: BotRange;
}

/**
 * The spread each level draws its Bots' profiles from. Reaction time and
 * clumsiness fall from EASY to HARD (a HARD Bot reacts to the world almost as
 * it is); look-ahead rises (HARD forecasts a Motion further out); aim error
 * falls and aggression/chance-taking rise, for the tickets that will read
 * them.
 */
export const BOT_LEVEL_SPREADS: Readonly<Record<BotLevel, BotLevelSpread>> = {
  easy: {
    reactionTicks: { min: 6, max: 10 },
    clumsiness: { min: 0.5, max: 0.9 },
    lookAheadTicks: { min: 0, max: 5 },
    timingErrorTicks: { min: 4, max: 10 },
    aimError: { min: 0.3, max: 0.6 },
    aggression: { min: 0.1, max: 0.4 },
    chanceTaking: { min: 0.1, max: 0.4 },
  },
  normal: {
    reactionTicks: { min: 3, max: 6 },
    clumsiness: { min: 0.15, max: 0.4 },
    lookAheadTicks: { min: 5, max: 12 },
    timingErrorTicks: { min: 2, max: 5 },
    aimError: { min: 0.12, max: 0.3 },
    aggression: { min: 0.3, max: 0.6 },
    chanceTaking: { min: 0.3, max: 0.6 },
  },
  hard: {
    reactionTicks: { min: 0, max: 2 },
    clumsiness: { min: 0, max: 0.1 },
    lookAheadTicks: { min: 12, max: 24 },
    timingErrorTicks: { min: 0, max: 2 },
    aimError: { min: 0, max: 0.1 },
    aggression: { min: 0.55, max: 0.85 },
    chanceTaking: { min: 0.5, max: 0.8 },
  },
};

/**
 * How many extra Ticks a stumble (`clumsiness`) can add to a Bot's
 * perception delay at its worst — drawn fresh every Tick, so a clumsy Bot's
 * lateness varies instead of just being a longer steady delay.
 */
export const BOT_STUMBLE_EXTRA_TICKS_MAX = 6;

/**
 * The most Ticks old any Bot's view of itself can be, at any level: the
 * slowest reaction plus the worst stumble (`withPerceptionDelay`). Read off
 * the table, never copied. A link is proven standing this long after its
 * script (M17 ticket 06), since a Bot stands until its view has caught up.
 */
export const BOT_STALE_TICKS_MAX = Math.max(
  ...Object.values(BOT_LEVEL_SPREADS).map(({ reactionTicks, clumsiness }) => Math.round(reactionTicks.max) + Math.floor(clumsiness.max * BOT_STUMBLE_EXTRA_TICKS_MAX)),
);

/**
 * How many phases in a row of a bounce deck's hop a link from it must be
 * proven safe from (M17 ticket 06b): as many as the widest spread of
 * lateness any Bot's view of itself has (`staleWindow`: its reaction time,
 * and up to its worst stumble on top). A Bot times a take-off off a hop it
 * sees late, so it knows its real phase only to within that spread. Read off
 * the table, never copied.
 */
export const BOT_HOP_SAFE_RUN_MIN = Math.max(
  ...Object.values(BOT_LEVEL_SPREADS).map(({ clumsiness }) => Math.floor(clumsiness.max * BOT_STUMBLE_EXTRA_TICKS_MAX) + 1),
);

/**
 * A Bot that has pushed on this many Ticks without its view of itself
 * moving {@link BOT_STALL_MOVE_M} is stalled (M17 ticket 06b, "never
 * stranded"): two capsules pressed deep into each other hold each other
 * whichever way either pushes on. It then heads straight away from the
 * nearest Character within {@link BOT_STALL_TOUCH_M} for
 * {@link BOT_UNSTALL_TICKS}, and plans afresh.
 */
export const BOT_STALL_TICKS = 45;
export const BOT_STALL_MOVE_M = 0.3;
export const BOT_STALL_TOUCH_M = 2 * CAPSULE_RADIUS + 0.2;
export const BOT_UNSTALL_TICKS = 15;

// --- Never stepping off (M17 ticket 06, ADR 0129) ---------------------------
// None of these is settled. The guard's own reach is never one of them: it is
// the Bot's own speed over its own staleness, read off its profile.

/**
 * How far above or below a Bot's floor, besides what a walkable slope rises
 * over the distance, an edge is still one it could walk off. More than a
 * step, less than a tier: an edge on the deck above or below is not the
 * Bot's.
 */
export const BOT_EDGE_GUARD_HEIGHT_M = 0.75;

/**
 * How much further than it could get before stopping a Bot looks for an
 * edge at all. Beyond that the guard has nothing to say, and costs one grid
 * lookup.
 */
export const BOT_EDGE_GUARD_SLACK_M = 0.5;

/**
 * How far inside the navmesh's edge (itself a capsule's radius in from the
 * drop) a Bot's moves stop. What the guard's own model leaves out (a bounce
 * off a deck's bevel, a slope's speed) is taken up here: a capsule whose
 * round foot is on a bevel is pushed off sideways by it.
 */
export const BOT_EDGE_MARGIN_M = 0.2;

/**
 * How far from a void edge a Bot's path keeps its corners where the floor
 * allows (M17 ticket 06): wider than {@link BOT_EDGE_MARGIN_M}, so a path is
 * never one the guard has to turn a Bot off.
 */
export const BOT_PATH_EDGE_MARGIN_M = 0.5;

/**
 * How far a path's corners on ice are kept from any border, wall or drop
 * (M17 ticket 06b). Brushing anything there knocks a Character down (ADR
 * 0102), and a Bot steering its slide round a corner cuts inside it by
 * about this much (measured: Spin Cycle's ice catwalk, a Bot drifting half a
 * metre into a bar's end).
 */
export const BOT_ICE_WALL_MARGIN_M = 1;

/**
 * How narrow a polygon of the navmesh, measured in from a drop it borders,
 * is an edge strip a path keeps off where the leg can be run round it (M17
 * ticket 06): too narrow to keep {@link BOT_PATH_EDGE_MARGIN_M} from the drop
 * and still pass. The strip between a bumper and the base race's ice slide's
 * edge is one; a narrow bridge with no way round is still run.
 */
export const BOT_EDGE_STRIP_M = 2 * BOT_PATH_EDGE_MARGIN_M;

/**
 * How near its feet's height an edge must be for a Bot to count as standing
 * past it (M17 ticket 06). Beside the foot of a tier a Bot is outside the
 * tier's edge across the ground, but on the floor below it.
 */
export const BOT_EDGE_PAST_HEIGHT_M = 0.4;

/**
 * How far above a border's floor the ground probe past it starts (M17 ticket
 * 06): low enough to start inside a wall or a bumper standing there, under
 * anything hung overhead.
 */
export const BOT_GROUND_PROBE_ABOVE_M = 0.5;

/** The most Ticks the guard plays a Bot braking on a slick floor before it counts it stopped. */
export const BOT_EDGE_GUARD_STOP_TICKS_MAX = 60;

/** How much room a Bot keeps between its capsule and a Prop it steers round, in metres. */
export const BOT_PROP_CLEARANCE_M = 0.25;

/**
 * How much of a floor's crash speed (ADR 0102: ice knocks down whoever runs
 * into anything at it) a Bot lets itself close on a Prop or a Character at.
 * Under it, leaning on a bumper or a neighbour hurts nobody, so a Bot boxed
 * in on ice by both can still edge past; the share leaves room for what its
 * late view of the others gets wrong.
 */
export const BOT_CRASH_SPEED_SHARE = 0.5;

/**
 * How far to either side of a link's start, and how far along its run-up,
 * a Bot may stand when it plays the link's script, and the link's proof
 * plays it from (M17 ticket 06). Across, where a Bot reaching the corner may
 * be standing ({@link BOT_CORNER_REACHED_M}); along, half a Tick's walk,
 * which is as close as a Bot stepping a Tick at a time can come.
 */
export const BOT_LINK_START_SIDE_M = BOT_CORNER_REACHED_M;
export const BOT_LINK_START_ALONG_M = 0.1;

/**
 * How near a link's start another Character must stand for a Bot to wait its
 * turn (M17 ticket 06), and how far above or below counts as the same start:
 * two capsules' width and a little, so the one waiting is not in the way of
 * the one stepping up to the start.
 */
export const BOT_LINK_QUEUE_M = 1.5;
export const BOT_LINK_QUEUE_HEIGHT_M = 1;

// --- Links: jumps, Springs and slides (M17 ticket 05) -----------------------
// None of these is settled. The jump's own reach is never one of them: it is
// measured by playing a jump (`linkProof.ts`), so it follows the jump tuning.

/**
 * What a metre of a link costs a Bot's path search, against a metre of plain
 * floor at 1 (`navAreaCost`). Above 1, so a jump is taken where it saves
 * real ground and a walk round is kept where the two are close: a jump is
 * the one move a Bot can get wrong in the air.
 */
export const BOT_LINK_COST = 2;

/** How far ahead on a link's line a Bot aims while it runs up, so one that arrived to one side runs back onto the line. */
export const BOT_LINK_AIM_AHEAD_M = 1;

/** The most Ticks a link may take from the run-up to a stand; past it the Bot gives up and plans again. */
export const BOT_LINK_MAX_TICKS = 150;

/**
 * The most Ticks a link's run-up may take before it has left the ground. A
 * run-up is {@link BOT_LINK_RUNUP_M} and a little more, a quarter of a second
 * at a walk; one still on the ground after this has something in its way.
 */
export const BOT_LINK_RUN_TICKS = 30;

/** The most Ticks a link spends braking to a stand once it has landed. */
export const BOT_LINK_LAND_TICKS = 30;

/** Metres between the points along a navmesh border that a link is looked for from. */
export const BOT_LINK_SAMPLE_M = 1;

/**
 * How far off square two borders may face and still be a jump's two ends,
 * in degrees: a jump runs from one border toward the other, and each must
 * face the other within this. Wide enough for the corner of one square to
 * the corner of the next (the base race's spinning squares).
 */
export const BOT_LINK_FACING_MAX_DEG = 60;

/** How far below its take-off a link may land. Further down is a fall a Player would not choose. */
export const BOT_LINK_MAX_DROP_M = 6;

/**
 * How much further than the link a walk between the same two points must be
 * for the link to be worth having, in metres. Two points the navmesh already
 * joins by a short walk get no jump between them.
 */
export const BOT_LINK_MIN_SAVING_M = 6;

/** How close two links' starts may be on the same pair of places; one of them is enough. */
export const BOT_LINK_SPACING_M = 4;

/** The most candidates proven between one pair of places before the rest are let go. Proving is the whole cost of a link. */
export const BOT_LINK_ATTEMPTS_PER_PAIR = 6;

/** How far behind where it takes off a link's run-up starts: `walkTrack`'s own line-up, which a Player's jump starts from too. */
export const BOT_LINK_RUNUP_M = 1.5;

// --- The fight (M17 ticket 09) ----------------------------------------------
// None of these is settled: first guesses the fight suite runs and the user's
// live checks will move. The fight's own reaches (Hit, Grab, a Spin, a Toss)
// are read off `tuning/fight.ts`, never copied here.

/**
 * How often, in Ticks, a Bot with nothing in hand looks for a fight. Each look
 * is one seeded draw against its `aggression`, so this and `aggression`
 * together set how often the Fight interrupts the run: asked every Tick, even
 * a mild Bot would take almost every chance within a second.
 */
export const BOT_FIGHT_DECIDE_TICKS = 10;

/** How far, across the ground, a Bot looks for someone to fight. Beyond it, it runs on. */
export const BOT_FIGHT_SEEK_M = 6;

/** How far above or below a Bot a target may stand: a fight is on one floor, never a jump away. */
export const BOT_FIGHT_HEIGHT_M = 1;

/**
 * How far ahead of its heading a target must be to be worth turning to, as a
 * cosine: 0 is anywhere in the front half. A Bot does not turn round to chase
 * someone it has already passed; it runs on.
 */
export const BOT_FIGHT_FRONT_COS = 0;

/**
 * How close a Bot closes on its target before it stops and only turns to it:
 * inside a Hit's and a Grab's reach, short of walking into them. A Bot that
 * kept walking at a target on an edge would follow it off when it moved. It
 * stops earlier by what its own perception delay can carry it (`staleReach`),
 * and the straight run to the target itself must stay on the navmesh
 * (ADR 0129: chasing never leaves it).
 */
export const BOT_FIGHT_STANDOFF_M = 1.1;

/**
 * How closely a Bot's body must face its target, as a cosine, before it
 * swings or reaches: tighter than the verbs' own cones (`HIT_FACING_COS_MIN`),
 * because a Bot judges its facing from where it last turned, and the target
 * from where it last saw it.
 */
export const BOT_AIM_COS = 0.9;

/** The longest a Bot chases one target, in Ticks, before it gives the chance up and runs on. */
export const BOT_FIGHT_GIVE_UP_TICKS = 60;

/** How long, in Ticks, a Bot runs on after a fight before it looks for another. */
export const BOT_FIGHT_REST_TICKS = 45;

/**
 * How many Checkpoints behind the leader a Bot must be to count as far
 * behind, and what its aggression is multiplied by then: a Bot far behind
 * fights less and runs more.
 */
export const BOT_BEHIND_CHECKPOINTS = 2;
export const BOT_BEHIND_FIGHT_SCALE = 0.25;

/**
 * How near a void a target's back must be, in metres along the way a Bot
 * would push it, to count as exposed. Exposure then scores from 1 (at the
 * navmesh's edge) down to 0 (this far away), beside distance's own 1 (at
 * the Bot) to 0 (at {@link BOT_FIGHT_SEEK_M}); the two are added with
 * {@link BOT_EXPOSURE_WEIGHT}. Nothing else is read: never who the target is.
 */
export const BOT_EXPOSURE_EDGE_M = 3;
export const BOT_EXPOSURE_WEIGHT = 1;

/** How many directions round a Bot it looks for an edge in, to Hurl toward. */
export const BOT_EDGE_DIRECTIONS = 12;

/** How far round a Bot it looks for an edge while it holds someone. */
export const BOT_EDGE_SEARCH_M = 8;

/**
 * How far past the navmesh's edge a Bot looks for floor, and how far above
 * and below it: none there is a void (a drop to a lower deck is not).
 */
export const BOT_EDGE_VOID_PROBE_M = 1;
export const BOT_EDGE_VOID_DEPTH_M = 3;

/**
 * The nearest and farthest an edge may be from a Bot that Spins toward it.
 * Nearer than the first, it never Spins (ADR 0129: never suicidal, whatever
 * its perception delay put it); farther than the second, a Hurl falls short,
 * so it carries its catch closer first.
 */
export const BOT_HURL_EDGE_MIN_M = 2;
export const BOT_HURL_EDGE_MAX_M = 4.5;

/** How far a Spin must wind up (0..1) before a Bot lets go: a flick falls short of any edge worth aiming at. */
export const BOT_HURL_WINDUP_MIN = 0.8;

/** The Spin's Ticks a Bot never holds past, short of getting dizzy: it lets go wherever it is aimed. */
export const BOT_SPIN_GIVE_UP_MARGIN_TICKS = 3;

/** How long, in Ticks, a Bot carrying someone with no edge in reach walks toward one before it drops them and runs on. */
export const BOT_CARRY_LOOK_TICKS = 45;

/**
 * How fast a Held Bot wiggles (wiggles a second): the steady end at no
 * clumsiness, the clumsy end at full. A Bot's `clumsiness` places it between,
 * so a level's spread is its wiggle's spread too, and no new field is drawn.
 */
export const BOT_STRUGGLE_WIGGLES_PER_S_STEADY = 11;
export const BOT_STRUGGLE_WIGGLES_PER_S_CLUMSY = 5;

/** How far ahead along its heading a Prop may lie to be "in its path". */
export const BOT_PROP_SEEK_M = 4;

/** How far off its heading, as a cosine, a Prop may lie and still be in its path. */
export const BOT_PROP_PATH_COS = 0.7;

/** How close a Bot comes to a Prop before it reaches for it. */
export const BOT_PROP_STANDOFF_M = 0.9;

/** The farthest a target may be for a Bot to Toss a Prop at it; beyond, it Spins and Hurls. */
export const BOT_TOSS_RANGE_M = 5;

/** The farthest a target may be for a Bot to throw a Prop at it at all, and so to pick one up. */
export const BOT_THROW_RANGE_M = 8;

/** How close, in radians, a Bot's facing must be to its aim before it Tosses. */
export const BOT_THROW_FACING_TOLERANCE = 0.25;

/** How long, in Ticks, a Bot waits for a throw's target to come into reach before it puts the Prop down. */
export const BOT_THROW_LOOK_TICKS = 45;

/** How many Characters within a blast's knockdown reach of a spot make it a group worth a Bomb. */
export const BOT_BOMB_GROUP_MIN = 2;

/**
 * Seconds of fuse left at which a Bot throws a lit Bomb wherever it faces:
 * never held to the end (ADR 0129). A Toss takes its wind-up on top.
 */
export const BOT_BOMB_LAST_THROW_S = 1.5;

/** The least fuse, in seconds, a lying lit Bomb must have for a Bot to pick it up: the Lift alone takes over a second. */
export const BOT_BOMB_PICKUP_FUSE_MIN_S = 3;

/**
 * The slowest reaction, in Ticks, that catches a Shooter's Bomb: HARD's
 * reflexes (ADR 0127's catch). Read off the table above, never copied, so a
 * retuned HARD still catches and NORMAL still does not.
 */
export const BOT_CATCH_REACTION_TICKS_MAX = BOT_LEVEL_SPREADS.hard.reactionTicks.max;

/** How far, across the ground, a flying Bomb may be for a catching Bot to turn and face it. */
export const BOT_CATCH_WATCH_M = 8;

// --- Moving Segments (M17 ticket 07) ----------------------------------------
// The groundwork's own constants. Each part (07a–07f) adds its block below
// this one, under its own comment; none is copied into a test.

/**
 * The furthest ahead any Bot foresees a Motion, in Ticks: the size of the
 * shared pose cache's ring (`movingWorld.ts`). Read off the spread table,
 * never copied, so a retuned HARD still finds every Tick it looks at cached.
 */
export const BOT_LOOK_AHEAD_TICKS_MAX = Math.max(...Object.values(BOT_LEVEL_SPREADS).map((spread) => spread.lookAheadTicks.max));

/**
 * How far, in metres, a moving body's top at rest may sit above or below a
 * still navmesh floor near it and still count as a floor a Bot rides
 * (`movingWorldOf`'s role rule). A bar's top is 1.8 m up, a sliding wall's 3.
 */
export const BOT_RIDE_TOP_TOLERANCE_M = 0.6;

/** How far, across the ground, from a moving body's rest footprint a still navmesh floor is looked for to call it a floor. */
export const BOT_RIDE_NEAR_FLOOR_M = 3;

/** The least top area, in square metres, a moving body needs to be a floor a Bot rides rather than a sweeper. */
export const BOT_RIDE_DECK_MIN_M2 = 4;

/** How far in, in metres, a deck outline's vertex may be dropped to (M17 ticket 07b): a disc's ~200 exported vertices become about a dozen, all inside the real deck. */
export const BOT_RIDE_HULL_SIMPLIFY_M = 0.25;

// --- Timing sweepers (M17 ticket 07a) -----------------------------------------
// `SweeperHold` (`bot/sweeperHold.ts`): whether the next stretch of path is
// clear of a sweeping body until the Bot is through it. First guesses.

/** Ticks between a hold's decisions; between them it repeats the last. */
export const BOT_HOLD_DECIDE_TICKS = 3;

/** How far ahead along its path, in metres, a Bot asks whether a sweeper will be in its way. */
export const BOT_HOLD_LOOK_M = 8;

/** Metres between the corridor's samples. */
export const BOT_HOLD_SAMPLE_M = 0.5;

/** Metres a sweeper's hitbox is grown by, beyond the capsule's own radius, before it counts as in the way. */
export const BOT_HOLD_MARGIN_M = 0.3;

/** How many Ticks ahead a held Bot asks whether a sweeper will hit it where it stands. */
export const BOT_HOLD_HERE_TICKS = 20;

/** The longest a Bot holds for a sweeper before it goes anyway: the longest authored cycle is a 4 s slide, and a spin bar passes twice a turn. */
export const BOT_HOLD_MAX_TICKS = 150;

/**
 * After giving up a hold, how many Ticks a Bot goes before it may hold again.
 * Longer than the stall detector's {@link BOT_STALL_TICKS} and its unstall:
 * a Bot pressed into another behind a hold goes nowhere on a go, and only a
 * go that outlasts the detector lets the unstall part them (measured on 07a's
 * Track A; 45 was one Tick short of it).
 */
export const BOT_HOLD_GO_TICKS = BOT_STALL_TICKS + BOT_UNSTALL_TICKS;

/**
 * A sweeper slower than this at a point only shoves there, so holding for it
 * is time lost: half the closing speed a Moving Segment staggers from
 * (`MOVING_SEGMENT_STAGGER_SPEED`'s own rule, read off its tuning).
 */
export const BOT_HOLD_MIN_SPEED = IMPACT_STAGGER_MIN / MOVING_SEGMENT_IMPACT_SCALE / 2;

// --- Belts (M17 ticket 07c) --------------------------------------------------
// `BeltPush` (`bot/belts.ts`): a Bot on a belt compensates the belt's push in
// its own steering, and tells `EdgeGuard` the drift. First guesses.

/** How near a capsule's feet must be to a belt's deck top, in metres, to read as standing on it (`beltUnder`). */
export const BOT_BELT_HEIGHT_M = 1;

/**
 * How slow a Bot's own speed against a belt's flow may be, in units/s,
 * before pushing harder stops being possible: below this the belt runs
 * against the Bot faster than it walks, and `BeltPush` leaves the move
 * alone (the guard decides whether it is safe).
 */
export const BOT_BELT_MIN_OWN_SPEED = 0.5;

// --- Riding moving floors (M17 ticket 07b) -----------------------------------
// `DeckRider` (`bot/deckRider.ts`) and its ride table (`bot/rideLinks.ts`): a
// moving deck is a link whose ends move. First guesses, but for the two
// measured jump numbers.

/** How far in from a deck's hull a ride end's rim point sits, in metres. */
export const BOT_RIDE_RIM_INSET_M = 0.5;

/** Metres between rim points along a deck hull's edges (its vertices are rim points too). */
export const BOT_RIDE_RIM_STEP_M = 1;

/** Ticks between the phases of a platform's cycle the ride table looks for ends at. */
export const BOT_RIDE_PHASE_STEP_TICKS = 3;

/** How near, in metres, a deck's rim must come to a still floor for a Bot to walk across rather than jump. */
export const BOT_RIDE_WALK_GAP_M = 0.6;

/**
 * How far a held jump carries a capsule at walk speed, take-off to landing
 * on a flat deck, in metres. Measured (2026-09-24, a scratch run on a flat
 * static deck, `jumpHeld` for `JUMP_HOLD_MAX_TICKS` at `WALK_SPEED`): 4.95 m.
 * From a stand the 1.4 m run-up takes 8 Ticks and reaches full walk speed.
 */
export const BOT_RIDE_JUMP_REACH_M = 4.9;

/** Ticks from pressing jump to grounded again, the same measurement: 27. */
export const BOT_RIDE_JUMP_FLIGHT_TICKS = 27;

/** The most ride ends a platform keeps. */
export const BOT_RIDE_ENDS_MAX = 12;

/** What a ride costs in the planner, in metres of walk, before the distance ridden. */
export const BOT_RIDE_COST_M = 12;

/** The most rides one planned path may chain. The base race's second leg has five. */
export const BOT_RIDE_CHAIN_MAX = 8;

/** The fastest a deck's rim may come at a boarding Bot, in units/s: faster is a shove. */
export const BOT_RIDE_BOARD_SPEED = 2;

/** How far in from a deck's rim a Bot boards to and alights from, in metres. */
export const BOT_RIDE_EXIT_INSET_M = 1;

/** The longest a Bot waits to board or alight before it goes at the next nearest pass, whatever the gap. Also capped at two cycles. */
export const BOT_RIDE_WAIT_MAX_TICKS = 300;

/**
 * How far, in metres, a Bot's own waiting spot aboard is spread from the
 * exit's (across the rim and back from it, by its seed): twelve Bots on one
 * inset point shoved each other off the rim (measured, R1 and the base race's
 * first row: 26 Falls in 60 s at HARD, all at the far rim).
 */
export const BOT_RIDE_SPREAD_M = 2;

/** The longest run-up a jump off a deck takes from where the Bot waits, in metres: a run from the middle of any authored deck reaches its rim in this. */
export const BOT_RIDE_RUNUP_MAX_M = 4;

/**
 * How far under a deck's top a grounded Character inside its outline still
 * counts as on it: a lower lip of a sliding row it is carried on and cannot
 * walk up (measured on the base race's second leg, 0.5 m down). It hops up.
 */
export const BOT_RIDE_LIP_M = 1;

/**
 * The margin a jump off a deck keeps to the still floor's edges, as a share
 * of the carry the Character keeps from the deck over its flight (ADR 0061):
 * how wrong the carry model is allowed to be before it lands off.
 */
export const BOT_RIDE_CARRY_MARGIN = 0.5;

/**
 * How many Ticks of two platforms' shared cycle the ride table scans for
 * their rims meeting (M17 ticket 07e, moving-to-moving transfers): the least
 * common multiple of their periods, capped here (20 s). Two spins whose
 * speeds never line up still meet every turn, so the cap only loses ends.
 */
export const BOT_TRANSFER_SCAN_TICKS = 600;

/**
 * The cell the ride table's still-end scan caches its navmesh probes by, in
 * metres (M17 ticket 07d): the first probe in a cell answers for every later
 * one. A tenth of the run-up's step, so a march ends where it would have a
 * step later at most (measured: the base race's table, 136 k probes, 66 ms →
 * under its 50 ms budget, every end and ride the same).
 */
export const BOT_RIDE_PROBE_CELL_M = 0.1;

// --- Traps (M17 ticket 07f) -------------------------------------------------
// `bot/trapHold.ts`: a trap door crossed while shut, a Shooter's line of fire
// crossed between shots, a fragile block not stepped on at its last crack.
// First guesses; the holds share 07a's decide/sample/margin/cap constants.

/** How near, in metres, a Shooter's muzzle must be to a Bot for the Bot to watch its shots. */
export const BOT_SHOOTER_WATCH_M = 30;

/**
 * How many Ticks, on top of the block's own return time, a Bot waits at a
 * fragile block at its last crack that is its only way before it goes onto it
 * anyway (never stranded).
 */
export const BOT_FRAGILE_WAIT_MAX_TICKS = 30;

// --- Holds (M17 ticket 07g) -------------------------------------------------
// `SweeperHold` again: a hold that ends, and a Bot that walks up to what
// blocks it rather than standing wherever it first saw it. First guesses.

/**
 * How near, in metres along its path, the first blocked sample must be before
 * a Bot holds; further off it walks on toward it (a wall six metres ahead is
 * no reason to stand here). On top of this a Bot adds what it walks while its
 * view lags and between two decisions, so it stops short of the sample it
 * cannot see itself reaching.
 */
export const BOT_HOLD_STOP_M = 1;

/**
 * A hold's cap, in Ticks per Tick of the Bot's `lookAheadTicks`: a Bot that
 * looks further has more to wait for, so it may wait longer, but never less
 * than {@link BOT_HOLD_MAX_TICKS} (one longest authored cycle). Measured on
 * the base race's belt climb (07d): with one cap for every level a HARD Bot
 * stood at Checkpoint 4 for the whole run.
 */
export const BOT_HOLD_MAX_TICKS_PER_LOOK = 8;

// --- Spinning crosses (M17 ticket 07i) --------------------------------------
// `SweeperHold`'s arc: a spinning bar a straight walk never clears (a cross
// has an arm past any point every 24 Ticks, a walk through its swath takes
// 37) is passed by walking *with* its rotation, along an arc the gap between
// two arms carries round. First guesses.

/** Ticks between the start Ticks tried for an arc, over one turn of the bar. */
export const BOT_ARC_DELAY_STEP_TICKS = 2;

/** The arc's radius, as shares of the bar's swept radius, in the order they are tried. */
export const BOT_ARC_RADIUS_SHARES: readonly number[] = [0.85, 0.75, 0.9, 0.65, 0.55];

/** The most Ticks one arc may take, stand to exit: a half turn's walk and a wait for the ramp. */
export const BOT_ARC_MAX_TICKS = 120;

/** How many Ticks ahead of where it should be on the arc a Bot aims, on top of its view's lag. */
export const BOT_ARC_AIM_AHEAD_TICKS = 3;

/** How far, across the ground, a Bot may be off where its arc puts it before it drops the arc and decides afresh. */
export const BOT_ARC_OFF_M = 1.5;

/** How far, across the ground, from the arc's exit the Bot counts as through. */
export const BOT_ARC_DONE_M = 0.6;

/** After an arc search finds nothing round a bar, how many Ticks pass before it is tried again there. */
export const BOT_ARC_RETRY_TICKS = 60;

/**
 * Metres a bar's hitbox is grown by, beyond the capsule's own radius, before
 * it counts as crossing an arc: less than {@link BOT_HOLD_MARGIN_M}, since an
 * arc is played Tick by Tick against exact poses, and the gap between a
 * cross's arms at the radius a Bot can keep pace at is only a few tenths wide.
 */
export const BOT_ARC_MARGIN_M = 0.15;

// --- Rides with a crowd (M17 ticket 07h, round 2) -----------------------------
// `DeckRider` again: a Bot held at a still entry by those ahead of it asks the
// planner again with the queue as it stands, and goes to another entry when
// that is cheaper. First guess.

/**
 * Ticks between a waiting Bot's re-plans while someone is ahead of it at its
 * entry (or on its landing). A re-plan is a Dijkstra over the ride table, so
 * not every Tick; and never sooner after the wait began than
 * {@link BOT_REPLAN_TICKS}, since only then does `PathFollower` plan afresh
 * the Tick the ride lets go of the Bot.
 */
export const BOT_RIDE_HANDOFF_TICKS = 30;

/**
 * The cell, in metres, a ride plan's start-walks (from where the Bot stands to
 * every still end of its floor) are cached by: a plan from anywhere in the
 * cell reuses the first's lengths, at most a cell's diagonal off. A changed
 * queue signature used to miss the plan cache and pay every navmesh walk again.
 */
export const BOT_RIDE_START_CELL_M = 2;

/**
 * A sweeper slower than this at a point only shoves a Bot *walking into
 * it* (M17 ticket 07i): the closing speed a Moving Segment staggers from
 * (`MOVING_SEGMENT_STAGGER_SPEED`) less the walk the Bot brings. 07a's
 * {@link BOT_HOLD_MIN_SPEED} read the bar's speed alone, so a bar's hub
 * turning at 2.7 u/s was walked into and Staggered every Bot off Spin
 * Cycle's catwalk (Segment 119, measured: 40 Staggers in 120 s at HARD).
 */
export const BOT_HOLD_MIN_SPEED_WALKING = Math.max(0, IMPACT_STAGGER_MIN / MOVING_SEGMENT_IMPACT_SCALE - WALK_SPEED_FOR_BOTS);

import { vec3, type Vec3 } from "../math/vec3.js";
import { isDownMotionState } from "../simulation/CharacterStateMachine.js";
import { canLiftProp } from "../simulation/propCarry.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { surfaceConfig, type SurfaceId } from "../track/Surface.js";
import {
  BOT_EDGE_DIRECTIONS,
  BOT_EDGE_VOID_DEPTH_M,
  BOT_EDGE_VOID_PROBE_M,
  BOT_EXPOSURE_EDGE_M,
  BOT_EXPOSURE_WEIGHT,
  BOT_FIGHT_FRONT_COS,
  BOT_FIGHT_HEIGHT_M,
  BOT_FIGHT_SEEK_M,
  BOT_STUMBLE_EXTRA_TICKS_MAX,
} from "../tuning/bots.js";
import { TICK_DT } from "../tuning/clock.js";
import {
  BOMB_BLAST_IMPACT_CENTRE,
  BOMB_BLAST_IMPACT_EDGE,
  BOMB_BLAST_RADIUS,
  HURLED_BODY_MIN_SPEED,
} from "../tuning/fight.js";
import { IMPACT_RAGDOLL_MIN } from "../tuning/knockdown.js";
import type { BotWorldView } from "./Bot.js";
import { navFloorWithin, navStraightRun, type TrackNav } from "./navMesh.js";
import type { BotProfile } from "./profile.js";

/**
 * What the Fight reads off a {@link BotWorldView} (M17 ticket 09, ADR 0129):
 * who is at hand and how exposed they are, where the nearest void is, which
 * Prop lies in the way. Pure functions of the view and the navmesh; nothing
 * here writes anything, and nothing here asks who a Character *is*.
 */

/** Across the ground, ignoring height. */
export const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

/** The unit direction across the ground from `from` to `to`, or `null` when they stand on the same spot. */
export const flatDirection = (from: Vec3, to: Vec3): Vec3 | null => {
  const length = groundDistance(from, to);
  return length < 1e-6 ? null : vec3((to.x - from.x) / length, 0, (to.z - from.z) / length);
};

/** The `facing` (ADR 0045: yaw 0 looks down −Z) of a body turned along `direction`: the inverse of `forwardOf`. */
export const facingOf = (direction: Vec3): number => Math.atan2(direction.x, -direction.z);

/** `direction` turned by `angle` about the vertical, the way `facing` grows. */
export const turned = (direction: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vec3(direction.x * c - direction.z * s, 0, direction.x * s + direction.z * c);
};

/**
 * How far past where it perceives itself a Bot may really be: its own speed
 * over its reaction time and its worst stumble (`withPerceptionDelay`). A Bot
 * that stops this much short of where it meant to has stopped there — which
 * is how its own lateness never walks it past a target toward an edge.
 */
export const staleReach = (self: Readonly<CharacterSnapshot>, profile: BotProfile): number =>
  Math.hypot(self.velocity.x, self.velocity.z) * (profile.reactionTicks + profile.clumsiness * BOT_STUMBLE_EXTRA_TICKS_MAX) * TICK_DT;

/**
 * Whether a Surface is one to fight on: full grip, nothing that bounces,
 * slips or crashes (ADR 0035/0094/0102). On ice a Bot could not stop where
 * it meant to, and a crash there knocks it down; mud slips it.
 */
const fightFooting = (surface: SurfaceId): boolean => {
  const config = surfaceConfig(surface);
  return config.grip >= 1 && !config.bounce && !config.runningSlip && !config.crashKnockdown && !config.landingKnockdown;
};

/**
 * Whether a Bot may walk straight from `from` to `to` for a fight: on the
 * navmesh the whole way, over footing it can stop on (ADR 0129: chasing never
 * leaves the navmesh). Off the navmesh at `from` — riding something that
 * moves, or already at an edge — is never a run to take.
 */
export const fightRunClear = (nav: TrackNav, from: Vec3, to: Vec3): boolean => {
  const run = navStraightRun(nav, from, to);
  return run !== null && run.every(fightFooting);
};

/** Where a point is looked for on the navmesh, as `navSurfaceAt` looks. */
const FLOOR_HALF_EXTENTS = { x: 0.5, y: 2, z: 0.5 };
/** Where floor past an edge is looked for: narrow across, deep. */
const VOID_HALF_EXTENTS = { x: 0.25, y: BOT_EDGE_VOID_DEPTH_M, z: 0.25 };

/**
 * How far from `from`, along `direction`, the navmesh ends over a void, or
 * `null` when it runs on for `range`, ends at a wall with floor behind it, or
 * `from` is not on it. A void is an edge with no floor
 * {@link BOT_EDGE_VOID_PROBE_M} past it within {@link BOT_EDGE_VOID_DEPTH_M}
 * up or down: a step down to a lower deck is not one.
 *
 * Detour's raycast is a 2D check meant for short runs, which these are.
 */
export const voidAlong = (nav: TrackNav, from: Vec3, direction: Vec3, range: number): number | null => {
  const start = nav.query.findNearestPoly(from, { halfExtents: FLOOR_HALF_EXTENTS });
  if (!start.success || start.nearestRef === 0) return null;
  const origin = start.nearestPoint;
  const end = { x: origin.x + direction.x * range, y: origin.y, z: origin.z + direction.z * range };
  const hit = nav.query.raycast(start.nearestRef, origin, end);
  // Detour reports a run that reaches `end` with no border as t = FLT_MAX.
  if (!hit.success || hit.t > 1) return null;
  const distance = hit.t * range;
  const past = distance + BOT_EDGE_VOID_PROBE_M;
  const probe = { x: origin.x + direction.x * past, y: origin.y, z: origin.z + direction.z * past };
  // Floor that is really there (M17 ticket 06): Detour's own nearest point can lie a metre off.
  if (navFloorWithin(nav, probe, VOID_HALF_EXTENTS) !== null) return null;
  return distance;
};

/**
 * Every void round `from` within `range`, nearest first, looked for in
 * {@link BOT_EDGE_DIRECTIONS} directions.
 */
export const nearestVoids = (nav: TrackNav, from: Vec3, range: number): { direction: Vec3; distance: number }[] => {
  const out: { direction: Vec3; distance: number }[] = [];
  for (let k = 0; k < BOT_EDGE_DIRECTIONS; k += 1) {
    const angle = (2 * Math.PI * k) / BOT_EDGE_DIRECTIONS;
    const direction = vec3(Math.sin(angle), 0, -Math.cos(angle));
    const distance = voidAlong(nav, from, direction, range);
    if (distance !== null) out.push({ direction, distance });
  }
  return out.sort((a, b) => a.distance - b.distance);
};

/**
 * How exposed `target` is to a Bot at `from` (ADR 0129: "someone at an edge
 * or in front of it"): 1 with a void right behind it along the way the Bot
 * would push it, falling to 0 at {@link BOT_EXPOSURE_EDGE_M}.
 */
export const exposureOf = (nav: TrackNav, from: Vec3, target: Vec3): number => {
  const push = flatDirection(from, target);
  if (push === null) return 0;
  const edge = voidAlong(nav, target, push, BOT_EXPOSURE_EDGE_M);
  return edge === null ? 0 : 1 - edge / BOT_EXPOSURE_EDGE_M;
};

/** Which fight a target is for: a Hit wants it on its feet, a Grab takes it down or up (ADR 0093). */
export type FightPurpose = "strike" | "catch";

/** A Character a Bot could fight, and how much it wants to. */
export interface FightCandidate {
  readonly id: string;
  readonly distance: number;
  readonly exposure: number;
  readonly score: number;
}

/** Whether `other` is someone a fight can be had with at all: in the Round, running, and in nobody's hold. */
const fightable = (other: Readonly<CharacterSnapshot>): boolean =>
  !other.eliminated &&
  other.finishTick === null &&
  other.motionState !== "Held" &&
  other.grabbingId === null &&
  other.heldByGrabberId === null;

/**
 * Everyone a Bot could fight from where it stands, heading along `heading`,
 * scored by distance and exposure only (ADR 0129: whoever is at hand, human
 * or Bot alike). A candidate is in the Round and in nobody's hold, within
 * {@link BOT_FIGHT_SEEK_M} across the ground and {@link BOT_FIGHT_HEIGHT_M}
 * up or down, in the front half of the heading, with a straight run to it
 * that stays on the navmesh. A Hit also wants it on its feet.
 */
export const fightCandidates = (view: BotWorldView, heading: Vec3, purpose: FightPurpose): FightCandidate[] => {
  const { self, track } = view;
  const out: FightCandidate[] = [];
  for (const [id, other] of Object.entries(view.characters)) {
    if (id === view.id || !fightable(other)) continue;
    if (purpose === "strike" && isDownMotionState(other.motionState)) continue;
    const distance = groundDistance(self.position, other.position);
    if (distance > BOT_FIGHT_SEEK_M || Math.abs(other.position.y - self.position.y) > BOT_FIGHT_HEIGHT_M) continue;
    const toward = flatDirection(self.position, other.position);
    if (toward !== null && toward.x * heading.x + toward.z * heading.z < BOT_FIGHT_FRONT_COS) continue;
    if (!fightRunClear(track.nav, self.position, other.position)) continue;
    const exposure = exposureOf(track.nav, self.position, other.position);
    out.push({ id, distance, exposure, score: 1 - distance / BOT_FIGHT_SEEK_M + BOT_EXPOSURE_WEIGHT * exposure });
  }
  return out;
};

/** Two scores this close are a tie. */
const TIE = 1e-9;

/**
 * The candidate a Bot goes for: the best score, and a tie broken by `random`
 * — never by id or by order, so two Characters in the same spot are equally
 * likely whoever they are (ADR 0129).
 */
export const pickFightTarget = (candidates: readonly FightCandidate[], random: () => number): FightCandidate | null => {
  if (candidates.length === 0) return null;
  const best = Math.max(...candidates.map((c) => c.score));
  const tied = candidates.filter((c) => best - c.score <= TIE);
  return tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))]!;
};

/**
 * How far from a blast its Impact still knocks down (ADR 0126): it falls off
 * linearly from the middle's to the edge's, so the knockdown reach is where
 * that line crosses `IMPACT_RAGDOLL_MIN`.
 */
export const blastKnockdownReach = (): number =>
  (BOMB_BLAST_RADIUS * (BOMB_BLAST_IMPACT_CENTRE - IMPACT_RAGDOLL_MIN)) / (BOMB_BLAST_IMPACT_CENTRE - BOMB_BLAST_IMPACT_EDGE);

/**
 * The spot a Bomb thrown from `from` would do most at: the Character with the
 * most others round it within a blast's knockdown reach, if that is at least
 * `groupMin`, and never nearer `from` than the reach itself (a Bot does not
 * knock itself down), nor farther than `range`.
 */
export const bombGroupSpot = (view: BotWorldView, from: Vec3, range: number, groupMin: number): Vec3 | null => {
  const reach = blastKnockdownReach();
  const others = Object.entries(view.characters).filter(([id, c]) => id !== view.id && !c.eliminated && c.finishTick === null);
  let best: { spot: Vec3; count: number } | null = null;
  for (const [, centre] of others) {
    const distance = groundDistance(from, centre.position);
    if (distance <= reach || distance > range) continue;
    const count = others.filter(([, c]) => groundDistance(c.position, centre.position) <= reach).length;
    if (count >= groupMin && (best === null || count > best.count)) best = { spot: centre.position, count };
  }
  return best?.spot ?? null;
};

/** A Prop's mass as its Track placed it, or `null` when the Track does not say (a Bot then leaves it alone). */
const massOf = (view: BotWorldView, index: number): number | null => view.track.resolved.props[index]?.mass ?? null;

/** Whether the Prop at `index` is a Bomb (ADR 0126). */
export const isBomb = (view: BotWorldView, index: number): boolean => view.track.resolved.props[index]?.bomb !== undefined;

/** How many seconds are left on the lit Bomb at `index`, or `null` while it is not lit. */
export const fuseLeft = (view: BotWorldView, index: number): number | null => {
  const row = view.bombs?.find((b) => b.propIndex === index);
  return row?.detonateTick === undefined ? null : (row.detonateTick - view.tick) * TICK_DT;
};

/** Whether the Bomb at `index` is spent: gone off, or gone out, waiting to come back (ADR 0126). */
const spent = (view: BotWorldView, index: number): boolean => view.bombs?.some((b) => b.propIndex === index && b.blastTick !== undefined) ?? false;

/**
 * Whether the Prop at `index` is one a Bot could pick up as it lies (ADR
 * 0125): light enough, not a Shooter's ball, in play, in nobody's hands, not
 * flying and, a Bomb, not spent, with fuse enough left for a Lift if lit.
 */
export const liftable = (view: BotWorldView, index: number, fuseMin: number): boolean => {
  const config = view.track.resolved.props[index];
  const prop = view.props?.[index];
  const mass = massOf(view, index);
  if (!config || !prop || mass === null || !canLiftProp(mass)) return false;
  if ((config.projectile === true && config.bomb === undefined) || prop.live === false || prop.carriedBy !== undefined) return false;
  if (prop.velocity && Math.hypot(prop.velocity.x, prop.velocity.y, prop.velocity.z) >= HURLED_BODY_MIN_SPEED) return false;
  if (config.bomb === undefined) return true;
  if (spent(view, index)) return false;
  const left = fuseLeft(view, index);
  return left === null || left >= fuseMin;
};

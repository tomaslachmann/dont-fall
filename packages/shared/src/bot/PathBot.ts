import { vec3, type Vec3 } from "../math/vec3.js";
import { dashEnvelope } from "../simulation/movementVerbs.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { surfaceConfig } from "../track/Surface.js";
import {
  BOT_BRAKE_MIN_SPEED,
  BOT_CORNER_REACHED_M,
  BOT_CROSS_BESIDE_M,
  BOT_DASH_MARGIN_M,
  BOT_DASH_SIDE_M,
  BOT_FORK_VIA_REACHED_M,
  BOT_HOLD_MARGIN_M,
  BOT_LEG_JOINED_M,
  BOT_LINK_LAND_TICKS,
  BOT_LINK_QUEUE_HEIGHT_M,
  BOT_LINK_QUEUE_M,
  BOT_LINK_START_ALONG_M,
  BOT_LINK_START_SIDE_M,
  BOT_OFF_CORRIDOR_M,
  BOT_REPLAN_TICKS,
  BOT_STALL_MOVE_M,
  BOT_STALL_TICKS,
  BOT_STALL_TOUCH_M,
  BOT_UNSTALL_TICKS,
} from "../tuning/bots.js";
import { CAPSULE_RADIUS, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { DASH_DURATION_TICKS, DASH_RAMP_TICKS, DASH_RELEASE_TICKS, DASH_SPEED, JUMP_HOLD_MAX_TICKS } from "../tuning/movement.js";
import type { BotWorldView } from "./Bot.js";
import { EdgeGuard, keepOffEdges } from "./edgeGuard.js";
import type { HookContext, PathHooks } from "./hooks.js";
import { botProfile, type BotProfile } from "./profile.js";
import { botDraw } from "./random.js";
import { HopReader, hopStartable, LinkReplay, type NavLink } from "./links.js";
import type { Cross } from "./movingWorld.js";
import { EDGE_STRIP_FLAG, navCorners, navFilterFor, navFloorWithin, navStraightRun, navSurfaceAt, type NavCorner, type TrackNav } from "./navMesh.js";

/*
 * This file was the first Bot (`PathBot`, M17 ticket 03). Since ticket 04 the
 * one Bot is `TreeBot`, and what `PathBot` did is its path-following leaf,
 * `PathFollower`, below. The file keeps its name only because the package
 * index is shared with other work; the class is what counts.
 */

/** Straight-line distance across the ground: a path's corners are on the floor, a capsule's centre is above it. */
const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * Where a Bot is running to this Tick: a Round goal's answer (ticket 04's
 * Race, ticket 12's Survival), which the path-following leaf turns into a
 * move.
 */
export interface Route {
  /** Where the run ends. */
  readonly target: Vec3;
  /**
   * A point to pass on the way, or `null`: the middle of the fork arm this
   * Bot prefers (`forkArms`). Passed once, then the run heads for
   * {@link target}. The same object from Tick to Tick means the same via;
   * a passed via stays passed until {@link key} changes.
   */
  readonly via: Vec3 | null;
  /**
   * Changes whenever the run starts over: a new Checkpoint, a Respawn, getting
   * up. A change plans at once and makes the via count again, so a Bot back on
   * its Checkpoint takes its own arm again.
   */
  readonly key: string;
  /**
   * Changes whenever {@link via} must be passed again: a new leg, a Respawn.
   * `key` without what only plans afresh, so a Bot knocked down past its arm's
   * middle does not run back to it once up (found in M17 ticket 05, forcing a
   * Bot down an arm full of bumpers). Defaults to `key`.
   */
  readonly viaKey?: string;
}

/** What the path-following leaf asks of the Character this Tick. */
export interface Steering {
  /** A unit vector on the ground, or zero to stand. */
  readonly moveDirection: Vec3;
  readonly dash: boolean;
  /** Jump held, which only a link asks for (M17 ticket 05). */
  readonly jump?: boolean;
  /**
   * A proven link's own input (M17 ticket 06): the one move a Bot sends
   * toward an edge on purpose, so `EdgeGuard` leaves it alone.
   */
  readonly committed?: boolean;
  /**
   * The floor's own flow under the Bot, units/s (M17 ticket 07c: a belt),
   * which the guard adds to every Tick it plays. Absent: none.
   */
  readonly drift?: Vec3;
}

/** A goal is worked out afresh every Tick, so the same goal is the same point, not the same object. */
const samePoint = (a: Vec3, b: Vec3 | null): boolean => b !== null && a.x === b.x && a.y === b.y && a.z === b.z;

/** How far, up or down, a path may run from a cross's axle and still be under its arms. */
const CROSS_LEVEL_M = 3;
/** Box a via point beside a cross must find floor in. */
const VIA_FLOOR_HALF: Vec3 = { x: 0.5, y: 1, z: 0.5 };

/**
 * `corners` re-planned beside the first cross it runs through (M17 ticket 07i,
 * round 3), or null to keep it. A cross has no straight window (07g: an arm
 * past any point of Spin Cycle's cross every 24 Ticks, a walk through in 37),
 * so a plan through its swath is a hold to the cap or an arc, both slow; the
 * lane beside it, where it has one, is a walk. The via lies a swath's width
 * from the pivot, square to the stretch that runs through, on the side the
 * stretch already leans to first; it is taken when the floor holds it and both
 * halves join. No floor beside (a catwalk) keeps the plan: the hold and its arc
 * are for that. Only a preference, never the second, never-stranded plan's.
 */
export const besideCrosses = (
  nav: TrackNav,
  crosses: readonly Cross[],
  from: Vec3,
  goal: Vec3,
  corners: readonly NavCorner[],
  filter: Parameters<typeof navCorners>[3],
  /** The way on from the via to the goal; the navmesh's own by default (a ride's planner when the leg needs one). */
  onward: (via: Vec3) => NavCorner[] | null = (via) => navCorners(nav, via, goal, filter),
): NavCorner[] | null => {
  for (let i = 1; i < corners.length; i += 1) {
    const a = corners[i - 1]!;
    const b = corners[i]!;
    // Past a link or a ride the Bot is in the air, or the rider's.
    if (a.link !== null || a.ride !== undefined) break;
    const dx = b.point.x - a.point.x;
    const dz = b.point.z - a.point.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    for (const cross of crosses) {
      const { pivot } = cross;
      if (Math.abs(a.point.y - pivot.y) > CROSS_LEVEL_M) continue;
      const swath = cross.radius + CAPSULE_RADIUS + BOT_HOLD_MARGIN_M + BOT_CROSS_BESIDE_M;
      const t = Math.max(0, Math.min(1, ((pivot.x - a.point.x) * dx + (pivot.z - a.point.z) * dz) / (length * length)));
      const nearest = { x: a.point.x + dx * t, y: a.point.y + (b.point.y - a.point.y) * t, z: a.point.z + dz * t };
      if (groundDistance(nearest, pivot) >= swath) continue;
      const nx = -dz / length;
      const nz = dx / length;
      const lean = (nearest.x - pivot.x) * nx + (nearest.z - pivot.z) * nz >= 0 ? 1 : -1;
      for (const side of [lean, -lean]) {
        const via = { x: pivot.x + side * nx * swath, y: nearest.y, z: pivot.z + side * nz * swath };
        if (navFloorWithin(nav, via, VIA_FLOOR_HALF) === null) continue;
        const first = navCorners(nav, from, via, filter);
        if (first === null || groundDistance(first.at(-1)!.point, via) > BOT_LEG_JOINED_M) continue;
        const second = onward(via);
        if (second === null || groundDistance(second.at(-1)!.point, goal) > BOT_LEG_JOINED_M) continue;
        return [...first, ...second.slice(1)];
      }
      return null;
    }
  }
  return null;
};

const STAND: Steering = { moveDirection: vec3(), dash: false };
const COMMITTED_STAND: Steering = { ...STAND, committed: true };

/** Whether the floor under `position` is a bounce deck, where a Bot is never seen standing, only hopping (ADR 0094). */
const hopsOn = (nav: TrackNav, position: Vec3): boolean => surfaceConfig(navSurfaceAt(nav, position) ?? undefined).bounce !== undefined;

/** Whether a straight run from `from` to `to` stays on the navmesh, over floors with full grip: a step a Bot stops dead at the end of. */
const gripAllTheWay = (nav: TrackNav, from: Vec3, to: Vec3): boolean =>
  navStraightRun(nav, from, to)?.every((id) => surfaceConfig(id).grip >= 1) ?? false;

/**
 * How far a Dash carries a runner along its line, from the Dash's own tuning
 * (ADR 0092): the burst's speed over its envelope, plus the walk it rides on,
 * Tick by Tick as `DashController` plays it.
 */
export const dashReach = (): number => {
  let metres = 0;
  for (let tick = 0; tick < DASH_DURATION_TICKS; tick += 1) {
    const burst = DASH_SPEED * dashEnvelope(tick + 0.5, DASH_DURATION_TICKS, DASH_RAMP_TICKS, DASH_RELEASE_TICKS);
    metres += (WALK_SPEED + burst) * TICK_DT;
  }
  return metres;
};

/**
 * A Bot's path following (M17 ticket 04): a {@link Route} and the Character
 * in, a move direction and a Dash out, every Tick.
 *
 * - **Planning.** The route is planned with `navPath`, the cheapest way by the
 *   floors it crosses, string-pulled to corners. It is planned again at once
 *   when the route changes or the Bot is pushed off its corridor (more than
 *   {@link BOT_OFF_CORRIDOR_M} from the stretch it was on), and otherwise
 *   every {@link BOT_REPLAN_TICKS}, since a plan is a decision (ADR 0129).
 * - **Steering.** Straight at the first corner further than
 *   {@link BOT_CORNER_REACHED_M}. Where the path runs out the Bot stands. On a
 *   floor with less than full grip (ice) it steers its *velocity* instead,
 *   pushing against whatever it carries that it does not want, and brakes
 *   where it means to stand: ice is taken carefully.
 * - **Dash.** A resource (ADR 0092): pressed only when it is ready, the Bot is
 *   up and on the ground, and the straight run to the next corner is longer
 *   than a Dash carries plus {@link BOT_DASH_MARGIN_M} (plus as far as the
 *   Bot walks while its view lags, M17 ticket 06b), on navmesh all the way and
 *   {@link BOT_DASH_SIDE_M} to either side (never into a gap, off the path's
 *   end or past a wall close enough to brush) and over floors a Dash may start
 *   on and keeps its grip on. Never toward a link's start: a link was proven
 *   without one.
 * - **Links** (M17 tickets 05 and 06). A link is taken from a stand, with
 *   the Bot's view of itself caught up (`EdgeGuard.fresh`): it stops short of
 *   the link's start by as far as its view can lag, waits for its view to
 *   show it standing, steps up to the start a measured number of Ticks at a
 *   time (waiting again after each), and once it stands in the box the proof
 *   replayed from ({@link BOT_LINK_START_SIDE_M}, {@link BOT_LINK_START_ALONG_M})
 *   it plays the link's script ({@link LinkReplay}), the input that proved
 *   it, by its own count. Nothing interrupts it but the Bot losing control
 *   (the tree's Recover, which stops this leaf being asked). Then it stands
 *   until its view shows where it landed, and plans again from there.
 */
export class PathFollower {
  /** Corners of the current plan. */
  private path: readonly NavCorner[] = [];
  /** The corner being steered for. */
  private corner = 0;
  private plannedKey: string | null = null;
  private plannedGoal: Vec3 | null = null;
  private plannedTick = Number.NEGATIVE_INFINITY;
  /** The stretch of the current plan a Dash was refused on (`${plannedTick}:${corner}`), so it is not asked again every Tick. */
  private dashRefused: string | null = null;
  /** The via already passed on this run, so the run heads for the target. */
  private passedVia: Vec3 | null = null;
  private viaKey: string | null = null;
  private readonly reach = dashReach();
  /** The link being played, if one is. */
  private link: LinkReplay | null = null;
  /** A link was just played: stand until the Bot's view shows where it landed. */
  private landing = false;
  /** Stepping up to a link's start: this direction, until this Tick. */
  private stepping: { direction: Vec3; until: number } | null = null;
  /** The link whose start the Bot has set out for from where it saw itself stand (M17 ticket 06b): its steps and stands are the link's own. */
  private approach: NavLink | null = null;
  /** The Bot's own hop, read while it waits at the start of a link off a bounce deck (M17 ticket 06b), and which link's. */
  private readonly hopReader = new HopReader();
  private hopFor: NavLink | null = null;
  /** Where the Bot last saw itself get somewhere, and since when (M17 ticket 06b): {@link noteStall}. */
  private stalledAt: Vec3 | null = null;
  private stalledSince = 0;
  /** Heading apart from whoever it is stuck in, until this Tick. */
  private unstallUntil = Number.NEGATIVE_INFINITY;
  /** The last Tick this leaf was asked: a gap means the Bot was out of control, and whatever link it was on is over. */
  private lastTick = Number.NEGATIVE_INFINITY;

  private readonly profile: BotProfile;

  /**
   * `guard` is the Bot's own (M17 ticket 06): what it knows of how late it
   * sees itself, and what it has pushed since. The default is a Bot that
   * sees itself as it is. `hooks` are M17 ticket 07's seams
   * (`defaultHooks`); none registered, this leaf steers as it always did.
   */
  constructor(
    private readonly guard: EdgeGuard = new EdgeGuard({ min: 0, max: 0 }),
    private readonly hooks: PathHooks = {},
    /** This Bot's spread (M17 ticket 08): what the hooks read look-ahead and timing error off. NORMAL's on `seed` by default. */
    profile?: BotProfile,
    /** The Bot's seed: which way it heads out of a Character standing exactly where it stands (M17 ticket 06b). */
    private readonly seed = "",
  ) {
    this.profile = profile ?? botProfile("normal", seed);
  }

  /** What the hooks are handed this Tick (M17 ticket 07). */
  private context(view: BotWorldView): HookContext {
    return {
      tick: view.tick,
      view,
      self: view.self,
      clock: view.runningFromTick ?? null,
      profile: this.profile,
      stale: this.guard.stale,
      seed: this.seed,
      path: this.path,
      corner: this.corner,
    };
  }

  /**
   * `others` are where the other Characters are as this Bot sees them: a
   * link's start is taken in turn (M17 ticket 06). The view is the Bot's
   * own for this Tick: `self` as it sees it, the Track, and (M17 ticket 07)
   * the Motion Clock and the fragile floors the hooks read.
   */
  follow(view: BotWorldView, route: Route, others: readonly Vec3[] = []): Steering {
    const { tick, self } = view;
    const { nav } = view.track;
    if (tick !== this.lastTick + 1) {
      this.link = null;
      this.stepping = null;
      this.approach = null;
    }
    this.lastTick = tick;
    if (this.link !== null || this.landing) this.stalledAt = null;
    if (this.link !== null) {
      const step = this.link.step();
      if (step !== null) return { moveDirection: step.moveDirection, dash: false, jump: step.jump, committed: true };
      this.link = null;
      this.landing = true;
    }
    if (this.landing) {
      if (!this.guard.fresh(self, hopsOn(nav, self.position)) && this.guard.stillTicks <= this.guard.stale.max + BOT_LINK_LAND_TICKS) return STAND;
      // Landed and seen to: plan afresh from here, whatever the route says.
      this.landing = false;
      this.plannedTick = Number.NEGATIVE_INFINITY;
    }
    let replan = false;
    if (route.key !== this.plannedKey) {
      this.plannedKey = route.key;
      replan = true;
    }
    const viaKey = route.viaKey ?? route.key;
    if (viaKey !== this.viaKey) {
      this.viaKey = viaKey;
      this.passedVia = null;
    }
    let via = route.via !== null && route.via !== this.passedVia ? route.via : null;
    if (via !== null && groundDistance(self.position, via) <= BOT_FORK_VIA_REACHED_M) {
      this.passedVia = via;
      via = null;
    }
    const goal = via ?? route.target;
    // A ride under way owns the Bot (M17 ticket 07b): its Steering is committed, so the guard and the other hooks leave it alone.
    const riding = this.hooks.ride?.steer(this.context(view)) ?? null;
    if (riding !== null) {
      this.noteStall(tick, self, riding);
      return riding;
    }
    if (replan || !samePoint(goal, this.plannedGoal) || tick - this.plannedTick >= BOT_REPLAN_TICKS || this.offCorridor(self.position)) {
      this.plan(tick, self.position, goal, nav, view);
      const last = this.path[this.path.length - 1]?.point;
      if (via !== null && (last === undefined || groundDistance(last, via) > BOT_LEG_JOINED_M)) {
        // No way to the arm from here (knocked somewhere else): run for the end instead.
        this.passedVia = via;
        this.plan(tick, self.position, route.target, nav, view);
      }
    }
    const unstall = this.unstall(tick, self, others);
    if (unstall !== null) return unstall;
    let steering = this.steer(tick, self, nav, others);
    // M17 ticket 07: a hold may replace the move (07a sweepers, 07f traps),
    // the first that changes it winning; then the floor's own flow bends it
    // (07c). Never a committed move: a link's script and a ride are their own.
    const { hold = [], push } = this.hooks;
    if (steering.committed !== true && (hold.length > 0 || push !== undefined)) {
      const context = this.context(view);
      for (const hook of hold) {
        const held = hook.hold(context, steering);
        if (held !== steering) {
          steering = held;
          break;
        }
      }
      if (steering.committed !== true && push !== undefined) steering = push.compensate(context, steering);
    }
    this.noteStall(tick, self, steering);
    return steering;
  }

  /**
   * Whether the Bot has pushed on for {@link BOT_STALL_TICKS} without its
   * view of itself getting anywhere (M17 ticket 06b, "never stranded"). Two
   * capsules pressed deep into each other (a Respawn onto someone standing on
   * the Checkpoint, measured on Slip Stream's start yard) hold each other
   * where they are whichever way either pushes on; heading straight apart
   * with a jump gets them out (measured: without the jump, not below 0.4 m
   * apart). Only a Tick it pushes counts: a Bot standing at a
   * link's start or in its queue is waiting, not stalled.
   */
  private noteStall(tick: number, self: Readonly<CharacterSnapshot>, steering: Steering): void {
    const pushing = steering.moveDirection.x !== 0 || steering.moveDirection.z !== 0;
    if (!pushing || steering.committed === true || this.stalledAt === null || groundDistance(self.position, this.stalledAt) > BOT_STALL_MOVE_M) {
      this.stalledAt = self.position;
      this.stalledSince = tick;
      return;
    }
    if (tick - this.stalledSince >= BOT_STALL_TICKS) this.unstallUntil = tick + BOT_UNSTALL_TICKS;
  }

  /** While unstalling: straight away from the nearest Character pressed against it, with a jump, then plan afresh. `null` otherwise. */
  private unstall(tick: number, self: Readonly<CharacterSnapshot>, others: readonly Vec3[]): Steering | null {
    if (tick >= this.unstallUntil) return null;
    let nearest: Vec3 | null = null;
    let best = BOT_STALL_TOUCH_M;
    for (const other of others) {
      const distance = groundDistance(self.position, other);
      if (distance < best && Math.abs(other.y - self.position.y) < BOT_LINK_QUEUE_HEIGHT_M) {
        best = distance;
        nearest = other;
      }
    }
    this.stalledAt = null;
    this.plannedTick = Number.NEGATIVE_INFINITY;
    // Stalled with nobody at hand is not this: a hop there is a hop onto whatever it leans on (measured, a ball on Slip Stream's ice arm).
    if (nearest === null) {
      this.unstallUntil = tick;
      return null;
    }
    // A hop as it goes: two capsules pressed this deep together hold each other along the ground, never over it (measured).
    const jump = this.unstallUntil - tick > BOT_UNSTALL_TICKS - JUMP_HOLD_MAX_TICKS;
    if (best > 0) return { moveDirection: vec3((self.position.x - nearest.x) / best, 0, (self.position.z - nearest.z) / best), dash: false, jump };
    // Exactly where it stands (two Respawns onto one Checkpoint, measured on the base race): its own way out, its seed's.
    const angle = botDraw(this.seed, "unstall") * 2 * Math.PI;
    return { moveDirection: vec3(Math.cos(angle), 0, Math.sin(angle)), dash: false, jump };
  }

  private plan(tick: number, from: Vec3, goal: Vec3, nav: TrackNav, view: BotWorldView): void {
    // M17 ticket 06: every Bot keeps off a strip of floor too narrow to keep
    // a margin from its drop in, where the leg can be run round it. Only ever
    // a preference: a leg that needs the strip is run through it (M17 ticket
    // 06b, "never stranded"). Bounce decks are no longer planned round: every
    // link off one is proven from the phases of its hop a Bot can time. A part
    // may add flags the first plan keeps off too (M17 ticket 07f, a fragile
    // block on its last crack); the second plan drops them all the same.
    const extra = this.hooks.planFilterFlags?.({ view }) ?? 0;
    const filter = navFilterFor(nav, EDGE_STRIP_FLAG | extra);
    let corners = navCorners(nav, from, goal, filter);
    // A first plan keeps beside a cross's swath where the lane has room (M17 ticket 07i, round 3); the second plan never does.
    if (corners !== null && view.track.moving.crosses.length > 0) corners = besideCrosses(nav, view.track.moving.crosses, from, goal, corners, filter) ?? corners;
    let last = corners?.at(-1)?.point;
    if (last === undefined || groundDistance(last, goal) > BOT_LEG_JOINED_M) corners = navCorners(nav, from, goal);
    last = corners?.at(-1)?.point;
    // The navmesh alone does not join the goal: a way across moving floors, if the ride hook knows one (M17 ticket 07b).
    if ((last === undefined || groundDistance(last, goal) > BOT_LEG_JOINED_M) && this.hooks.ride !== undefined) {
      const { ride } = this.hooks;
      const across = ride.planAcross({ view, seed: this.seed }, from, goal);
      if (across !== null) {
        corners = across;
        // Beside a cross before the first ride too, the rest of the way re-planned across from the via (07i round 3).
        if (view.track.moving.crosses.length > 0) corners = besideCrosses(nav, view.track.moving.crosses, from, goal, across, filter, (via) => ride.planAcross({ view, seed: this.seed }, via, goal)) ?? across;
      }
    }
    this.path = corners === null ? [] : keepOffEdges(nav, corners);
    this.corner = 0;
    this.plannedGoal = goal;
    this.plannedTick = tick;
  }

  /**
   * Whether the Bot has been moved away from the stretch of path it was
   * running. A path starts at the Bot's own spot on the navmesh, so the first
   * stretch is the one between the first two corners.
   */
  private offCorridor(position: Vec3): boolean {
    const to = this.path[this.corner]?.point;
    if (to === undefined || this.corner === 0) return false;
    // Across a link there is no corridor: the Bot is in the air over a gap.
    const previous = this.path[this.corner - 1]!;
    if (previous.link !== null) return false;
    const from = previous.point;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((position.x - from.x) * dx + (position.z - from.z) * dz) / lengthSq));
    const nearest = { x: from.x + dx * t, y: from.y + (to.y - from.y) * t, z: from.z + dz * t };
    return groundDistance(position, nearest) > BOT_OFF_CORRIDOR_M || position.y < nearest.y - BOT_OFF_CORRIDOR_M;
  }

  private steer(tick: number, self: Readonly<CharacterSnapshot>, nav: TrackNav, others: readonly Vec3[]): Steering {
    const { position } = self;
    const surface = surfaceConfig(navSurfaceAt(nav, position) ?? undefined);
    const slick = surface.grip < 1;
    // A link's start is stood on, never passed (M17 ticket 06).
    while (
      this.corner < this.path.length &&
      this.path[this.corner]!.link === null &&
      groundDistance(position, this.path[this.corner]!.point) <= BOT_CORNER_REACHED_M
    ) {
      this.corner += 1;
    }
    const corner = this.path[this.corner];
    if (corner === undefined) return slick ? this.brake(self) : STAND;
    if (corner.link !== null) {
      const settle = this.settleReach(surface.topSpeedMultiplier);
      const distance = groundDistance(position, corner.point);
      // Near enough to queue for it (the others at its start are seen from
      // further out than a Bot stops for its view to catch up), or to stop.
      if (distance <= Math.max(settle, BOT_LINK_QUEUE_M + BOT_CORNER_REACHED_M)) {
        const queued = this.queueFor(self, nav.links[corner.link]!, others, slick);
        if (queued !== null) return queued;
        if (distance <= settle) return this.startLink(tick, self, nav, nav.links[corner.link]!, slick, WALK_SPEED * surface.topSpeedMultiplier);
      }
    }
    this.stepping = null;
    this.approach = null;
    const target = corner.point;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    const toward = vec3(dx / distance, 0, dz / distance);
    if (slick) return { moveDirection: this.careful(self, toward, WALK_SPEED * surface.topSpeedMultiplier), dash: false };
    return { moveDirection: toward, dash: corner.link === null && this.wantsDash(self, nav, toward, distance) };
  }

  /**
   * How near a link's start, as it sees itself, a Bot stops and waits for its
   * view to catch up: as far as it walks while its view can lag
   * (`EdgeGuard.stale`), and the corner's own reach. A Bot with no lag starts
   * from the corner, as it always did.
   */
  private settleReach(topSpeedMultiplier: number): number {
    return (this.guard.stale.max + 1) * WALK_SPEED * topSpeedMultiplier * TICK_DT + BOT_CORNER_REACHED_M;
  }

  /**
   * A link's start is taken in turn (M17 ticket 06): whoever is nearest it
   * goes, and the rest stand back out of its way, a Bot inside the queue's
   * reach stepping back out of it. What to do while waiting, or `null` when
   * it is this Bot's turn. Twelve Bots all stepping for one start shoved each
   * other round it for good (measured, Slip Stream's middle Spring).
   */
  private queueFor(self: Readonly<CharacterSnapshot>, link: NavLink, others: readonly Vec3[], slick: boolean): Steering | null {
    const mine = groundDistance(self.position, link.from);
    const ahead = others.some(
      (at) => Math.abs(at.y - self.position.y) < BOT_LINK_QUEUE_HEIGHT_M && groundDistance(at, link.from) < Math.min(mine, BOT_LINK_QUEUE_M),
    );
    if (!ahead) return null;
    this.stepping = null;
    if (mine >= BOT_LINK_QUEUE_M || mine === 0) return slick ? this.brake(self) : STAND;
    return { moveDirection: vec3((self.position.x - link.from.x) / mine, 0, (self.position.z - link.from.z) / mine), dash: false };
  }

  /**
   * Near a link's start (M17 ticket 06): wait until the Bot's view of itself
   * has caught up, then either play the link, standing where the proof
   * replayed it from, or step toward the start for as many Ticks as its
   * distance takes and wait again. A Bot that could only see where it was a
   * few Ticks ago can still stand where it means to, one measured step at a
   * time. Off a bounce deck (M17 ticket 06b) it also waits, hopping in
   * place, until every phase of its hop it may really be at is one the link
   * was proven from (`hopStartable`).
   */
  private startLink(tick: number, self: Readonly<CharacterSnapshot>, nav: TrackNav, link: NavLink, slick: boolean, walk: number): Steering {
    if (link !== this.approach && this.stepping !== null) this.stepping = null;
    // Once the Bot has seen where it stands and set out for the start along a
    // clear run of floor with grip (M17 ticket 06b), the stand and the steps
    // up to it are the link's own: the start is where the proof stood, and
    // the guard's margin from an edge can hold a start a link needs, leaving
    // a Bot stepping up and pushed back for good (measured, the base race).
    const committed = link === this.approach;
    if (this.stepping !== null && tick < this.stepping.until) return { moveDirection: this.stepping.direction, dash: false, committed };
    this.stepping = null;
    const wait: Steering = slick ? this.brake(self) : committed ? COMMITTED_STAND : STAND;
    // A link off a bounce deck is timed on the Bot's own hop (M17 ticket 06b): it reads it every Tick it waits.
    if (link !== this.hopFor) {
      this.hopFor = link;
      this.hopReader.reset();
    }
    const phase = link.hop === undefined ? null : this.hopReader.read(link.hop.cycle, self);
    if (!this.guard.fresh(self, link.hop !== undefined) || self.dashing) return wait;
    const dx = self.position.x - link.from.x;
    const dz = self.position.z - link.from.z;
    const along = dx * link.direction.x + dz * link.direction.z;
    const across = dx * -link.direction.z + dz * link.direction.x;
    if (Math.abs(along) <= BOT_LINK_START_ALONG_M && Math.abs(across) <= BOT_LINK_START_SIDE_M) {
      if (link.hop !== undefined && !hopStartable(link.hop, phase, this.guard.stale.min, this.guard.stale.max)) return wait;
      this.approach = null;
      this.hopFor = null;
      this.link = new LinkReplay(link);
      const step = this.link.step();
      if (step !== null) return { moveDirection: step.moveDirection, dash: false, jump: step.jump, committed: true };
      this.link = null;
      return STAND;
    }
    const distance = Math.hypot(dx, dz);
    const direction = vec3(-dx / distance, 0, -dz / distance);
    this.stepping = { direction, until: tick + Math.max(1, Math.round(distance / (walk * TICK_DT))) };
    this.approach = !slick && gripAllTheWay(nav, self.position, link.from) ? link : null;
    return { moveDirection: direction, dash: false, committed: this.approach === link };
  }

  /**
   * On a slick floor a move direction is a push, not a velocity: steer by
   * what the velocity lacks, so drift away from the path is pushed back
   * rather than added to. Speed along the path is never braked (the floor's
   * own top speed is only what the Bot asks for at least): a Bot arriving
   * faster than ice lets it run would otherwise push back, step off the ice,
   * run on again and never cross.
   */
  private careful(self: Readonly<CharacterSnapshot>, toward: Vec3, speed: number): Vec3 {
    const along = Math.max(speed, self.velocity.x * toward.x + self.velocity.z * toward.z);
    const ex = toward.x * along - self.velocity.x;
    const ez = toward.z * along - self.velocity.z;
    const error = Math.hypot(ex, ez);
    return error < BOT_BRAKE_MIN_SPEED ? toward : vec3(ex / error, 0, ez / error);
  }

  /** Where the path runs out on a slick floor: push against the drift until it is too slow to hurt. */
  private brake(self: Readonly<CharacterSnapshot>): Steering {
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    if (speed < BOT_BRAKE_MIN_SPEED) return STAND;
    return { moveDirection: vec3(-self.velocity.x / speed, 0, -self.velocity.z / speed), dash: false };
  }

  private wantsDash(self: Readonly<CharacterSnapshot>, nav: TrackNav, toward: Vec3, straight: number): boolean {
    if (self.dashCooldownMs > 0 || self.dashing || !self.grounded || self.motionState !== "Controlled") return false;
    // M17 ticket 06b: a Bot whose view lags is further along than it sees
    // itself by as far as it walks meanwhile, and the Dash runs on from
    // there, so the run it wants clear is that much longer.
    const late = this.guard.stale.max * Math.max(WALK_SPEED, Math.hypot(self.velocity.x, self.velocity.z)) * TICK_DT;
    const run = this.reach + BOT_DASH_MARGIN_M + late;
    if (straight < run) return false;
    // The run only shortens along a stretch, so a stretch refused once stays refused.
    const stretch = `${this.plannedTick}:${this.corner}`;
    if (stretch === this.dashRefused) return false;
    // Clear to either side of the line as well as along it (BOT_DASH_SIDE_M).
    const clear = [0, -BOT_DASH_SIDE_M, BOT_DASH_SIDE_M].every((offset) => {
      const from = { x: self.position.x - toward.z * offset, y: self.position.y, z: self.position.z + toward.x * offset };
      const end = { x: from.x + toward.x * run, y: from.y, z: from.z + toward.z * run };
      const surfaces = navStraightRun(nav, from, end);
      return surfaces !== null && surfaces.every((id) => {
        const config = surfaceConfig(id);
        return config.noDash !== true && config.grip >= 1;
      });
    });
    if (!clear) this.dashRefused = stretch;
    return clear;
  }
}

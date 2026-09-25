import type { Quat } from "../math/vec3.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { surfaceConfig } from "../track/Surface.js";
import {
  BOT_ARC_AIM_AHEAD_TICKS,
  BOT_ARC_DELAY_STEP_TICKS,
  BOT_ARC_DONE_M,
  BOT_ARC_MARGIN_M,
  BOT_ARC_MAX_TICKS,
  BOT_ARC_OFF_M,
  BOT_ARC_RADIUS_SHARES,
  BOT_ARC_RETRY_TICKS,
  BOT_BRAKE_MIN_SPEED,
  BOT_CORNER_REACHED_M,
  BOT_HOLD_DECIDE_TICKS,
  BOT_HOLD_GO_TICKS,
  BOT_HOLD_HERE_TICKS,
  BOT_HOLD_LOOK_M,
  BOT_HOLD_MARGIN_M,
  BOT_HOLD_MAX_TICKS,
  BOT_HOLD_MAX_TICKS_PER_LOOK,
  BOT_HOLD_MIN_SPEED,
  BOT_HOLD_SAMPLE_M,
  BOT_HOLD_STOP_M,
  BOT_STALL_MOVE_M,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { MOVING_SEGMENT_STAGGER_SPEED } from "../simulation/MovingSegment.js";
import { accelerate, type Motion } from "./edgeGuard.js";
import { corridorAhead, type HoldHook, type HookContext } from "./hooks.js";
import type { MovingBody, MovingWorld, Platform } from "./movingWorld.js";
import { navFloorWithin, navSurfaceAt } from "./navMesh.js";
import type { Steering } from "./PathBot.js";
import type { BotProfile } from "./profile.js";
import { botDraw } from "./random.js";

/*
 * Timing the sweepers (M17 ticket 07a). Every sweeping body — a spin bar, a
 * hammer, a wrecking ball, a slide wall, a spiked wheel, a glove — is a pure
 * function of the Tick and the Motion Clock, so "is the next stretch of my
 * path clear from now until I am through it" has an exact answer. Only the
 * Bot's own position is late (`ctx.stale`): arrival Ticks are counted from
 * where it sees itself, and "will it hit me where I stand" looks from
 * `tick + stale.max` on, since a Bot cannot be hit at a Tick it has lived.
 *
 * How far ahead a Bot asks is its profile's `lookAheadTicks`, how wrong it may
 * be about *when* its `timingErrorTicks` (one draw a decision). The guard
 * still vets every move this outputs (never steps off), and a hold has a cap
 * (never stranded).
 *
 * M17 ticket 07g, from what 07d's whole Races measured:
 * - A Bot **walks up to what blocks it** and holds there (`BOT_HOLD_STOP_M`):
 *   a wall six metres ahead is no reason to stand here, and two walls five
 *   metres apart are timed one at a time, as a Player times them. Before, one
 *   blocked sample anywhere in the look-ahead held the Bot where it stood,
 *   so a HARD Bot's longer look found the base race's belt climb never clear.
 * - The hold's clock runs until the Bot **gets nearer its corner**, not until
 *   it is displaced: a belt against it carried a held Bot back and forth,
 *   which read as "got somewhere" and reset the clock, so the hold never gave
 *   up (07d: a HARD Bot standing at Checkpoint 4 for the whole run, `gaveUp`
 *   0). The cap scales with the look-ahead (`BOT_HOLD_MAX_TICKS_PER_LOOK`).
 * - A body that **never moves** is scenery, not a sweeper: it is never held
 *   for, spiked or not (07a's open question).
 * - A Bot standing on a moving deck reads its corridor in the **deck's frame**:
 *   a sample it will reach is carried with the deck to the Tick it reaches it.
 *
 * M17 ticket 07i, spinning crosses. A bar a straight walk never clears (07g
 * measured a cross with an arm past any point every 24 Ticks against a
 * 37-Tick walk through its swath, so every Bot held to the cap and was hit)
 * is passed by walking **with its rotation**: the Bot stands at the swath's
 * edge, and when an arm has just gone by it walks an arc round the pivot in
 * the arm's own direction, inside the gap the arm leaves behind it, out to
 * where its path leaves the swath. The arc is found by playing the walk
 * (`accelerate`, the guard's own model of the Character) against the bar's
 * exact poses over one turn, start Tick by start Tick and radius by radius,
 * and kept only if no arm crosses it; it is then followed as a count from
 * the stand it was planned from, like a link's script, corrected toward the
 * plan by what the Bot sees. Tried only when no straight window opens within
 * one turn — a bar with a window is timed as before, and a Bot's look-ahead
 * still decides whether it sees that window. The guard vets every move of
 * the arc (never steps off); an arc that finds nothing leaves the old hold
 * and its give-up in place (never stranded).
 */

type Decision = "go" | "hold" | "retreat";

/** A crossing walked with a bar's rotation (M17 ticket 07i): where the Bot is each Tick from a stand at `points[0]` on `startTick`. */
interface ArcPlan {
  readonly body: number;
  readonly startTick: number;
  readonly points: readonly Vec3[];
}

/** What the last decision found in the way, for the arc to plan round. */
interface Blocked {
  readonly body: MovingBody;
  readonly index: number;
  readonly samples: readonly { p: Vec3; arriveTick: number }[];
  readonly near: readonly MovingBody[];
  readonly onDeck: boolean;
  /** Whether `body` at `at` is one to hold for at `p`, reached with the walk velocity `walk` (none: standing). */
  readonly counts: (body: MovingBody, at: number, p: Vec3, walk?: Vec3) => boolean;
  /** The walk the Bot brings to `samples[i]`. */
  readonly walkAt: (i: number) => Vec3 | undefined;
}

const isYaw = (q: Quat): boolean => Math.abs(q.x) < 1e-3 && Math.abs(q.z) < 1e-3;
const yawOf = (q: Quat): number => 2 * Math.atan2(q.y, q.w);
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

/** A body turning flat about a fixed pivot, as of `tick`: its yaw rate and one turn in Ticks. */
export interface SpinAbout {
  readonly pivot: Vec3;
  /** Radians per second; the sign is the turn's. */
  readonly w: number;
  readonly period: number;
}

/**
 * `body` as a spin about a fixed pivot at `tick`, or null: its yaw must
 * advance between `tick` and `tick + 1` with no roll or pitch, and its origin
 * must be where it was a quarter turn on (a swing or a slide is not).
 */
export const spinAbout = (moving: MovingWorld, body: MovingBody, tick: number, clock: HookContext["clock"]): SpinAbout | null => {
  const pose0 = moving.poseAt(body.index, tick, clock);
  const pose1 = moving.poseAt(body.index, tick + 1, clock);
  if (!isYaw(pose0.rotation) || !isYaw(pose1.rotation)) return null;
  const w = wrapAngle(yawOf(pose1.rotation) - yawOf(pose0.rotation)) / TICK_DT;
  if (Math.abs(w) < 1e-3) return null;
  const period = Math.max(2, Math.round((2 * Math.PI) / Math.abs(w) / TICK_DT));
  const later = moving.poseAt(body.index, tick + Math.round(period / 4), clock).position;
  if (groundDistance(later, pose0.position) > 1e-3) return null;
  return { pivot: pose0.position, w, period };
};

/**
 * The point whose occupancy by `spin`'s body *now* is `p`'s occupancy
 * `ticks` Ticks on: `p` turned back about the pivot by the body's turn over
 * those Ticks (M17 ticket 07i). A spinning body's future is asked of its
 * present pose, so a start Tick costs a sine, not a pose outside the ring
 * cache. `cos`/`sin` are the turn's, when the caller has them tabled.
 */
export const turnedBack = (spin: SpinAbout, ticks: number, p: Vec3, cos = Math.cos(spin.w * ticks * TICK_DT), sin = Math.sin(spin.w * ticks * TICK_DT)): Vec3 => {
  const dx = p.x - spin.pivot.x;
  const dz = p.z - spin.pivot.z;
  return { x: spin.pivot.x + dx * cos - dz * sin, y: p.y, z: spin.pivot.z + dx * sin + dz * cos };
};

/** A spinner's turn over each Tick offset an arc search asks, tabled once per search. */
interface SpinTable {
  readonly spin: SpinAbout;
  /** The same turn about the origin, for turning a velocity back. */
  readonly about0: SpinAbout;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
}

const spinTable = (spin: SpinAbout, offsets: number): SpinTable => {
  const cos = new Float64Array(offsets);
  const sin = new Float64Array(offsets);
  for (let d = 0; d < offsets; d += 1) {
    const a = spin.w * d * TICK_DT;
    cos[d] = Math.cos(a);
    sin[d] = Math.sin(a);
  }
  return { spin, about0: { ...spin, pivot: ORIGIN }, cos, sin };
};

/** How far past the bar's swept radius, plus the grown margin, a corridor sample must lie to be the arc's exit. */
const ARC_EXIT_CLEAR_M = 0.3;
/** How near a polyline point the played walk must come before it heads for the next. */
const ARC_TURN_M = 0.25;
/** Metres between the arc's own polyline points. */
const ARC_STEP_M = 0.5;
/** Box the arc's Ticks must find floor in, round the capsule's feet, one Tick in every {@link ARC_FLOOR_EVERY} (a walk's Tick is 0.18 m; the guard vets the move itself). */
const ARC_FLOOR_HALF = { x: 0.3, y: 0.5, z: 0.3 };
const ARC_FLOOR_EVERY = 3;

const STAND: Steering = { moveDirection: vec3(), dash: false };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Ticks a body's pose is compared at to tell a stopped body from a paused one: none of these is a multiple of another. */
const STOPPED_PROBE_TICKS = [7, 61, 233];

/** Per moving world, which bodies never move at all (a Motion at speed 0, or none that poses it). */
const stoppedByWorld = new WeakMap<MovingWorld, Map<number, boolean>>();

const isStopped = (moving: MovingWorld, body: MovingBody, clock: HookContext["clock"]): boolean => {
  let map = stoppedByWorld.get(moving);
  if (map === undefined) {
    map = new Map();
    stoppedByWorld.set(moving, map);
  }
  let stopped = map.get(body.index);
  if (stopped === undefined) {
    const at0 = moving.poseAt(body.index, 0, clock);
    stopped = STOPPED_PROBE_TICKS.every((tick) => {
      const p = moving.poseAt(body.index, tick, clock);
      return (
        Math.hypot(p.position.x - at0.position.x, p.position.y - at0.position.y, p.position.z - at0.position.z) < 1e-6 &&
        Math.abs(p.rotation.x - at0.rotation.x) + Math.abs(p.rotation.y - at0.rotation.y) + Math.abs(p.rotation.z - at0.rotation.z) + Math.abs(p.rotation.w - at0.rotation.w) < 1e-6
      );
    });
    map.set(body.index, stopped);
  }
  return stopped;
};

export class SweeperHold implements HoldHook {
  /** Every hold that ran into its cap and went anyway, over all Bots: logged by the suite, not asserted. */
  static gaveUp = 0;

  private decision: Decision = "go";
  private decidedAt = Number.NEGATIVE_INFINITY;
  private lastTick = Number.NEGATIVE_INFINITY;
  /**
   * The Tick the current hold (or retreat) began, and how far the Bot then
   * stood from the corner it was steering for: null once it has got nearer
   * since. A "go" between holds does not end it on its own — two capsules
   * pressed together behind a hold go nowhere on a go, and a hold/go rhythm
   * shorter than the stall detector's would otherwise keep them there for
   * good (measured: two HARD Bots on Track A) — and nor does being carried
   * about by a belt (07g).
   */
  private heldSince: number | null = null;
  private heldCorner: { index: number; distance: number } | null = null;
  /** No hold before this Tick: the Bot gave one up and is going. */
  private goUntil = Number.NEGATIVE_INFINITY;
  /** A hold ended last Tick: decide afresh this one. */
  private holdEnded = false;
  /** Whether the last decision found a sweeper near. */
  private sweepersNear = false;
  /** What the last decision found in the way (07i), for the arc; null when nothing was. */
  private blocked: Blocked | null = null;
  /** The arc being walked (07i), if one is. */
  private arc: ArcPlan | null = null;
  /** Per bar, the Tick before which an arc search there is not tried again (07i). */
  private readonly arcFailed = new Map<number, number>();

  /** Every arc planned, over all Bots: logged by the suite, not asserted (07i). */
  static arcs = 0;
  /** Every arc dropped for the Bot straying off it, over all Bots. */
  static arcsDropped = 0;

  constructor(
    private readonly profile: BotProfile,
    private readonly seed: string,
  ) {}

  /** The longest this Bot holds before it goes anyway: one longest authored cycle, or longer the further it looks. */
  private holdCap(): number {
    return Math.max(BOT_HOLD_MAX_TICKS, Math.round(this.profile.lookAheadTicks * BOT_HOLD_MAX_TICKS_PER_LOOK));
  }

  hold(ctx: HookContext, steering: Steering): Steering {
    if (steering.committed === true) return steering;
    const { tick } = ctx;
    const contiguous = tick === this.lastTick + 1;
    this.lastTick = tick;
    if (!contiguous) {
      this.heldSince = null;
      this.heldCorner = null;
      this.decision = "go";
      this.decidedAt = Number.NEGATIVE_INFINITY;
      this.arc = null;
    }
    // Never forever: a hold that has lasted its cap goes, and holds nothing for a while. An arc's wait
    // and walk are on the same clock (07i): a Bot boxed in at a bar by the crowd is not held for good.
    if (this.heldCorner !== null && this.progressed(ctx, this.heldCorner)) {
      this.heldSince = null;
      this.heldCorner = null;
    }
    if (this.heldSince !== null && tick - this.heldSince >= this.holdCap()) {
      SweeperHold.gaveUp += 1;
      if (process.env.R3_TRACE) console.log(`[trace] ${ctx.view.id} t${tick} gave up at (${ctx.self.position.x.toFixed(1)}, ${ctx.self.position.z.toFixed(1)}) seg ${this.blocked?.body.config.segmentIndex}`);
      this.goUntil = tick + BOT_HOLD_GO_TICKS;
      this.arc = null;
      this.end();
      return steering;
    }
    // An arc under way is walked to its end, or dropped (07i).
    if (this.arc !== null) {
      const walked = this.followArc(ctx);
      if (walked !== null) return walked;
    }
    if (tick < this.goUntil) return steering;
    if (this.holdEnded || tick - this.decidedAt >= BOT_HOLD_DECIDE_TICKS) {
      this.holdEnded = false;
      this.decidedAt = tick;
      const decided = this.decide(ctx, steering);
      if (decided === "go") {
        if (this.decision !== "go") this.holdEnded = true;
        this.decision = "go";
      } else {
        // A bar no straight walk clears is walked round with its rotation (07i), from this stand.
        if (decided === "hold" && this.blocked !== null && !this.blocked.onDeck) {
          const arc = this.planArc(ctx, this.blocked);
          if (arc !== null) {
            SweeperHold.arcs += 1;
            this.arc = arc;
            if (this.heldSince === null) {
              this.heldSince = tick;
              this.heldCorner = this.cornerDistance(ctx);
            }
            this.decision = "go";
            return this.followArc(ctx) ?? steering;
          }
        }
        if (this.heldSince === null) {
          this.heldSince = tick;
          this.heldCorner = this.cornerDistance(ctx);
        }
        this.decision = decided;
      }
    }
    if (this.decision === "hold") return this.stand(ctx);
    if (this.decision === "retreat") return this.retreat(ctx);
    // The corridor's arrival Ticks are a walk's: a Dash among sweepers arrives
    // when the timing did not look, so a Bot with a sweeper near walks.
    if (steering.dash && this.sweepersNear) return { ...steering, dash: false };
    return steering;
  }

  /** How far, across the ground, the Bot stands from the corner it steers for; null with no corner to steer for. */
  private cornerDistance(ctx: HookContext): { index: number; distance: number } | null {
    const corner = ctx.path[ctx.corner];
    if (corner === undefined) return null;
    return { index: ctx.corner, distance: Math.hypot(corner.point.x - ctx.self.position.x, corner.point.z - ctx.self.position.z) };
  }

  /** Whether the Bot has got nearer its corner than when the hold began, by {@link BOT_STALL_MOVE_M}, or past it. */
  private progressed(ctx: HookContext, since: { index: number; distance: number }): boolean {
    if (ctx.corner > since.index) return true;
    const now = this.cornerDistance(ctx);
    return now !== null && now.index === since.index && now.distance < since.distance - BOT_STALL_MOVE_M;
  }

  private end(): void {
    this.heldSince = null;
    this.heldCorner = null;
    this.decision = "go";
    this.holdEnded = true;
  }

  private decide(ctx: HookContext, steering: Steering): Decision {
    const move = steering.moveDirection;
    this.sweepersNear = false;
    this.blocked = null;
    if (move.x === 0 && move.z === 0) return "go";
    const { view, self, tick, clock, stale } = ctx;
    const { moving } = view.track;
    const look = Math.max(0, Math.round(this.profile.lookAheadTicks));
    const near = moving.near(self.position, BOT_HOLD_LOOK_M, tick, look, clock, ["sweeper"]).filter((body) => !isStopped(moving, body, clock));
    this.sweepersNear = near.length > 0;
    if (near.length === 0) return "go";
    const samples = corridorAhead(ctx, BOT_HOLD_LOOK_M, BOT_HOLD_SAMPLE_M);
    const jitter = Math.round((2 * botDraw(this.seed, `hold ${tick}`) - 1) * this.profile.timingErrorTicks);
    const grow = CAPSULE_RADIUS + BOT_HOLD_MARGIN_M;
    // A bar too slow to Stagger only shoves: holding for it is time lost. A spiked body always counts.
    // A Bot walking into it brings its own walk (07i): the simulation's closing speed is the body's
    // velocity net of the Character's, along the push, so a body head-on counts from the Stagger
    // speed less the walk, and one moving away or across does not (07i round 3: the speed alone,
    // above 1.2 u/s, held for every slow wall and hub on Slip Stream, and the holds gave up 4× as often).
    const counts = (body: MovingBody, at: number, p: Vec3, walk?: Vec3): boolean => {
      if (!moving.solidAt(body.index, at, view.fragile)) return false;
      if (body.spiked) return true;
      const v = moving.velocityAt(body.index, at, clock, p);
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > BOT_HOLD_MIN_SPEED) return true;
      if (process.env.R3_OLD_SPEED || walk === undefined || speed < 1e-3) return false;
      // Along the body's own motion, which is the push a sweeping face deals: a walk straight into it adds
      // the whole walk, a walk across it adds nothing (07i round 3: the relative speed's magnitude counted
      // a glancing walk past a bar's slow inner half as head-on, and 812 of 2,666 holds at Slip Stream's
      // bar 97 were that).
      return process.env.R3_RELATIVE ? Math.hypot(v.x - walk.x, v.y, v.z - walk.z) > MOVING_SEGMENT_STAGGER_SPEED : speed - (walk.x * v.x + walk.z * v.z) / speed > MOVING_SEGMENT_STAGGER_SPEED;
    };
    /** The walk the Bot brings to sample `i`: its corridor's direction there at its floor's pace, from the samples' own spacing and arrival. */
    const walkAt = (i: number): Vec3 | undefined => {
      const a = samples[i - 1] ?? samples[i]!;
      const b = samples[i + 1] ?? samples[i]!;
      const dx = b.p.x - a.p.x;
      const dz = b.p.z - a.p.z;
      const length = Math.hypot(dx, dz);
      const ticks = b.arriveTick - a.arriveTick;
      if (length < 1e-6 || ticks <= 0) return undefined;
      const speed = Math.min(WALK_SPEED, length / (ticks * TICK_DT));
      return { x: (dx / length) * speed, y: 0, z: (dz / length) * speed };
    };
    // On a moving deck the Bot is carried: a sample it will reach is where the deck takes it by then (07g).
    const deck: Platform | null = self.grounded ? moving.platformUnder(self.position, tick, clock) : null;
    const carried = (p: Vec3, at: number): Vec3 => (deck === null ? p : moving.toWorld(deck, at, clock, moving.toLocal(deck, tick, clock, p)));
    // The first sample a counting body occupies when the Bot gets there, and how far along the path it is.
    // The look-ahead is how far off a Bot notices a sweeper; a swath it has
    // noticed is checked all the way through (07i): a single bar's window is
    // as long as the walk through its swath, which no level's look covers.
    // Each near body's swath as it stands now, once a decision, not once a sample.
    const swaths = near.map((body) => ({ at: moving.poseAt(body.index, tick, clock).position, radius: body.radius + grow }));
    const inSwath = (p: Vec3): boolean => swaths.some(({ at, radius }) => Math.hypot(at.x - p.x, at.z - p.z) <= radius);
    let blockedAt = -1;
    let through = false;
    for (let i = 0; i < samples.length && blockedAt < 0; i += 1) {
      const { p, arriveTick } = samples[i]!;
      if (arriveTick - tick > look) {
        if (!through || process.env.R3_NO_THROUGH) break;
        if (!inSwath(p)) break;
      } else through = inSwath(p);
      const at = arriveTick + jitter;
      const q = carried(p, at);
      for (const body of near) {
        if (moving.occupies(body.index, at, clock, q, grow) && counts(body, at, q, walkAt(i))) {
          if (process.env.R3_TRACE) {
            const v = moving.velocityAt(body.index, at, clock, q);
            const u = walkAt(i);
            console.log(`[trace] ${ctx.view.id} t${tick} hold? seg ${body.config.segmentIndex} body ${body.index} sample ${i} at (${q.x.toFixed(1)}, ${q.z.toFixed(1)}) |v| ${Math.hypot(v.x, v.y, v.z).toFixed(2)} |v-u| ${u === undefined ? "-" : Math.hypot(v.x - u.x, v.y, v.z - u.z).toFixed(2)}`);
          }
          blockedAt = i;
          this.blocked = { body, index: i, samples, near, onDeck: deck !== null, counts, walkAt };
          break;
        }
      }
    }
    if (blockedAt < 0) return "go";
    // Blocked further off than the Bot stops in: walk on toward it and hold there (07g). What it walks while its view
    // lags and until the next decision is added, since it cannot see itself reaching a sample that near.
    const speed = WALK_SPEED * surfaceConfig(navSurfaceAt(view.track.nav, self.position) ?? undefined).topSpeedMultiplier;
    const stopReach = BOT_HOLD_STOP_M + (stale.max + BOT_HOLD_DECIDE_TICKS) * speed * TICK_DT;
    if (blockedAt * BOT_HOLD_SAMPLE_M > stopReach) return "go";
    const last = tick + Math.min(look, BOT_HOLD_HERE_TICKS);
    for (let at = tick + stale.max; at <= last; at += 2) {
      const here = carried(self.position, at);
      for (const body of near) {
        if (moving.occupies(body.index, at, clock, here, grow) && counts(body, at, here)) return "retreat";
      }
    }
    return "hold";
  }

  /**
   * An arc round `blocked.body`'s pivot, with its rotation, from a stand where
   * the Bot sees itself (07i), or null: the bar does not turn flat about a
   * fixed pivot, a straight window opens within one turn (the ordinary hold's
   * business), the path never leaves the swath within the corridor, or no
   * start Tick and radius over one turn is clear of every near sweeper and
   * on the floor all the way. A search that finds nothing is not tried again
   * at this bar for {@link BOT_ARC_RETRY_TICKS}.
   */
  private planArc(ctx: HookContext, blocked: Blocked): ArcPlan | null {
    const { view, self, tick, clock, stale } = ctx;
    const { moving, nav } = view.track;
    const { body, near, samples, counts } = blocked;
    if (process.env.R3_NOARC) return null;
    // From a stand, seen: the arc is a count from here, as a link's script is.
    if (Math.hypot(self.velocity.x, self.velocity.z) >= BOT_BRAKE_MIN_SPEED) return null;
    const failedUntil = this.arcFailed.get(body.index);
    if (failedUntil !== undefined && tick < failedUntil) return null;
    const fail = (): null => {
      this.arcFailed.set(body.index, tick + BOT_ARC_RETRY_TICKS);
      return null;
    };
    // A bar turning flat about a fixed pivot: its yaw advances, its origin stays.
    const bar = spinAbout(moving, body, tick, clock);
    if (bar === null) return fail();
    const { pivot, w: omega, period } = bar;
    const grow = CAPSULE_RADIUS + BOT_ARC_MARGIN_M;
    const swath = body.radius + grow;
    // The path's first sample past the swath is where the arc comes out.
    let exit: Vec3 | null = null;
    for (let i = blocked.index + 1; i < samples.length; i += 1) {
      const { p } = samples[i]!;
      if (groundDistance(p, pivot) > swath + ARC_EXIT_CLEAR_M) {
        exit = p;
        break;
      }
    }
    if (exit === null) return fail();
    // A body turning flat about a fixed pivot occupies at `at` what it occupies
    // at `tick` turned back by its turn since (`turnedBack`): asked at `tick`,
    // every pose is the ring cache's, and a start Tick costs a sine — tabled
    // here, once per search, for every offset the search asks. Any other near
    // body (a hammer, a wall) is asked at `at` as before.
    const offsets = period + BOT_ARC_MAX_TICKS + stale.max + 2;
    const spinners = near.map((b) => {
      const spin = spinAbout(moving, b, tick, clock);
      return spin === null ? null : spinTable(spin, offsets);
    });
    const clearAt = (p: Vec3, at: number, walk?: Vec3): boolean => {
      for (let i = 0; i < near.length; i += 1) {
        const b = near[i]!;
        const table = spinners[i] ?? null;
        if (table === null) {
          if (moving.occupies(b.index, at, clock, p, grow) && counts(b, at, p, walk)) return false;
          continue;
        }
        const d = at - tick;
        const q = d >= 0 && d < offsets ? turnedBack(table.spin, d, p, table.cos[d], table.sin[d]) : turnedBack(table.spin, d, p);
        // The walk turned back with the point: the closing speed is the same in the body's frame.
        const u = walk === undefined ? undefined : d >= 0 && d < offsets ? turnedBack(table.about0, d, walk, table.cos[d], table.sin[d]) : turnedBack(table.about0, d, walk);
        if (moving.occupies(b.index, tick, clock, q, grow) && counts(b, tick, q, u)) return false;
      }
      return true;
    };
    /** The walk from `points[k]` to `points[k + 1]`, one Tick apart. */
    const walkAlong = (points: readonly Vec3[], k: number): Vec3 | undefined => {
      const a = points[k]!;
      const b = points[k + 1];
      return b === undefined ? undefined : { x: (b.x - a.x) / TICK_DT, y: 0, z: (b.z - a.z) / TICK_DT };
    };
    for (let delay = 0; delay < period; delay += BOT_ARC_DELAY_STEP_TICKS) {
      let open = true;
      for (let i = 0; i < samples.length && open; i += 1) {
        const { p, arriveTick } = samples[i]!;
        if (groundDistance(p, pivot) > swath + ARC_EXIT_CLEAR_M && i > blocked.index) break;
        open = clearAt(p, arriveTick + delay, blocked.walkAt(i));
      }
      if (open) return fail();
    }
    // The arcs, played as the Character walks them: every radius, both ways round, from the stand.
    const start = self.position;
    const y = start.y;
    const floorY = y - CAPSULE_BOTTOM_OFFSET;
    const walk = WALK_SPEED * surfaceConfig(navSurfaceAt(nav, start) ?? undefined).topSpeedMultiplier;
    const phiStart = Math.atan2(start.z - pivot.z, start.x - pivot.x);
    const phiExit = Math.atan2(exit.z - pivot.z, exit.x - pivot.x);
    const played: Vec3[][] = [];
    const directions = omega > 0 ? [1, -1] : [-1, 1];
    for (const share of BOT_ARC_RADIUS_SHARES) {
      const r = share * body.radius;
      for (const dir of directions) {
        let span = (phiExit - phiStart) * dir;
        span = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const line: Vec3[] = [start];
        const steps = Math.max(1, Math.ceil((span * r) / ARC_STEP_M));
        for (let s = 0; s <= steps; s += 1) {
          const phi = phiStart + dir * span * (s / steps);
          line.push({ x: pivot.x + r * Math.cos(phi), y, z: pivot.z + r * Math.sin(phi) });
        }
        line.push(exit);
        const points = this.playWalk(line, walk);
        if (points === null) continue;
        if (!points.every((p, k) => k % ARC_FLOOR_EVERY !== 0 || navFloorWithin(nav, { x: p.x, y: floorY, z: p.z }, ARC_FLOOR_HALF) !== null)) continue;
        played.push(points);
      }
    }
    if (played.length === 0) return fail();
    // The earliest start Tick over one turn that some arc is clear from, waiting here safe until it. The
    // stand is checked once per Tick of the wait: a Tick the bar reaches the stand rules out every later start.
    let waitChecked = tick + stale.max - 2;
    for (let delay = 0; delay < period; delay += BOT_ARC_DELAY_STEP_TICKS) {
      const startTick = tick + delay;
      let waitSafe = true;
      for (let at = waitChecked + 2; at <= startTick && waitSafe; at += 2) {
        waitSafe = clearAt(start, at);
        waitChecked = at;
      }
      if (!waitSafe) break;
      for (const points of played) {
        let clear = true;
        for (let k = 0; k < points.length && clear; k += 1) clear = clearAt(points[k]!, startTick + k, walkAlong(points, k));
        if (!clear) continue;
        const jitter = Math.round((2 * botDraw(this.seed, `arc ${tick}`) - 1) * this.profile.timingErrorTicks);
        return { body: body.index, startTick: Math.max(tick + 1, startTick + jitter), points };
      }
    }
    return fail();
  }

  /**
   * Where a Character walking `line` at `walk` is each Tick from a stand at
   * its first point, by the guard's own model of the walk, until it is within
   * {@link BOT_ARC_DONE_M} of the last point; null if that takes more than
   * {@link BOT_ARC_MAX_TICKS}.
   */
  private playWalk(line: readonly Vec3[], walk: number): Vec3[] | null {
    const first = line[0]!;
    const last = line[line.length - 1]!;
    const m: Motion = { x: first.x, z: first.z, vx: 0, vz: 0 };
    const points: Vec3[] = [first];
    let next = 1;
    for (let k = 0; k < BOT_ARC_MAX_TICKS; k += 1) {
      while (next < line.length - 1 && Math.hypot(line[next]!.x - m.x, line[next]!.z - m.z) <= ARC_TURN_M) next += 1;
      const target = line[next]!;
      const dx = target.x - m.x;
      const dz = target.z - m.z;
      const length = Math.hypot(dx, dz);
      if (length > 1e-6) accelerate(m, (dx / length) * walk, (dz / length) * walk, 1);
      m.x += m.vx * TICK_DT;
      m.z += m.vz * TICK_DT;
      points.push({ x: m.x, y: first.y, z: m.z });
      if (Math.hypot(last.x - m.x, last.z - m.z) <= BOT_ARC_DONE_M) return points;
    }
    return null;
  }

  /**
   * The move along the arc this Tick (07i): a stand until its start Tick,
   * then the arc's own direction at where the Bot should be by now, bent
   * toward the plan by how far its view puts it off it. Null once the Bot is
   * through, or has strayed more than {@link BOT_ARC_OFF_M} from where the
   * plan puts what it sees: the arc is over and the hold decides afresh.
   */
  private followArc(ctx: HookContext): Steering | null {
    const arc = this.arc!;
    const { tick, self, stale } = ctx;
    if (tick < arc.startTick) return this.stand(ctx);
    const n = arc.points.length;
    const k = tick - arc.startTick;
    const last = arc.points[n - 1]!;
    if (groundDistance(self.position, last) <= BOT_CORNER_REACHED_M || k >= n + stale.max + BOT_ARC_AIM_AHEAD_TICKS) {
      this.arc = null;
      this.end();
      return null;
    }
    const seenAt = arc.points[Math.max(0, Math.min(n - 1, k - stale.max))]!;
    const off = groundDistance(self.position, seenAt);
    if (off > BOT_ARC_OFF_M) {
      // Dropped: not planned again at this bar for a while, or a Bot boxed in by the crowd would plan,
      // stand, drop and plan for good (measured: 67 of 73 arcs dropped at EASY, two Bots stranded).
      SweeperHold.arcsDropped += 1;
      this.arcFailed.set(arc.body, tick + BOT_ARC_RETRY_TICKS);
      this.arc = null;
      this.end();
      return null;
    }
    const at = arc.points[Math.min(n - 1, k)]!;
    const ahead = arc.points[Math.min(n - 1, k + BOT_ARC_AIM_AHEAD_TICKS)]!;
    let dx = ahead.x - at.x + (seenAt.x - self.position.x);
    let dz = ahead.z - at.z + (seenAt.z - self.position.z);
    if (Math.hypot(dx, dz) < 1e-6) {
      dx = last.x - self.position.x;
      dz = last.z - self.position.z;
    }
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return STAND;
    return { moveDirection: vec3(dx / length, 0, dz / length), dash: false };
  }

  /** A stand; on a slick floor, a push against the drift until it is too slow to hurt (as `PathFollower.brake`). */
  private stand(ctx: HookContext): Steering {
    const { self } = ctx;
    if (surfaceConfig(navSurfaceAt(ctx.view.track.nav, self.position) ?? undefined).grip >= 1) return STAND;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    if (speed < BOT_BRAKE_MIN_SPEED) return STAND;
    return { moveDirection: vec3(-self.velocity.x / speed, 0, -self.velocity.z / speed), dash: false };
  }

  /** A unit move back toward the previous corner; at corner 0, the path's direction reversed. */
  private retreat(ctx: HookContext): Steering {
    const { self, path, corner } = ctx;
    const previous = corner > 0 ? path[corner - 1] : undefined;
    let dx: number;
    let dz: number;
    if (previous !== undefined) {
      dx = previous.point.x - self.position.x;
      dz = previous.point.z - self.position.z;
    } else {
      const next = path[corner];
      if (next === undefined) return this.stand(ctx);
      dx = self.position.x - next.point.x;
      dz = self.position.z - next.point.z;
    }
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return this.stand(ctx);
    return { moveDirection: vec3(dx / length, 0, dz / length), dash: false };
  }
}

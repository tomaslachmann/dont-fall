import { vec3, type Vec3 } from "../math/vec3.js";
import type { MotionClock } from "../track/Motion.js";
import {
  BOT_BRAKE_MIN_SPEED,
  BOT_CORNER_REACHED_M,
  BOT_EDGE_MARGIN_M,
  BOT_LINK_QUEUE_HEIGHT_M,
  BOT_LINK_QUEUE_M,
  BOT_LINK_RUNUP_M,
  BOT_LINK_START_ALONG_M,
  BOT_PATH_EDGE_MARGIN_M,
  BOT_RIDE_BOARD_SPEED,
  BOT_RIDE_CARRY_MARGIN,
  BOT_RIDE_CHAIN_MAX,
  BOT_RIDE_COST_M,
  BOT_RIDE_EXIT_INSET_M,
  BOT_RIDE_JUMP_FLIGHT_TICKS,
  BOT_RIDE_JUMP_REACH_M,
  BOT_RIDE_LIP_M,
  BOT_RIDE_PHASE_STEP_TICKS,
  BOT_RIDE_RIM_INSET_M,
  BOT_RIDE_RUNUP_MAX_M,
  BOT_RIDE_SPREAD_M,
  BOT_RIDE_TOP_TOLERANCE_M,
  BOT_RIDE_WAIT_MAX_TICKS,
  BOT_RIDE_WALK_GAP_M,
  BOT_STALL_MOVE_M,
  BOT_STALL_TICKS,
} from "../tuning/bots.js";
import { WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { JUMP_HOLD_MAX_TICKS } from "../tuning/movement.js";
import type { BotTrack } from "./Bot.js";
import type { HookContext, RideHook } from "./hooks.js";
import { LinkRun } from "./links.js";
import type { Platform } from "./movingWorld.js";
import { navCorners, navFloorWithin, navStandsOn, type NavCorner } from "./navMesh.js";
import type { Steering } from "./PathBot.js";
import type { BotProfile } from "./profile.js";
import { botDraw } from "./random.js";
import { hullDistance, insetToward, nearestRim, rideTableOf, RUNUP_STEP_M, TRANSFER_COMPONENT, type RideDeck, type RideEnd, type RideLink, type RideTable } from "./rideLinks.js";

/*
 * Riding a moving floor from still floor and back (M17 ticket 07b). A moving
 * deck is a link whose ends move (`rideLinks.ts`): the Bot boards when the
 * deck's rim meets the floor it stands on, steers in the deck's frame while
 * aboard, and gets off when the rim meets its next floor. Boarding and
 * alighting are timed from exact poses, with the Bot's own timing error; a
 * misjudgement is a late jump or a wait, and no wait lasts for good.
 *
 * A transfer (M17 ticket 07e) is a ride whose exit meets another platform
 * (`RideEnd.to`): the Bot alights by a jump aimed at that deck's middle as it
 * will be at the landing, lands on it by `platformUnder`, and the next Tick
 * plans from aboard it, as one knocked onto a deck does.
 */

type State = "off" | "waitToBoard" | "boarding" | "aboard" | "waitToAlight" | "alighting" | "landing";

const STAND: Steering = { moveDirection: vec3(), dash: false, committed: true };

const ground = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);
const unit = (from: Vec3, to: Vec3): Vec3 => {
  const d = ground(from, to);
  return d === 0 ? vec3(1, 0, 0) : vec3((to.x - from.x) / d, 0, (to.z - from.z) / d);
};
const walkTicks = (metres: number): number => Math.max(1, Math.ceil(metres / (WALK_SPEED * TICK_DT)));
/** Ticks of a jump's run-up from a stand (the recipe's `jumpAt`). */
const JUMP_AT = BOT_LINK_RUNUP_M - BOT_LINK_START_ALONG_M;
const RUN_TICKS = walkTicks(JUMP_AT);
const JUMP_TICKS = RUN_TICKS + BOT_RIDE_JUMP_FLIGHT_TICKS;
/** From a stand, where a jump lands: the run-up, then the flight. */
const JUMP_LANDS_M = JUMP_AT + BOT_RIDE_JUMP_REACH_M;

/** Ticks a run from a stand takes over `metres`: the measured {@link RUN_TICKS} for the first {@link JUMP_AT}, walk speed beyond. */
const runTicks = (metres: number): number => (metres <= JUMP_AT ? RUN_TICKS : RUN_TICKS + Math.ceil((metres - JUMP_AT) / (WALK_SPEED * TICK_DT)));

interface JumpOff {
  readonly direction: Vec3;
  /** Metres run before jump is pressed: from the Bot's spot to the rim, at least {@link JUMP_AT}. */
  readonly runUp: number;
  readonly runTicks: number;
  readonly takeOff: Vec3;
  readonly lands: Vec3;
  /** The deck's velocity at the take-off, which the Character keeps in the air. */
  readonly carry: Vec3;
}

/**
 * A jump off a deck from the Bot's spot `source` (platform frame) at `at`:
 * it runs straight for `still` (the deck carrying it) and presses jump where
 * its line leaves the deck's outline, so the run-up is as long as its spot
 * is far in and the take-off is at the rim. Airborne, a Character keeps the
 * velocity of what it rode (`MovementController.leaveRide`), so the line
 * aims upstream of `still` by the deck's velocity over the flight.
 */
const jumpOff = (track: BotTrack, deck: RideDeck, platform: Platform, source: Vec3, still: Vec3, at: number, clock: MotionClock): JumpOff => {
  const { moving } = track;
  const body = platform.bodies[0]!.index;
  const start = moving.toWorld(platform, at, clock, source);
  const flight = BOT_RIDE_JUMP_FLIGHT_TICKS * TICK_DT;
  let direction = unit(start, still);
  let runUp = JUMP_AT;
  let takeOff = start;
  let carry = vec3();
  // The carry turns the line, and the line decides where the rim is met: twice over settles it. The run-up is marched in the
  // deck's frame (M17 ticket 07h): a Bot running on a deck is carried with it, so where its line leaves the outline is a
  // question in that frame, and the take-off is that point as the deck will have brought it (marched in world against the
  // deck's later pose, the take-off was wrong by the carry over the run-up, 1.3 m on a 5 u/s slide; measured: HARD landings
  // 1–3 m off along the slide's axis).
  for (let pass = 0; pass < 2; pass += 1) {
    runUp = JUMP_AT;
    for (let t = JUMP_AT + RUNUP_STEP_M; t <= BOT_RIDE_RUNUP_MAX_M; t += RUNUP_STEP_M) {
      const p = { x: start.x + direction.x * t, y: start.y, z: start.z + direction.z * t };
      if (hullDistance(deck.hull, moving.toLocal(platform, at, clock, p)) > -BOT_RIDE_RIM_INSET_M / 2) break;
      runUp = t;
    }
    const local = moving.toLocal(platform, at, clock, { x: start.x + direction.x * runUp, y: start.y, z: start.z + direction.z * runUp });
    takeOff = moving.toWorld(platform, at + runTicks(runUp), clock, local);
    carry = moving.velocityAt(body, at + runTicks(runUp), clock, takeOff);
    direction = unit(takeOff, { x: still.x - carry.x * flight, y: still.y, z: still.z - carry.z * flight });
  }
  const lands = {
    x: takeOff.x + direction.x * BOT_RIDE_JUMP_REACH_M + carry.x * flight,
    y: still.y,
    z: takeOff.z + direction.z * BOT_RIDE_JUMP_REACH_M + carry.z * flight,
  };
  return { direction, runUp, runTicks: runTicks(runUp), takeOff, lands, carry };
};

/** A transfer's landing (M17 ticket 07e): the deck it goes to, in world at `at`, its middle. */
const transferAim = (track: BotTrack, table: RideTable, end: RideEnd, at: number, clock: MotionClock): Vec3 => {
  const target = track.moving.platforms[end.to!.platform]!;
  const deck = table.decks[target.index]!;
  return track.moving.toWorld(target, at, clock, { x: deck.centroid.x, y: deck.y, z: deck.centroid.z });
};

/**
 * The jump off a deck to `end`: to its still point, or, for a transfer, to
 * the other deck's middle as it will be when the jump comes down. The run-up
 * decides the landing Tick and the landing Tick where the deck is: twice
 * over settles it.
 */
const jumpOffEnd = (track: BotTrack, table: RideTable, deck: RideDeck, platform: Platform, source: Vec3, end: RideEnd, at: number, clock: MotionClock): JumpOff & { landTick: number } => {
  if (end.to === null) {
    const jump = jumpOff(track, deck, platform, source, end.still, at, clock);
    return { ...jump, landTick: at + jump.runTicks + BOT_RIDE_JUMP_FLIGHT_TICKS };
  }
  let landTick = at + RUN_TICKS + BOT_RIDE_JUMP_FLIGHT_TICKS;
  let jump = jumpOff(track, deck, platform, source, transferAim(track, table, end, landTick, clock), at, clock);
  if (at + jump.runTicks + BOT_RIDE_JUMP_FLIGHT_TICKS !== landTick) {
    landTick = at + jump.runTicks + BOT_RIDE_JUMP_FLIGHT_TICKS;
    jump = jumpOff(track, deck, platform, source, transferAim(track, table, end, landTick, clock), at, clock);
  }
  return { ...jump, landTick };
};

/** A planned way across: a chain of rides, by link index. */
interface Across {
  readonly rides: readonly number[];
}

/**
 * The ride hook (M17 ticket 07b): the planner across moving floors
 * ({@link planAcross}) and a small state machine per Bot
 * (`off → waitToBoard → boarding → aboard → waitToAlight → alighting → off`).
 */
export class DeckRider implements RideHook {
  /** How many waits ran past `BOT_RIDE_WAIT_MAX_TICKS` and went at the nearest pass. Logged, not asserted. */
  gaveUp = 0;
  private state: State = "off";
  private ride: RideLink | null = null;
  private platform: Platform | null = null;
  private waitSince = 0;
  /** A wait that gave up goes at this Tick, whatever the gap. */
  private forcedAt: number | null = null;
  private quiet = 0;
  private lastTick = Number.NEGATIVE_INFINITY;
  private run: LinkRun | null = null;
  /** A jump off a deck (M17 ticket 07h): the one heading held from the stand to the landing; null while a `LinkRun` steers instead. */
  private jumpHeading: Vec3 | null = null;
  /** A jump's run: the first Tick jump is held, counted from a fresh stand, and whether the Bot has been seen off the ground since. */
  private pressAt = 0;
  private left = false;
  private walkUntil = 0;
  /** Walking on: the deck-fixed point walked to. */
  private boardLocal: Vec3 | null = null;
  private readonly plans = new Map<string, Across | null>();
  /** Aboard: where the Bot last saw itself get somewhere, and since when; a jump until this Tick to get out of a pin. */
  private stalledAt: Vec3 | null = null;
  private stalledSince = 0;
  private hopUntil = Number.NEGATIVE_INFINITY;
  /** This Bot's place across the rim, −1 … 1 of {@link BOT_RIDE_SPREAD_M}: its boarding spot, its aim on the deck and its waiting spot aboard all share it, so twelve Bots cross side by side. */
  private across = 0;
  /** Waiting to board: the still-floor spot this Bot stands at (spread from the entry's still point), and the last Tick it walks for it. */
  private boardSpot: Vec3 | null = null;
  private spotUntil = 0;
  /** The walk to the spot is a counted run from a fresh stand (M17 ticket 07h): its heading, and the Tick it ends. */
  private spotWalkUntil = 0;
  private spotHeading: Vec3 = vec3(1, 0, 0);

  constructor(
    private readonly profile: BotProfile,
    private readonly seed: string,
  ) {}

  planAcross(ctx: Pick<HookContext, "view" | "seed">, from: Vec3, goal: Vec3): NavCorner[] | null {
    const track = ctx.view.track;
    const table = rideTableOf(track);
    if (table.links.length === 0) return null;
    const clock = ctx.view.runningFromTick ?? null;
    const aboard = track.moving.platformUnder(from, ctx.view.tick, clock);
    const nearest = aboard !== null ? `aboard ${aboard.index}` : `node ${table.componentOf(from)}`;
    // Who is queued at which still entry (M17 ticket 07d): a Bot ahead at an entry costs a turn of standing there. Twelve
    // Bots planning the one cheapest entry boarded it one a window (measured on two spinning squares: all twelve waiting
    // at one end from Tick 224, the first aboard at 498, one pass per half turn).
    const queued = new Map<RideEnd, number>();
    for (const [id, c] of Object.entries(ctx.view.characters)) {
      if (id === ctx.view.id || c.eliminated) continue;
      for (const end of table.ends) {
        if (end.to !== null || Math.abs(c.position.y - end.still.y) > BOT_LINK_QUEUE_HEIGHT_M) continue;
        if (ground(c.position, end.still) < BOT_LINK_QUEUE_M) queued.set(end, (queued.get(end) ?? 0) + 1);
      }
    }
    const signature = [...queued].map(([end, n]) => `${table.ends.indexOf(end)}:${n}`).sort().join(",");
    const key = `${nearest}|${Math.round(goal.x)},${Math.round(goal.y)},${Math.round(goal.z)}|${signature}`;
    let across = this.plans.get(key);
    if (across === undefined) {
      // A Bot ahead at a still entry costs a turn of its platform's period standing behind it, in metres of walk.
      across = dijkstra(table, aboard, from, goal, (entry) => (queued.get(entry) ?? 0) * track.moving.platforms[entry.platform]!.periodTicks * TICK_DT * WALK_SPEED);
      this.plans.set(key, across);
    }
    if (across === null) return null;
    return compose(track, table, aboard, from, goal, across);
  }

  steer(ctx: HookContext): Steering | null {
    const { tick, self } = ctx;
    if (tick !== this.lastTick + 1) this.reset();
    this.lastTick = tick;
    const track = ctx.view.track;
    const table = rideTableOf(track);
    const { moving } = track;
    const seenTick = tick - Math.round((ctx.stale.min + ctx.stale.max) / 2);

    if (this.state === "off") {
      const index = this.rideAhead(ctx);
      const under = self.grounded ? moving.platformUnder(self.position, seenTick, ctx.clock) : null;
      if (index !== null) {
        const link = table.links[index]!;
        const platform = moving.platforms[link.entry.platform]!;
        // Already on the deck the ride starts from: aboard, not waiting to board it. A transfer's entry is only ever met from aboard.
        if (under === platform) this.begin(ctx, link, platform, "aboard");
        else if (link.entry.to === null) this.begin(ctx, link, platform, "waitToBoard");
        else return null;
      } else {
        if (under === null) return this.offLip(ctx, table, seenTick);
        // Knocked onto a deck with no ride planned: plan from aboard toward where the path was going.
        const goal = ctx.path.at(-1)?.point;
        const link = goal === undefined ? null : exitFrom(table, under, self.position, goal);
        if (link === null) return null;
        this.begin(ctx, link, under, "aboard");
      }
    }
    const out = this.step(ctx, table, seenTick);
    this.quiet = out === null || (out.moveDirection.x === 0 && out.moveDirection.z === 0 && out.jump !== true) ? this.quiet + 1 : 0;
    return out;
  }

  /**
   * Grounded inside a deck's outline but under its top (M17 ticket 07b): on a
   * lower lip of a sliding row, carried along with nothing under it the
   * navmesh knows. Hop up toward the deck's middle; on top, the next Tick
   * plans from aboard.
   */
  private offLip(ctx: HookContext, table: RideTable, seenTick: number): Steering | null {
    const { tick, self, clock } = ctx;
    const { moving } = ctx.view.track;
    if (!self.grounded) return null;
    const lip = moving.platformUnder(self.position, seenTick, clock, BOT_RIDE_LIP_M);
    if (lip === null) return null;
    const deck = table.decks[lip.index]!;
    const centre = moving.toWorld(lip, tick, clock, { x: deck.centroid.x, y: deck.y, z: deck.centroid.z });
    return { moveDirection: unit(self.position, centre), dash: false, jump: tick % (2 * JUMP_HOLD_MAX_TICKS) < JUMP_HOLD_MAX_TICKS, committed: true };
  }

  private reset(): void {
    this.state = "off";
    this.ride = null;
    this.platform = null;
    this.run = null;
    this.jumpHeading = null;
    this.boardLocal = null;
    this.boardSpot = null;
    this.spotWalkUntil = 0;
    this.forcedAt = null;
  }

  private begin(ctx: HookContext, link: RideLink, platform: Platform, state: State): void {
    this.ride = link;
    this.platform = platform;
    this.state = state;
    this.waitSince = ctx.tick;
    this.forcedAt = null;
    this.quiet = 0;
    this.stalledAt = null;
    this.across = 2 * botDraw(this.seed, `ride across ${ctx.tick}`) - 1;
    this.boardSpot = state === "waitToBoard" ? this.spreadStill(ctx, link.entry, rideTableOf(ctx.view.track).decks[platform.index]!) : null;
    this.spotWalkUntil = 0;
    // A spot another Character stands on is never reached: walk for it as long as the walk takes (after the fresh stand the
    // counted walk starts from), then wait where the Bot is (measured on a turntable: a Bot pushing at its taken spot never
    // stood still long enough to go, and blocked the rest).
    this.spotUntil = this.boardSpot === null ? 0 : ctx.tick + walkTicks(ground(ctx.self.position, this.boardSpot)) + 2 * ctx.stale.max + 5;
  }

  /**
   * Where this Bot waits to board: the entry's still point spread across the
   * rim by its place, as far as the navmesh has floor there (M17 ticket 07b:
   * twelve Bots pressing on one point at a lane's end shoved the outer ones
   * off its corners, measured on R2).
   */
  private spreadStill(ctx: HookContext, end: RideEnd, deck: RideDeck): Vec3 {
    const { tick, clock } = ctx;
    const { moving, nav } = ctx.view.track;
    const platform = moving.platforms[end.platform]!;
    const rim = moving.toWorld(platform, tick, clock, end.local);
    const out = unit(rim, end.still);
    const tangent = { x: -out.z, z: out.x };
    const box = { x: 0.3, y: BOT_RIDE_TOP_TOLERANCE_M, z: 0.3 };
    // A walk end's spot must be one the rim comes within the walk gap of at some phase, or the walk never opens there
    // (measured on a turntable: spots spread to where the disc never reaches the lane, and the Bots walked off its corner).
    const reachable = (spot: Vec3): boolean => {
      if (end.jump) return true;
      for (let phase = 0; phase < platform.periodTicks; phase += BOT_RIDE_PHASE_STEP_TICKS) {
        if (hullDistance(deck.hull, moving.toLocal(platform, tick + phase, clock, spot)) <= BOT_RIDE_WALK_GAP_M) return true;
      }
      return false;
    };
    // And floor a path's edge margin either way along the rim (M17 ticket 07h): a spot 0.2 m from a narrow row's side had
    // the Bot that reached it stepping off that side (measured, the base race's 4 × 4 row).
    const roomy = (spot: Vec3): boolean =>
      [1, -1].every((side) => navFloorWithin(nav, { x: spot.x + tangent.x * side * BOT_PATH_EDGE_MARGIN_M, y: spot.y, z: spot.z + tangent.z * side * BOT_PATH_EDGE_MARGIN_M }, box) !== null);
    for (let share = 1; share > 0.2; share /= 2) {
      const d = this.across * BOT_RIDE_SPREAD_M * share;
      const spot = navFloorWithin(nav, { x: end.still.x + tangent.x * d, y: end.still.y, z: end.still.z + tangent.z * d }, box);
      if (spot !== null && reachable(spot) && roomy(spot)) return spot;
    }
    return end.still;
  }

  /** Where this Bot aims to land boarding: the entry's rim point moved across the rim by its place, kept inside the outline by the edge margin. */
  private boardAim(deck: RideDeck, end: RideEnd): Vec3 {
    const margin = BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M;
    let aim = { x: end.local.x - end.outward.z * this.across * BOT_RIDE_SPREAD_M, z: end.local.z + end.outward.x * this.across * BOT_RIDE_SPREAD_M };
    while (hullDistance(deck.hull, aim) > -margin && Math.hypot(aim.x - end.local.x, aim.z - end.local.z) > RUNUP_STEP_M) aim = insetToward(aim, end.local, RUNUP_STEP_M);
    return { x: aim.x, y: deck.y, z: aim.z };
  }

  /** The ride the path hands this Bot, when it has come near enough its start to settle (the links' rule). */
  private rideAhead(ctx: HookContext): number | null {
    const settle = (ctx.stale.max + 1) * WALK_SPEED * TICK_DT + BOT_CORNER_REACHED_M;
    for (let c = ctx.corner; c < Math.min(ctx.path.length, ctx.corner + 2); c += 1) {
      const corner = ctx.path[c]!;
      if (corner.ride !== undefined) return ground(ctx.self.position, corner.point) <= settle ? corner.ride : null;
    }
    return null;
  }

  /** Whether the Bot's view of itself is where it is (`EdgeGuard.fresh`'s rule): quiet for longer than its view can lag, grounded, slow against its floor. */
  private fresh(ctx: HookContext, seenTick: number): boolean {
    const { self } = ctx;
    if (this.quiet <= ctx.stale.max || !self.grounded) return false;
    if (Math.hypot(self.velocity.x, self.velocity.z) < BOT_BRAKE_MIN_SPEED) return true;
    // Aboard, a Character's velocity may carry the deck's own: slow against the deck is still.
    if (this.platform === null || !(this.state === "aboard" || this.state === "waitToAlight" || this.state === "landing")) return false;
    const floor = ctx.view.track.moving.velocityAt(this.platform.bodies[0]!.index, seenTick, ctx.clock, self.position);
    return Math.hypot(self.velocity.x - floor.x, self.velocity.z - floor.z) < BOT_BRAKE_MIN_SPEED;
  }

  private step(ctx: HookContext, table: RideTable, seenTick: number): Steering | null {
    const { tick, self, clock } = ctx;
    const track = ctx.view.track;
    const { moving } = track;
    const ride = this.ride!;
    const platform = this.platform!;
    const deck = table.decks[platform.index]!;
    switch (this.state) {
      case "waitToBoard":
      case "waitToAlight": {
        const boarding = this.state === "waitToBoard";
        const end = boarding ? ride.entry : ride.exit;
        const limit = Math.min(BOT_RIDE_WAIT_MAX_TICKS, 2 * platform.periodTicks);
        if (this.forcedAt === null && tick - this.waitSince > limit) {
          this.gaveUp += 1;
          this.forcedAt = bestPass(track, table, deck, platform, end, boarding ? this.boardAim(deck, end) : end.still, this.sourceLocal(ctx, seenTick), tick, clock);
        }
        if (!boarding && moving.platformUnder(self.position, seenTick, clock) !== platform && self.grounded) {
          // Not on the deck after all: plan again.
          this.reset();
          return null;
        }
        if (boarding && this.boardSpot !== null) {
          // The walk to the spot is a counted run from a fresh stand, as a jump's run-up is (M17 ticket 07h): steered live off a
          // view up to `stale.max` late, an EASY Bot had walked 2.75 m past where it saw itself, past its spot and off the deck's
          // edge, or turned back for a spot already behind it and drifted off the side (measured, base leg 2: every step-off).
          if (tick < this.spotWalkUntil) return { moveDirection: this.spotHeading, dash: false, committed: true };
          const away = ground(self.position, this.boardSpot);
          if (away > BOT_CORNER_REACHED_M) {
            if (!this.fresh(ctx, seenTick)) return STAND;
            if (tick < this.spotUntil) {
              this.spotHeading = unit(self.position, this.boardSpot);
              this.spotWalkUntil = tick + walkTicks(away);
              return { moveDirection: this.spotHeading, dash: false, committed: true };
            }
            // Not there when the walk should have got there (someone stands on it): rest a stall where it is, asking to go
            // from here meanwhile, then walk for it again (measured on R2: a Bot that gave the spot up for good stood a metre
            // short of where the walk-on can open until its wait ran out).
            if (tick - this.spotUntil > BOT_STALL_TICKS) this.spotUntil = tick + walkTicks(away) + ctx.stale.max + 5;
          }
        }
        if (!this.fresh(ctx, seenTick)) return boarding ? STAND : this.holdAboard(ctx, table, seenTick);
        const error = Math.round((2 * botDraw(this.seed, `ride ${tick}`) - 1) * this.profile.timingErrorTicks);
        const source = this.sourceLocal(ctx, seenTick);
        const aim = boarding ? this.boardAim(deck, end) : end.still;
        const go = this.forcedAt !== null ? tick >= this.forcedAt : contact(track, table, deck, platform, end, aim, source, tick + error, this.profile.timingErrorTicks, clock);
        if (!go) return boarding ? STAND : this.holdAboard(ctx, table, seenTick);
        // In turn: whoever is nearer the point the run heads for goes first (the links' rule). A wait that gave up goes regardless.
        const dest = boarding ? this.rimAhead(ctx, deck, source) : end.to === null ? end.still : transferAim(track, table, end, tick + JUMP_TICKS, clock);
        if (this.forcedAt === null && this.someoneAhead(ctx, dest)) {
          return boarding ? STAND : this.holdAboard(ctx, table, seenTick);
        }
        // Boarding, the spot the jump comes down on must be free too: those waiting to alight stand where the landings are
        // (measured on the base race's first row: landers came down on the waiters' backs and both went off the rim).
        if (this.forcedAt === null && boarding && end.jump && this.landingTaken(ctx, deck, aim, seenTick)) return STAND;
        return this.depart(ctx, table, end, boarding, source);
      }
      case "boarding":
      case "alighting": {
        const boarding = this.state === "boarding";
        // A transfer lands on another platform, never on the navmesh.
        const target = !boarding && ride.exit.to !== null ? moving.platforms[ride.exit.to.platform]! : null;
        if (this.run !== null) {
          const under = moving.platformUnder(self.position, seenTick, clock);
          const onTarget = boarding ? under === platform : target !== null ? under === target : navStandsOn(track.nav, self.position);
          const step = this.run.step(self, onTarget);
          if (!self.grounded && tick >= this.pressAt) this.left = true;
          // Jump is held by count from the fresh stand it set out from, never by where a late view puts it. Still on the
          // floor long after the hold, with no air seen: something was in the way; plan again.
          const stuck = !this.left && tick > this.pressAt + JUMP_HOLD_MAX_TICKS + ctx.stale.max + 2 && !onTarget;
          if (step.failed || stuck) {
            this.reset();
            return null;
          }
          if (step.done) return this.arrive(boarding, tick, target);
          const jump = tick >= this.pressAt && tick < this.pressAt + JUMP_HOLD_MAX_TICKS;
          // Down again but not on the floor it aimed for (a bevel beside it): for that floor, not on along the line
          // (measured: a Bot landed 0.5 m wide of a row's navmesh and ran along its bevel and off its end).
          if (this.left && self.grounded && !onTarget && !jump) {
            const safe = boarding ? moving.toWorld(platform, tick, clock, this.boardAim(deck, ride.entry)) : target !== null ? transferAim(track, table, ride.exit, tick, clock) : ride.exit.still;
            return { moveDirection: unit(self.position, safe), dash: false, jump: false, committed: true };
          }
          return { moveDirection: step.moveDirection, dash: false, jump, committed: true };
        }
        if (this.jumpHeading !== null) {
          // The open-loop jump off a deck: the heading held, jump pressed by count, landed when seen grounded after the air.
          const under = moving.platformUnder(self.position, seenTick, clock);
          const onTarget = target !== null ? under === target : navStandsOn(track.nav, self.position);
          if (!self.grounded && tick >= this.pressAt) this.left = true;
          const jump = tick >= this.pressAt && tick < this.pressAt + JUMP_HOLD_MAX_TICKS;
          const stuck = !this.left && tick > this.pressAt + JUMP_HOLD_MAX_TICKS + ctx.stale.max + 2;
          if (stuck || tick > this.pressAt + BOT_RIDE_JUMP_FLIGHT_TICKS + ctx.stale.max + BOT_STALL_TICKS) {
            this.reset();
            return null;
          }
          if (this.left && self.grounded) {
            if (onTarget) return this.arrive(false, tick, target);
            // Down beside the floor it aimed for: for that floor (a bevel beside it is not floor).
            if (!jump) {
              const safe = target !== null ? transferAim(track, table, ride.exit, tick, clock) : ride.exit.still;
              return { moveDirection: unit(self.position, safe), dash: false, jump: false, committed: true };
            }
          }
          return { moveDirection: this.jumpHeading, dash: false, jump, committed: true };
        }
        if (tick < this.walkUntil) {
          const target = boarding ? moving.toWorld(platform, tick, clock, this.boardLocal!) : ride.exit.still;
          return { moveDirection: unit(self.position, target), dash: false, committed: true };
        }
        return this.arrive(boarding, tick, target);
      }
      case "aboard":
        return this.aboard(ctx, table, seenTick);
      case "landing": {
        // Down beside the still floor rather than on it — its centre off the navmesh, on the row's bevel — a Bot that stands
        // slides off (M17 ticket 07h, measured: two HARD Bots a hand's width past the beam's and the 4 × 4 row's side, standing
        // still at 4–7 u/s down the bevel). For the floor it aimed at, until it is on it.
        if (ride.exit.to === null && self.grounded && navFloorWithin(track.nav, self.position, { x: 0.05, y: BOT_RIDE_TOP_TOLERANCE_M, z: 0.05 }) === null) {
          if (tick - this.waitSince <= BOT_STALL_TICKS) return { moveDirection: unit(self.position, ride.exit.still), dash: false, committed: true };
        }
        if (!this.fresh(ctx, seenTick) && tick - this.waitSince <= ctx.stale.max + 10) return STAND;
        this.reset();
        return null;
      }
      default:
        return null;
    }
  }

  /** Boarded, or landed: on `landedOn` after a transfer (so a fresh stand is read against that deck), else on still floor. */
  private arrive(boarding: boolean, tick: number, landedOn: Platform | null): Steering {
    this.run = null;
    this.jumpHeading = null;
    this.boardLocal = null;
    this.state = boarding ? "aboard" : "landing";
    if (landedOn !== null) this.platform = landedOn;
    this.waitSince = tick;
    this.quiet = 0;
    return STAND;
  }

  /** Where the Bot leaves from, in the platform frame when aboard (its own seen spot), else in world (the still point it stands on). */
  private sourceLocal(ctx: HookContext, seenTick: number): Vec3 {
    if (this.state === "waitToBoard") return ctx.self.position;
    return ctx.view.track.moving.toLocal(this.platform!, seenTick, ctx.clock, ctx.self.position);
  }

  private depart(ctx: HookContext, table: RideTable, end: RideEnd, boarding: boolean, source: Vec3): Steering {
    const { tick, self, clock } = ctx;
    const { moving } = ctx.view.track;
    const platform = this.platform!;
    const deck = table.decks[platform.index]!;
    this.state = boarding ? "boarding" : "alighting";
    if (!end.jump) {
      if (boarding) {
        const local = moving.toLocal(platform, tick, clock, self.position);
        const rim = nearestRim(deck.hull, local).point;
        const at = insetToward(rim, deck.centroid, BOT_RIDE_RIM_INSET_M + BOT_RIDE_EXIT_INSET_M);
        this.boardLocal = { x: at.x, y: deck.y, z: at.z };
        this.walkUntil = tick + walkTicks(ground(local, this.boardLocal));
        return { moveDirection: unit(self.position, moving.toWorld(platform, tick, clock, this.boardLocal)), dash: false, committed: true };
      }
      const from = moving.toWorld(platform, tick, clock, source);
      this.walkUntil = tick + walkTicks(ground(from, end.still) + BOT_RIDE_EXIT_INSET_M);
      return { moveDirection: unit(self.position, end.still), dash: false, committed: true };
    }
    // Boarding, the run-up is a link's; alighting, it is from the Bot's own spot to the rim.
    const { direction, runUp } = boarding
      ? { direction: unit(self.position, moving.toWorld(platform, tick + JUMP_TICKS, clock, this.boardAim(deck, end))), runUp: JUMP_AT }
      : jumpOffEnd(ctx.view.track, table, deck, platform, source, end, tick, clock);
    // The Bot sets out from a fresh stand (`fresh`), so the run-up is a count of Ticks from here, as a link's replay is: read off
    // a view as late as `stale.max`, the press came where a stale view put it, a metre early from a near-stand or late over the edge
    // (measured on R1 at NORMAL and EASY: Falls at the lane's end, y 2.6, slid down its face).
    this.pressAt = tick + runTicks(runUp);
    this.left = false;
    if (boarding) {
      // From still floor there is no carry: `LinkRun` steers the line and lands it.
      this.run = new LinkRun({ from: self.position, direction, jumpAt: null, steerInAir: true, dash: false });
      this.jumpHeading = null;
      const step = this.run.step(self, false);
      return { moveDirection: step.moveDirection, dash: false, jump: false, committed: true };
    }
    // Off a deck the run is open-loop, one heading held from the stand to the landing (M17 ticket 07h): the line is aimed
    // upstream of the still by the carry the Character keeps, so the Bot is *meant* to drift off it, and `LinkRun` steering it
    // back onto the line on the deck and in the air undid part of that aim — the "kept less of the carry than modelled" 07e
    // measured (0.8–2.6 m along the carry) and, here, HARD landings 1–3 m off along a slide's axis. Held, the flight is the model's.
    this.run = null;
    this.jumpHeading = direction;
    return { moveDirection: direction, dash: false, jump: false, committed: true };
  }

  /** Whether another Character aboard stands within {@link BOT_LINK_QUEUE_M} of `aim` (platform frame), as both are seen at `seenTick`. */
  private landingTaken(ctx: HookContext, deck: RideDeck, aim: Vec3, seenTick: number): boolean {
    const { moving } = ctx.view.track;
    for (const [id, other] of Object.entries(ctx.view.characters)) {
      if (id === ctx.view.id || other.eliminated) continue;
      if (Math.abs(other.position.y - ctx.self.position.y) >= BOT_LINK_QUEUE_HEIGHT_M) continue;
      const local = moving.toLocal(this.platform!, seenTick, ctx.clock, other.position);
      if (Math.hypot(local.x - aim.x, local.z - aim.z) < BOT_LINK_QUEUE_M) return true;
    }
    return false;
  }

  /** Boarding: the world point of the rim the Bot's run heads for, at `tick`. */
  private rimAhead(ctx: HookContext, deck: RideDeck, source: Vec3): Vec3 {
    const { moving } = ctx.view.track;
    const rim = nearestRim(deck.hull, moving.toLocal(this.platform!, ctx.tick, ctx.clock, source)).point;
    return moving.toWorld(this.platform!, ctx.tick, ctx.clock, { x: rim.x, y: deck.y, z: rim.z });
  }

  /**
   * Whether another Character is nearer `dest` than this Bot and within
   * {@link BOT_LINK_QUEUE_M} of it, at its height: the links' `queueFor`
   * rule, so Bots board and alight one after another rather than all at
   * once (measured: twelve going on one window ran into each other at the
   * rim and the Bumps put them off it).
   */
  private someoneAhead(ctx: HookContext, dest: Vec3): boolean {
    const { self } = ctx;
    const mine = ground(self.position, dest);
    const line = unit(self.position, dest);
    for (const [id, other] of Object.entries(ctx.view.characters)) {
      if (id === ctx.view.id || other.eliminated) continue;
      if (Math.abs(other.position.y - self.position.y) >= BOT_LINK_QUEUE_HEIGHT_M) continue;
      if (ground(other.position, dest) < Math.min(mine, BOT_LINK_QUEUE_M)) return true;
      // Or ahead on the way there: every run to one end converges on it, so two set out a metre apart meet at the rim
      // (measured on the base race's first row: three Bots left within three Ticks of each other and Bumped at the take-off).
      const dx = other.position.x - self.position.x;
      const dz = other.position.z - self.position.z;
      const along = dx * line.x + dz * line.z;
      if (along > 0 && along < mine && Math.abs(dx * line.z - dz * line.x) < BOT_LINK_QUEUE_M) return true;
    }
    return false;
  }

  /** Aboard: to the exit's rim point, inset so a late view cannot overshoot; away from the rim when the Bot sees itself near it. */
  private aboard(ctx: HookContext, table: RideTable, seenTick: number): Steering | null {
    const { tick, self, clock } = ctx;
    const { moving } = ctx.view.track;
    const platform = this.platform!;
    const deck = table.decks[platform.index]!;
    if (moving.platformUnder(self.position, seenTick, clock) !== platform) {
      if (!self.grounded) {
        // Off the deck's top in the air, or lodged in it (measured on a turntable's seams): for the deck's middle. Still
        // lodged after a stall's worth of that (measured on R2: 300 Ticks in a lane's seam, never grounded), it presses
        // jump and works the other way every stall, since nothing else is left to try.
        if (tick - this.waitSince <= BOT_STALL_TICKS) return STAND;
        const centre = moving.toWorld(platform, tick, clock, { x: deck.centroid.x, y: deck.y, z: deck.centroid.z });
        const toward = unit(self.position, centre);
        const stalls = Math.floor((tick - this.waitSince) / BOT_STALL_TICKS);
        if (stalls < 2) return { moveDirection: toward, dash: false, committed: true };
        const back = stalls % 2 === 1;
        return { moveDirection: back ? vec3(-toward.x, 0, -toward.z) : toward, dash: false, jump: true, committed: true };
      }
      if (tick - this.waitSince > ctx.stale.max + 2) {
        this.reset();
        return null;
      }
      return STAND;
    }
    const seen = moving.toLocal(platform, seenTick, clock, self.position);
    const target = this.aboardTarget(ctx, table);
    const now = moving.toWorld(platform, tick, clock, seen);
    if (hullDistance(deck.hull, seen) > -(BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M)) {
      const centre = moving.toWorld(platform, tick, clock, { x: deck.centroid.x, y: deck.y, z: deck.centroid.z });
      return { moveDirection: unit(now, centre), dash: false, committed: true };
    }
    if (ground(seen, target) <= BOT_CORNER_REACHED_M) {
      this.state = "waitToAlight";
      this.waitSince = tick;
      this.quiet = 0;
      return STAND;
    }
    return this.unpinned(tick, self.position, { moveDirection: unit(now, moving.toWorld(platform, tick, clock, target)), dash: false, committed: true });
  }

  /**
   * A push aboard that gets the Bot nowhere for {@link BOT_STALL_TICKS} (a
   * capsule pinned in a deck's seam, measured on a turntable) gets a jump,
   * `PathFollower`'s own way out of a pin.
   */
  private unpinned(tick: number, position: Vec3, steering: Steering): Steering {
    if (tick < this.hopUntil) return { ...steering, jump: true };
    if (this.stalledAt === null || ground(position, this.stalledAt) > BOT_STALL_MOVE_M) {
      this.stalledAt = position;
      this.stalledSince = tick;
    } else if (tick - this.stalledSince >= BOT_STALL_TICKS) {
      this.stalledAt = null;
      this.hopUntil = tick + JUMP_HOLD_MAX_TICKS;
      return { ...steering, jump: true };
    }
    return steering;
  }

  /**
   * Where this Bot waits to alight: the exit's rim point inset so a late view
   * cannot overshoot, then spread by its seed across the rim and back from it
   * (up to {@link BOT_RIDE_SPREAD_M} each way), kept inside the outline by the
   * edge margin. Twelve Bots on one point shoved each other off (measured).
   */
  private aboardTarget(ctx: HookContext, table: RideTable): Vec3 {
    const deck = table.decks[this.platform!.index]!;
    const exit = this.ride!.exit;
    const lag = ctx.stale.max * WALK_SPEED * TICK_DT;
    const base = insetToward(exit.local, deck.centroid, BOT_RIDE_EXIT_INSET_M + lag);
    const across = this.across * BOT_RIDE_SPREAD_M;
    const back = botDraw(this.seed, "ride spot back") * BOT_RIDE_SPREAD_M;
    let spot = { x: base.x - exit.outward.z * across - exit.outward.x * back, z: base.z + exit.outward.x * across - exit.outward.z * back };
    const margin = BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M + lag;
    while (hullDistance(deck.hull, spot) > -margin && Math.hypot(spot.x - deck.centroid.x, spot.z - deck.centroid.z) > RUNUP_STEP_M) {
      spot = insetToward(spot, deck.centroid, RUNUP_STEP_M);
    }
    return { x: spot.x, y: deck.y, z: spot.z };
  }

  /** Waiting to alight: stand, but keep off the rim. */
  private holdAboard(ctx: HookContext, table: RideTable, seenTick: number): Steering {
    const { tick, clock } = ctx;
    const { moving } = ctx.view.track;
    const platform = this.platform!;
    const deck = table.decks[platform.index]!;
    const seen = moving.toLocal(platform, seenTick, clock, ctx.self.position);
    if (hullDistance(deck.hull, seen) > -(BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M)) {
      const now = moving.toWorld(platform, tick, clock, seen);
      const centre = moving.toWorld(platform, tick, clock, { x: deck.centroid.x, y: deck.y, z: deck.centroid.z });
      this.quiet = 0;
      return { moveDirection: unit(now, centre), dash: false, committed: true };
    }
    return STAND;
  }
}

/** Knocked onto `platform` with no ride planned: the first ride of the way to `goal` from aboard, else the nearest way off the deck. */
const exitFrom = (table: RideTable, platform: Platform, from: Vec3, goal: Vec3): RideLink | null => {
  const first = dijkstra(table, platform, from, goal)?.rides[0];
  if (first !== undefined) return table.links[first]!;
  let best: RideLink | null = null;
  for (const link of table.links) {
    if (link.exit.platform !== platform.index) continue;
    if (best === null || ground(from, link.exit.still) < ground(from, best.exit.still)) best = link;
  }
  return best;
};

/**
 * Whether `end` is open for a Bot leaving from `source` at `at`, and still
 * open `errorTicks` either side of it (its own misjudgement, a deck about
 * to reverse under it being the measured way to land short): every Tick of
 * the crossing sees the rim within reach. A walk needs the deck's edge
 * within {@link BOT_RIDE_WALK_GAP_M} of the still floor the whole walk; a
 * jump needs where it lands on floor (the deck, inset, when boarding), its
 * take-off on floor, and the rim not coming at the Bot faster than
 * {@link BOT_RIDE_BOARD_SPEED}. `aim` is the deck point boarded to (platform
 * frame) or the still point alighted to (world).
 */
const contact = (track: BotTrack, table: RideTable, deck: RideDeck, platform: Platform, end: RideEnd, aim: Vec3, source: Vec3, at: number, errorTicks: number, clock: MotionClock): boolean => {
  // One-sided: a Bot only ever executes late (a stumble, a late view), never early. Asked either side, NORMAL and EASY waited for a
  // window twice their error wide, crowded the wait and shoved (measured, R2 EASY: 51 contact Falls at the lane's end).
  for (const t of errorTicks > 0 ? [at, at + errorTicks] : [at]) {
    if (score(track, table, deck, platform, end, aim, source, t, clock) > 0) return false;
  }
  return true;
};

/** The least a jump's line may agree with the straight way to its still point (cos 45°): more upstream than that and the deck is moving too fast under it to land by this model. */
const AIM_COS_MIN = Math.SQRT1_2;

/** How far from open `end` is at `at` (≤ 0: open); boarding when `end` is a link's entry (`aim` on the deck), else alighting. */
const score = (track: BotTrack, table: RideTable, deck: RideDeck, platform: Platform, end: RideEnd, aim: Vec3, source: Vec3, at: number, clock: MotionClock): number => {
  const { moving, nav } = track;
  const body = platform.bodies[0]!.index;
  const boarding = aim !== end.still;
  if (boarding) {
    // The rim facing the Bot must not come at it fast.
    const here = moving.toLocal(platform, at, clock, source);
    const rim = nearestRim(deck.hull, here);
    const rimWorld = moving.toWorld(platform, at, clock, { x: rim.point.x, y: deck.y, z: rim.point.z });
    const v = moving.velocityAt(body, at, clock, rimWorld);
    const toward = unit(rimWorld, source);
    const shove = v.x * toward.x + v.z * toward.z - BOT_RIDE_BOARD_SPEED;
    if (!end.jump) {
      const ticks = walkTicks(Math.max(0, hullDistance(deck.hull, here)) + BOT_RIDE_RIM_INSET_M + BOT_RIDE_EXIT_INSET_M);
      let worst = shove;
      for (let k = 0; k <= ticks; k += 1) worst = Math.max(worst, hullDistance(deck.hull, moving.toLocal(platform, at + k, clock, source)) - BOT_RIDE_WALK_GAP_M);
      return worst;
    }
    const dir = unit(source, moving.toWorld(platform, at + JUMP_TICKS, clock, aim));
    const lands = { x: source.x + dir.x * JUMP_LANDS_M, y: source.y, z: source.z + dir.z * JUMP_LANDS_M };
    let worst = shove;
    // Landing, and a few Ticks after, on the deck with a margin.
    for (const k of [0, 3]) {
      const local = moving.toLocal(platform, at + JUMP_TICKS + k, clock, lands);
      worst = Math.max(worst, hullDistance(deck.hull, local) + BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M);
    }
    return worst;
  }
  // Alighting: from the Bot's own spot on the deck (platform frame).
  if (!end.jump) {
    const from = moving.toWorld(platform, at, clock, source);
    let worst = -Infinity;
    const ticks = walkTicks(ground(from, end.still));
    for (let k = 0; k <= ticks; k += 1) {
      worst = Math.max(worst, hullDistance(deck.hull, moving.toLocal(platform, at + k, clock, end.still)) - BOT_RIDE_WALK_GAP_M);
    }
    return worst;
  }
  if (end.to !== null) return transferScore(track, table, deck, platform, end, source, at, clock);
  const jump = jumpOff(track, deck, platform, source, end.still, at, clock);
  // The line must still be roughly at the still point: a deck fast enough to turn it further is not one to jump off now.
  const straight = unit(moving.toWorld(platform, at, clock, source), end.still);
  if (straight.x * jump.direction.x + straight.z * jump.direction.z < AIM_COS_MIN) return 1;
  // Take-off on the deck, as the deck will be then (the run-up may have hit its cap short of the rim).
  const takeOffGap = hullDistance(deck.hull, moving.toLocal(platform, at + jump.runTicks, clock, jump.takeOff)) + BOT_RIDE_RIM_INSET_M / 2;
  // Landing on still floor with the rim inset either way along the line, and a share of the carry the model may be wrong by
  // either way along the *carry* (M17 ticket 07h; as `transferScore` has it): a slide row's carry is across the lane, and the
  // landings that missed did so across it — a metre wide onto the beam's bevel, 0.95 wide onto the 4 × 4 row's, 3.9 at a 45° aim
  // (measured, base leg 2, every step-off left after the spot walk was fixed). Probed along the line, the beam read as floor.
  const flight = BOT_RIDE_JUMP_FLIGHT_TICKS * TICK_DT;
  const carry = Math.hypot(jump.carry.x, jump.carry.z);
  const box = { x: 0.5, y: BOT_RIDE_TOP_TOLERANCE_M, z: 0.5 };
  let landGap = 0;
  for (const along of [-BOT_RIDE_RIM_INSET_M, 0, BOT_RIDE_RIM_INSET_M]) {
    const p = { x: jump.lands.x + jump.direction.x * along, y: jump.lands.y, z: jump.lands.z + jump.direction.z * along };
    if (navFloorWithin(nav, p, box) === null) landGap = 1;
  }
  if (carry > 0) {
    const err = BOT_RIDE_CARRY_MARGIN * carry * flight;
    for (const along of [-err, err]) {
      const p = { x: jump.lands.x + (jump.carry.x / carry) * along, y: jump.lands.y, z: jump.lands.z + (jump.carry.z / carry) * along };
      if (navFloorWithin(nav, p, box) === null) landGap = 1;
    }
  }
  return Math.max(takeOffGap, landGap, ground(jump.takeOff, end.still) - (BOT_RIDE_JUMP_REACH_M + BOT_LINK_RUNUP_M));
};

/**
 * How far from open a transfer is at `at` (M17 ticket 07e): the jump off
 * this deck must take off on it and come down inside the other deck's
 * outline (as that deck will be then, and a few Ticks after) by the edge
 * margin and the rim inset, still on it either way along the carry by the
 * share of it the model may be wrong by, and the other rim must not be
 * coming at the landing fast.
 */
const transferScore = (track: BotTrack, table: RideTable, deck: RideDeck, platform: Platform, end: RideEnd, source: Vec3, at: number, clock: MotionClock): number => {
  const { moving } = track;
  const target = moving.platforms[end.to!.platform]!;
  const deckTo = table.decks[target.index]!;
  const jump = jumpOffEnd(track, table, deck, platform, source, end, at, clock);
  const straight = unit(moving.toWorld(platform, at, clock, source), transferAim(track, table, end, jump.landTick, clock));
  if (straight.x * jump.direction.x + straight.z * jump.direction.z < AIM_COS_MIN) return 1;
  const takeOffGap = hullDistance(deck.hull, moving.toLocal(platform, at + jump.runTicks, clock, jump.takeOff)) + BOT_RIDE_RIM_INSET_M / 2;
  let landGap = -Infinity;
  for (const k of [0, 3]) {
    landGap = Math.max(landGap, hullDistance(deckTo.hull, moving.toLocal(target, jump.landTick + k, clock, jump.lands)) + BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M);
  }
  const carry = Math.hypot(jump.carry.x, jump.carry.z);
  if (carry > 0) {
    const err = BOT_RIDE_CARRY_MARGIN * carry * BOT_RIDE_JUMP_FLIGHT_TICKS * TICK_DT;
    for (const along of [-err, err]) {
      const p = { x: jump.lands.x + (jump.carry.x / carry) * along, y: jump.lands.y, z: jump.lands.z + (jump.carry.z / carry) * along };
      landGap = Math.max(landGap, hullDistance(deckTo.hull, moving.toLocal(target, jump.landTick, clock, p)));
    }
  }
  const rim = nearestRim(deckTo.hull, moving.toLocal(target, jump.landTick, clock, jump.lands));
  const rimWorld = moving.toWorld(target, jump.landTick, clock, { x: rim.point.x, y: deckTo.y, z: rim.point.z });
  const v = moving.velocityAt(target.bodies[0]!.index, jump.landTick, clock, rimWorld);
  const toward = unit(rimWorld, jump.takeOff);
  const shove = v.x * toward.x + v.z * toward.z - BOT_RIDE_BOARD_SPEED;
  return Math.max(takeOffGap, landGap, shove);
};

/** A wait that gave up: the Tick in the next cycle where the end is nearest open. */
const bestPass = (track: BotTrack, table: RideTable, deck: RideDeck, platform: Platform, end: RideEnd, aim: Vec3, source: Vec3, tick: number, clock: MotionClock): number => {
  let best = tick;
  let bestScore = Infinity;
  for (let t = tick; t < tick + platform.periodTicks; t += 1) {
    const s = score(track, table, deck, platform, end, aim, source, t, clock);
    if (s < bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
};

/**
 * The cheapest way from `from` to `goal` through rides (Dijkstra). Nodes are
 * `from`, `goal` and every end's still; edges are navmesh walks (cached per
 * pair for the Track) and rides (`BOT_RIDE_COST_M` plus the hull crossed plus
 * the wait at the exit plus `queue(entry)`, the Bots already waiting at a
 * still entry, M17 ticket 07d).
 * From aboard, the start edges are that platform's exits at no cost.
 */
const dijkstra = (table: RideTable, aboard: Platform | null, from: Vec3, goal: Vec3, queue: (entry: RideEnd) => number = () => 0): Across | null => {
  const { ends, links } = table;
  const n = ends.length;
  const FROM = n;
  const GOAL = n + 1;
  const dist = new Array<number>(n + 2).fill(Infinity);
  const via = new Array<{ node: number; ride: number | null } | null>(n + 2).fill(null);
  const rides = new Array<number>(n + 2).fill(0);
  const done = new Array<boolean>(n + 2).fill(false);
  const index = new Map<RideEnd, number>(ends.map((end, i) => [end, i]));
  const goalComponent = table.componentOf(goal);
  const fromComponent = aboard === null ? table.componentOf(from) : -2;
  dist[FROM] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i += 1) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === GOAL) break;
    done[u] = true;
    const relax = (v: number, cost: number, ride: number | null): void => {
      const count = rides[u]! + (ride === null ? 0 : 1);
      if (count > BOT_RIDE_CHAIN_MAX) return;
      if (dist[u]! + cost < dist[v]!) {
        dist[v] = dist[u]! + cost;
        via[v] = { node: u, ride };
        rides[v] = count;
      }
    };
    if (u === FROM) {
      if (aboard !== null) {
        links.forEach((link, k) => {
          if (link.exit.platform === aboard.index) relax(index.get(link.exit)!, 0, k);
        });
      } else {
        ends.forEach((end, i) => {
          if (table.component[i] !== fromComponent) return;
          const length = table.walk(from, end.still);
          if (length !== null) relax(i, length, null);
        });
      }
      continue;
    }
    const end = ends[u]!;
    const component = table.component[u];
    // A transfer (M17 ticket 07e): across to the end this one meets on the other platform, a jump's cost.
    if (component === TRANSFER_COMPONENT) {
      const other = table.mirror[u]!;
      if (other >= 0 && !done[other]) relax(other, BOT_RIDE_COST_M, null);
    } else {
      // Walks from here, on the same still floor.
      ends.forEach((other, i) => {
        if (i === u || table.component[i] !== component || done[i]) return;
        const length = table.walk(end.still, other.still);
        if (length !== null) relax(i, length, null);
      });
    }
    if (component === goalComponent) {
      const length = table.walk(end.still, goal);
      if (length !== null) relax(GOAL, length, null);
    }
    // Rides from here.
    links.forEach((link, k) => {
      if (link.entry !== end) return;
      relax(index.get(link.exit)!, BOT_RIDE_COST_M + link.across + link.wait + queue(link.entry), k);
    });
  }
  if (dist[GOAL] === Infinity) return null;
  const chain: number[] = [];
  for (let v = GOAL; v !== FROM; v = via[v]!.node) {
    const ride = via[v]!.ride;
    if (ride !== null) chain.unshift(ride);
  }
  if (chain.length === 0) return null;
  return { rides: chain };
};

/** The path's corners for a chain of rides: walks between the rides, each ride's entry corner marked. */
const compose = (track: BotTrack, table: RideTable, aboard: Platform | null, from: Vec3, goal: Vec3, across: Across): NavCorner[] | null => {
  const { nav } = track;
  const out: NavCorner[] = [];
  const push = (corners: readonly NavCorner[] | null, skipFirst: boolean): boolean => {
    if (corners === null) return false;
    for (let i = skipFirst ? 1 : 0; i < corners.length; i += 1) out.push(corners[i]!);
    return true;
  };
  let at: Vec3 = from;
  across.rides.forEach((k, i) => {
    const link = table.links[k]!;
    if (i === 0 && aboard !== null) {
      out.push({ point: from, link: null, ride: k });
    } else if (i > 0 && table.links[across.rides[i - 1]!]!.exit.to !== null) {
      // After a transfer: no walk joins the two decks; the ride starts where the Bot lands.
      out.push({ point: link.entry.still, link: null, ride: k });
    } else {
      if (!push(navCorners(nav, at, link.entry.still), out.length > 0)) out.push({ point: link.entry.still, link: null });
      const last = out[out.length - 1]!;
      if (ground(last.point, link.entry.still) < 0.1) out[out.length - 1] = { point: link.entry.still, link: null, ride: k };
      else out.push({ point: link.entry.still, link: null, ride: k });
    }
    out.push({ point: link.exit.still, link: null });
    at = link.exit.still;
  });
  push(navCorners(nav, at, goal), true);
  return out;
};

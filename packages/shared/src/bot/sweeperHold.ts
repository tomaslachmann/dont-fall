import { vec3, type Vec3 } from "../math/vec3.js";
import { surfaceConfig } from "../track/Surface.js";
import {
  BOT_BRAKE_MIN_SPEED,
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
import { CAPSULE_RADIUS, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { corridorAhead, type HoldHook, type HookContext } from "./hooks.js";
import type { MovingBody, MovingWorld, Platform } from "./movingWorld.js";
import { navSurfaceAt } from "./navMesh.js";
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
 */

type Decision = "go" | "hold" | "retreat";

const STAND: Steering = { moveDirection: vec3(), dash: false };

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
    }
    // Never forever: a hold that has lasted its cap goes, and holds nothing for a while.
    if (this.heldCorner !== null && this.progressed(ctx, this.heldCorner)) {
      this.heldSince = null;
      this.heldCorner = null;
    }
    if (this.heldSince !== null && tick - this.heldSince >= this.holdCap()) {
      SweeperHold.gaveUp += 1;
      this.goUntil = tick + BOT_HOLD_GO_TICKS;
      this.end();
      return steering;
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
    const counts = (body: MovingBody, at: number, p: Vec3): boolean => {
      if (!moving.solidAt(body.index, at, view.fragile)) return false;
      if (body.spiked) return true;
      const v = moving.velocityAt(body.index, at, clock, p);
      return Math.hypot(v.x, v.y, v.z) > BOT_HOLD_MIN_SPEED;
    };
    // On a moving deck the Bot is carried: a sample it will reach is where the deck takes it by then (07g).
    const deck: Platform | null = self.grounded ? moving.platformUnder(self.position, tick, clock) : null;
    const carried = (p: Vec3, at: number): Vec3 => (deck === null ? p : moving.toWorld(deck, at, clock, moving.toLocal(deck, tick, clock, p)));
    // The first sample a counting body occupies when the Bot gets there, and how far along the path it is.
    let blockedAt = -1;
    for (let i = 0; i < samples.length; i += 1) {
      const { p, arriveTick } = samples[i]!;
      if (arriveTick - tick > look) break;
      const at = arriveTick + jitter;
      const q = carried(p, at);
      if (near.some((body) => moving.occupies(body.index, at, clock, q, grow) && counts(body, at, q))) {
        blockedAt = i;
        break;
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

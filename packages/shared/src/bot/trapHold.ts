import { conjugateQuat } from "../math/quat.js";
import { rotateVec3ByQuat, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { surfaceConfig } from "../track/Surface.js";
import { shooterLifeTicks, shooterMuzzleAt, shooterPeriodTicks } from "../track/Shooter.js";
import {
  BOT_BRAKE_MIN_SPEED,
  BOT_FRAGILE_WAIT_MAX_TICKS,
  BOT_HOLD_DECIDE_TICKS,
  BOT_HOLD_GO_TICKS,
  BOT_HOLD_LOOK_M,
  BOT_HOLD_MARGIN_M,
  BOT_HOLD_MAX_TICKS,
  BOT_HOLD_SAMPLE_M,
  BOT_LEG_JOINED_M,
  BOT_SHOOTER_WATCH_M,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS, GRAVITY_Y } from "../tuning/character.js";
import { TICK_DT, TICK_RATE_HZ } from "../tuning/clock.js";
import { corridorAhead, type HoldHook, type HookContext, type PathHooks } from "./hooks.js";
import type { MovingBody } from "./movingWorld.js";
import { EDGE_STRIP_FLAG, LAST_CRACK_FLAG, navCorners, navFilterFor, navSurfaceAt } from "./navMesh.js";
import type { Steering } from "./PathBot.js";
import type { BotProfile } from "./profile.js";
import { botDraw } from "./random.js";

/*
 * Traps (M17 ticket 07f): a trap door crossed only while shut (ADR 0117), a
 * Shooter's line of fire crossed between shots (ADR 0119), and a fragile
 * block not stepped on at its last crack (ADR 0118). A trap door and a
 * Shooter are pure functions of the Tick, so "will this stretch of my path be
 * a floor / clear of a ball while I am on it" has an exact answer; a fragile
 * block's state is the Snapshot's, read off the Bot's (delayed) view. A glove
 * is a sweeper, 07a's `SweeperHold`'s.
 *
 * Every hold here is a stand, never a retreat (a hole does not come to you),
 * never committed (the guard still vets it), and never forever (a cap).
 */

const STAND: Steering = { moveDirection: vec3(), dash: false };

/** A stand, or on a slick floor a push against the drift until it is too slow to hurt (as `PathFollower.brake`). */
const standFor = (ctx: HookContext): Steering => {
  const { self, view } = ctx;
  if (surfaceConfig(navSurfaceAt(view.track.nav, self.position) ?? undefined).grip >= 1) return STAND;
  const speed = Math.hypot(self.velocity.x, self.velocity.z);
  if (speed < BOT_BRAKE_MIN_SPEED) return STAND;
  return { moveDirection: vec3(-self.velocity.x / speed, 0, -self.velocity.z / speed), dash: false };
};

/** How many Ticks ahead a trap is asked about: the Bot's look-ahead, plus as late as it sees itself and one decision's gap, so it can stop before it. */
const horizonOf = (ctx: HookContext): number => ctx.profile.lookAheadTicks + ctx.stale.max + BOT_HOLD_DECIDE_TICKS;

/**
 * The sweeper hold's shape (07a) for a trap: decide every
 * {@link BOT_HOLD_DECIDE_TICKS}, repeat the decision between, one timing draw
 * a decision, and a cap of {@link BOT_HOLD_MAX_TICKS} after which it goes and
 * holds nothing for {@link BOT_HOLD_GO_TICKS}.
 */
abstract class TimedHold implements HoldHook {
  /** Every hold that hit its cap and went anyway, over all Bots and every trap hold: logged by the suite. */
  static gaveUp = 0;

  private holding = false;
  private decidedAt = Number.NEGATIVE_INFINITY;
  private lastTick = Number.NEGATIVE_INFINITY;
  private heldSince: number | null = null;
  private goUntil = Number.NEGATIVE_INFINITY;

  constructor(
    protected readonly profile: BotProfile,
    protected readonly seed: string,
    private readonly name: string,
  ) {}

  /** Whether the next stretch of path is unsafe to go on now, with the Bot's timing off by `jitter` Ticks. */
  protected abstract blocked(ctx: HookContext, jitter: number): boolean;

  hold(ctx: HookContext, steering: Steering): Steering {
    if (steering.committed === true) return steering;
    const { tick } = ctx;
    if (tick !== this.lastTick + 1) {
      this.holding = false;
      this.heldSince = null;
      this.decidedAt = Number.NEGATIVE_INFINITY;
    }
    this.lastTick = tick;
    if (this.heldSince !== null && tick - this.heldSince >= BOT_HOLD_MAX_TICKS) {
      TimedHold.gaveUp += 1;
      this.goUntil = tick + BOT_HOLD_GO_TICKS;
      this.holding = false;
      this.heldSince = null;
      return steering;
    }
    if (tick < this.goUntil) return steering;
    if (tick - this.decidedAt >= BOT_HOLD_DECIDE_TICKS) {
      this.decidedAt = tick;
      const jitter = Math.round((2 * botDraw(this.seed, `${this.name} ${tick}`) - 1) * this.profile.timingErrorTicks);
      this.holding = this.blocked(ctx, jitter);
      if (!this.holding) this.heldSince = null;
      else this.heldSince ??= tick;
    }
    return this.holding ? standFor(ctx) : steering;
  }
}

/** Whether world point `p` lies over `body`'s footprint at its rest pose, grown by `grow` across (the y is not asked: a sample's is between floor and capsule centre). */
const overRest = (body: MovingBody, p: Vec3, grow: number): boolean => {
  const { position, orientation } = body.config;
  const local = rotateVec3ByQuat(subVec3(p, position), conjugateQuat(orientation));
  for (const h of body.hitboxes) {
    const dx = local.x - h.cx;
    const dz = local.z - h.cz;
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    if (Math.abs(dx * c + dz * s) <= h.hx + grow && Math.abs(-dx * s + dz * c) <= h.hz + grow) return true;
  }
  return false;
};

/**
 * A trap door (ADR 0117): open is a hole. A Bot steps onto a leaf only when
 * it is shut from the Tick the Bot reaches it until the Tick it is past it,
 * and holds on the still floor before it otherwise. On a leaf already it goes
 * on: a hole does not come to you, and standing on a leaf is what drops you.
 */
export class TrapDoorHold extends TimedHold {
  constructor(profile: BotProfile, seed: string) {
    super(profile, seed, "trap door");
  }

  protected blocked(ctx: HookContext, jitter: number): boolean {
    const { moving } = ctx.view.track;
    if (moving.gates.length === 0) return false;
    const self = ctx.self.position;
    if (moving.gates.some((leaf) => overRest(leaf, self, 0))) return false;
    const horizon = horizonOf(ctx);
    const samples = corridorAhead(ctx, BOT_HOLD_LOOK_M, BOT_HOLD_SAMPLE_M);
    for (const leaf of moving.gates) {
      let entry: number | null = null;
      let exit: number | null = null;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i]!;
        const inside = overRest(leaf, sample.p, CAPSULE_RADIUS);
        if (inside && entry === null) entry = sample.arriveTick;
        if (inside) exit = samples[i + 1]?.arriveTick ?? sample.arriveTick + 1;
        else if (entry !== null) break;
      }
      if (entry === null || exit === null || entry - ctx.tick > horizon) continue;
      // From as early as the Bot may really be there (it sees itself late) until it is past.
      for (let t = entry - ctx.stale.max + jitter; t <= exit + jitter; t += 1) {
        if (!moving.solidAt(leaf.index, t, undefined)) return true;
      }
    }
    return false;
  }
}

/**
 * A Shooter's line of fire (ADR 0119): every shot is a pure function of the
 * Tick, so where each ball in the air will be is predicted, not read off the
 * Snapshot. A sample is blocked when a shot will be within its radius, the
 * capsule's and {@link BOT_HOLD_MARGIN_M} of it while the Bot is there.
 * A ball that has reached the floor is taken as rolling along it.
 */
export class ShooterLaneHold extends TimedHold {
  constructor(profile: BotProfile, seed: string) {
    super(profile, seed, "shooter");
  }

  protected blocked(ctx: HookContext, jitter: number): boolean {
    const { shooters } = ctx.view.track.resolved;
    if (shooters.length === 0) return false;
    const self = ctx.self.position;
    const watched = shooters.filter(({ aim }) => {
      const muzzle = shooterMuzzleAt(aim, ctx.tick).position;
      return Math.hypot(muzzle.x - self.x, muzzle.y - self.y, muzzle.z - self.z) <= BOT_SHOOTER_WATCH_M;
    });
    if (watched.length === 0) return false;
    const horizon = horizonOf(ctx);
    const samples = corridorAhead(ctx, BOT_HOLD_LOOK_M, BOT_HOLD_SAMPLE_M);
    this.muzzles.clear();
    let here = true;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i]!;
      if (sample.arriveTick - ctx.tick > horizon) break;
      const until = samples[i + 1]?.arriveTick ?? sample.arriveTick + 1;
      // From as early as the Bot may really be there until it reaches the next sample.
      const from = sample.arriveTick - (here ? 0 : ctx.stale.max);
      for (const { aim } of watched) {
        if (this.shotNear(aim, sample.p, from + jitter, until + jitter)) {
          // In the line of fire already: standing there is the one thing sure to be hit.
          return !here;
        }
      }
      here = false;
    }
    return false;
  }

  /** Each shot's muzzle for one decision, by Shooter and firing Tick: `shooterMuzzleAt` poses the aim chain, and a decision asks each shot many times. */
  private readonly muzzles = new Map<string, ReturnType<typeof shooterMuzzleAt>>();

  private muzzleAt(aim: Parameters<typeof shooterMuzzleAt>[0], t0: number): ReturnType<typeof shooterMuzzleAt> {
    const key = `${aim.position.x},${aim.position.z}:${t0}`;
    let muzzle = this.muzzles.get(key);
    if (muzzle === undefined) {
      muzzle = shooterMuzzleAt(aim, t0);
      this.muzzles.set(key, muzzle);
    }
    return muzzle;
  }

  private shotNear(aim: Parameters<typeof shooterMuzzleAt>[0], p: Vec3, from: number, until: number): boolean {
    const { def } = aim;
    const period = shooterPeriodTicks(def);
    const life = shooterLifeTicks(def);
    const reach = def.radius * aim.scale + CAPSULE_RADIUS + BOT_HOLD_MARGIN_M;
    for (let t = from; t <= until; t += 1) {
      const first = Math.max(0, Math.ceil((t - life + 1) / period));
      for (let shot = first; shot * period <= t; shot += 1) {
        const t0 = shot * period;
        const seconds = (t - t0) * TICK_DT;
        const muzzle = this.muzzleAt(aim, t0);
        const x = muzzle.position.x + muzzle.direction.x * def.speed * seconds;
        const z = muzzle.position.z + muzzle.direction.z * def.speed * seconds;
        // A Prop falls: a ball over the capsule's head passes; one that has reached the floor rolls on along it.
        const y = muzzle.position.y + muzzle.direction.y * def.speed * seconds + 0.5 * GRAVITY_Y * seconds * seconds;
        if (y > p.y + 2 * CAPSULE_BOTTOM_OFFSET + reach) continue;
        if (Math.hypot(x - p.x, z - p.z) <= reach) return true;
      }
    }
    return false;
  }
}

/** Ticks a Bot waits at a last-crack block that is its only way before it goes anyway: the block's own return time, and {@link BOT_FRAGILE_WAIT_MAX_TICKS} on top. */
const fragileWaitTicks = (body: MovingBody): number => Math.round(body.config.fragile!.returnSeconds * TICK_RATE_HZ) + BOT_FRAGILE_WAIT_MAX_TICKS;

/**
 * A fragile block at its last crack (ADR 0118): every arrival costs a state,
 * so the next Bot onto it breaks it. The first plan already keeps off it
 * ({@link trapPlanFilterFlags}); a Bot whose plan still crosses it stands:
 * for at most a replan when there is a way round, and when there is not,
 * until it returns intact or the block's return time and
 * {@link BOT_FRAGILE_WAIT_MAX_TICKS} have passed, then it goes.
 */
export class FragileHold implements HoldHook {
  /** Every wait that ran out and went onto a last-crack block anyway, over all Bots: logged by the suite. */
  static gaveUp = 0;

  private waitingFor: number | null = null;
  private waitingSince = 0;
  private lastTick = Number.NEGATIVE_INFINITY;
  private goOnto: number | null = null;

  hold(ctx: HookContext, steering: Steering): Steering {
    if (steering.committed === true) return steering;
    const { moving, nav } = ctx.view.track;
    if (moving.fragile.length === 0) return steering;
    const { tick } = ctx;
    if (tick !== this.lastTick + 1) this.waitingFor = null;
    this.lastTick = tick;
    const self = ctx.self.position;
    const ahead = this.lastCrackAhead(ctx);
    if (ahead === null || overRest(ahead, self, 0)) {
      this.waitingFor = null;
      if (ahead === null) this.goOnto = null;
      return steering;
    }
    const segment = ahead.config.segmentIndex;
    if (this.goOnto === segment) return steering;
    if (this.waitingFor !== segment) {
      this.waitingFor = segment;
      this.waitingSince = tick;
    }
    // A way round: stand until the next plan takes it.
    const end = ctx.path[ctx.path.length - 1]?.point;
    if (end !== undefined) {
      const round = navCorners(nav, self, end, navFilterFor(nav, EDGE_STRIP_FLAG | LAST_CRACK_FLAG))?.at(-1)?.point;
      if (round !== undefined && Math.hypot(round.x - end.x, round.z - end.z) <= BOT_LEG_JOINED_M) return standFor(ctx);
    }
    // The only way: wait for it to come back intact, never forever.
    if (tick - this.waitingSince >= fragileWaitTicks(ahead)) {
      FragileHold.gaveUp += 1;
      this.goOnto = segment;
      this.waitingFor = null;
      return steering;
    }
    return standFor(ctx);
  }

  /** The first last-crack block the next stretch of path steps onto within the Bot's horizon, as its view has it. */
  private lastCrackAhead(ctx: HookContext): MovingBody | null {
    const { moving } = ctx.view.track;
    const cracked = moving.fragile.filter((body) => {
      const row = ctx.view.fragile?.find((r) => r.segmentIndex === body.config.segmentIndex);
      return row !== undefined && row.hits === body.config.fragile!.entries - 1;
    });
    if (cracked.length === 0) return null;
    const horizon = horizonOf(ctx);
    for (const sample of corridorAhead(ctx, BOT_HOLD_LOOK_M, BOT_HOLD_SAMPLE_M)) {
      if (sample.arriveTick - ctx.tick > horizon) break;
      const onto = cracked.find((body) => overRest(body, sample.p, CAPSULE_RADIUS));
      if (onto !== undefined) return onto;
    }
    return null;
  }
}

/** 07f's holds, in `defaultHooks`' order. */
export const trapHolds = (profile: BotProfile, seed: string): HoldHook[] => [
  new TrapDoorHold(profile, seed),
  new ShooterLaneHold(profile, seed),
  new FragileHold(),
];

/** The first plan keeps off a fragile block at its last crack; the never-stranded second plan still crosses it when it is the only way. */
export const trapPlanFilterFlags: NonNullable<PathHooks["planFilterFlags"]> = () => LAST_CRACK_FLAG;

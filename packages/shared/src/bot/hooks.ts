import type { Vec3 } from "../math/vec3.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import type { MotionClock } from "../track/Motion.js";
import { surfaceConfig } from "../track/Surface.js";
import { BOT_BELT_MIN_OWN_SPEED } from "../tuning/bots.js";
import { WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import type { BotWorldView } from "./Bot.js";
import type { StaleWindow } from "./edgeGuard.js";
import { CROSS_SWATH_FLAG, navSurfaceAt, type NavCorner } from "./navMesh.js";
import type { Steering } from "./PathBot.js";
import type { BotProfile } from "./profile.js";
import { BeltPush, beltUnder } from "./belts.js";
import { DeckRider } from "./deckRider.js";
import { SweeperHold } from "./sweeperHold.js";
import { trapHolds, trapPlanFilterFlags } from "./trapHold.js";

/*
 * The seams M17 ticket 07's parts plug into (07a sweepers, 07b rides, 07c
 * belts, 07f traps). `PathFollower` calls them in a fixed order every Tick it
 * steers; with none registered its behaviour is exactly what it was. Each
 * part adds one line to {@link defaultHooks} and nothing else here.
 */

/** What every hook is handed for one Tick. */
export interface HookContext {
  /** The Tick the input is for; poses are exact at every Tick, only `self` is late. */
  readonly tick: number;
  /** `track.moving`, `runningFromTick`, `fragile`. */
  readonly view: BotWorldView;
  readonly self: Readonly<CharacterSnapshot>;
  /** The Motion Clock the poses are asked at: `view.runningFromTick`, or `null` before the Round runs. */
  readonly clock: MotionClock;
  /** `lookAheadTicks`, `timingErrorTicks`. */
  readonly profile: BotProfile;
  /** How late `self` may be (`EdgeGuard.stale`). */
  readonly stale: StaleWindow;
  /** For `botDraw` timing jitter. */
  readonly seed: string;
  readonly path: readonly NavCorner[];
  /** The corner being steered for. */
  readonly corner: number;
}

/** 07a, 07f: may replace a move with a stand, a retreat, or leave it. Applied in order; the first that changes the move wins. */
export interface HoldHook {
  hold(ctx: HookContext, steering: Steering): Steering;
}

/** 07b: owns the Bot while it boards, rides and alights. */
export interface RideHook {
  /** A path from `from` to `goal` through platforms, when the navmesh alone does not join them; null if none. Corners with `ride` set start a ride. */
  planAcross(ctx: Pick<HookContext, "view" | "seed">, from: Vec3, goal: Vec3): NavCorner[] | null;
  /** Non-null when the Bot is boarding, aboard or alighting: the whole Steering for this Tick (committed, so the guard and the other hooks leave it alone). */
  steer(ctx: HookContext): Steering | null;
}

/** 07c: bends the move for the floor's own flow and tells the guard the drift. */
export interface PushHook {
  compensate(ctx: HookContext, steering: Steering): Steering;
}

export interface PathHooks {
  hold?: readonly HoldHook[];
  ride?: RideHook;
  push?: PushHook;
  /** 07f: extra polygon flags the *first* plan excludes (`navFilterFor`); the never-stranded second plan drops them, as `plan()` already does for `EDGE_STRIP_FLAG`. */
  planFilterFlags?: (ctx: Pick<HookContext, "view">) => number;
}

/**
 * What `TreeBot` installs. One line per part is added here, nothing else;
 * both arguments are the Bot's own, for a hook that keeps state per Bot.
 */
export const defaultHooks = (profile: BotProfile, seed: string): PathHooks => {
  void profile;
  void seed;
  return {
    hold: [new SweeperHold(profile, seed), ...trapHolds(profile, seed)],
    // A first plan keeps beside a cross's swath where the lane has room (M17 ticket 07i, round 3).
    planFilterFlags: (ctx) => trapPlanFilterFlags(ctx) | CROSS_SWATH_FLAG,
    push: new BeltPush(),
    ride: new DeckRider(profile, seed),
  };
};

/**
 * Sample points along the Bot's next stretch of path, every `step` metres
 * up to `metres`, with the Tick it reaches each at its floor's walk speed
 * from where it sees itself (M17 ticket 07, read by 07a and 07f). The first
 * sample is where the Bot stands, at `tick`. Sampling stops at a link's
 * start: past it the Bot is in the air, on the link's own script. One loop
 * over corners, no allocation beyond the array. A belt under a sample adds
 * its flow along the path to the walk (M17 ticket 07g: on the base race's
 * belt climb a walk against a belt arrives a third later than a walk), and
 * sampling stops at a ride's start as at a link's — aboard, the Bot is the
 * rider's (07b).
 */
export const corridorAhead = (ctx: HookContext, metres: number, step: number): { p: Vec3; arriveTick: number }[] => {
  const { nav } = ctx.view.track;
  const out: { p: Vec3; arriveTick: number }[] = [];
  let from: Vec3 = ctx.self.position;
  let travelled = 0;
  let sampledAt = 0;
  let nextAt = 0;
  let ticks = 0;
  const sample = (p: Vec3, at: number, dx: number, dz: number, length: number): void => {
    let speed = WALK_SPEED * surfaceConfig(navSurfaceAt(nav, p) ?? undefined).topSpeedMultiplier;
    const belt = beltUnder(ctx.view.track, p);
    if (belt !== null && length > 0) speed = Math.max(BOT_BELT_MIN_OWN_SPEED, speed + (belt.x * dx + belt.z * dz) / length);
    ticks += (at - sampledAt) / (speed * TICK_DT);
    sampledAt = at;
    out.push({ p, arriveTick: ctx.tick + Math.round(ticks) });
  };
  for (let c = ctx.corner; c < ctx.path.length && nextAt <= metres; c += 1) {
    const corner = ctx.path[c]!;
    const to = corner.point;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    while (nextAt <= travelled + length && nextAt <= metres) {
      const t = length === 0 ? 0 : (nextAt - travelled) / length;
      sample({ x: from.x + dx * t, y: from.y + (to.y - from.y) * t, z: from.z + dz * t }, nextAt, dx, dz, length);
      nextAt += step;
    }
    travelled += length;
    from = to;
    if (corner.link !== null || corner.ride !== undefined) break;
  }
  return out;
};

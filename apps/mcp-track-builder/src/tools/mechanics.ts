import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CONVEYOR_SPEEDS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_RAMP_MS,
  DASH_SPEED,
  DEFAULT_KILL_PLANE_Y,
  GRAB_CARRY_SPEED_MULTIPLIER,
  GRAB_RANGE,
  GRAVITY_Y,
  HIT_CHARGE_MAX_MS,
  HIT_RANGE,
  HURL_MAX_SPEED,
  JUMP_HOLD_GRAVITY_SCALE,
  JUMP_HOLD_MAX_TICKS,
  JUMP_VELOCITY,
  LAUNCH_HEIGHT_MAX,
  LAUNCH_HEIGHT_MIN,
  SURFACES,
  TICK_DT,
  TICK_RATE_HZ,
  WALK_SPEED,
  WALKABLE_SLOPE_MAX_ANGLE,
  WALL_IMPACT_MIN_SPEED,
  WALL_NORMAL_MAX_Y,
  type SurfaceId,
} from "@dont-fall/shared";
import { jsonTool } from "../tools.js";

/**
 * What a Character can do, computed from `packages/shared/src/tuning/` at
 * call time (ADR 0114's discovery half, extended 2026-09-20).
 *
 * Deliberately not written into the skill's prose: these are *feel* numbers
 * the user tunes by playing, and a copy in a document is a number nobody
 * played — the Dash was authored at 15, recorded as 12 in an ADR, and is 9
 * in the file as this is written. Reading them here means an LLM places
 * geometry against whatever the simulation actually runs today, and a retune
 * reaches the authoring side with no second edit.
 */

const r2 = (n: number): number => Math.round(n * 100) / 100;
const deg = (radians: number): number => Math.round((radians * 180) / Math.PI);

/**
 * One jump integrated the way the simulation steps it — the fixed tick, the
 * held-jump gravity scale while rising — rather than the continuous-time
 * `v²/2g`, which the discrete step and the hold both make wrong.
 */
const flight = (takeoff: number, holdTicks: number): { apex: number; seconds: number } => {
  let velocity = takeoff;
  let height = 0;
  let apex = 0;
  let ticks = 0;
  while (ticks < 600) {
    const gravity = ticks < holdTicks && velocity > 0 ? GRAVITY_Y * JUMP_HOLD_GRAVITY_SCALE : GRAVITY_Y;
    velocity += gravity * TICK_DT;
    height += velocity * TICK_DT;
    ticks++;
    apex = Math.max(apex, height);
    if (height <= 0) break;
  }
  return { apex: r2(apex), seconds: r2(ticks * TICK_DT) };
};

/** A jump's reach: how high it gets, and how wide a gap it crosses at `speed`. */
interface Reach {
  apex: number;
  airtime: number;
  gap: number;
}

const reach = (takeoff: number, holdTicks: number, speed: number): Reach => {
  const { apex, seconds } = flight(takeoff, holdTicks);
  return { apex, airtime: seconds, gap: r2(seconds * speed) };
};

const surfaceRow = (surface: (typeof SURFACES)[SurfaceId]): Record<string, unknown> => {
  const jumpMultiplier = surface.jumpMultiplier ?? 1;
  const topSpeedMultiplier = surface.topSpeedMultiplier ?? 1;
  return {
    topSpeedMultiplier,
    topSpeed: r2(WALK_SPEED * topSpeedMultiplier),
    jumpMultiplier,
    jumpApex: flight(JUMP_VELOCITY * jumpMultiplier, JUMP_HOLD_MAX_TICKS).apex,
    grip: surface.grip,
    dash: surface.noDash === true ? "blocked" : "allowed",
    ...(surface.landingKnockdown ? { landingKnockdown: surface.landingKnockdown } : {}),
    ...(surface.crashKnockdown ? { crashKnockdown: surface.crashKnockdown } : {}),
    ...(surface.runningSlip ? { runningSlip: surface.runningSlip } : {}),
    ...(surface.bounce ? { bounce: surface.bounce } : {}),
  };
};

export const characterMechanics = (): Record<string, unknown> => {
  const tap = reach(JUMP_VELOCITY, 0, WALK_SPEED);
  const held = reach(JUMP_VELOCITY, JUMP_HOLD_MAX_TICKS, WALK_SPEED);
  return {
    note:
      "Computed from packages/shared/src/tuning/ at call time — the same constants the simulation runs. " +
      "Feel values are tuned by playing, so read them here rather than trusting any number written in prose.",
    units: "1 unit = 1 metre; speeds are units/s; the simulation steps at a fixed tick.",
    tickRateHz: TICK_RATE_HZ,
    walk: { speed: WALK_SPEED, gravity: GRAVITY_Y },
    jump: {
      tap,
      held,
      dashing: { gap: r2(held.airtime * DASH_SPEED) },
      doubleJump: false,
    },
    dash: { speed: DASH_SPEED, durationMs: DASH_DURATION_MS, rampMs: DASH_RAMP_MS, cooldownMs: DASH_COOLDOWN_MS },
    capsule: {
      radius: CAPSULE_RADIUS,
      height: r2(2 * CAPSULE_HALF_HEIGHT + 2 * CAPSULE_RADIUS),
      crouch: false,
      autostep: false,
      clearanceNote:
        "No autostep: any lip is a wall that must be jumped, and a pad must be seated flush (~2 cm proud) to be stood on. " +
        "No crouch: a bar to pass under needs more than the capsule's height of clearance.",
    },
    slopes: {
      walkableMaxDeg: deg(WALKABLE_SLOPE_MAX_ANGLE),
      wallMinDeg: deg(Math.acos(WALL_NORMAL_MAX_Y)),
      note: "Below walkableMax it walks, between the two it Slides, above wallMin it is a wall.",
    },
    surfaces: Object.fromEntries(
      Object.entries(SURFACES).map(([id, surface]) => [id, surfaceRow(surface)]),
    ),
    impulses: {
      launchApexRange: [LAUNCH_HEIGHT_MIN, LAUNCH_HEIGHT_MAX],
      conveyorSpeeds: CONVEYOR_SPEEDS,
      conveyorNote: `A belt faster than walking (${WALK_SPEED}) running against the route is impassable, not merely hard.`,
    },
    fight: {
      hitRange: HIT_RANGE,
      hitChargeMaxMs: HIT_CHARGE_MAX_MS,
      grabRange: GRAB_RANGE,
      carrySpeedMultiplier: GRAB_CARRY_SPEED_MULTIPLIER,
      hurlMaxSpeed: HURL_MAX_SPEED,
      wallImpactMinClosingSpeed: WALL_IMPACT_MIN_SPEED,
      arenaNote:
        "Keep a Survival arena's edge within about a Hit's reach of a line Players walk, or nobody can be shoved off it.",
    },
    fall: { defaultKillPlaneY: DEFAULT_KILL_PLANE_Y },
    budget: {
      rise: tap.apex,
      gap: tap.gap,
      note:
        "Size a route every Player must take against the tap jump on a default Surface. Held jumps, Dash distance, " +
        "bounce decks and Springs are headroom for optional or risky lines.",
    },
  };
};

export const registerMechanicsTools = (server: McpServer): void => {
  jsonTool(
    server,
    "get_character_mechanics",
    "What a Character can do, computed live from the simulation's own tuning: walk speed, jump apex and the gap a jump crosses, Dash, capsule size, whether autostep or crouch exist, slope bands, every Surface's cost, Spring and belt speeds, Hit/Grab reach, and the rise/gap budget for a route everyone must take. Call it before placing geometry that has to be traversed — these are tuned by playing, so never carry a number over from a document.",
    {},
    async () => characterMechanics(),
  );
};

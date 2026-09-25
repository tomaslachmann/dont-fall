import { addVec3, normalizeVec3, rotateVec3ByQuat, scaleVec3, type Quat, type Vec3 } from "../math/vec3.js";
import { TICK_DT } from "../tuning/clock.js";
import { BOMB_SPENT_HOLD_SECONDS, SHOOTER_BOMB_FUSE_SECONDS } from "../tuning/fight.js";
import { SHOOTER_MAX_IN_FLIGHT } from "../tuning/world.js";
import { applyMotionPose, motionChainPose, type SegmentMotion } from "./Motion.js";

/**
 * A cannon that fires a ball along its barrel (CONTEXT.md: Shooter, ADR
 * 0119), as its Asset authors it. On the def rather than the Segment for the
 * reason a Spring's throw is: the muzzle is a place on the model. What a
 * placed Segment retunes is how often, how fast and how long
 * ({@link ShooterTiming}).
 */
/**
 * One axis a cannon aims on (ADR 0119): a sweep either side of the rest pose
 * the Asset was authored in. The two axes are separate things, not one
 * movement — the carriage turns and the barrel tips, each on its own range
 * and its own clock, so the muzzle covers an area rather than retracing one
 * line. An amplitude of 0 is an axis that does not move.
 */
export interface ShooterSweep {
  axis: Vec3;
  /** What it turns about, in the Asset's own frame. */
  pivot: Vec3;
  /** Radians either side of rest. */
  amplitude: number;
  /** Seconds for one sweep out and back. */
  period: number;
  /** Fraction of a cycle it starts ahead by. Defaults to 0. */
  phase?: number;
}

export interface ShooterDef {
  /** The carriage's turn and the barrel's tip — independent (see {@link ShooterSweep}). */
  yaw: ShooterSweep;
  pitch: ShooterSweep;
  /** Where a shot leaves, in the barrel's own rest frame — the Asset frame with its Parts at rest. */
  muzzle: Vec3;
  /** Which way the barrel points at rest, a unit vector in the same frame. */
  forward: Vec3;
  /** The ball's radius. */
  radius: number;
  /** Seconds between shots. */
  periodSeconds: number;
  /** How fast a shot leaves, in units per second. */
  speed: number;
  /** Seconds a ball lives before it is taken away — never on a hit (ADR 0119). With bombs, the fuse (ADR 0127). */
  lifeSeconds: number;
  /** What it fires (ADR 0127). Absent is balls, as every Shooter did before bombs. */
  ammo?: ShooterAmmo;
}

/** What a Shooter fires (ADR 0127): its own balls, or Bombs, lit as they leave. */
export const SHOOTER_AMMO = ["ball", "bomb"] as const;
export type ShooterAmmo = (typeof SHOOTER_AMMO)[number];

/** The Asset a Shooter's bombs are (ADR 0127): always bomb A. */
export const SHOOTER_BOMB_ASSET_ID = "bomb_A";

/**
 * What an author may retune on a placed Shooter: how often it fires, how fast
 * and how long a ball lasts, and each aiming axis' own range and clock —
 * never where the muzzle is, which is a place on the model.
 */
export interface ShooterTiming {
  /** What it fires (ADR 0127) — `"ball"` when absent. With `"bomb"`, `lifeSeconds` is each bomb's fuse. */
  ammo?: ShooterAmmo;
  periodSeconds?: number;
  speed?: number;
  lifeSeconds?: number;
  /** Degrees either side of rest, and seconds per sweep, for each axis on its own. `0` degrees is an axis held still. */
  yawDegrees?: number;
  yawSeconds?: number;
  pitchDegrees?: number;
  pitchSeconds?: number;
}

const DEGREES = Math.PI / 180;

const sweptBy = (sweep: ShooterSweep, degrees: number | undefined, seconds: number | undefined): ShooterSweep =>
  degrees === undefined && seconds === undefined
    ? sweep
    : {
        ...sweep,
        ...(degrees === undefined ? {} : { amplitude: Math.max(0, degrees) * DEGREES }),
        ...(seconds === undefined ? {} : { period: Math.max(TICK_DT, seconds) }),
      };

/**
 * One aiming axis as a Motion, for the body it turns — or `undefined` when it
 * is held still. Derived rather than authored twice: the sweep in the def is
 * the one description of where the cannon points, and the Part that carries
 * the collision follows it.
 */
export const shooterSweepMotion = (sweep: ShooterSweep): SegmentMotion | undefined =>
  sweep.amplitude === 0
    ? undefined
    : {
        swing: {
          axis: sweep.axis,
          pivot: sweep.pivot,
          amplitude: sweep.amplitude,
          period: sweep.period,
          easing: "easeInOut",
          ...(sweep.phase === undefined ? {} : { phase: sweep.phase }),
        },
      };

/**
 * The Shooter a placed Segment runs: its Asset's own, with what its author
 * retuned on top — and never more balls in the air than
 * {@link SHOOTER_MAX_IN_FLIGHT}. A publish refuses a pair of numbers that
 * asks for more (the author is told); this is the backstop that keeps an
 * older Track's Round from building a hundred bodies.
 */
export const shooterDefOf = (def: ShooterDef, timing: ShooterTiming | undefined): ShooterDef => {
  const asked: ShooterDef =
    timing === undefined
      ? def
      : {
          ...def,
          yaw: sweptBy(def.yaw, timing.yawDegrees, timing.yawSeconds),
          pitch: sweptBy(def.pitch, timing.pitchDegrees, timing.pitchSeconds),
          ...(timing.periodSeconds === undefined ? {} : { periodSeconds: Math.max(TICK_DT, timing.periodSeconds) }),
          ...(timing.speed === undefined ? {} : { speed: Math.max(0, timing.speed) }),
          ...(timing.lifeSeconds === undefined ? {} : { lifeSeconds: Math.max(TICK_DT, timing.lifeSeconds) }),
          // Bombs burn their own fuse unless the author gave the Shooter a life (ADR 0127).
          ...(timing.ammo === "bomb"
            ? { ammo: "bomb" as const, ...(timing.lifeSeconds === undefined ? { lifeSeconds: SHOOTER_BOMB_FUSE_SECONDS } : {}) }
            : {}),
        };
  const life = Math.min(asked.lifeSeconds, asked.periodSeconds * SHOOTER_MAX_IN_FLIGHT);
  return life === asked.lifeSeconds ? asked : { ...asked, lifeSeconds: life };
};

/**
 * How many of this Shooter's balls can be in the air at once — known before
 * the Round runs, which is what lets them be a fixed set of bodies rather
 * than something a Round creates (ADR 0119).
 */
export const shooterShotsInFlight = (def: ShooterDef): number =>
  Math.max(1, Math.ceil(def.lifeSeconds / Math.max(TICK_DT, def.periodSeconds)));

/**
 * How many bodies a Shooter keeps: one per shot in the air, and with bombs
 * enough more that the one it fires next has finished going off where it was
 * spent (ADR 0127) — {@link BOMB_SPENT_HOLD_SECONDS} after its fuse.
 */
export const shooterBodies = (def: ShooterDef): number =>
  def.ammo === "bomb"
    ? Math.max(1, Math.ceil((def.lifeSeconds + BOMB_SPENT_HOLD_SECONDS) / Math.max(TICK_DT, def.periodSeconds)))
    : shooterShotsInFlight(def);

/** Ticks between shots — at least one, so a Shooter can never fire twice in a Tick. */
export const shooterPeriodTicks = (def: ShooterDef): number => Math.max(1, Math.round(def.periodSeconds / TICK_DT));

/** Ticks a ball lives. */
export const shooterLifeTicks = (def: ShooterDef): number => Math.max(1, Math.round(def.lifeSeconds / TICK_DT));

/** Which shot `tick` is, counting from 0, or `null` when nothing fires on it. */
export const shooterShotAt = (def: ShooterDef, tick: number): number | null => {
  const period = shooterPeriodTicks(def);
  return tick >= 0 && tick % period === 0 ? tick / period : null;
};

/** A Shooter's placement, as everything that aims it reads it. */
export interface ShooterAim {
  position: Vec3;
  orientation: Quat;
  scale: number;
  def: ShooterDef;
}

/** The two axes as Motions, outermost first — the carriage's turn, then the barrel's tip inside it. */
export const shooterAimMotions = (def: ShooterDef): SegmentMotion[] =>
  [shooterSweepMotion(def.yaw), shooterSweepMotion(def.pitch)].filter((motion): motion is SegmentMotion => motion !== undefined);

/**
 * Where the muzzle is and which way it points at `tick`, in world space — the
 * one function the server fires along, the Track builder aims its preview
 * with, and a test reads. A pure function of the Tick, so both sides of a
 * Match agree on where a shot came from without it being sent.
 */
export const shooterMuzzleAt = (aim: ShooterAim, tick: number): { position: Vec3; direction: Vec3 } => {
  const local = motionChainPose(shooterAimMotions(aim.def), tick);
  const point = applyMotionPose(local, aim.def.muzzle);
  // Normalized here rather than trusted: a def's forward is hand-written from
  // a measurement, and a shot's speed is its own number, never the length of
  // the vector that aimed it.
  const direction = normalizeVec3(rotateVec3ByQuat(aim.def.forward, local.rotation));
  return {
    position: addVec3(rotateVec3ByQuat(scaleVec3(point, aim.scale), aim.orientation), aim.position),
    direction: rotateVec3ByQuat(direction, aim.orientation),
  };
};

/**
 * Why `value` is not a storable Shooter timing (ADR 0099's registry), or
 * `undefined`. Shape only, and the population bound is checked where the
 * Module is known — a publish validates a Segment on its own.
 */
export const invalidShooterReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "a Shooter's timing must be an object";
  const { ammo, periodSeconds, speed, lifeSeconds, yawDegrees, yawSeconds, pitchDegrees, pitchSeconds, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0) {
    return `a Shooter's timing has no "${extra[0]}" — only ammo, periodSeconds, speed, lifeSeconds and each axis' own yaw/pitch degrees and seconds`;
  }
  if (ammo !== undefined && !(SHOOTER_AMMO as readonly unknown[]).includes(ammo)) {
    return `a Shooter's ammo must be one of ${SHOOTER_AMMO.join(", ")}`;
  }
  for (const [name, degrees] of [
    ["yawDegrees", yawDegrees],
    ["pitchDegrees", pitchDegrees],
  ] as const) {
    if (degrees === undefined) continue;
    if (typeof degrees !== "number" || !Number.isFinite(degrees) || degrees < 0 || degrees > 180) {
      return `a Shooter's ${name} must be 0 (held still) up to 180`;
    }
  }
  for (const [name, seconds] of [
    ["yawSeconds", yawSeconds],
    ["pitchSeconds", pitchSeconds],
  ] as const) {
    if (seconds === undefined) continue;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return `a Shooter's ${name} must be a positive number of seconds`;
  }
  for (const [name, seconds] of [
    ["periodSeconds", periodSeconds],
    ["lifeSeconds", lifeSeconds],
  ] as const) {
    if (seconds === undefined) continue;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return `a Shooter's ${name} must be a positive number of seconds`;
  }
  if (speed !== undefined && (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0)) {
    return "a Shooter's speed must be a positive number of units per second";
  }
  // Both numbers given is the one case a Segment on its own can be measured
  // against the budget (ADR 0119); one of them alone leans on its Asset's
  // other half, which a publish cannot see, and `shooterDefOf` caps instead.
  if (typeof periodSeconds === "number" && typeof lifeSeconds === "number") {
    const inFlight = Math.ceil(lifeSeconds / periodSeconds);
    if (inFlight > SHOOTER_MAX_IN_FLIGHT) {
      return `a Shooter firing every ${periodSeconds} s with balls lasting ${lifeSeconds} s would put ${inFlight} in the air at once, past the ${SHOOTER_MAX_IN_FLIGHT} a Round allows`;
    }
  }
  return undefined;
};

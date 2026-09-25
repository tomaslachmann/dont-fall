import { addVec3, type Vec3 } from "../math/vec3.js";
import { IDENTITY_QUAT } from "../math/quat.js";
import { TICK_DT } from "../tuning/clock.js";
import type { MotionPose } from "./Motion.js";

/**
 * A punching glove's clip, as it was keyframed (CONTEXT.md: Punching Glove,
 * ADR 0121): how far the fist reaches, and how big each thing that grows is,
 * sample by sample at the clip's own step.
 *
 * Read from the GLB by `pnpm convert:df`, never played — the server has no
 * three.js, and a pose every Player must agree on cannot come from one
 * client's playback. What *is* changed is the speed: the authored punch
 * crosses its 2.31 m at 4.6 u/s, which the Impact rule (ADR 0037) reads as a
 * shove, so the whole curve is played `rate` times faster and the ordinary
 * rule knocks down without a special case.
 */
export interface PunchCycle {
  /** Seconds between samples, as authored. */
  step: number;
  /** How far the fist is out, in metres along the Asset's +Z. */
  reach: number[];
  /** How big the glove is — 0 is no glove at all, which is what rest looks like. */
  glove: number[];
  /** How far the bellows is stretched, along the Asset's Z. */
  bellows: number[];
  /** How big the idle button is — it sinks as the fist comes out. */
  button: number[];
  /** What each of those scales happens about, in the Asset's own frame. */
  pivots: { glove: Vec3; bellows: Vec3; button: Vec3 };
  /** How much faster than authored the curve plays (ADR 0121). */
  rate: number;
  /** Seconds for one whole cycle: the punch, then still until it comes round again. */
  period: number;
  /** Fraction of a cycle this one is ahead by — a row of gloves in a wave. Defaults to 0. */
  phase?: number;
}

/** What an author may retune on a placed glove: when it punches, never how. */
export interface PunchTiming {
  period?: number;
  phase?: number;
  /** How much faster than authored it swings — what decides whether it knocks down. */
  rate?: number;
}

/** Which of a glove's moving pieces a Part is (ADR 0121) — each reads its own channel of the same curve. */
export type PunchPiece = "glove" | "bellows" | "button";

/** The glove is solid only when it is essentially full size — a fist growing out of a plate hits nobody. */
const SOLID_SCALE = 0.9;

/** Seconds the authored curve spans, before `rate`. */
export const punchCurveSeconds = (cycle: PunchCycle): number => Math.max(0, cycle.reach.length - 1) * cycle.step;

/** Seconds one punch takes as it is actually played. */
export const punchSeconds = (cycle: PunchCycle): number => punchCurveSeconds(cycle) / cycle.rate;

/** Where in the authored curve the glove is at `tick`, in samples — past its end while it waits. */
const sampleAt = (cycle: PunchCycle, tick: number): number => {
  const turns = (tick * TICK_DT) / cycle.period + (cycle.phase ?? 0);
  const seconds = ((turns - Math.floor(turns)) * cycle.period) * cycle.rate;
  return seconds / cycle.step;
};

const valueAt = (samples: readonly number[], at: number, rest: number): number => {
  if (at >= samples.length - 1) return rest;
  const i = Math.floor(at);
  const a = samples[i] ?? rest;
  const b = samples[i + 1] ?? rest;
  return a + (b - a) * (at - i);
};

/** How far the fist is out at `tick`. */
export const punchReachAt = (cycle: PunchCycle, tick: number): number => valueAt(cycle.reach, sampleAt(cycle, tick), 0);

/** How big `piece` is at `tick` — 0 for a glove that is not out. */
export const punchScaleAt = (cycle: PunchCycle, tick: number, piece: PunchPiece): number =>
  valueAt(cycle[piece], sampleAt(cycle, tick), cycle[piece][cycle[piece].length - 1] ?? 1);

/** Whether the fist is something to be hit by at `tick` (ADR 0121). */
export const punchLanded = (cycle: PunchCycle, tick: number): boolean => punchScaleAt(cycle, tick, "glove") >= SOLID_SCALE;

/**
 * Where one piece of the glove is at `tick`, in the Asset's own frame: the
 * fist's reach along +Z, and each piece's own scale about its own pivot —
 * which is why the position carries the pivot correction rather than the
 * scale being applied wherever the drawn node happens to sit.
 */
export const punchPose = (cycle: PunchCycle, tick: number, piece: PunchPiece): MotionPose & { scale: Vec3 } => {
  const size = punchScaleAt(cycle, tick, piece);
  const pivot = cycle.pivots[piece];
  // The bellows stretches along Z alone; the fist and the button grow evenly.
  const scale = piece === "bellows" ? { x: 1, y: 1, z: size } : { x: size, y: size, z: size };
  const about = { x: pivot.x * (1 - scale.x), y: pivot.y * (1 - scale.y), z: pivot.z * (1 - scale.z) };
  const reach = piece === "glove" ? { x: 0, y: 0, z: punchReachAt(cycle, tick) } : { x: 0, y: 0, z: 0 };
  return { position: addVec3(about, reach), rotation: IDENTITY_QUAT, scale };
};

/** The cycle a placed Segment runs: the Asset's own, with what its author retuned on top. */
export const punchCycleOf = (cycle: PunchCycle, timing: PunchTiming | undefined): PunchCycle => {
  if (timing === undefined) return cycle;
  const rate = timing.rate === undefined ? cycle.rate : Math.max(0.1, timing.rate);
  const floor = punchCurveSeconds(cycle) / rate;
  return {
    ...cycle,
    rate,
    ...(timing.period === undefined ? {} : { period: Math.max(floor, timing.period) }),
    ...(timing.phase === undefined ? {} : { phase: timing.phase }),
  };
};

/**
 * Why `value` is not a storable punch timing (ADR 0099's registry), or
 * `undefined`. Shape only: a period shorter than the punch itself is floored
 * by {@link punchCycleOf}, because how long the punch takes is the Asset's.
 */
export const invalidPunchReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "a punching glove's timing must be an object";
  const { period, phase, rate, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0) return `a punching glove's timing has no "${extra[0]}" — only period, phase and rate`;
  if (period !== undefined && (typeof period !== "number" || !Number.isFinite(period) || period <= 0)) {
    return "a punching glove's period must be a positive number of seconds";
  }
  if (rate !== undefined && (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)) {
    return "a punching glove's rate must be a positive multiple of the authored swing";
  }
  if (phase !== undefined && (typeof phase !== "number" || !Number.isFinite(phase) || phase < 0 || phase >= 1)) {
    return "a punching glove's phase must be a fraction of a cycle, from 0 up to (not including) 1";
  }
  return undefined;
};

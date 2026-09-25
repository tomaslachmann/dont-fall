import { addVec3, rotateVec3ByQuat, subVec3, type Vec3 } from "../math/vec3.js";
import { TICK_DT } from "../tuning/clock.js";
import { axisAngleQuat, IDENTITY_MOTION_POSE, type MotionPose } from "./Motion.js";

/**
 * A trap door leaf's clock (CONTEXT.md: Trap Door, ADR 0117): the authored
 * swing itself, replayed by a pure function of the Tick.
 *
 * The curve is the GLB's own animation, sampled at its own step by
 * `pnpm convert:df` — so what the simulation poses is what was keyframed in
 * Blender, down to the tremble, rather than a re-modelled guess at it. The
 * clips are never *played* (the server has no three.js, and a pose every
 * Player must agree on cannot come from one client's playback); their numbers
 * are lifted into the def instead, which is the same authored motion with one
 * source of truth.
 *
 * Angles are radians about `axis`, **positive as the leaf opens**, so the
 * authored tremble — which lifts the leaf a few degrees the other way before
 * it drops — is the negative part of the curve. That is also what makes
 * "shut" exact: a leaf is a floor while its angle is at or below zero
 * ({@link trapDoorShut}), which is the tremble and the dwell and nothing else.
 */
export interface TrapDoorCycle {
  axis: Vec3;
  /** The hinge, in the Asset's own frame. */
  pivot: Vec3;
  /** Seconds between samples of `curve`. */
  step: number;
  /** The authored swing: radians about `axis`, shut at 0, negative while it trembles. */
  curve: number[];
  /**
   * Seconds for one whole cycle: the curve plays once, then the leaf lies
   * shut until it comes round again. At least the curve's own length.
   */
  period: number;
  /** Fraction of a cycle this leaf is ahead by — a row of doors in a wave. Defaults to 0. */
  phase?: number;
}

/** What an author may retune on a placed trap door (ADR 0117) — how the authored swing repeats, never its shape. */
export interface TrapDoorTiming {
  period?: number;
  phase?: number;
}

/** At or below this angle (radians) the leaf is a floor — see {@link TrapDoorCycle}. */
const SHUT_ANGLE = 1e-4;

/** Seconds the authored curve itself spans. */
export const trapDoorCurveSeconds = (cycle: TrapDoorCycle): number => Math.max(0, cycle.curve.length - 1) * cycle.step;

/** Where in its cycle the leaf is at `tick` (fractional for rendering), in seconds from the curve's start. */
const cycleSeconds = (cycle: TrapDoorCycle, tick: number): number => {
  const turns = (tick * TICK_DT) / cycle.period + (cycle.phase ?? 0);
  return (turns - Math.floor(turns)) * cycle.period;
};

/** The leaf's angle about its axis at `tick` — the authored curve, then shut for the rest of the cycle. */
export const trapDoorAngle = (cycle: TrapDoorCycle, tick: number): number => {
  const seconds = cycleSeconds(cycle, tick);
  const at = seconds / cycle.step;
  if (at >= cycle.curve.length - 1) return 0;
  const i = Math.floor(at);
  const a = cycle.curve[i] ?? 0;
  const b = cycle.curve[i + 1] ?? 0;
  return a + (b - a) * (at - i);
};

/** Whether the leaf is a floor at `tick`: shut, or trembling on its way to opening (ADR 0117). */
export const trapDoorShut = (cycle: TrapDoorCycle, tick: number): boolean => trapDoorAngle(cycle, tick) <= SHUT_ANGLE;

/** The leaf's local pose at `tick` — what the renderers draw it at; physics only ever wants it shut. */
export const trapDoorPose = (cycle: TrapDoorCycle, tick: number): MotionPose => {
  const angle = trapDoorAngle(cycle, tick);
  if (angle === 0) return IDENTITY_MOTION_POSE;
  const rotation = axisAngleQuat(cycle.axis, angle);
  return { rotation, position: subVec3(cycle.pivot, rotateVec3ByQuat(cycle.pivot, rotation)) };
};

/** Where a rest-local point of the leaf is at `tick`. */
export const trapDoorPoint = (cycle: TrapDoorCycle, tick: number, point: Vec3): Vec3 => {
  const pose = trapDoorPose(cycle, tick);
  return addVec3(rotateVec3ByQuat(point, pose.rotation), pose.position);
};

/**
 * The cycle a placed Segment runs: the Asset's own, with what its author
 * retuned on top. A period shorter than the authored swing is floored at it
 * here rather than refused, because the swing's length is the *Asset's* and a
 * publish validates a Segment on its own; the Track builder floors it in the
 * same place the author sets it, so the number on screen is the one that runs.
 */
export const trapDoorCycleOf = (cycle: TrapDoorCycle, timing: TrapDoorTiming | undefined): TrapDoorCycle =>
  timing === undefined
    ? cycle
    : {
        ...cycle,
        ...(timing.period === undefined ? {} : { period: Math.max(timing.period, trapDoorCurveSeconds(cycle)) }),
        ...(timing.phase === undefined ? {} : { phase: timing.phase }),
      };

/**
 * Why `value` is not a storable trap door timing (ADR 0099's registry), or
 * `undefined`. Shape only, because a publish validates a Segment without its
 * Module and the swing it has to outlast is the Asset's: a period shorter
 * than the swing is floored by {@link trapDoorCycleOf} instead.
 */
export const invalidTrapDoorReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "a trap door's timing must be an object";
  const { period, phase, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0) return `a trap door's timing has no "${extra[0]}" — only period and phase`;
  if (period !== undefined) {
    if (typeof period !== "number" || !Number.isFinite(period) || period <= 0) return "a trap door's period must be a positive number of seconds";
  }
  if (phase !== undefined && (typeof phase !== "number" || !Number.isFinite(phase) || phase < 0 || phase >= 1)) {
    return "a trap door's phase must be a fraction of a cycle, from 0 up to (not including) 1";
  }
  return undefined;
};

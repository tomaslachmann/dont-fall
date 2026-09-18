import { mulQuat, IDENTITY_QUAT } from "../math/quat.js";
import { addVec3, lengthVec3, rotateVec3ByQuat, scaleVec3, subVec3, type Quat, type Vec3 } from "../math/vec3.js";
import { TICK_DT } from "../tuning/clock.js";

/**
 * How a Swing or Slide travels between its two ends (ADR 0061). Each leg of
 * the back-and-forth uses the same curve mirrored, so `easeIn` departs slowly
 * and arrives fast in both directions — a crusher's slam — and `easeInOut`
 * is the pendulum-like default.
 */
export type MotionEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";
export const MOTION_EASINGS: readonly MotionEasing[] = ["linear", "easeIn", "easeOut", "easeInOut"];

/** Endless rotation at a constant speed about `axis` through `pivot` (both in the Segment's local frame). */
export interface MotionSpin {
  axis: Vec3;
  pivot: Vec3;
  /** Radians per second; the sign gives the direction (right-handed about `axis`). */
  speed: number;
  /** Radians at Tick 0. Defaults to 0. */
  startAngle?: number;
}

/** Shared timing of the back-and-forth kinds. */
export interface MotionTiming {
  /** Seconds for one full cycle: out, pause, back, pause. Must exceed twice `pause`. */
  period: number;
  easing: MotionEasing;
  /** Seconds held at each end. Defaults to 0. */
  pause?: number;
  /** Fraction of a cycle (0–1) this one is ahead by — a row of hammers in a wave. Defaults to 0. */
  phase?: number;
}

/** Rotation back and forth between −`amplitude` and +`amplitude` about `axis` through `pivot`. */
export interface MotionSwing extends MotionTiming {
  axis: Vec3;
  pivot: Vec3;
  /** Radians either side of the rest pose. */
  amplitude: number;
}

/** Movement back and forth between the rest pose and `offset` (local frame). */
export interface MotionSlide extends MotionTiming {
  offset: Vec3;
}

/**
 * A Segment's Motion (CONTEXT.md, ADR 0061): at most one of each kind,
 * always applied spin → swing → slide in the Segment's local frame, so a saw
 * that spins about its axle while sliding along a rail needs no ordering.
 */
export interface SegmentMotion {
  spin?: MotionSpin;
  swing?: MotionSwing;
  slide?: MotionSlide;
}

/** A rigid local transform: a rest-local point `p` moves to `rotation·p + position`. */
export interface MotionPose {
  position: Vec3;
  rotation: Quat;
}

export const IDENTITY_MOTION_POSE: MotionPose = { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_QUAT };

/** Whether `motion` moves anything at all. */
export const hasMotion = (motion: SegmentMotion | undefined): motion is SegmentMotion =>
  motion !== undefined && (motion.spin !== undefined || motion.swing !== undefined || motion.slide !== undefined);

export const axisAngleQuat = (axis: Vec3, angle: number): Quat => {
  const length = lengthVec3(axis);
  const s = Math.sin(angle / 2) / length;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
};

export const easeMotion = (easing: MotionEasing, t: number): number => {
  switch (easing) {
    case "linear":
      return t;
    case "easeIn":
      return 1 - Math.cos((t * Math.PI) / 2);
    case "easeOut":
      return Math.sin((t * Math.PI) / 2);
    case "easeInOut":
      return (1 - Math.cos(t * Math.PI)) / 2;
  }
};

/**
 * Where a back-and-forth kind is, 0 (rest end) to 1 (far end), `seconds` into
 * the Round's clock: out over half the travel time, hold, back, hold.
 */
export const backAndForth = (timing: MotionTiming, seconds: number): number => {
  const pause = timing.pause ?? 0;
  const travel = (timing.period - 2 * pause) / 2;
  const cycle = seconds / timing.period + (timing.phase ?? 0);
  const u = (cycle - Math.floor(cycle)) * timing.period;
  if (u < travel) return easeMotion(timing.easing, u / travel);
  if (u < travel + pause) return 1;
  if (u < 2 * travel + pause) return 1 - easeMotion(timing.easing, (u - travel - pause) / travel);
  return 0;
};

/** `inner` then `outer`: a point goes through `inner` first. */
const composePose = (outer: MotionPose, inner: MotionPose): MotionPose => ({
  rotation: mulQuat(outer.rotation, inner.rotation),
  position: addVec3(rotateVec3ByQuat(inner.position, outer.rotation), outer.position),
});

/** Rotation by `angle` about the line through `pivot` along `axis`. */
const rotationAbout = (axis: Vec3, pivot: Vec3, angle: number): MotionPose => {
  const rotation = axisAngleQuat(axis, angle);
  return { rotation, position: subVec3(pivot, rotateVec3ByQuat(pivot, rotation)) };
};

/**
 * The Motion's local pose at `tick` — the one function the simulation, a
 * predicting client, the renderer and the Track builder all call (ADR 0061),
 * so a Motion is never replicated. `tick` may be fractional (render
 * interpolation, the builder's scrubber).
 */
export const motionPose = (motion: SegmentMotion, tick: number): MotionPose => {
  const seconds = tick * TICK_DT;
  let pose = IDENTITY_MOTION_POSE;
  if (motion.spin) {
    const { axis, pivot, speed, startAngle } = motion.spin;
    pose = composePose(rotationAbout(axis, pivot, (startAngle ?? 0) + speed * seconds), pose);
  }
  if (motion.swing) {
    const { axis, pivot, amplitude } = motion.swing;
    const angle = amplitude * (2 * backAndForth(motion.swing, seconds) - 1);
    pose = composePose(rotationAbout(axis, pivot, angle), pose);
  }
  if (motion.slide) {
    const s = backAndForth(motion.slide, seconds);
    pose = composePose({ rotation: IDENTITY_QUAT, position: scaleVec3(motion.slide.offset, s) }, pose);
  }
  return pose;
};

export const applyMotionPose = (pose: MotionPose, point: Vec3): Vec3 =>
  addVec3(rotateVec3ByQuat(point, pose.rotation), pose.position);

/**
 * Velocity (units/s, local frame) of the rest-local `point` over the tick
 * from `tick` to `tick + 1` — exactly how far the kinematic body carries it
 * in that step, which is what riding and Impact must agree with.
 */
export const motionPointVelocity = (motion: SegmentMotion, tick: number, point: Vec3): Vec3 =>
  scaleVec3(
    subVec3(applyMotionPose(motionPose(motion, tick + 1), point), applyMotionPose(motionPose(motion, tick), point)),
    1 / TICK_DT,
  );

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vec = (value: unknown): value is Vec3 => {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, z } = value as Record<string, unknown>;
  return finite(x) && finite(y) && finite(z);
};

const timingReason = (kind: string, timing: Record<string, unknown>): string | undefined => {
  if (!finite(timing.period) || timing.period <= 0) return `motion.${kind}.period must be a positive number of seconds`;
  if (typeof timing.easing !== "string" || !MOTION_EASINGS.includes(timing.easing as MotionEasing)) {
    return `motion.${kind}.easing must be one of ${MOTION_EASINGS.join(", ")}`;
  }
  if (timing.pause !== undefined && (!finite(timing.pause) || timing.pause < 0)) {
    return `motion.${kind}.pause must be zero or more seconds`;
  }
  if (2 * ((timing.pause as number | undefined) ?? 0) >= timing.period) {
    return `motion.${kind}.period must be longer than its two pauses`;
  }
  if (timing.phase !== undefined && !finite(timing.phase)) return `motion.${kind}.phase must be a finite number`;
  return undefined;
};

const axisReason = (kind: string, fields: Record<string, unknown>): string | undefined => {
  if (!vec(fields.axis) || lengthVec3(fields.axis) < 1e-6) return `motion.${kind}.axis must be a non-zero vector`;
  if (!vec(fields.pivot)) return `motion.${kind}.pivot must be a point with finite x/y/z`;
  return undefined;
};

/**
 * Why `value` is not a valid {@link SegmentMotion}, or `undefined` when it is.
 * A Revision is immutable (ADR 0032), so anything that would make
 * {@link motionPose} produce NaN — or silently never move — is refused here.
 */
export const invalidMotionReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "motion must be an object";
  const { spin, swing, slide, ...rest } = value as Record<string, unknown>;
  const unknownKinds = Object.keys(rest);
  if (unknownKinds.length > 0) return `motion has unknown kind(s): ${unknownKinds.join(", ")}`;
  if (spin === undefined && swing === undefined && slide === undefined) return "motion must have a spin, swing or slide";
  if (spin !== undefined) {
    if (typeof spin !== "object" || spin === null) return "motion.spin must be an object";
    const fields = spin as Record<string, unknown>;
    const reason = axisReason("spin", fields);
    if (reason) return reason;
    if (!finite(fields.speed)) return "motion.spin.speed must be a finite number of radians per second";
    if (fields.startAngle !== undefined && !finite(fields.startAngle)) return "motion.spin.startAngle must be a finite number";
  }
  if (swing !== undefined) {
    if (typeof swing !== "object" || swing === null) return "motion.swing must be an object";
    const fields = swing as Record<string, unknown>;
    const reason = axisReason("swing", fields) ?? timingReason("swing", fields);
    if (reason) return reason;
    if (!finite(fields.amplitude)) return "motion.swing.amplitude must be a finite number of radians";
  }
  if (slide !== undefined) {
    if (typeof slide !== "object" || slide === null) return "motion.slide must be an object";
    const fields = slide as Record<string, unknown>;
    if (!vec(fields.offset)) return "motion.slide.offset must be a vector with finite x/y/z";
    const reason = timingReason("slide", fields);
    if (reason) return reason;
  }
  return undefined;
};

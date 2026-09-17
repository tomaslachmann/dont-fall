import {
  addVec3,
  axisAngleQuat,
  conjugateQuat,
  dotVec3,
  lengthVec3,
  movingSegmentPose,
  mulQuat,
  normalizeVec3,
  rotateVec3ByQuat,
  scaleVec3,
  subVec3,
  TICK_DT,
  type MotionPose,
  type MotionSpin,
  type MovingSegmentConfig,
  type SpinnerConfig,
  type Vec3,
} from "@dont-fall/shared";
import type { LoopHandle, SoundEngine } from "./engine.js";
import {
  slidePeakSpeed,
  slideSpeedAt,
  slideStopsCrossed,
  spinAngleAt,
  spinTipPasses,
  swingPeakAngularSpeed,
  swingPeaksCrossed,
} from "./segmentMotion.js";
import type { SoundSlot } from "./slots.js";

/** What each Motion kind sounds like, unless the Asset says otherwise. */
export interface SegmentSoundSet {
  swing: SoundSlot;
  spinPass: SoundSlot;
  slideStop: SoundSlot;
  slideRumble: SoundSlot;
  /** How many tips a spinning piece sweeps past you with: 2 for a bar, 4 for a square. Absent, its shape decides. */
  spinTips?: number;
}

export const MOTION_SOUNDS: SegmentSoundSet = {
  swing: "segment.swing",
  spinPass: "segment.spin_pass",
  slideStop: "segment.slide_stop",
  slideRumble: "segment.slide_rumble",
};

/**
 * Assets that sound unlike their Motion's default, by Module id (ADR 0087:
 * a client table, never data the server loads).
 */
export const SEGMENT_SOUND_OVERRIDES: Readonly<Record<string, Partial<SegmentSoundSet>>> = {
  trap_hammerbig: { swing: "segment.swing_heavy" },
  trap_trapball: { swing: "segment.swing_heavy" },
};

export const segmentSoundSet = (moduleId: string): SegmentSoundSet => ({ ...MOTION_SOUNDS, ...SEGMENT_SOUND_OVERRIDES[moduleId] });

/** The slots the moving pieces of a Track can play: all a Stage needs to decode for them. */
export const segmentSoundSlots = (
  movingSegments: readonly Pick<MovingSegmentConfig, "moduleId" | "motion">[],
  spinners: readonly unknown[],
): SoundSlot[] => {
  const slots = new Set<SoundSlot>();
  for (const { moduleId, motion } of movingSegments) {
    const set = segmentSoundSet(moduleId);
    if (motion.swing) slots.add(set.swing);
    if (motion.spin) slots.add(set.spinPass);
    if (motion.slide) {
      slots.add(set.slideStop);
      slots.add(set.slideRumble);
    }
  }
  if (spinners.length > 0) slots.add(MOTION_SOUNDS.spinPass);
  return [...slots];
};

/** A swing's tip speed (units/s) at which its woosh is at full volume. */
export const SWING_LOUD_TIP_SPEED = 12;
/** A spinning tip's speed (units/s) at which its woosh is at full volume. */
export const SPIN_LOUD_TIP_SPEED = 12;
/** Below this tip speed (units/s) a spin makes no woosh: a slow turntable doesn't whoosh past. */
export const SPIN_PASS_MIN_TIP_SPEED = 4;
/** The quietest a moving piece's woosh gets, as a share of full. */
export const MOTION_GAIN_FLOOR = 0.3;
/**
 * A jump in the clock longer than this (s), or backwards, is heard as
 * nothing: a new Round, a Track swap, a stalled tab. Only a real frame's
 * worth of Motion sounds.
 */
export const MAX_HEARD_STEP_SECONDS = 0.5;

const loudness = (speed: number, loud: number): number => Math.min(1, Math.max(MOTION_GAIN_FLOOR, speed / loud));

/** A Moving Segment as its sounds see it: its config, and its drawn shape at rest in its own (scaled) frame. */
export interface SoundedSegment {
  config: Pick<MovingSegmentConfig, "moduleId" | "position" | "orientation" | "scale" | "motion">;
  /** Corners of the visual's bounds in the Segment's own frame, already scaled. */
  corners: readonly Vec3[];
}

/** A spinning piece's geometry in its own frame: its tips and how far out they are. */
interface SpinShape {
  spin: Pick<MotionSpin, "speed" | "startAngle">;
  /** The pivot in the frame the pose maps. */
  pivot: Vec3;
  axis: Vec3;
  /** The first tip's direction at angle 0, perpendicular to `axis`. */
  firstTip: Vec3;
  radius: number;
  tips: number;
}

interface Piece {
  config: SoundedSegment["config"];
  sounds: SegmentSoundSet;
  centre: Vec3;
  swingTipSpeed: number;
  spin: SpinShape | null;
  slidePeak: number;
  rumble: LoopHandle | null;
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

const alongAxis = (point: Vec3, pivot: Vec3, axis: Vec3): Vec3 => {
  const relative = subVec3(point, pivot);
  return subVec3(relative, scaleVec3(axis, dotVec3(relative, axis)));
};

/** The farthest a corner is from the line through `pivot` along `axis`. */
const reach = (corners: readonly Vec3[], pivot: Vec3, axis: Vec3): number =>
  Math.max(0, ...corners.map((corner) => lengthVec3(alongAxis(corner, pivot, axis))));

/**
 * A spinning piece's tips, from its bounds: the farthest corner is the first
 * tip. A piece nearly as wide across that tip as it is long is a square with
 * four, anything narrower a bar with two.
 */
const spinShape = (spin: MotionSpin, corners: readonly Vec3[], scale: number, tips: number | undefined): SpinShape | null => {
  const pivot = scaleVec3(spin.pivot, scale);
  const axis = normalizeVec3(spin.axis);
  let radius = 0;
  let firstTip: Vec3 | null = null;
  for (const corner of corners) {
    const out = alongAxis(corner, pivot, axis);
    const length = lengthVec3(out);
    if (length > radius) {
      radius = length;
      firstTip = scaleVec3(out, 1 / length);
    }
  }
  if (!firstTip) return null;
  const across = cross(axis, firstTip);
  const width = Math.max(...corners.map((corner) => Math.abs(dotVec3(alongAxis(corner, pivot, axis), across))));
  return { spin, pivot, axis, firstTip, radius, tips: tips ?? (width > radius / 2 ? 4 : 2) };
};

const applyPose = (pose: MotionPose, point: Vec3): Vec3 => addVec3(rotateVec3ByQuat(point, pose.rotation), pose.position);

/**
 * Every moving piece on a Track, heard near it (M14 ticket 07, ADR 0087):
 *
 * - **Swing:** a woosh each time it passes its fastest point, louder the
 *   faster its tip moves.
 * - **Spin:** a woosh each time a tip sweeps past the listener, where it
 *   passes closest, louder the faster the tip. No loop (the user's call).
 * - **Slide:** a clunk each time it arrives at an end, and a rumble loop
 *   whose level follows its speed.
 *
 * It is driven by the drawn Motion's tick (`updateMotion`'s `t`, the
 * prediction tick), so a hammer's woosh lines up with the hammer you see.
 * The M1 Spinner goes through the same spin rule.
 */
export class SegmentSounds {
  private readonly pieces: Piece[];
  private readonly spinners: SpinShape[];
  private previousSeconds: number | null = null;

  constructor(
    private readonly engine: Pick<SoundEngine, "play" | "loop">,
    segments: readonly SoundedSegment[],
    spinners: readonly SpinnerConfig[] = [],
  ) {
    this.pieces = segments.map(({ config, corners }) => {
      const sounds = segmentSoundSet(config.moduleId);
      const { swing, spin, slide } = config.motion;
      const centre = scaleVec3(corners.reduce((sum, corner) => addVec3(sum, corner), { x: 0, y: 0, z: 0 }), 1 / Math.max(1, corners.length));
      const swingTipSpeed = swing
        ? swingPeakAngularSpeed(swing) * reach(corners, scaleVec3(swing.pivot, config.scale), normalizeVec3(swing.axis))
        : 0;
      return {
        config,
        sounds,
        centre,
        swingTipSpeed,
        spin: spin ? spinShape(spin, corners, config.scale, sounds.spinTips) : null,
        slidePeak: slide ? slidePeakSpeed(slide, config.scale) : 0,
        rumble: slide ? engine.loop(sounds.slideRumble, { gain: 0 }) : null,
      };
    });
    this.spinners = spinners.map((spinner) => ({
      spin: { speed: spinner.angularSpeed, startAngle: spinner.initialAngle ?? 0 },
      pivot: spinner.center,
      axis: { x: 0, y: 1, z: 0 },
      firstTip: { x: 1, y: 0, z: 0 },
      radius: spinner.armLength,
      tips: 2,
    }));
  }

  /** Once a frame, at the drawn Motion's `tick`, heard from `listener`. */
  update(tick: number, listener: Vec3): void {
    const seconds = tick * TICK_DT;
    const from = this.previousSeconds;
    this.previousSeconds = seconds;
    const heard = from !== null && seconds > from && seconds - from <= MAX_HEARD_STEP_SECONDS;

    for (const piece of this.pieces) {
      const { config, sounds } = piece;
      const { swing, slide } = config.motion;
      const pose = movingSegmentPose(config, tick);
      const centre = applyPose(pose, piece.centre);
      if (slide && piece.rumble) {
        const speed = piece.slidePeak > 0 ? slideSpeedAt(slide, config.scale, seconds) / piece.slidePeak : 0;
        piece.rumble.set({ at: centre, gain: Math.min(1, speed) });
      }
      if (!heard) continue;
      if (swing && swingPeaksCrossed(swing, from, seconds) > 0) {
        this.engine.play(sounds.swing, { at: centre, gain: loudness(piece.swingTipSpeed, SWING_LOUD_TIP_SPEED) });
      }
      if (slide && slideStopsCrossed(slide, from, seconds) > 0) this.engine.play(sounds.slideStop, { at: centre });
      if (piece.spin) {
        // The spin's own turn is taken off the pose, leaving whatever carries the spinning piece.
        const turn = axisAngleQuat(piece.spin.axis, spinAngleAt(piece.spin.spin, seconds));
        this.spinPass(sounds.spinPass, piece.spin, applyPose(pose, piece.spin.pivot), mulQuat(pose.rotation, conjugateQuat(turn)), listener, from, seconds);
      }
    }
    if (!heard) return;
    for (const spinner of this.spinners) {
      this.spinPass(MOTION_SOUNDS.spinPass, spinner, spinner.pivot, { x: 0, y: 0, z: 0, w: 1 }, listener, from, seconds);
    }
  }

  private spinPass(
    slot: SoundSlot,
    shape: SpinShape,
    pivot: Vec3,
    carried: MotionPose["rotation"],
    listener: Vec3,
    from: number,
    to: number,
  ): void {
    const tipSpeed = Math.abs(shape.spin.speed) * shape.radius;
    if (tipSpeed < SPIN_PASS_MIN_TIP_SPEED) return;
    const axis = rotateVec3ByQuat(shape.axis, carried);
    const first = rotateVec3ByQuat(shape.firstTip, carried);
    const second = cross(axis, first);
    const toListener = alongAxis(listener, pivot, axis);
    const distance = lengthVec3(toListener);
    if (distance < 1e-3) return;
    const angle = Math.atan2(dotVec3(toListener, second), dotVec3(toListener, first));
    if (spinTipPasses(shape.spin, shape.tips, angle, from, to) === 0) return;
    this.engine.play(slot, {
      at: addVec3(pivot, scaleVec3(toListener, shape.radius / distance)),
      gain: loudness(tipSpeed, SPIN_LOUD_TIP_SPEED),
    });
  }

  /** Lets every rumble go. */
  dispose(): void {
    for (const piece of this.pieces) piece.rumble?.stop();
  }
}

import {
  applyMotionPose,
  backAndForth,
  motionPose,
  impactOutcome,
  lengthVec3,
  motionPointVelocity,
  movingSegmentImpactMagnitude,
  TICK_RATE_HZ,
  type ImpactOutcome,
  type MotionEasing,
  type MotionSlide,
  type MotionSpin,
  type MotionSwing,
  type MotionTiming,
  type Module,
  type SegmentMotion,
  type Vec3,
} from "@dont-fall/shared";

/**
 * The plain-language and picture half of the Motion panel (M11 ticket 06
 * follow-up, `docs/research/motion-authoring-visual-aids.md`): what a novice
 * reads instead of the maths. Everything here samples the simulation's own
 * pure functions (`backAndForth`, `motionPointVelocity`) and its own Impact
 * mapping, so a sentence or a strip can never tell a different story from a
 * Match.
 */

/** The eight corners of a piece's Footprint — where its fastest point is always found. */
export const footprintCorners = (module: Module): Vec3[] => {
  const { center: c, halfExtents: h } = module.footprint.bounds;
  const corners: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push({ x: c.x + x * h.x, y: c.y + y * h.y, z: c.z + z * h.z });
  return corners;
};

/**
 * The fastest of `points` (units/s) under `motion` over the tick starting at
 * `seconds`, for a Segment at `scale` (ADR 0062: scale wraps the Motion, so
 * every world speed is the local one times the scale).
 */
export const topSpeedAt = (motion: SegmentMotion, seconds: number, points: readonly Vec3[], scale = 1): number =>
  scale * Math.max(0, ...points.map((point) => lengthVec3(motionPointVelocity(motion, seconds * TICK_RATE_HZ, point))));

/**
 * What a point that fast does to a Character standing in its way, head-on —
 * through the same magnitude and thresholds the simulation's Impact uses.
 */
export const speedOutcome = (speed: number): ImpactOutcome => impactOutcome(movingSegmentImpactMagnitude(speed));

export const OUTCOME_WORDS: Record<ImpactOutcome, string> = { none: "Push", stagger: "Stagger", ragdoll: "Ragdoll" };
export const OUTCOME_COLOURS: Record<ImpactOutcome, string> = { none: "#22c55e", stagger: "#facc15", ragdoll: "#ef4444" };

/** One sample of a back-and-forth cycle, in cycle time (0 = leaving the rest end, phase not applied). */
export interface CycleSample {
  /** Seconds into the cycle. */
  t: number;
  /** 0 at the rest end, 1 at the far end. */
  position: number;
  /** Whether this moment is a hold at one end. */
  holding: boolean;
  speed: number;
  outcome: ImpactOutcome;
}

/**
 * One period of a Swing or Slide, sampled for the timing strip. `kind` is the
 * back-and-forth alone (phase removed), so the strip always starts at the rest
 * end; its speed is that kind's own, at the piece's fastest corner.
 */
export const sampleCycle = (
  kind: { swing: MotionSwing } | { slide: MotionSlide },
  points: readonly Vec3[],
  samples = 120,
  scale = 1,
): CycleSample[] => {
  const timing: MotionTiming = "swing" in kind ? kind.swing : kind.slide;
  const unphased: SegmentMotion = "swing" in kind ? { swing: { ...kind.swing, phase: 0 } } : { slide: { ...kind.slide, phase: 0 } };
  const pause = timing.pause ?? 0;
  const travel = (timing.period - 2 * pause) / 2;
  const result: CycleSample[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / samples) * timing.period;
    const holding = (t >= travel && t < travel + pause) || t >= 2 * travel + pause;
    const speed = topSpeedAt(unphased, t, points, scale);
    result.push({ t, position: backAndForth({ ...timing, phase: 0 }, t), holding, speed, outcome: speedOutcome(speed) });
  }
  return result;
};

/** Where the playhead sits in a cycle (0–1) at clock time `seconds`, phase applied — what the strip marks as "now". */
export const cycleFraction = (timing: MotionTiming, seconds: number): number => {
  const cycle = seconds / timing.period + (timing.phase ?? 0);
  return cycle - Math.floor(cycle);
};

/**
 * The clock time nearest `now` at which the cycle is at fraction `u` — what
 * dragging the strip's playhead sets the transport to.
 */
export const secondsForFraction = (timing: MotionTiming, u: number, now: number): number => {
  const base = Math.floor(now / timing.period) * timing.period;
  const offset = ((u - (timing.phase ?? 0)) % 1 + 1) % 1;
  return base + offset * timing.period;
};

export const EASING_HINTS: Record<MotionEasing, string> = {
  linear: "Same speed all the way",
  easeIn: "Starts slow, arrives fast",
  easeOut: "Leaves fast, slows before it stops",
  easeInOut: "Slow at both ends, fastest in the middle",
};

const seconds = (value: number): string => `${Math.round(value * 10) / 10} s`;
const metres = (value: number): string => `${Math.round(value * 10) / 10} m`;
const speedWords = (speed: number): string => `${Math.round(speed * 10) / 10} m/s → ${OUTCOME_WORDS[speedOutcome(speed)]}`;

const timingWords = (timing: MotionTiming, outWord: string, backWord: string): string => {
  const pause = timing.pause ?? 0;
  const travel = (timing.period - 2 * pause) / 2;
  const hold = pause > 0 ? `, waits ${seconds(pause)}` : "";
  return `${outWord} in ${seconds(travel)}${hold}, ${backWord} in ${seconds(travel)}${hold}.`;
};

const phaseWords = (timing: MotionTiming): string => {
  const phase = timing.phase ?? 0;
  const lead = (((phase % 1) + 1) % 1) * timing.period;
  return lead > 0.005 ? ` Starts ${seconds(lead)} into its cycle.` : "";
};

/** "One turn every 4 s, counter-clockwise… Tip 7.9 m/s → Stagger." */
export const describeSpin = (spin: MotionSpin, points: readonly Vec3[], scale = 1): string => {
  const turn = Math.abs(spin.speed) > 1e-6 ? (2 * Math.PI) / Math.abs(spin.speed) : Infinity;
  const every = Number.isFinite(turn) ? `One turn every ${seconds(turn)}` : "Standing still";
  const way = spin.speed > 0 ? "counter-clockwise" : "clockwise";
  return `${every}, ${way}. Fastest point ${speedWords(topSpeedAt({ spin }, 0, points, scale))}.`;
};

/** The fastest moment of a sampled cycle: its speed and when it happens. */
const peak = (samples: readonly CycleSample[]): CycleSample =>
  samples.reduce((best, sample) => (sample.speed > best.speed ? sample : best), samples[0]!);

/** "Swings ±60°: out in 0.8 s, waits 0.2 s… Fastest 11.2 m/s → Stagger, 0.4 s into the cycle." */
export const describeSwing = (swing: MotionSwing, points: readonly Vec3[], scale = 1): string => {
  const top = peak(sampleCycle({ swing }, points, 120, scale));
  const degrees = Math.round((Math.abs(swing.amplitude) * 180) / Math.PI);
  return (
    `Swings ±${degrees}°: ${timingWords(swing, "over", "back")}` +
    ` Fastest ${speedWords(top.speed)}, ${seconds(top.t)} into the cycle.${phaseWords(swing)}`
  );
};

/** "Travels 4 m: out in 1.5 s, waits 0.5 s… Fastest 5.2 m/s → Push." */
export const describeSlide = (slide: MotionSlide, points: readonly Vec3[], scale = 1): string => {
  const top = peak(sampleCycle({ slide }, points, 120, scale));
  return (
    `Travels ${metres(lengthVec3(slide.offset) * scale)}: ${timingWords(slide, "out", "back")}` +
    ` Fastest ${speedWords(top.speed)}, ${seconds(top.t)} into the cycle.${phaseWords(slide)}`
  );
};

/**
 * The track the piece's fastest corner draws through the air (the viewport's
 * path line, after Dreams' animation path): one full cycle — the longest
 * back-and-forth period, or one turn of a lone Spin (capped at 30 s) —
 * sampled with the Impact outcome at each point, in the Segment's rest frame.
 */
export const motionPath = (
  motion: SegmentMotion,
  corners: readonly Vec3[],
  samples = 120,
  /** Only the outcomes scale (world speed); the points stay in the Segment's own frame. */
  scale = 1,
): { points: Vec3[]; outcomes: ImpactOutcome[] } => {
  const periods = [motion.swing?.period, motion.slide?.period].filter((p): p is number => p !== undefined);
  const turn = motion.spin && Math.abs(motion.spin.speed) > 1e-6 ? (2 * Math.PI) / Math.abs(motion.spin.speed) : 30;
  const duration = Math.min(30, periods.length > 0 ? Math.max(...periods) : turn);
  const times = Array.from({ length: samples + 1 }, (_, i) => (i / samples) * duration);
  const speedsOf = (corner: Vec3): number[] =>
    times.map((t) => lengthVec3(motionPointVelocity(motion, t * TICK_RATE_HZ, corner)));
  let fastest = corners[0] ?? { x: 0, y: 0, z: 0 };
  let fastestSpeeds = speedsOf(fastest);
  for (const corner of corners.slice(1)) {
    const speeds = speedsOf(corner);
    if (Math.max(...speeds) > Math.max(...fastestSpeeds)) {
      fastest = corner;
      fastestSpeeds = speeds;
    }
  }
  return {
    points: times.map((t) => applyMotionPose(motionPose(motion, t * TICK_RATE_HZ), fastest)),
    outcomes: fastestSpeeds.map((speed) => speedOutcome(speed * scale)),
  };
};

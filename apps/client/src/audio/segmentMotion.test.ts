import {
  backAndForth,
  motionPose,
  rotateVec3ByQuat,
  TICK_DT,
  type MotionEasing,
  type MotionSlide,
  type MotionSwing,
} from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  legSeconds,
  slidePeakSpeed,
  slideSpeedAt,
  slideStopsCrossed,
  spinTipPasses,
  swingPeakAngularSpeed,
  swingPeaksCrossed,
} from "./segmentMotion.js";

const swingOf = (easing: MotionEasing, over: Partial<MotionSwing> = {}): MotionSwing => ({
  axis: { x: 0, y: 0, z: 1 },
  pivot: { x: 0, y: 5, z: 0 },
  amplitude: 1,
  period: 3,
  easing,
  pause: 0.25,
  ...over,
});

/** The swing's angle at `seconds`, read off the real pose: where a point below the pivot has been carried. */
const swingAngle = (swing: MotionSwing, seconds: number): number => {
  const pose = motionPose({ swing }, seconds / TICK_DT);
  const down = rotateVec3ByQuat({ x: 0, y: -1, z: 0 }, pose.rotation);
  return Math.atan2(down.x, -down.y);
};

/** Seconds, across one cycle, where the swing turns fastest, sampled from the pose. */
const fastestTimes = (swing: MotionSwing): number[] => {
  const step = 0.001;
  const speeds: number[] = [];
  for (let t = 0; t < swing.period; t += step) speeds.push(Math.abs(swingAngle(swing, t + step) - swingAngle(swing, t)) / step);
  const top = Math.max(...speeds);
  // The fastest sample of each stretch within a hair of the top speed: one per leg.
  const peaks: { t: number; speed: number }[] = [];
  speeds.forEach((speed, i) => {
    if (speed < top * 0.999) return;
    const t = i * step;
    const last = peaks.at(-1);
    if (!last || t - last.t > 0.2) peaks.push({ t, speed });
    else if (speed >= last.speed) peaks[peaks.length - 1] = { t, speed };
  });
  return peaks.map((peak) => peak.t);
};

describe("segment Motion sounds (M14 ticket 07)", () => {
  describe("a swing's fastest point", () => {
    it("is crossed twice per cycle, whatever the easing and phase", () => {
      for (const easing of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
        for (const phase of [0, 0.3]) {
          const swing = swingOf(easing, { phase });
          expect(swingPeaksCrossed(swing, 10, 10 + swing.period), `${easing} ${phase}`).toBe(2);
        }
      }
    });

    it("lands where the real pose turns fastest: the bottom for easeInOut, the slam for easeIn", () => {
      for (const easing of ["easeInOut", "easeIn"] as const) {
        const swing = swingOf(easing, { phase: 0.1 });
        const peaks = fastestTimes(swing);
        expect(peaks.length, easing).toBeGreaterThanOrEqual(2);
        for (const peak of peaks) {
          expect(swingPeaksCrossed(swing, peak - 0.02, peak + 0.02), `${easing} at ${peak}`).toBe(1);
        }
      }
    });

    it("is not crossed away from those points", () => {
      const swing = swingOf("easeInOut");
      // The far end: the swing is slowest there.
      const leg = legSeconds(swing);
      expect(swingPeaksCrossed(swing, leg - 0.1, leg + 0.1)).toBe(0);
    });

    it("turns at the speed the pose does at its fastest", () => {
      const swing = swingOf("easeInOut");
      const [peak] = fastestTimes(swing);
      const step = 0.001;
      const measured = Math.abs(swingAngle(swing, peak! + step) - swingAngle(swing, peak!)) / step;
      expect(swingPeakAngularSpeed(swing)).toBeCloseTo(measured, 1);
    });
  });

  describe("a slide", () => {
    const slide: MotionSlide = { offset: { x: 4, y: 0, z: 0 }, period: 4, easing: "easeInOut", pause: 0.5, phase: 0.2 };

    it("stops at each end once per cycle, exactly where it arrives", () => {
      expect(slideStopsCrossed(slide, 3, 3 + slide.period)).toBe(2);
      const shift = (slide.phase ?? 0) * slide.period;
      const leg = legSeconds(slide);
      const farArrival = leg - shift + slide.period;
      expect(backAndForth(slide, farArrival)).toBeCloseTo(1, 6);
      expect(slideStopsCrossed(slide, farArrival - 0.01, farArrival + 0.01)).toBe(1);
      expect(slideStopsCrossed(slide, farArrival + 0.05, farArrival + 0.4)).toBe(0);
    });

    it("moves at the speed its pose does, still while it pauses, and never past its peak", () => {
      const scale = 1.5;
      let top = 0;
      for (let t = 0; t < slide.period; t += 0.05) {
        const step = 0.0005;
        const a = motionPose({ slide }, t / TICK_DT).position.x * scale;
        const b = motionPose({ slide }, (t + step) / TICK_DT).position.x * scale;
        const measured = Math.abs(b - a) / step;
        expect(slideSpeedAt(slide, scale, t)).toBeCloseTo(measured, 1);
        top = Math.max(top, slideSpeedAt(slide, scale, t));
      }
      expect(top).toBeLessThanOrEqual(slidePeakSpeed(slide, scale) + 1e-9);
      expect(top).toBeGreaterThan(slidePeakSpeed(slide, scale) * 0.95);
      const shift = (slide.phase ?? 0) * slide.period;
      expect(slideSpeedAt(slide, scale, legSeconds(slide) - shift + 0.2)).toBe(0);
    });
  });

  describe("a spinning tip", () => {
    const spin = { speed: 2, startAngle: 0 };

    it("passes a listener once per turn per tip, either way round", () => {
      const turn = (2 * Math.PI) / spin.speed;
      expect(spinTipPasses(spin, 2, 1, 0, turn)).toBe(2);
      expect(spinTipPasses(spin, 4, 1, 0, turn)).toBe(4);
      expect(spinTipPasses({ speed: -2 }, 2, 1, 0, turn)).toBe(2);
    });

    it("passes when a tip points at the listener, counting from its start angle", () => {
      // The first tip starts at 0.5 rad and turns at 2 rad/s: it points at 1.5 rad after 0.5 s.
      const started = { speed: 2, startAngle: 0.5 };
      expect(spinTipPasses(started, 1, 1.5, 0.45, 0.55)).toBe(1);
      expect(spinTipPasses(started, 1, 1.5, 0.1, 0.45)).toBe(0);
      // The second tip of a bar is half a turn behind: it points there π/2 s later.
      expect(spinTipPasses(started, 2, 1.5, 0.45 + Math.PI / 2, 0.55 + Math.PI / 2)).toBe(1);
    });
  });
});

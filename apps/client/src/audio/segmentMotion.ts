import type { MotionEasing, MotionSpin, MotionSwing, MotionSlide, MotionTiming } from "@dont-fall/shared";

/**
 * When a Moving Segment's Motion (ADR 0061) is worth hearing, as pure
 * functions of its config and the Round's clock (M14 ticket 07). They are
 * derived from the same `backAndForth` and spin angle `motionPose` uses, so a
 * sound lands on the pose that is drawn.
 */

/** Where along a leg (0 departure, 1 arrival) an easing is fastest. */
export const FASTEST_ALONG_LEG: Readonly<Record<MotionEasing, number>> = {
  linear: 0.5,
  easeInOut: 0.5,
  easeIn: 1,
  easeOut: 0,
};

/** An easing's steepest slope, in legs per leg: `linear` is 1, and the sine easings π/2. */
export const STEEPEST_EASE_SLOPE: Readonly<Record<MotionEasing, number>> = {
  linear: 1,
  easeInOut: Math.PI / 2,
  easeIn: Math.PI / 2,
  easeOut: Math.PI / 2,
};

/** Seconds one leg of a back-and-forth travels (either way). */
export const legSeconds = (timing: MotionTiming): number => (timing.period - 2 * (timing.pause ?? 0)) / 2;

/**
 * How many of the instants `offsets` (seconds into each cycle) fall in
 * (`fromSeconds`, `toSeconds`], on `timing`'s clock with its phase.
 */
const cycleInstantsCrossed = (timing: MotionTiming, offsets: readonly number[], fromSeconds: number, toSeconds: number): number => {
  const shift = (timing.phase ?? 0) * timing.period;
  let count = 0;
  for (const offset of offsets) {
    count +=
      Math.floor((toSeconds + shift - offset) / timing.period) - Math.floor((fromSeconds + shift - offset) / timing.period);
  }
  return count;
};

/**
 * How many times a swing passed its fastest point between the two times: the
 * bottom of the arc for the default easing, the slam at an end for `easeIn`.
 */
export const swingPeaksCrossed = (swing: MotionTiming, fromSeconds: number, toSeconds: number): number => {
  const leg = legSeconds(swing);
  const at = FASTEST_ALONG_LEG[swing.easing] * leg;
  return cycleInstantsCrossed(swing, [at, leg + (swing.pause ?? 0) + at], fromSeconds, toSeconds);
};

/** A swing's angular speed at its fastest point (rad/s). */
export const swingPeakAngularSpeed = (swing: MotionSwing): number =>
  (2 * Math.abs(swing.amplitude) * STEEPEST_EASE_SLOPE[swing.easing]) / legSeconds(swing);

/** How many times a slide arrived at either end between the two times. */
export const slideStopsCrossed = (slide: MotionTiming, fromSeconds: number, toSeconds: number): number => {
  const leg = legSeconds(slide);
  return cycleInstantsCrossed(slide, [leg, 2 * leg + (slide.pause ?? 0)], fromSeconds, toSeconds);
};

const slideLength = (slide: MotionSlide, scale: number): number =>
  Math.hypot(slide.offset.x, slide.offset.y, slide.offset.z) * scale;

/** A slide's top speed (units/s): the steepest part of its easing over one leg. */
export const slidePeakSpeed = (slide: MotionSlide, scale: number): number =>
  (slideLength(slide, scale) * STEEPEST_EASE_SLOPE[slide.easing]) / legSeconds(slide);

/** A slide's speed (units/s) at `seconds`: zero while it pauses at an end. */
export const slideSpeedAt = (slide: MotionSlide, scale: number, seconds: number): number => {
  const leg = legSeconds(slide);
  const pause = slide.pause ?? 0;
  const cycle = seconds / slide.period + (slide.phase ?? 0);
  const u = (cycle - Math.floor(cycle)) * slide.period;
  const along = u < leg ? u / leg : u >= leg + pause && u < 2 * leg + pause ? (u - leg - pause) / leg : null;
  if (along === null) return 0;
  return (slideLength(slide, scale) * easeSlope(slide.easing, along)) / leg;
};

/** The derivative of `easeMotion` at `t`. */
const easeSlope = (easing: MotionEasing, t: number): number => {
  switch (easing) {
    case "linear":
      return 1;
    case "easeIn":
      return (Math.PI / 2) * Math.sin((t * Math.PI) / 2);
    case "easeOut":
      return (Math.PI / 2) * Math.cos((t * Math.PI) / 2);
    case "easeInOut":
      return (Math.PI / 2) * Math.sin(t * Math.PI);
  }
};

/** A spin's angle (rad) at `seconds`, as `motionPose` turns it. */
export const spinAngleAt = (spin: Pick<MotionSpin, "speed" | "startAngle">, seconds: number): number =>
  (spin.startAngle ?? 0) + spin.speed * seconds;

/**
 * How many times one of `tips` evenly spaced tips of a spinning piece swept
 * past the angle `listenerAngle` (rad, measured like the spin, from the first
 * tip at angle 0) between the two times. A tip passes the listener closest
 * when it points at the listener.
 */
export const spinTipPasses = (
  spin: Pick<MotionSpin, "speed" | "startAngle">,
  tips: number,
  listenerAngle: number,
  fromSeconds: number,
  toSeconds: number,
): number => {
  const turns = (seconds: number): number => ((spinAngleAt(spin, seconds) - listenerAngle) * tips) / (2 * Math.PI);
  return Math.abs(Math.floor(turns(toSeconds)) - Math.floor(turns(fromSeconds)));
};

import type { MotionSlide, MotionSpin, MotionSwing, SegmentMotion } from "@dont-fall/shared";
import { nearestAxis, toDegrees } from "./motionForm.js";

/**
 * The motion card headers' right-aligned summaries (new-design port):
 * the kind's essence at a glance — degrees and seconds, like the fields.
 */
export const spinSummary = (spin: MotionSpin): string => `${toDegrees(spin.speed)} °/s · ${nearestAxis(spin.axis)}`;

export const swingSummary = (swing: MotionSwing): string =>
  `±${toDegrees(swing.amplitude)}° · ${swing.period} s · ${nearestAxis(swing.axis)}`;

export const slideSummary = (slide: MotionSlide): string => {
  const travel = Math.round(Math.hypot(slide.offset.x, slide.offset.y, slide.offset.z) * 10) / 10;
  return `${travel} m · ${slide.period} s`;
};

/**
 * Which kinds this Motion runs, in composition order — the folded MOTION
 * section's header, where there's room for the kinds but not their numbers.
 */
export const motionKindsOf = (motion: SegmentMotion | undefined): ("spin" | "swing" | "slide")[] => [
  ...(motion?.spin ? (["spin"] as const) : []),
  ...(motion?.swing ? (["swing"] as const) : []),
  ...(motion?.slide ? (["slide"] as const) : []),
];

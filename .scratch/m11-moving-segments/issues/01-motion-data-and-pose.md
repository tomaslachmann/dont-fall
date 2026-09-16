# 01 — Motion data and the pure pose function

**What to build:** `Segment.motion?` (Spin / Swing / Slide, ADR 0061) as shared
data, one pure `motionPose(motion, tick)` every consumer calls, and API
validation for stored Tracks.

**Blocked by:** nothing (first ticket).

**Status:** done (2026-09-14).

## What to change

- [x] `packages/shared/src/track/Motion.ts`: `SegmentMotion { spin?, swing?, slide? }`,
      `MotionEasing`, easing functions, `motionPose(motion, tick) → { position, rotation }`
      in the Segment's local frame (spin → swing → slide), velocity at a local
      point (`motionPointVelocity`) for Impact/tint, all tuning-free and pure
- [x] `Segment.motion?`; `validateMotion` in shared (finite, periods > 0,
      axis non-zero, known easing, pauses ≥ 0), used by the API's Track validation
- [x] Unit tests: periodicity, ping-pong end holds, easing endpoints, phase,
      composition order, fractional ticks (render interpolation), velocity
      matches the finite difference of pose

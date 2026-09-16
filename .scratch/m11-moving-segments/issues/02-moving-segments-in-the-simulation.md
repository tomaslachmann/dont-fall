# 02 — Moving Segments in the simulation and the client

**What to build:** a Segment with a Motion resolves to one kinematic body
posed every tick from `motionPose`, on server and predicting client alike,
and the client draws it at the interpolated Tick.

**Blocked by:** 01.

**Status:** done (2026-09-14) — tests; the live check is the user's.

## What to change

- [x] `resolveTrack` emits `movingSegments` (local boxes/trimeshes + placement +
      motion) and keeps their colliders out of the static world (ADR 0050 amended)
- [x] `MovingSegment` body in `RapierSimulation`, queued each tick like the Spinner
- [x] Client scene: moving Segment groups posed from the interpolated Tick
- [x] Tests: a dropped Character lands on a Slide platform's current pose; the
      collider is where `motionPose` says at tick N on two independently built sims
- [ ] Live check (the user's): a sliding platform moves identically in two browsers

# 09 — A Motion that speeds up

**What to build:** A Ramp on any Motion (Spin, Swing, Slide): "N times as fast,
T seconds after the Round starts running", linear, then held. The Round's start
is the Motion Clock, replicated from the Countdown on so a client predicts it
exactly. ADR 0123.

**Blocked by:** —

**Status:** done on tests (2026-09-23) — every feel check is the user's

- [x] `SegmentMotion.ramp?: { multiplier, seconds }`, validated at publish
      (multiplier > 0, seconds > 0, both finite)
- [x] `motionPose` / `motionChainPose` / `motionPointVelocity` /
      `movingSegmentPose` take an optional Motion Clock (the Tick the Round runs
      from, or `null`). No clock → the Motion exactly as before
- [x] `RapierSimulation.syncMotionClock`; the server sets it from the first
      Countdown Tick, clears it back in the Lobby, and sends it as
      `SnapshotMessage.runningFromTick`; the client adopts it every snapshot, the
      way it adopts `roundRules`
- [x] The client's renderer and sounds pose with the same clock; free-roam
      practice runs it from Tick 0
- [x] The builder's MOTION panel: RAMP (×N, seconds) for any Motion; the preview
      runs the clock from the scrubber's 0. MCP `set_motion` takes `ramp`
- [x] Tests (shared): no Ramp or no clock is byte-identical to today; the warped
      clock is continuous at both ends of the ramp; a ramped Spin reaches
      N × its speed and holds it; a ramped Swing's period shrinks N×; a client
      simulation with the replicated clock poses a Moving Segment exactly as the
      server's does

## Notes

- Off by default: no def carries a Ramp, not even the three-arm sweeper's (the
  user's call, 2026-09-23).

## As built

- **One warp, `motionSeconds`.** Every kind reads the Ramp-warped time instead
  of `tick · TICK_DT`, and `motionPace` is its slope. The Spin's angle, the
  Swing's and the Slide's `backAndForth`, riding and Impact all follow from it,
  so nothing downstream learned the word.
- **`motionClockFor(state, roundStartTick, countdownMs)`** in `MatchPhase.ts`
  is the one answer to "when does this Round run from". The server syncs it
  into its own simulation before each Tick and sends it as `runningFromTick`.
- **`syncMotionClock` re-places every Moving Segment** when the clock changes.
  A client that joins mid-Ramp would otherwise sweep from a stale pose for one Tick.
- **Sounds follow the pace.** Each piece is heard on its own warped clock, so a
  sped-up hammer wooshes as often as it swings, and its loudness takes the pace.
- **The builder's preview** runs every Ramp from `PREVIEW_MOTION_CLOCK = 0`. A
  Motion edit no longer rebuilds nothing: `refreshPartPlans` re-reads each Part's
  plan and the Impact tint's Motion on the transform-only path. Before, a parted
  Asset's preview only followed a whole-Segment `motion` because
  `partPose` read `segment.motion` live.
- **Measured:** the three-arm sweeper's middle arm, 4.5 m out, shoves at its own
  72°/s and knocks down at ×3. The two runs differ only in the Motion Clock
  (`AssetPart.test.ts`).
- The RAMP card's default (×2 over 60 s) is a first guess.


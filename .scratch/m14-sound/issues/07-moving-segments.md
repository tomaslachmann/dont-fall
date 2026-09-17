# 07 — Moving Segments: swings, spins and slides

**What to build:** every Moving Segment (ADR 0061) and Spinner is heard near it.
**ADR 0087.**

**Blocked by:** 02

**Status:** done on tests (2026-09-17). Hearing it in a game, and whether a whoosh per sweep is too busy, is the user's check.

## How it behaves after

- **Swing** (hammers, pendulums): a woosh as the swing passes its fastest point,
  louder the faster the Motion. The speed comes from the same pure pose function
  the renderer and the simulation use, sampled at the prediction tick
  (`stage.updateMotion`'s `t`).
- **Spin** (spinners, rotating bars, spinning squares): no loop (user,
  2026-09-17). A woosh plays when a bar's tip sweeps past the listener, at the
  point of closest approach. It is louder the faster the tip moves and the
  closer it passes. A bar sweeping past someone else far away stays silent
  under the budget.
- **Slide** (moving platforms, doors): a clunk at each end (its `pause`), and a
  low rumble loop while it travels.
- **Which sound:** a default per Motion kind, overridden per Asset by a client
  table keyed by Module id (e.g. `trap_hammerbig` → a heavier swing). Assets
  with no entry use the Motion default.
- Only the nearest few loops of each kind play (02's budget). A far hammer's
  woosh is never created.
- A Track decodes only the slots of the Segments it places.

## What to change

- [x] Motion speed and "passed the fastest point" / "reached an end" as pure
      functions of the Motion config and `t`, tested against
      `movingSegmentPose`
- [x] The Module id → sound table (client), with a test that every entry names
      a known slot and a placed Module
- [x] Emitters placed at each Segment's world pivot, following a Segment that
      rides another's motion
- [x] The Spinner (M1) through the same spin rule
- [x] "A bar passed the listener" as a pure function of the spin config, the bar's length and `t` (the tip's closest approach crossed since last frame), with tests

## Notes

- Research §8.
- Sounds are timed to the drawn Motion, which is the prediction tick, so a
  hammer's woosh lines up with the hammer you see about to hit you.

## As built

- **`audio/segmentMotion.ts`** holds the pure functions. They use the same `backAndForth` and spin
  angle as `motionPose`.
  - `swingPeaksCrossed`: the fastest point along a leg, per easing (`FASTEST_ALONG_LEG`). That is
    the middle for `linear`/`easeInOut`, the arrival (the slam) for `easeIn`, and the departure for
    `easeOut`. It counts crossings in (from, to], with the phase.
  - `swingPeakAngularSpeed`: 2·amplitude·(steepest ease slope)/leg.
  - `slideStopsCrossed`: arrival at either end.
  - `slidePeakSpeed`, and `slideSpeedAt`, which is 0 while paused.
  - `spinTipPasses(spin, tips, listenerAngle, from, to)`: evenly spaced tips crossing the
    listener's angle, either way round.
  - Tests check them against the real `motionPose`: where it turns fastest, where it arrives, and
    its numeric speed.
- **`audio/segmentSounds.ts`:**
  - **Sound table:** `MOTION_SOUNDS` holds the defaults per kind. `SEGMENT_SOUND_OVERRIDES` (keyed
    by Module id) makes `trap_hammerbig` and `trap_trapball` use `segment.swing_heavy`, and can also
    set `spinTips`. A test checks that every entry names a known slot and a placeable Module.
  - **`segmentSoundSlots`:** what a Track's moving pieces need.
  - **`SegmentSounds`** is fed `updateMotion`'s `t` (the drawn prediction tick) and the camera.
    - **Swing:** a woosh at the piece's drawn centre per crossing. Gain is tip speed
      (peak angular speed × the farthest corner from the swing axis) / 12 u/s, floor 0.3.
    - **Slide:** a clunk at each end. A `segment.slide_rumble` loop per slide, whose gain is
      speed / peak speed, placed at the centre. It is 0 while paused, so 02's nearest-k culls it.
    - **Spin:** a woosh when a tip points at the listener, at the tip circle's point nearest the
      listener. Gain is tip speed / 12, floor 0.3. Spins with a tip under 4 u/s are silent
      (`SPIN_PASS_MIN_TIP_SPEED`), so a slow turntable (the base race's 0.55 rad/s discs) doesn't
      whoosh every quarter turn.
    - **Tips:** the farthest bounds corner is the first tip. A piece at least half as wide across
      it is a square with 4 tips. Anything narrower is a bar with 2.
    - **Spin combined with a swing or slide:** the spin's own turn is taken off the pose, so the
      pivot and axis follow what carries it.
    - **The M1 Spinner:** 2 tips at `armLength`, about +Y.
    - **Clock jumps:** a jump over 0.5 s, or backwards (a new Round, a Track swap), is silent.
- **Stage:**
  - It builds `SegmentSounds` from each Moving Segment group's rest `localBounds` corners, and
    calls it in `updateMotion`. The camera has not moved yet at that point, so the listener is
    last frame's.
  - Moving Segments are never nested in the Stage, so "a Segment that rides another's motion" is
    the pose's own composition (spin → swing → slide). The emitter follows the pose.
- **Per-Track decoding:** `audio/stageSounds.ts: stageSoundSlots(track)` is `STAGE_SOUND_SLOTS`
  plus this Track's moving pieces.
  - Boot (match and practice) still starts the Character sounds in parallel. It then loads the
    Track's full set, and files already decoded are shared.
  - The live Track swap loads the new Track's set.
- **Not done:** the research note suggested a spin whirr loop. The ADR amendment dropped it (the NC
  file), so spins pass instead.

### Changed after (user, 2026-09-17)

- **Sound:** the spin pass is now a single take, moogy73's `woosh_low_04` (the user's pick, the same
  take `segment/swing_3` uses). It replaces the two short wooshes, and the library was rebuilt with
  `pnpm build:sounds`.
- **Timing:** the file is 2.5 s long, and its loudest stretch is 0.4–0.7 s in, with the tail fading
  out by about 1.8 s. It starts at the moment of closest approach, so the swell lands about half a
  second after the bar has passed. Starting it earlier, with the pass predicted from the pure spin
  angle, would line the swell up with the pass. That is not done yet and is left as the user's call.

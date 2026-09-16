# 04 — Floating: BLIP stays alive in an updraft

**What to build:** the float animation picked in 00 (`LOOP` or `HOLD`) for the local Character and
for every remote one.

**Blocked by:** 00 (made: **LOOP**, at the prototype's defaults).

**Status:** done on tests (2026-09-16). Recorded as **ADR 0077**. The look in play is the
user's to check.

## Decided: no new "Flying" state (user's question, answered 2026-09-16)

**Agreed with the user:** no new `CharacterMotionState`. Floating is render-side, next to
`JumpSequences`.

- Each motion state exists because it changes what input or physics does. `Stagger` scales input,
  `Sliding` changes movement, and `Ragdoll` takes the body. Riding an updraft changes neither: the
  Character stays `Controlled` with full air control, and the Volume only adds force.
- Whether a Character is in an updraft is a pure function of its position (ADR 0036; the sim picks
  it with `pointInOrientedBox` over the priority-sorted Volumes). The client already has the
  resolved Volumes and every Character's position, so it can compute this for remote Characters
  too, with no new replicated bit.
- A sim state would cost a protocol change and an ADR 0013 snap path, and buy no gameplay.
- It becomes a sim state (with its own ADR) the day floating changes a mechanic: less air control,
  no Dash or Hit while aloft, a glide verb, a flight Power-up.
- Needs a glossary term. **Proposed:** **Floating** (a Character held aloft by a Volume), added to
  `CONTEXT.md`.

## What changed

- [x] Shared: `byVolumePriority`, `volumeAt` and `holdsAloft` in `Volume.ts`. `RapierSimulation`
      now picks its Volume through the first two (no change in behaviour), so the renderer asks
      the very same question.
- [x] `jumpSequence.ts`: `JumpFrame.inUpdraft`, the latch (`FLOAT_RELEASE_MS`), the speed-mapped
      loop (`floatLoopTarget`, breathe, settle), `floatWeight` / `isFloating`, and no relaunch
      while Floating. All at the prototype's numbers.
- [x] `floatPose.ts`: `blendFloatStruggle` (Struggle_Air at 30% and 0.7×) and `FloatLimbs` (the
      procedural layer), at the prototype's numbers.
- [x] Wired into the local Character (`scene.ts`, from the stashed capsule centre) and every
      remote one (`remoteCharacterPool.ts`, from its interpolated position). Both draw the layers
      only under the jump's own pose, and stop them on a knockdown.
- [x] `CONTEXT.md`: **Floating**.
- [x] Tests: `Volume.test.ts`, the Floating block in `jumpSequence.test.ts` (a simulated ride in
      the fan's field), `floatPose.test.ts`, and a `modelBones.test.ts` pin that the real BLIP
      has every bone the layer drives.
- [ ] The look in play (the user's). The prototype's sign conventions carried over unchanged, and
      the user saw them there.

## Notes

- Floating is latched (00). The release time must outlast the bob's overshoot above the column.
- The fall after floating is paced to the floor below (a raycast, or the Stage's existing floor
  query), not to the floor jumped from. That floor can be seconds and metres away by then.
- Grab, Hit and down-state precedence stay as they are in `scene.ts`: floating is one more
  candidate under them.
- Tests: the latch, the speed→playhead mapping, and the hand-back to forward-only pacing are pure
  and belong in `jumpSequence.test.ts`'s style.

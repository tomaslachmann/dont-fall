# 03 — The pose-matched get-up

**What to build:** Physics ends where the clip begins (the user's idea, 2026-09-20: "predat
rapieru startovni pozice do ceho ma dosahnout"). At `Ragdoll → GettingUp` the server sweeps the
bones kinematically from the heap onto `GetUp_F`/`GetUp_B`'s first frame over `GETUP_DRIVE_MS`;
the clip then plays from frame 0 at full weight with nothing to hide.

**Blocked by:** 01, 02

**Status:** done on tests (2026-09-20), one gap named below — every live check is the user's

- [x] The bake captures `GetUp_F`/`GetUp_B` frame-0 world transforms for all 15 bones (rig-origin
      frame: origin on the floor, facing +Z) into the same generated spec
- [x] `simulation/ragdoll/getUp.ts` — `matchGetUp(bones)` (side from the chest's belly sign, yaw
      from the heap's spine vs the clip's own head−pelvis line, origin pinned under the pelvis),
      `getUpFloorY` (the clip's lowest bone onto the heap's lowest bone — both are a body resting
      on the ground, so no ray is needed and a body settled on a Prop still agrees) and
      `getUpTargetOf` (one bone's placed target). Pure and shared: the simulation sweeps by it and
      the client reads the landing back off the same rule
- [x] `RagdollController.beginGettingUp` matches and starts the sweep; `advanceGetUp` runs one
      smoothstep step per tick before the world steps, bodies `KinematicPositionBased`
      (`AuthoredRagdoll.startSweep` / `sweepStep`) — never velocity-driven, which the bench
      measured fighting the floor contacts into a bounce. The capsule waits at the clip's own
      origin from the first tick
- [x] `GettingUp` lasts `GETUP_TOTAL_TICKS` = `GETUP_DRIVE_TICKS` (900 ms, new tuning constant)
      + `GETUP_MS`; control still returns at the planted-feet frame
- [x] `pose()` serves the swept bones throughout — live during the sweep, then the clip's own
      first frame frozen; `position` travels from the settled pelvis to the clip's origin over the
      sweep (the body really is moving that far), so `position.y − CAPSULE_BOTTOM_OFFSET` is
      exactly the floor the clip is played on. `blendGettingUpBones` retired
- [x] Client: bones through the sweep, then `GetUp_X` from frame 0 at **full weight, crossfade 0**,
      with the rig turned to `landing.yaw` — the two encodings of one pose must never blend
- [x] The landing is derived from the replicated bones by the same `matchGetUp` — no new wire
      field. Pinned by an idempotence test: matching a *placed* clip pose returns the placement it
      was given (side, yaw and origin), which is what makes the handover exact
- [x] Tests: `getUp.test.ts` (6) — side, idempotence over four yaws and both sides, origin is the
      clip's not the pelvis's, every bone's target reproduces the placed pose, the floor;
      `CharacterStateMachine.test.ts` moved to `GETUP_TOTAL_TICKS`; the client's two-phase
      handover in `knockdownAnimation.test.ts`

## The gap

The **drawn rig's yaw during the clip is set from the landing, but the simulation's own `facing`
is not** — so a client that draws from `facing` alone (a rig that joins mid-get-up and has no
bones yet) can start the clip turned the wrong way, and the Character hands control back facing
where it was knocked down rather than where the clip stood it up. Both renderers read the landing
off the bones, which they always have while down, so nothing visible is wrong today. Closing it
means writing the landing yaw into `currentFacing` when the sweep starts — a one-liner that
touches what the client sends (ADR 0085), so it wants its own look.

## Notes

- F/B only: with the free yaw match a body lies belly-up or belly-down, so the four diagonal
  GetUp clips stay bound and unused — they exist for authored falls this port removes.
- `modelBones.test.ts` drops "KO length == RAGDOLL_MIN_MS" (no longer coupled) and keeps the
  planted-feet pin `GETUP_MS` relies on.

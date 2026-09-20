# 02 — The knockdown is drawn from the bones

**What to build:** While a Character is `Ragdoll`, its rig is posed from the fifteen replicated
bones — the bench's sync recipe — instead of playing `KO_X`. Supersedes ADR 0076's look for the
fall only; the GetUp clip stays (ticket 03). The user's call, 2026-09-20: "my chceme nahradit i KO
tim co se vytvorilo v rubber/ to fyzikalni."

**Blocked by:** 01

**Status:** done on tests (2026-09-20) — every live check is the user's

- [x] `render/ragdollRig.ts` rewritten to the bench's sync: parent-first **full local transforms**
      (position and rotation, no bind offset — the authored bodies sit on the rig's own pivots),
      each solved against the parent's real `matrixWorld` so the model's uniform scale divides out
      and composes back, scale discarded, `updateMatrix`/`updateMatrixWorld` per bone. The old
      rotations-only pose, the `RIG_NODE` translation table and the measured L/R de-mirroring are
      gone with the mushroom-era skeleton they were written for: the spec names BLIP's own bones,
      so `boneOf` (dot-stripping) resolves them directly
- [x] Bone names come from the shared spec's wire order; the wire itself stays nameless
- [x] `knockdownAnimation.ts` returns a `KnockdownDraw` — `{kind:"bones"}` or
      `{kind:"clip", pose, landing}` — instead of a clip pose. `Ragdoll` is always bones
- [x] `stage/localCharacter.ts` and `remoteCharacterPool.ts` pose from the interpolated bones
      while down (`mixer.stopAllAction()`, `activeAction = null`, `ragdollRig.pose(bones)`), and
      reset the undriven bones (GLB `root`, crest, eyes) to bind on the entry edge —
      `restUndriven()`, the bench's stale-root fix. The remote pool tracks that edge per rig
      (`wasDown`)
- [x] `KnockdownOrigin` / `knockdownFeetY` stay — they still place the rig for the get-up clip
      (and keep a rig whose bones have not arrived yet standing sensibly); the bones override
      them while they drive
- [x] `KO_X` / `Death_X` stay bound, driven by nothing
- [x] Tests: `ragdollRig.test.ts` rewritten (7) — every bone lands exactly on its body in world
      space, the body holds together at model scale 0.58 / 1 / 2.4 (the bench's measured
      58%-of-offset bug), no bone is ever scaled, the carrier is left alone;
      `knockdownAnimation.test.ts` rewritten to the two-phase contract (22)

## Notes

- `RAGDOLL_PELVIS_TO_FEET` is still read by the clip phase's vertical placement; it now derives
  from the baked spec.
- The Euler-mirror invariant (write the rig orientation whole, keep yaw in JS) is untouched in
  both renderers.

## Notes

- A local Character while down is already drawn from the interpolated server world
  (`ownDrawnFromServer`) — the bone path slots in behind the same switch; the Euler-mirror
  invariant ("write the rig orientation whole, keep yaw in JS") in
  `remoteCharacterPool.yaw.test.ts` / `localCharacter.test.ts` must stay green untouched.
- ADR 0076's open bandwidth follow-up ("drop the bones from the snapshot") closes the other way:
  the bones get their reader back.

# 05 — Grab's arm-reach

**What to build:** A grabbing Character's arms visibly reach toward whoever it's holding — Grab
(M6 ticket 04) shipped with no visual at all, deliberately deferred at the time for exactly this
reason: the rig has no Grab/Hold/Catch clip.

**Blocked by:** nothing new — reuses `RapierSimulation`'s existing `activeGrabs` relationship.

**Status:** done, revised twice from live feedback (bone-name bug fixed, then the whole feel
redesigned) — live visual verification still not possible from this session, see below

## Why

MushroomKing's full clip list is Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No,
Punch, Run, Walk, Wave, Weapon, Yes — nothing depicts grabbing or holding. Reusing an existing
clip (closest candidate: `Weapon`, an arms-forward stance) would be cheap but generic — it doesn't
actually reach toward the held Character, and a Character being held can still move around inside
the grabber's own cone, so a fixed pose reads wrong as soon as they drift.

## What changed

- [x] `grabbingId: string | null` joins `CharacterSnapshot`/`CharacterSnapshotFields`/`RenderCharacter`
      — the id of whoever a Character is currently grabbing, `null` on the held side and for
      anyone not engaged. Set by `RapierSimulation.updateGrabs` (same "not engaged until proven
      otherwise" default as `grabSpeedMultiplier`, in the same per-tick reset/re-apply pass) and
      exposed via a new `CharacterController.setGrabbingId`. Not in `ReconcileBase`: like
      `hitReactEpoch`, it's cross-Character authoritative state with no local prediction to
      reconcile — Grab itself is authoritative-only (ticket 04's own known limitation)
- [x] `apps/client/src/render/armReach.ts` (new, TDD'd against real `THREE.Object3D` hierarchies,
      no WebGL needed): `applyArmReach` aims each upper arm's own bone axis (local +Y — the
      direction toward its child, the convention `ragdollPose.ts` already relies on) at a world
      target, computed in each shoulder's own local frame so the result is valid regardless of
      the rig's own non-trivial bind orientation (confirmed from the raw glTF: `Shoulder.L`'s own
      bind quaternion is nowhere near identity). The lower arm, if present, is reset to its own
      *bind-pose* rotation every frame this runs — without it the forearm keeps playing whatever
      the walk/idle clip already had it doing, visibly dislocated from the now-pinned upper arm
      above it; freezing it at the bind rotation (defined relative to the upper arm's own frame,
      not a fixed world pose) reads as the model's natural resting elbow bend wherever the upper
      arm now actually points
- [x] Wired into both `scene.ts` (local Character — `Stage.updateCharacterAnimation` gains a
      `grabTargetPosition` parameter, resolved in `game/index.ts` from `remoteCharacters` since
      the local player's own held target is always some other, non-local Character) and
      `remoteCharacterPool.ts` (every remote rig — `RemoteCharacterPool.apply`/`Stage.applyRemoteCharacters`
      gain `localId`/`localPosition` so a remote grabber can reach toward the LOCAL player
      specifically when *they're* the one being held, since the local player is the one Character
      never present in the remote-characters map)
- [x] Aims at chest height (`ARM_REACH_TARGET_HEIGHT` above the target's own root position), not
      the target's feet

## Known limitation — flagged, not fixed

**No live visual verification.** This session's browser automation tooling is unavailable in
this environment (an OAuth account mismatch unrelated to this change), so the pose has been
proven correct only mathematically (`armReach.test.ts` asserts the upper arm's resulting world
direction lands within `1e-4` radians of the true direction to the target, including with a
non-trivial shoulder bind rotation) — never actually looked at on the MushroomKing model. Whether
it *reads* as "reaching" rather than "twisted" needs a real browser: two Players, one grabs the
other, watch from both sides and from a third spectator's own camera. `ARM_REACH_TARGET_HEIGHT`
(0.8) is a first guess, not a tuned value.

## Deliberately out of scope

- **No held-side pose.** The held Character's own struggle-away movement already drives its
  ordinary Run/Walk locomotion, which reasonably reads as "struggling" on its own; this ticket is
  about the grabber's own visual only.
- **No remote-side charge-style HUD/UI tell** — arm-reach is a 3D pose, not a HUD element; nothing
  new needed there.

## Code review findings and fixes

`/code-review medium` — 3 real bugs fixed, 2 pre-existing observations acknowledged without a
code change:

- **Fixed — the local player never saw their own arm-reach pose, and never saw their own
  HitReact.** `game/index.ts` read `grabbingId`/`hitReactEpoch` from `c` (`localSim.snapshot()`),
  but `localSim`'s own Character map only ever holds `myId` itself — every other Player is a
  lightweight `MirrorCharacter` for collision (`RapierSimulation.syncMirrorCharacters`), never a
  real second `CharacterController`, so Grab/Hit resolution (which both require a real second
  Character) can never run against it. `hitReactEpoch` was broken the same way since M6 ticket 03
  shipped it — that ticket's own notes explicitly (and, it turns out, wrongly) generalized
  "read the raw local snapshot directly, like `dashCooldownMs`/`dashing`" to a field that, unlike
  Dash, isn't actually locally derivable. Fixed by resolving both from `serverOwnCharacter`
  (already computed for the local Character's own down-state pose) instead, falling back to
  `0`/`null` before the first server snapshot arrives. `hitEpoch` itself stays read from `c` —
  the striker's own swing firing *is* a pure function of locally-replayed input, unlike whether it
  landed on someone else.
- **Fixed — a Hit landing on an already-down Character left the HitReact/Punch baseline stale for
  the rest of the knockdown, misfiring a reaction the instant Controlled resumed.** Hit's
  targeting doesn't exclude a down target (it reuses Bump's own "flailing an already-down
  Character is fine" precedent), so `hitReactEpoch` can change while `updateCharacterAnimation`/
  `updateRig`'s down-state branch is returning early every frame, never reaching
  `HitReactionPlayer.update()` to absorb it. The stale baseline then reads as a brand-new reaction
  the moment the down-state pose hands back to locomotion. Fixed with a new
  `HitReactionPlayer.observeBaseline(hitEpoch, hitReactEpoch)`, called from both down-state
  branches every frame (not just on the entering transition, since a second Hit mid-Ragdoll needs
  the same treatment as the first). Verified as a real bug before fixing: reverted `observeBaseline`
  to a no-op, watched the new regression test go red, restored it.
- **Acknowledged, no fix — two structural observations about pre-existing, unrelated code**:
  `ragdollPose.ts`'s `apply()` calls `updateMatrixWorld(true)` three times per invocation where one
  (at the end, to read the pelvis) is likely sufficient, a real perf concern at a 12-rig ceiling but
  untouched by this ticket and risky to change without visual re-verification of its own; and the
  per-Character render orchestration (down-state pose vs. reaction priority vs. locomotion vs.
  arm-reach, and the ordering between them) is duplicated between `scene.ts` and
  `remoteCharacterPool.ts` rather than factored into one shared function — the exact
  `observeBaseline` bug just above existed independently in both copies, which is the duplication's
  own cost made concrete. Both are real, pre-existing (not introduced by this ticket), and out of
  scope for a Grab-visual ticket; flagged here rather than silently noticed and dropped.

Re-verified afterward: full monorepo typecheck clean; full `pnpm -r test` green (1053 tests).

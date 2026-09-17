# 06 — Fighting: Hit, Grab, knockdown and getting up

**What to build:** the sounds of Characters meeting. **ADR 0087.**

**Blocked by:** 02, 05 (its detectors)

**Status:** done on tests (2026-09-17). Hearing it in a game is the user's check.

## How it behaves after

- **Hit swing:** a woosh when `hitEpoch` rises, louder with the charge it fired
  at.
- **Hit landed:** a punch (`impactPunch`, medium or heavy by charge) when
  `hitReactEpoch` rises, at the Character hit. Your own Character being hit is
  also louder.
- **Grab:** cloth when `grabEpoch` rises, and a grip when a hold starts
  (`grabbingId` becomes set). A struggle loop while held is optional (if a file
  fits, see 01).
- **Knockdown:** a thud when `ragdollEpoch` rises, keyed by `ragdollCause`:
  - `WallImpact` and `Obstacle`/`Spinner` are heavy;
  - `Bump` and `Hit` are medium.
- **Getting up:** a soft settle when `GettingUp` starts.
- **Bump:** a light impact on the Character bumped (it enters Stagger or Ragdoll
  from a Bump).

## What to change

- [x] Triggers on the detectors from 05, cause-to-slot table as data
- [x] Priorities: your own knockdown and hits highest, remote ones below
- [x] Tests: each event once, the right slot per cause, remote at its position

## Notes

- Research §7. Hit and HitReact epochs and `ragdollCause` are ADR 0023 and M6's.

## As built

- **`audio/fightCues.ts`: `FightCues`**, per id, pure, next to 05's `MovementCues`. Its rules:
  the drawn Character once a frame, the first sight is history, and a replay's second rise is
  silent.
  - **Swing:** `hitEpoch` rises (`RiseLatch`, `SWING_REFIRE_MIN_MS` = 0.8 × the Hit cooldown). The
    charge is the last `hitChargeMs` seen while held, because the charge is 0 again on the tick the
    swing fires. A Stagger or a knockdown discards it.
  - **Struck:** `hitReactEpoch` rises.
    - The victim can't know the charge, so every swing is kept for 600 ms (`HIT_PAIR_WINDOW_MS`).
    - A landed Hit takes the latest swing by someone else within 5 u (`HIT_PAIR_REACH`) and uses it
      up (`chargeOfHitOn`). The pairing runs after every Character's update, because a swing and
      its Hit arrive on one snapshot. Your own predicted swing is ahead of the remote reaction by a
      round trip, and the window covers that.
    - Heavy is `isHeavyHit(charge)`: the swing's `hitImpactMagnitude` reaches `IMPACT_RAGDOLL_MIN`,
      the simulation's own knockdown rule. With no swing seen, the Hit is medium.
  - **Reach and grip:** `grabEpoch` rises (`REACH_REFIRE_MIN_MS`), and `grabbingId` becomes set.
  - **Knockdown:** entering `Ragdoll` (refractory 500 ms, so a mispredicted knockdown undone and
    confirmed is one).
    - The weight is `KNOCKDOWN_WEIGHT[ragdollCause]` (data: WallImpact, Obstacle and Spinner are
      heavy; the rest medium) when `ragdollEpoch` rose with it.
    - **Found here:** a reconciliation snaps a predicting client into `Ragdoll` *without* raising
      its Epoch. Such a knockdown is always cross-Character (a Hit or a Bump), so it is medium.
  - **Getting up:** entering `GettingUp`.
  - **Bump:** entering `Stagger`, or a medium knockdown by a Bump or of unknown cause. It is not
    counted within 300 ms of a landed Hit or a Respawn (`CAUSED_STATE_WINDOW_MS`), which cause the
    state a tick later. It fires at most once per 400 ms.
- **`CharacterSounds`** (05's glue, renamed) plays both.
  - **Your own fighting:** unpanned, at slot priority + `OWN_FIGHT_PRIORITY_BOOST` (2).
  - **Anyone else's:** at their position, × `OTHER_PLAYER_GAIN`.
  - **Swing:** `swingLevel(charge)`, gain 0.5 → 1 and rate 1.1 → 0.9.
  - **Grip and bump:** have no files of their own. The new slots `character.grip` (the punch files,
    quiet, rate 1.3) and `character.bump` (the soft landing files, rate 1.15) reuse existing ones.
  - **Struggle loop:** skipped. No file fits.
- **Engine:** `PlayOptions.priority` overrides the slot's priority for one play, including for
  eviction.
- **`RenderCharacter`** adds `hitChargeMs`, `ragdollEpoch` and `ragdollCause`. They were already on
  the Snapshot.
- **The match loop's own Character:** the local stream gets `hitReactEpoch`, `grabbingId` and
  `heldByGrabberId` from the *latest* server snapshot. The local sim never resolves them. The latest
  snapshot is the one the prediction was just reconciled to, so a Hit is heard before the Stagger it
  forces. The interpolated copy would have been ~100 ms behind that snap.
- **Stage:** `applyMovementSounds` became `applyCharacterSounds`. `STAGE_SOUND_SLOTS` adds the
  fighting slots.
- **Tests:** `fightCues.test.ts`, the fighting half of `characterSounds.test.ts`, and the engine's
  per-play priority.

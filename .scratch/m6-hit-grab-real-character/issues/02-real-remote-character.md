# 02 — A real, oriented, animated remote Character

**What to build:** Every other Player in your Match appears as the same walking, running,
jumping, idling Mushroom King you play as yourself — tinted a distinct color per Player —
never the plain capsule placeholder that's stood in since M2. It faces the direction it's
actually looking, using ticket 01's replicated facing.

Retires the capsule placeholder for good (ADR 0046).

**Blocked by:** 01 — Character facing

**Status:** code done and reviewed (3 substantive `/code-review medium` passes, all findings
fixed; a 4th pass stalled on tooling after 600s with no finding to act on); live perf/visual
check deferred to ticket 05

- [x] A remote Character renders the same shared model the local Character uses, oriented by
      its replicated facing, in place of the capsule
- [x] Idle/Walk/Run/Jump/Dash animation states play correctly for a remote Character, driven
      from its own replicated speed/ground/dash state — no new wire fields beyond facing
- [x] Each connected Player gets a visually distinct, stable color tint, so "who's who" reads
      at a glance the way the capsule's own tint used to
- [x] A remote Character's Ragdoll/GettingUp plays the same canned collapse/recovery the local
      Character already uses — not true bone-driven puppetry (explicitly out of scope)
- [ ] Live-verified with 12 connected Characters: frame rate holds and every one renders and
      animates correctly, satisfying ADR 0011's ceiling — **carried to ticket 05** (its own
      checklist already covers this); not something this session's tooling can drive real
      browsers to confirm on its own

## Implementation notes

**`RenderCharacter` (`packages/shared/src/state/interpolate.ts`) gains `facing`, `velocity`,
`grounded`, `dashing`.** `facing` interpolates by shortest arc (new `math/angle.ts::lerpAngle`,
TDD'd first) on the same discontinuities `position` already snaps on; the rest pass straight
from `next`, uninterpolated — the same treatment `motionState` already has, since they only ever
feed a discrete animation-state decision, never a smoothly drawn quantity. (`dashSpeed` was
originally added alongside these too, but nothing on the remote side ever ends up reading it —
`selectLocomotion` only needs the `dashing` boolean — so code review's finding that it was dead
weight with an over-claiming doc comment was correct; removed rather than inventing a consumer
to justify keeping it.)

**Prefactored local's own animation logic before touching remote**, so both share it instead of
remote re-deriving a second copy:
- `render/locomotionAnimation.ts::selectLocomotion(moving, grounded, dashing)` — pure, TDD'd
  first — is the exact idle/walk/run/jump decision the local Character's `updateCharacterAnimation`
  used to inline. Local now calls it too; behavior is unchanged (confirmed by the full existing
  test suite staying green).
- `characterModel.ts` gained `loadCharacterActions` (binds a mixer to the five named clips,
  including the Death clip's one-shot/clamp setup — previously duplicated inline), `actionFor`
  (locomotion state → the actual clip, with run-falls-back-to-walk), and `crossfadeLocomotion`
  (the fade-in/fade-out swap). Local's own setup and `updateCharacterAnimation` now call these
  instead of five inline `clipAction` calls and a hand-rolled crossfade.
- `render/disposeSceneGraph.ts` — extracted verbatim from `scene.ts` so a remote rig's pooled
  clone can be torn down the exact same way the whole scene already is.

**`render/playerTint.ts::tintHueForId`** — a pure FNV-1a hash of the session id into a stable
hue, TDD'd first. `remoteCharacterPool.ts` turns that into an actual `THREE.Color` (fixed
saturation/lightness) and, critically, **clones every mesh's material before recoloring it** —
`SkeletonUtils.clone` shares material references across clones by default, so skipping this
would tint every player (including the local one) the same color the moment two shared a
material instance.

**`render/remoteCharacterPool.ts`** is the real work: one pooled `{ root, mixer, actions,
activeAction, visualState }` per session id, built via `SkeletonUtils.clone` (needed over a
plain `Object3D.clone()` because a skinned mesh's skeleton bindings don't survive a shallow
clone). Its `updateRig` is a deliberate line-by-line mirror of `scene.ts`'s own local
`applyRenderState`/`updateCharacterAnimation` Ragdoll/GettingUp/leavingDown branching — same
`RAGDOLL_PELVIS_TO_FEET` anchor math (recomputed locally from shared constants rather than
importing it from `scene.ts`, to avoid coupling the two modules for one derived number), same
Death-clip forward/reverse driving, same crossfade. The one genuine difference: local infers
"moving" from raw input (`moveDirection`), which a remote Character doesn't have — it thresholds
replicated `velocity`'s horizontal magnitude instead (`MOVING_SPEED_THRESHOLD`), and needs no
turn-rate-limited facing smoothing (`rig.root.rotation.y = Math.PI - facing`, applied directly)
since `facing` itself is already smoothly interpolated upstream, unlike local's predicted,
unsmoothed one.

A clone inherits the local model's own scale/feet-offset transform for free: `SkeletonUtils.clone`
copies the source root's transform, and `createRemoteCharacterPool` is only ever asked to build a
rig well after `createStage`'s existing local-model setup has already mutated
`characterModel.scene`'s own `scale`/`position` in place — no second bounds computation needed.

**`scene.ts`'s `Stage.applyRemoteCharacters`** gained a `deltaSeconds` parameter (threaded from
`game/index.ts`, the same value already passed to `updateCharacterAnimation`) so each remote
rig's own `AnimationMixer` can advance — the old capsule pool never needed one.

Full monorepo typecheck clean; full test suite green (871 tests across all 6 packages) —
including 12 new tests (`angle.test.ts`, `locomotionAnimation.test.ts`, `playerTint.test.ts`,
plus 4 new `interpolateState` cases) covering everything here that doesn't require an actual
WebGL context. The Three.js-heavy integration itself (`remoteCharacterPool.ts`, the `scene.ts`
wiring) has no unit tests of its own, consistent with the rest of `scene.ts` — matches this
codebase's existing pattern (only pure functions like `wobble.ts` get unit tests there); its
correctness rests on code review plus ticket 05's live verification.

## Code review findings and fixes

`/code-review medium` — 2 findings, both fixed:

- **Fixed — a real bug: a rig whose very first observation of its Character was already
  `GettingUp` never actually stood back up.** `rig.visualState` always starts `"Controlled"`,
  so a Character seen mid-`GettingUp` the very first time this client learns about them (joining
  a Match already in progress, or any other path that builds a fresh rig for an id already past
  `Ragdoll`) hit the same `enteringGettingUp` branch a genuine continuation does — but that
  branch only ever adjusts an *already-playing* `deathAction`'s `timeScale`/`paused`; it never
  calls `.play()`. Three.js's `AnimationMixer` only advances actions it has actually activated,
  so the clip silently never ran, and — since only `enteringRagdoll`/`leavingDown`/the plain
  branch ever reposition the rig — it stayed frozen at its clone-time transform, mid-idle-pose,
  until its *next* full Ragdoll cycle. The local Character can never hit this: it is always
  freshly spawned `Controlled`, never joins mid-animation. Fixed by extracting the whole
  Ragdoll/GettingUp/resume decision into a pure `deathClipPlan.ts::planDeathClip` (TDD'd first,
  9 tests including this exact regression as its own case) that tracks a new
  `everEnteredRagdoll` per-rig flag and returns a distinct `"coldReverse"` case — reverse-play
  the clip from its own fully-collapsed end frame instead of from a real elapsed fall time that
  was never recorded — so the reviewer's exact failure scenario is now a named, tested branch
  rather than a silent fallthrough.
- **Fixed — `RenderCharacter.dashSpeed` was dead weight with an over-claiming doc comment.**
  Added because ticket 02's own text said "driven from replicated speed/ground/dash state," but
  nothing on the remote side ever reads the numeric value — `selectLocomotion` only needs the
  `dashing` boolean. Removed from `RenderCharacter`/`interpolateState`/its test rather than
  inventing a consumer to justify keeping it.

Re-verified with a second `/code-review medium` pass, which found the mirror-image case the
first pass's fix didn't generalize to:

- **Fixed — a rig's very first observation of its Character already being `Ragdoll` played the
  fall animation from frame 0 on an already-downed body**, visibly popping the model upright
  first. `buildRig` always seeds `visualState: "Controlled"`, so `enteringRagdoll` read
  identically whether a rig watched a real fall happen or was just built for a Character who
  fell before this client ever saw them (joining a Match in progress, or any other path that
  builds a fresh rig for an already-down id) — exactly the same class of bug as the GettingUp
  one above, just the mirror transition. Fixed by adding an `isFirstObservation` flag (true only
  for a rig's actual first `updateRig` call) to `planDeathClip`, which now returns a distinct
  `snapDown` case for this: snap straight to the clip's own fully-collapsed end frame, no
  animation played out, `everEnteredRagdoll` still latched true so a later real GettingUp
  resumes normally rather than falling into `coldReverse`. Two new TDD'd regression cases pin
  both this and that contract (`snapDown` counts as a real entry for `resumeReverse`'s purposes).

Re-verified afterward: full monorepo typecheck clean; full test suite green (882 tests —
`deathClipPlan.test.ts` now 11 cases).

A third `/code-review medium` pass (reviewing both the committed ticket 01 range and this
ticket's full working tree) found two more, smaller findings, both fixed:

- **Fixed — `disposeSceneGraph` was disposing GPU resources a remote rig doesn't exclusively
  own.** `SkeletonUtils.clone` never clones geometry, and `Material.clone()` (used by `tintModel`
  for the per-player tint) copies texture references rather than the textures themselves — so a
  remote rig's geometry and every material's textures are the *same objects* the local
  Character's own rig and every other clone still use. Tearing down a departing player's rig
  with the blanket scene-wide sweep disposed those shared resources out from under everyone
  still connected — Three.js's internal GPU caches lazily re-create them on next access so
  nothing visibly broke, but every disconnect was thrashing GPU buffers for every remaining
  player, undermining the exact 12-player perf goal this ticket cares about. Fixed with a new
  `disposeRemoteRig`, scoped to only what a rig genuinely owns exclusively: the cloned
  `Skeleton` (needed once per rig, since each animates independently) and the cloned material
  instances themselves — never their shared geometry or textures.
- **Fixed — `RAGDOLL_PELVIS_TO_FEET` was duplicated verbatim** between `scene.ts` and
  `remoteCharacterPool.ts` (a deliberate call at the time, per that comment — code review
  correctly pushed back on it as real drift risk for zero cost saved). Moved to
  `characterModel.ts`, which both files already import from, and imported by both rather than
  each computing its own copy.

Re-verified afterward: full monorepo typecheck clean; full test suite green (882 tests,
unchanged — both fixes were disposal/dedup, no new test surface).

# 01 — Segment gains full 3D rotation, all the way to physics

**What to build:** A Segment's rotation stops being a single 90°-locked yaw scalar and becomes a
full 3D orientation (yaw + pitch + roll) that's real all the way down — `RapierSimulation`'s static
colliders actually rotate to match, not just visually. No Track builder UI work here; this is the
shared-package + physics foundation everything else in M3.5 builds on.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `Segment` gains optional `pitch`/`roll` fields, defaulting to 0; `rotation` keeps
      meaning yaw. Purely additive — every already-published Revision (including the M1 seed)
      parses and resolves unchanged.
- [x] `Socket` carries a full 3D orientation (not just a yaw scalar), so `placeAfter` composes a
      tilted predecessor's exit Socket correctly against the next Module's entry Socket.
- [x] `placeAfter`/`chainTrack`/`resolveTrack` generalize their yaw-only composition math to
      quaternions internally; degrees remain the boundary representation.
- [x] `packages/shared/src/math/box.ts`'s `rotateBoxYaw90`/`isMultipleOf90` AABB-swap machinery is
      removed (not extended) — replaced by an oriented-box (OBB) representation/overlap test that
      ticket 04 builds on.
- [x] `RapierSimulation`'s static-collider construction calls a real `setRotation()` (quaternion) on
      the rigid body instead of pre-rotating an axis-aligned box by hand.
- [x] A Character can stand on / walk onto a moderately tilted static floor using Rapier's own
      (default, unconfigured) `KinematicCharacterController` slope handling — a sanity check that
      it functions, not a feel/tuning pass (ADR 0034: tuning is explicitly deferred).
- [x] Manually verified: a hand-authored test Track containing a tilted Module renders tilted and
      collides at that exact tilt against a real running Match server; a previously-published
      Revision (the M1 seed) still loads and plays identically to before.

## Implementation notes / scoping decisions made along the way

- **Unit clarification**: `rotation`/`pitch`/`roll` are all **radians** internally and on the wire
  (matching `rotation`'s pre-existing unit) — "degrees at the boundary" (the spec/ADR's phrasing)
  means the editor's human-facing input fields (ticket 02/03), which convert to/from radians right
  at the DOM boundary. The `Segment` type and its JSON shape were never going to become
  mixed-unit (`rotation` in radians, `pitch`/`roll` in degrees) — that would have been a real
  footgun for anyone reading the type later.
- **`OrientedBox.rotation` is optional**, defaulting to identity, rather than required — this let
  every existing `Box`-shaped test literal across the codebase (`RapierSimulation.test.ts` alone
  had ~70 call sites) stay unchanged, since a plain `Box` is still a structurally valid
  `OrientedBox` with "no rotation." Only call sites that actually care about rotation (the new
  tilted-floor physics tests, `Track.ts`'s `orientBox` output) ever populate it explicitly.
- **New math primitives landed in `packages/shared/src/math/`**: `pitchQuat`/`rollQuat` (alongside
  the existing `yawQuat`), `eulerQuat` (yaw∘pitch∘roll composition) and its inverse `quatToEuler`
  (extracts a storable yaw/pitch/roll triple from a quaternion — degenerates only at the
  ±90°-pitch gimbal-lock singularity, a known/accepted limitation of Euler storage, not a bug),
  and `rotateVec3ByQuat` (generalizes the existing `rotateYaw`). All property-tested for
  round-trip correctness across a 15°-grid of angles.
- **Known, deliberately out-of-scope limitation**: a Prop's own shape doesn't tilt with its Segment
  yet (`PropConfig` has no spawn orientation field at all — only its *position* follows the tilt;
  `Prop.ts`'s constructor never calls `setRotation`). Flagged in a code comment as a real, if
  currently latent, step back specifically at a 90°/270°-rotated Segment for an *oblong* Prop — the
  old `rotateBoxYaw90`-based placement used to swap such a Prop's halfExtents to stay visually
  correct there. Every Prop `modules.ts` authors today is a cube (rotation-invariant in shape), so
  nothing currently observable regresses. A Spinner's spin axis similarly stays hardcoded to world
  Y regardless of pitch/roll (only its position and yaw-driven `initialAngle` follow) — pre-existing
  and unaffected by rotation direction, since a Spinner never had shape-swap behavior to begin with.
  Both are separate features (real spawn orientation for dynamic bodies), not this ticket's
  static-collider scope.
- **Rendering**: fixed `apps/client/src/scene.ts`'s `boxMesh` (now applies `box.rotation` via
  `mesh.quaternion.set`) and `apps/track-builder`'s `viewport.ts`/`playtest.ts` (both switched from
  `group.rotation.y = segment.rotation` to the full `segmentOrientation(segment)` quaternion) —
  necessary so the existing renderers stay visually correct against the generalized `Segment`
  shape; none of this is new editor *interaction* (that's ticket 02/03).
- **`trackEdit.ts`'s `rotateSegment`** had its `isMultipleOf90` guard removed (the function it
  imported from `box.ts` no longer exists) but is otherwise untouched — still yaw-only, still only
  ever called with exactly ±90° by today's two toolbar buttons. Pure forward-compatibility unblock
  for ticket 02/03, not new UI behavior.

## Code review (high effort) findings and outcomes

- **Fixed — Checkpoint containment regressed for a 90°/270°-rotated Segment.** The old
  `rotateBoxYaw90`-based placement swapped an asymmetric checkpoint volume's halfExtents to stay
  axis-aligned-correct at 90°/270° (both `checkpoint-spinner` and `checkpoint-end-props` in
  `modules.ts` are asymmetric in X/Z); the initial version of this ticket dropped that with no
  replacement. Fixed properly rather than restoring the old approximation: `Checkpoint.volume` is
  now an `OrientedBox`, and a new `pointInOrientedBox` (un-rotates the query point into the box's
  local frame before the plain axis-aligned check) replaced `pointInBox` for the containment test —
  correct at *any* angle, not just multiples of 90°. New tests in `box.test.ts` and an end-to-end
  `RapierSimulation.test.ts` case (a point outside an un-rotated oblong volume but inside the
  rotated one) pin this down.
- **Fixed — `trackEdit.ts`'s `rotateSegment` silently dropped a non-first Segment's pitch/roll.**
  The `index !== 0` branch built a fresh `{ moduleId, position, rotation }` literal instead of
  spreading `segment`, discarding any tilt propagated from a predecessor through the socket chain.
  Fixed by spreading `...segment` there too, exactly like the `index === 0` branch already did.
- **Left as-is, documented more explicitly — Props don't tilt their shape.** See the note above;
  a real fix means giving `PropConfig`/`Prop.ts` a spawn orientation, a separate feature.
- **Considered and rejected — merging `OrientedBox` into `Box`** (an optional `rotation` field
  directly on `Box` instead of a second interface). Kept them separate: `Box` represents a pure,
  always-local shape (a Module's Footprint bounds, a Prop's local shape) with no placement
  semantics of its own; `OrientedBox` explicitly means "this Box has been placed into world space
  with an orientation." Collapsing them would let a rotation field leak onto types that are never
  meant to carry one.
- **Fixed — a real quaternion-rotation duplicate.** `quat.ts`'s `quatToEuler` had its own private
  copy of the same sandwich-product formula as `vec3.ts`'s `rotateVec3ByQuat`, to dodge an import
  cycle (`vec3.ts` needed the `Quat` type from `quat.ts`). Resolved by moving the `Quat` interface's
  definition into `vec3.ts` itself (re-exported from `quat.ts` for every existing import site) —
  `quat.ts` now imports and calls `rotateVec3ByQuat` directly, no duplicate left.
- **Fixed — a copy-pasted "apply a Segment's transform to its group" snippet** in both
  `viewport.ts` and `playtest.ts`. Consolidated into `render.ts`'s new `applySegmentTransform`,
  used by both.

Verified live: a hand-authored Track (`{ moduleId: "start", rotation: 0, pitch: 0.2, roll: 0.1 }`)
publishes through track-service unchanged, `resolveTrack` produces a genuinely non-identity
rotated static, a real `RapierSimulation` settles a Character on it (`grounded: true`, not falling
through), a real Match server boots fine against track-service holding it, and the M1 seed
(published under the pre-ADR-0034 shape) still resolves with an identity rotation — zero
migration. Also verified via two dedicated physics tests
(`RapierSimulation.test.ts`, "tilted static floor"): a Character resting at opposite ends of a
~15°-pitched plank settles at measurably different heights matching the plank's true tilted
surface (proving the collider is genuinely rotated, not a cosmetic label), and grounds normally on
a moderately tilted floor via Rapier's own default slope handling.

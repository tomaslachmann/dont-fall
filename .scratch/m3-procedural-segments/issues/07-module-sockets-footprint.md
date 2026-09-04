# 07 — Module Socket/Footprint data model, `chainTrack` via Sockets

**What to build:** Replace ADR 0030's single global `MODULE_STEP` with real per-Module Sockets
(named local connection points, `position`+`yaw`) and a Footprint (occupied bounds + clearance),
per ADR 0031. `chainTrack`/`placeAfter` compute placement by aligning a Module's `entry` Socket
against the previous Module's `exit` Socket, supporting real rotation (in 90° increments — static
colliders don't rotate, so anything else would desync visual placement from physics) instead of
always `0`. `resolveTrack` applies this rotation to statics/props/checkpoints (swapping a Box's
X/Z half-extents at 90°/270° via a new `rotateBoxYaw90`) and folds it into a Spinner's
`initialAngle` instead of touching its collider shape.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `Module` gains `sockets: Socket[]` and `footprint: Footprint` (`packages/shared/src/track/Module.ts`)
- [x] `chainTrack(moduleIds, modules, start?, startRotation?)` and new `placeAfter` walk Socket-to-
      Socket; `MODULE_STEP` is removed
- [x] `resolveTrack` applies `segment.rotation` to every local point (`rotateYaw`) and to static
      Boxes/Prop box-shapes/Checkpoint volumes specifically via `rotateBoxYaw90` (X/Z half-extent
      swap at 90°/270°, identity at 0°/180°); Spinners get the rotation folded into `initialAngle`
      instead, since their collider shape never changes — only the body's own rotation does
- [x] `placeAfter`/`rotateBoxYaw90` throw if a resulting world rotation isn't a multiple of 90°
- [x] All 6 M1-derived Modules updated with `entry`/`exit` Sockets 6 units apart (reproducing the
      old `MODULE_STEP` distance exactly) and a shared Footprint
- [x] `M1_TRACK` resolves to the **exact same Segment positions** as before the refactor (regression
      test), and the same beats (6 stops, 1 Spinner, 3 Props, 2 Checkpoints, same Spinner tuning)
- [x] New `rotateYaw` (math/vec3.ts) and `rotateBoxYaw90` (math/box.ts) helpers, unit tested
      directly, including a 90°-turn Module regression test proving rotation actually accumulates
- [x] `apps/track-service/src/generate.ts`, `apps/track-builder/src/trackState.ts` updated for the
      new `chainTrack`/`placeAfter` signatures

**Code review (post-merge):** found `rotateYaw` used the wrong sign convention — matched
`movementDirection`'s mirrored yaw instead of Rapier's `yawQuat`/Three.js's `rotation.y`, which is
what actually rotates Spinners and rendered meshes. Latent (M1_TRACK's rotation is always 0, so it
never triggered) but would have silently misplaced geometry the moment any Module got a 90°/270°
turn. Fixed; `vec3.test.ts` now verifies `rotateYaw` against an independently-implemented
quaternion rotation instead. Also consolidated a duplicated "is yaw a multiple of 90°" check into
one exported `isMultipleOf90`.

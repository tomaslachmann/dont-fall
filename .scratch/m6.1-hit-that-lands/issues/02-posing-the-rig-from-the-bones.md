# 02 — Posing the rig from the ragdoll's bones

**What to build:** While a Character is down, drive the MushroomKing rig from the eleven ragdoll
bones the simulation already replicates, instead of playing the `Death` clip.

**Blocked by:** nothing in code — M6 ticket 05 (ADR 0047) already landed the physics this depends on.

**Status:** done (live verification carried to ticket 03)

## Why

`scene.ts` admits the current arrangement in its own comment: the `Death` clip is played forward for
Ragdoll and *in reverse* for GettingUp, because the rig has no compatible get-up clip. It always
falls the same way relative to facing, whatever hit you.

Everything needed to do better is already on the wire and already smoothed:

- `CharacterController.snapshot()` fills `bones` from `Ragdoll.readBones()` while down, and from
  `blendGettingUpBones` while getting up
- `SimState.characters[id].bones` and `RenderCharacter.bones` both carry them
- `interpolate.ts` interpolates them between snapshots, with a body-swap guard
- `game/index.ts` already treats the server's bone-carrying pose as the single down-state truth

## What to change

- [x] Map each ragdoll bone to its rig node — `pelvis→Body`, `chest→Torso`, `head→Head`,
      `upperArm*→UpperArm.*`, `lowerArm*→LowerArm.*`, `upperLeg*→UpperLeg.*`, `lowerLeg*→LowerLeg.*`.
      Everything unlisted (`Abdomen`, `Neck`, `Shoulder.*`, fingers, `Foot.*`, IK poles) keeps its
      bind pose
- [x] **Rotations only.** The ragdoll's proportions are not the rig's; writing world positions
      stretches the mesh. Take orientation from physics, keep the rig's own bone lengths, then slide
      the whole rig so its pelvis sits where the simulation's pelvis is
- [x] **Capture each bone's offset when the ragdoll activates**, not at load. The ragdoll's bodies
      are upright and unrotated at rest while the rig's arms hang down and out — composing the
      physics rotation onto the *bind* pose assumes those agree, and they do not. That assumption is
      what folded the limbs in the throwaway prototype
- [x] GettingUp uses the same path (its `bones` are already populated), with a clean crossfade back
      to `Idle` at the end
- [x] The `Death` clip stops being played for Ragdoll/GettingUp

## Done when

- [ ] A Character knocked down from four different directions visibly falls four different ways
- [ ] No mesh stretching at any point of the fall or the get-up
- [ ] The handback to `Idle` does not pop
- [x] The local Character and remote Characters use one mechanism, not two — `characterModel.ts`
      already holds the shared rig helpers M6 ticket 02 extracted for exactly this reason

## Watch out for

**Per-frame cost.** Eleven bones × twelve Characters, every frame, with a quaternion decompose each.
Ticket 03 is where that gets measured; keep the posing allocation-free so there is something to
measure rather than something to rewrite.

**Do not let it feed back into the simulation.** This is a rendering leaf. The capsule stays the
authority for where a Character is (ADR 0006), unchanged.

**Done.** `render/ragdollPose.ts` — one module, used by `scene.ts` for the local Character and by
`remoteCharacterPool.ts` for every remote one. Six tests against a stand-in rig (no gltf needed),
including one that pins the thing the throwaway prototype got wrong: the first frame of a knockdown
must leave the rig *exactly* as it found it.

**`planDeathClip` and its test file are deleted.** Its four cases (`collapse` / `snapDown` /
`resumeReverse` / `coldReverse`) existed only to decide how to wind a canned clip when a rig joined
mid-fall or never saw the collapse. Bones have no starting point to get wrong — whenever you begin
watching, they already say what the body is doing. `visualState`, `everEnteredRagdoll` and
`isFirstObservation` went with it.

Recorded as **ADR 0048**, superseding ADR 0046's deferral and M6's matching scope line.

*A bug worth remembering*: the first implementation stored every bone's anchor as the same shared
`Quaternion` — `invert()`/`multiply()` mutate in place, so all eleven entries pointed at one object
holding the last bone's value. Caught by the "leaves the rig exactly as it found it" test, which was
written before the code.

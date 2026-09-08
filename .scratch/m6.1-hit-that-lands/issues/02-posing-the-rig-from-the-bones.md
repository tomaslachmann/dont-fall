# 02 — Posing the rig from the ragdoll's bones

**What to build:** While a Character is down, drive the MushroomKing rig from the eleven ragdoll
bones the simulation already replicates, instead of playing the `Death` clip.

**Blocked by:** nothing in code — M6 ticket 05 (ADR 0047) already landed the physics this depends on.

**Status:** ready-for-agent

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

- [ ] Map each ragdoll bone to its rig node — `pelvis→Body`, `chest→Torso`, `head→Head`,
      `upperArm*→UpperArm.*`, `lowerArm*→LowerArm.*`, `upperLeg*→UpperLeg.*`, `lowerLeg*→LowerLeg.*`.
      Everything unlisted (`Abdomen`, `Neck`, `Shoulder.*`, fingers, `Foot.*`, IK poles) keeps its
      bind pose
- [ ] **Rotations only.** The ragdoll's proportions are not the rig's; writing world positions
      stretches the mesh. Take orientation from physics, keep the rig's own bone lengths, then slide
      the whole rig so its pelvis sits where the simulation's pelvis is
- [ ] **Capture each bone's offset when the ragdoll activates**, not at load. The ragdoll's bodies
      are upright and unrotated at rest while the rig's arms hang down and out — composing the
      physics rotation onto the *bind* pose assumes those agree, and they do not. That assumption is
      what folded the limbs in the throwaway prototype
- [ ] GettingUp uses the same path (its `bones` are already populated), with a clean crossfade back
      to `Idle` at the end
- [ ] The `Death` clip stops being played for Ragdoll/GettingUp

## Done when

- [ ] A Character knocked down from four different directions visibly falls four different ways
- [ ] No mesh stretching at any point of the fall or the get-up
- [ ] The handback to `Idle` does not pop
- [ ] The local Character and remote Characters use one mechanism, not two — `characterModel.ts`
      already holds the shared rig helpers M6 ticket 02 extracted for exactly this reason

## Watch out for

**Per-frame cost.** Eleven bones × twelve Characters, every frame, with a quaternion decompose each.
Ticket 03 is where that gets measured; keep the posing allocation-free so there is something to
measure rather than something to rewrite.

**Do not let it feed back into the simulation.** This is a rendering leaf. The capsule stays the
authority for where a Character is (ADR 0006), unchanged.

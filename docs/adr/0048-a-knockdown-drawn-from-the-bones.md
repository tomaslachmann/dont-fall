# 0048 — A knockdown drawn from the bones

ADR 0046 gave remote Characters a real model and said their Ragdoll/GettingUp would reuse "the same
canned Death-clip collapse the local Character already plays, not true bone-driven puppetry (out of
scope)". M6's own scope note said the same. This supersedes both.

The clip arrangement was always a workaround, and `scene.ts` said so: MushroomKing's `Death` clip
was played forward for Ragdoll and *in reverse* for GettingUp, because the rig has no get-up clip.
It falls the same way relative to your facing whatever hit you — while the physics ragdoll
underneath already reacted to the real Impact, and is already replicated, interpolated, and
authoritative for where a Character ends up lying.

Bone-driven rendering was built during M6 and rejected on sight. The reason was not the rendering:
the ragdoll had free ball joints and no self-collision, so it folded into a lump — pelvis to head
collapsed from `0.75` to `0.07` under gravity alone. ADR 0047 fixed that. With a ragdoll that holds
a body shape, the objection is gone.

## Decision

- **While a Character is down, its rig is posed from the eleven replicated `BoneSnapshot`s**, local
  and remote alike, from one module (`ragdollPose.ts`). The `Death` clip stops driving Ragdoll and
  GettingUp.
- **Rotations only, never positions.** The ragdoll's proportions are a generic humanoid's and the
  rig is a mushroom; writing bone world positions stretches the mesh between them. Orientation comes
  from physics, the rig keeps its own bone lengths, and the whole rig is then slid so its pelvis
  sits on the simulation's pelvis.
- **The anchor is taken on the first frame of a knockdown**, as `inverse(physics rotation) × (rig's
  current world rotation)` per bone. A ragdoll body's rest orientation is upright and unrotated
  while the rig's arms hang down and out; composing the physics rotation onto the *bind* pose
  assumes those agree, and folds every limb into the torso. Anchoring live also means the fall
  starts from the pose the Character was actually in, with no pop.
- **The mapping is deliberately partial.** Eleven bones drive eleven of the rig's forty-three
  joints; `Abdomen`, `Neck`, `Shoulder.*`, the fingers, `Foot.*` and the IK poles keep their bind
  pose and travel inside whichever mapped parent they hang from.
- **GettingUp is the same path**, because `blendGettingUpBones` already fills `bones` for it. There
  is no second mechanism, and no clip to unwind.

## Considered options

- **Turn the canned clip toward the blow** — built and rejected on sight. A rigid rotation of a
  backward fall is a backward fall in a rotated frame: the character visibly pivots before going
  down, and it cannot be fixed by choosing a better pivot.
- **Derive sideways death clips from the existing one** — built and rejected. Rotating each bone's
  displacement about its own rest position is five different axes, so the IK foot bones stopped
  agreeing with the legs and the mesh tore. There is no rigid transform that turns a fall without
  also turning the pose it starts from.
- **Author real death animations** — the right answer for a project with an animator, and no answer
  at all here. It also does not scale: a clip per direction, none of them reacting to the terrain,
  the Prop, or the other Character actually involved.
- **Keep the clip for remote Characters only** — rejected. Two mechanisms for one thing, and the
  remote path is where the clip's handling was *worst*: `planDeathClip` had four cases purely to
  decide how to wind a canned clip when a rig joined mid-fall or never saw the collapse.

## Consequences

- **`planDeathClip` and its tests are deleted.** Its four cases existed only to wind a clip from an
  unknown starting point. Bones have no starting point to get wrong: whenever you begin watching,
  they already say exactly what the body is doing. This is the clearest sign the seam was in the
  wrong place before.
- **Every knockdown is different**, and reacts to what is actually there — the ground, a Prop, the
  Character that hit you. That is the whole gain, and it is also the risk: an animator-posed fall is
  never ugly, and a physical one sometimes is.
- **More work per frame**: eleven bones posed per downed Character per frame, each with a
  quaternion decompose. ADR 0046's twelve-Character commitment now has this behind it, which is why
  M6.1 verifies it with several down at once rather than assuming.
- **The rendering is still a leaf.** The capsule remains the authority for where a Character is and
  what it collides with (ADR 0006). Nothing here feeds back into the simulation.

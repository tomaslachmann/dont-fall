# 0047 — A ragdoll that holds its shape

ADR 0006 gave the Character an articulated ragdoll of eleven bones joined by **free ball joints**,
with self-collision off. That was the right call for what it was: the ragdoll was only ever drawn as
bare capsules, and a loose, boneless flop is funny — "hilarious when you fail" is the third line of
the project's own design philosophy.

It stopped being the right call quietly. M6 ticket 02 put a real skinned model on screen, and the
ragdoll's own settle position is what places a downed Character — `apps/client` deliberately renders
the server's bone-carrying pose while down, because per-machine ragdoll physics drifted otherwise:
*"there is exactly one down-state position/pose on screen, and it's the server's."*

Measured in a standalone harness built from the project's own `RAGDOLL_BONES` and `RAGDOLL_GROUPS`
— gravity only, no blow, feet starting on the floor — the distance from pelvis to head, `0.75` in
the authored standing pose:

| | settled |
|---|---|
| free ball joints, no self-collision | **0.07** |
| with joint limits | **0.75** |

The skeleton folded into a point in under two seconds. Not a loose flop — a lump. The canned `Death`
clip drawn over it hides the shape, but not the place: a Character lies wherever a collapsed lump
came to rest.

## Decision

- **Joints that hinge on a body become hinges, with limits.** Elbows, knees, the spine and the neck
  are Rapier `revolute` joints with a signed range. Elbows and knees bend the way a limb bends and
  no further.
- **Shoulders and hips stay free ball joints.** A cone limit is what one would actually want there,
  and Rapier 0.20's `SphericalImpulseJoint` has no `setLimits` to express one. A limb swinging
  freely from the torso still reads correctly, where an elbow bending both ways does not — so this
  is a deliberate remainder, recorded rather than left to be rediscovered.
- **Ragdoll bones collide with each other**, so an arm no longer passes through the chest it hangs
  from. This settles the question `collisionGroups.ts` deferred as *"Ragdoll-vs-ragdoll is a
  deliberate later call (research §3.3)"* — and it applies between two Characters' ragdolls too,
  not only within one.
- **Bones that share a joint keep contacts off** (`ImpulseJoint.setContactsEnabled(false)`). They
  overlap at the joint by construction; once bones see each other at all, that overlap would become
  a permanent shove pushing the skeleton apart from the inside.
- **The limits are the loosest ones that still read as a body**, named in `tuning.ts`. The spine and
  neck are deliberately generous: a ragdoll that holds itself straight is a mannequin, and ADR 0006
  wanted the flop.

## Considered options

- **Leave it and fix the look in the renderer** — rejected, and tried first. The clip could be
  turned toward the blow, or the model driven from the bones; both were built and both were
  rejected on sight. Neither addresses the fact that the *authoritative settle position* is a lump,
  which no renderer can undo.
- **Author sideways death animations instead** — rejected as the wrong layer, and it does not scale:
  a clip per direction, none of them reacting to the terrain, the Prop, or the other Character that
  is actually involved.
- **Self-collision alone, no limits** — rejected by measurement: it moves the settled spread by 0.03.
  Its value is that limbs stop passing through the torso, which the limits do not cover; it is the
  smaller half, and the one to drop first if twelve simultaneous ragdolls ever cost frame rate.
- **Cone limits on shoulders and hips via a generic joint** — deferred. Modelling a cone out of
  `JointData.generic`'s locked axes is a bigger change than the problem currently justifies.

## Consequences

- **This amends ADR 0006, which is not superseded.** The ragdoll is still a separate articulated
  body activated on impact, and the flop is still the point. It is bounded now, not stiffened.
- **This is replicated behaviour.** `Ragdoll` is stepped by the shared simulation, so the change
  lands in client prediction and server authority together — the two agree because they run the
  same code, which is the whole of ADR 0003/0005. In the event, no netcode regression test moved:
  `predictionRegression.harness.test.ts` passes unchanged.
- **A knocked-down Character stays down longer.** Measured time to fall under
  `RAGDOLL_SETTLE_SPEED` after a hard Impact: **1.30 s before, 2.43 s after** — still well inside
  `RAGDOLL_MAX_MS`'s 4 s cap, so nothing times out, but ADR 0010 makes ragdoll recovery *the*
  Respawn penalty, and that penalty is now roughly twice as long after a real hit. Physically right
  — a body with structure tumbles where a limp sack stops dead — but it is a balance change, not
  only a visual one, and it should be felt before it is tuned.
- **A downed Character settles higher and takes up more room**, because it no longer flattens. Any
  future tuning that assumed a flat corpse — a camera framing a downed Player, a Survival arena's
  spacing — is measuring against a different body now.
- **`Ragdoll.test.ts` pins the shape**, not the pose: it asserts the settled pelvis→head distance
  stays within 10% of standing, under gravity and from four knockdown directions. A future joint or
  damping change that quietly returns to a lump fails there.
- **Bone-driven rendering is now possible but still out of scope** — M6 says so explicitly. This ADR
  is about what the physics does, never about what draws it.

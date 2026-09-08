# 05 — Ragdoll, které drží tvar těla

**What to build:** Give the articulated ragdoll joint limits and self-collision, so a knocked-down
Character settles as a body instead of folding into a single lump.

**Blocked by:** nothing. Touches `packages/shared`'s `Ragdoll.ts` / `collisionGroups.ts` only, so it
does not queue behind 03 or 04 — but it changes replicated simulation behaviour, so it wants a clean
tree rather than landing on top of half-finished Grab work.

**Status:** done (live verification carried to ticket 06)

## Why

Every joint in `Ragdoll.ts` is a free ball joint:

```ts
RAPIER.JointData.spherical(anchorParent, anchorChild)   // Ragdoll.ts:81 — no limits, ten times
```

and `collisionGroups.ts` says so out loud for the bones themselves:

> *"Still not the owning capsule, **not each other (no self-collision for M2)**, not the Spinner […]
> Ragdoll-vs-ragdoll is a deliberate later call (research §3.3)."*

Elbows and knees therefore bend both ways, the neck rotates freely, and limbs pass straight through
the torso. Measured in a standalone Rapier harness built from the project's own `RAGDOLL_BONES` and
`RAGDOLL_GROUPS` — **gravity only, no blow, feet starting on the floor**, distance from pelvis to
head, which is `0.75` in the authored standing pose:

| | settled pelvis→head | |
|---|---|---|
| today | **0.07** | −91 %, the skeleton collapses to a point in under two seconds |
| joint limits | **0.75** | holds |
| joint limits + self-collision | **0.72** | holds |

This is not cosmetic. The ragdoll's settle position is already authoritative and already on screen —
`game/index.ts` deliberately renders the server's bone-carrying pose while a Character is down
("there is exactly one down-state position/pose on screen, and it's the server's"). The canned
`Death` clip drawn on top hides the shape but not the place: a Character lies wherever a collapsed
lump ended up.

It is also the prerequisite for ever driving the model from the bones. That is **not** this ticket
and stays out of M6 — the milestone's own scope note is unchanged.

## What to change

- [x] Elbows and knees become real hinges — `JointData.revolute(...)` plus `setLimits(min, max)` on
      the returned `RevoluteImpulseJoint`, bending one way only
- [x] Spine (`chest`) and neck (`head`) get limited joints rather than free ones
- [x] Shoulders and hips stay spherical, and the code says why: Rapier 0.20's
      `SphericalImpulseJoint` has no `setLimits`, so a cone limit is not available without modelling
      the joint differently. A deliberate remainder, not an oversight
- [x] Ragdoll bones collide with each other — `RAGDOLL_GROUPS` gains `GROUP_RAGDOLL` in its filter,
      retiring the "no self-collision for M2" note
- [x] Jointed (adjacent) bone pairs keep contacts **off** — `ImpulseJoint.setContactsEnabled(false)`
      — or they shove each other apart at every joint, which the harness confirmed
- [x] Every limit is a named constant in `packages/shared` (CLAUDE.md), never an inline number

## Done when

- [x] A shared test drops a ragdoll from its own standing pose under gravity with no impulse and
      asserts the settled pelvis→head distance stays within ~10 % of the standing `0.75` — the
      harness number above, turned into a regression
- [x] Knocked down from each of four directions, the settled pose is still a body: no bone ends up
      inside another, and the head is not inside the pelvis
- [ ] Live-verified in two browsers, since this runs in client prediction *and* on the server and
      both must agree

## Watch out for

**This is replicated behaviour, not rendering.** `Ragdoll` is stepped by the shared simulation on
both sides, so the change lands in client prediction and server authority together. Expect
`predictionRegression.harness.test.ts` to move; re-baseline it deliberately and say so in the
commit, rather than letting the numbers drift silently.

**ADR.** ADR 0006 made the ragdoll free on purpose, back when it was only ever drawn as bare
capsules and a loose comic flop was the point. Constraining it trades some of that flop for a body
that reads as a body — a real trade-off, hard to reverse once tuned, and surprising without the
history. That is CLAUDE.md's own test for an ADR; **0047** is the next free number.

**Tuning is the actual work.** The joint list is small; making it settle like a body rather than a
mannequin is a feel pass, and the limits above are a starting point from the harness, not answers:

```
chest  ±0.5 rad · head ±0.6 rad · elbows 0…2.3 rad · knees −2.3…0 rad
```

**Self-collision earns less than it looks.** It moved the measured spread by 0.03. Its real value is
that an arm no longer passes through the chest, which that metric cannot see — worth having, but if
it costs frame rate with twelve ragdolls it is the half to drop, not the limits.

## Reproducing the numbers

The harness that produced the table was a throwaway page under `apps/client` building its own Rapier
worlds from `RAGDOLL_BONES` — deliberately never importing `Ragdoll.ts`, so today's behaviour and the
proposed one could be stepped side by side. Two mistakes to avoid if it gets rebuilt: spawn the
skeleton with its lowest bone exactly on the floor (spawning it high makes the drop, not the joints,
the thing being measured), and set the project's real `RAGDOLL_GROUPS` on the colliders — Rapier's
default is collide-with-everything, which silently gives "today" a self-collision it does not have.

**Done.** `BoneSpec` gained an optional `hinge` — axis plus a signed range, in the parent's frame —
so how a bone hangs off its parent lives next to the skeleton it describes rather than in a lookup
somewhere else. `Ragdoll` builds a `revolute` joint with `setLimits` where a bone has one and the
old `spherical` where it doesn't, and turns contacts off on every joint it makes. `RAGDOLL_GROUPS`
gained `GROUP_RAGDOLL`. The four angles are named in `tuning.ts`.

Measured through the real `Ragdoll` class, pelvis→head, standing `0.75`:

| | before | after |
|---|---|---|
| gravity alone | 0.255 | **0.728** |
| knocked from four directions | 0.040 | **0.732 – 0.745** |

**Nothing needed re-baselining.** The ticket warned `predictionRegression.harness.test.ts` would
move; it did not, and neither did any other existing test — 1022 across six packages, all green,
with the four new ones. Worth stating plainly rather than leaving as an unexamined relief: the
harness drives the *capsule's* predict/reconcile loop, and the ragdoll is a separate body the
capsule doesn't read, so there was no coupling to disturb.

**Code review found one real consequence worth naming**: time to settle after a hard Impact went
**1.30 s → 2.43 s**. Under the 4 s cap, so nothing breaks — but ADR 0010 makes ragdoll recovery the
Respawn penalty, so that penalty roughly doubled after a real hit. Recorded in the ADR as a balance
change to feel before tuning. Review also hardened the limits path: a hinge spec that fails to
produce a limitable joint now throws instead of silently leaving a free-swinging hinge.

Recorded as **ADR 0047**, which amends ADR 0006 without superseding it — the ragdoll is still the
loose articulated flop that ADR wanted, bounded rather than stiffened.

# 0006 — Hybrid Character: kinematic capsule with a ragdoll state machine

A Character is a kinematic capsule (Rapier's kinematic character controller) for
movement and collision, with a separate articulated ragdoll body that takes over
on Impact or Fall. A state machine drives the handoff:

```
Controlled  → Stagger    (minor impact: input dampened, stays upright)
Controlled  → Ragdoll    (hard impact / fall / dash into wall)
Stagger     → Controlled  (auto, after STAGGER_TICKS)
Stagger     → Ragdoll     (a hard impact lands while staggering)
Ragdoll     → GettingUp   (settled past RAGDOLL_MIN, or at RAGDOLL_MAX)
GettingUp   → Controlled   (auto, after GETUP_TICKS)
```

`GettingUp` is uninterruptible — a hard impact during recovery is ignored, and an
impact landing while already `Ragdoll` does not restart its timer, so continuous
impacts (lying in a Spinner's arc) can never soft-lock the Character out of
`Controlled`.

A pure active ragdoll (Gang Beasts style) gives the best chaos but is months of
tuning for a solo dev and is hard to network. A pure kinematic capsule is
predictable and easy to sync but can't be knocked down. The hybrid keeps
movement predictable and network-friendly while still delivering the "you get
shoved and hit the floor" moment that is the game's identity.

## Consequences

- Movement `Wobble` while Controlled is procedural and cosmetic — it never
  affects the capsule collision.
- The capsule and ragdoll are distinct physics bodies; transitions must hand off
  position/velocity between them cleanly to avoid pops.
- Only `Controlled` (and dampened `Stagger`) accept movement input; `Ragdoll` and
  `GettingUp` ignore it.

## Implementation notes (ticket 05)

- The state machine is `CharacterStateMachine` — pure, fed Impact magnitudes and
  a "ragdoll settled" flag by `RapierSimulation`.
- The ragdoll is an 11-bone articulated humanoid (`ragdollSkeleton.ts`, `Ragdoll`)
  with spherical joints, built once and parked, activated on transition into
  `Ragdoll`. Collision groups keep it from fighting the capsule
  (`collisionGroups.ts`).
- `SimState.character.bones` carries the per-bone transforms while `Ragdoll` /
  `GettingUp`; `interpolateState` snaps (no blend) on any `motionState` change,
  since the body being drawn swaps.
- `GettingUp` blends the captured ragdoll pose toward the standing rest pose over
  `GETUP_MS`; the capsule re-takes control at `Controlled`.

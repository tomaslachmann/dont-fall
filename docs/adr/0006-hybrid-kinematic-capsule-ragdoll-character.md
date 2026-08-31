# 0006 — Hybrid Character: kinematic capsule with a ragdoll state machine

A Character is a kinematic capsule (Rapier's kinematic character controller) for
movement and collision, with a separate articulated ragdoll body that takes over
on Impact or Fall. A state machine drives the handoff:

```
Controlled  → Stagger   (minor impact: input dampened, stays upright)
Controlled  → Ragdoll   (hard impact / fall / dash into wall)
Stagger     → Controlled (auto)
Ragdoll     → GettingUp  (blend ragdoll pose back toward standing)
GettingUp   → Controlled
```

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

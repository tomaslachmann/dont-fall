# 05 — Ragdoll state machine

**What to build:** The Character can be knocked down and get back up. Add an
articulated ragdoll body alongside the kinematic capsule and the state machine
that hands off between them:

```
Controlled → Stagger    (minor Impact: movement input dampened, stays upright)
Controlled → Ragdoll     (hard Impact or Fall)
Stagger    → Controlled  (auto, after a short time)
Ragdoll    → GettingUp    (blend ragdoll pose toward standing)
GettingUp  → Controlled
```

Impact magnitude decides Stagger vs Ragdoll. Position and velocity hand off
cleanly between capsule and ragdoll (no pops). Only `Controlled` and (dampened)
`Stagger` accept movement input.

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Articulated ragdoll body (Rapier joints) that can be enabled/disabled
- [ ] State machine with the five states above, driven inside the sim step
- [ ] Impact magnitude threshold (named constant) splits Stagger vs Ragdoll
- [ ] `Fall` routes through Ragdoll before Respawn (or on Respawn landing) — pick one and note it
- [ ] Clean position/velocity handoff capsule ↔ ragdoll, no visible pop
- [ ] `Ragdoll` and `GettingUp` ignore movement input; `Stagger` dampens it
- [ ] Respects ADR 0006

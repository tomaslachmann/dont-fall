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

**Status:** done

- [x] Articulated ragdoll: 11-bone humanoid (`ragdollSkeleton.ts` / `Ragdoll`), spherical joints, built once and parked, activated/deactivated on transition
- [x] `CharacterStateMachine` — the five states, driven each tick by `RapierSimulation`
- [x] `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN` split ignore / Stagger / Ragdoll by impulse magnitude
- [x] **Fall routes through Ragdoll on Respawn landing** (fork 2, option b): teleport to Checkpoint → gentle ragdoll flop → GettingUp → Controlled. Replaces the old frozen lockout (ADR 0010 updated)
- [x] Handoff: `beginRagdoll` transfers capsule velocity to the bones; `beginGettingUp` places the capsule above the settled pelvis; `interpolateState` snaps on `motionState` change so the body swap doesn't lerp
- [x] `Ragdoll`/`GettingUp` → `inputScale` 0; `Stagger` → `STAGGER_INPUT_SCALE`
- [x] Respects ADR 0006 (implementation notes added there)

**Impact trigger:** `simulation.applyImpact(impulse)` — used by tests now, by the
Spinner / wall dash / props in ticket 06. `SimInputs` unchanged.
**Deferred to ticket 07:** joint limits / mass tuning for a nicer flop; the
GettingUp pose blend is linear and crude.

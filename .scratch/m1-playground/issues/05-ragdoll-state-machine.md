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
Spinner / wall dash / props in ticket 06. `SimInputs` unchanged. The strongest
Impact per tick wins (magnitude + shove kept together); an Impact landing while
already down flails the ragdoll directly.

**Review fixes (high):** no soft-lock under continuous Impacts (`GettingUp`
uninterruptible, Ragdoll timer not restarted while down); Stagger dampens jump/
dash too, not just walk; `interpolateState` snaps only on a body swap (bone count
0↔N), not on `Controlled↔Stagger`; `position` rises smoothly across the
Ragdoll→GettingUp handoff (no ~0.7 pop); all feel values in `tuning.ts`;
`BoneSnapshot` moved to the handle-free `ragdollSkeleton.ts`; `respawning` field
removed (redundant with `motionState`); velocity unified to one `Vec3`.

**Deferred to ticket 07:** joint limits / mass tuning for a nicer flop; the
GettingUp pose blend is linear.

**Revised (post-ticket 06, MushroomKing character model):** the client no
longer draws the 11 capsule-bone meshes for Ragdoll/GettingUp — it plays the
Character model's own "Death" clip forward (then holds) for the fall, and in
reverse (from wherever the forward play actually got to, not always the final
frame) to stand back up, scaled to fit `GETUP_MS`. The physics ragdoll and
`SimState.character.bones` are unchanged — this is a client-rendering swap
only (`apps/client/src/scene.ts`), not a simulation change.

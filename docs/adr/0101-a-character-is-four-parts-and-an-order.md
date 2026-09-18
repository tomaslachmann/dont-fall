# 0101 — A Character is four parts and an order

## Context

The last item of `docs/research/codebase-audit-2026-09.md` (ticket 10), taken
up by the user on 2026-09-18. ADR 0098 had already cut
`CharacterController.beginCapsuleTick` into ten private methods and turned
eight per-tick Surface setters into one `applyGroundContext`, and had left
the rest on purpose: the class was still one 1838-line body holding the
capsule, the velocity model, what is underfoot, Hit and Grab, and every down
episode, in about sixty fields.

The user's own audit comment asked for four sub-controllers — Movement,
Surface, Interaction, Ragdoll — under `CharacterController` as an
orchestrator, and a strategy per motion state. Asked how far to take the
second, the user answered with what the code has to make easy next:

- a random chance to slip on **mud**;
- on **ice**, crashing into anything at **any speed** knocks you down;
- **Grab**'s mechanics changed and extended.

That, rather than a pattern, is what decided the cut. None of the three adds
a motion state; two are Surface hazards and one is Grab, which was spread
over three places (`CharacterController`, `GrabController`, and about 250
lines of `RapierSimulation`).

## Decision

**`CharacterController` says the order of a tick; four parts under
`simulation/character/` do the work, each the one place its kind of change
goes.** Its public API is unchanged, so `RapierSimulation` drives it exactly
as before.

- `Capsule` — the kinematic body, collider and Rapier controller every part
  shares and none owns.
- `MovementController` — velocity and `grounded`, jump, Dash, the walk wish,
  the two velocity models, what rides on top of them (a shove, a Spring, a
  Volume), the Ride, the sweep and the landing.
- `SurfaceController` — what is underfoot (ADR 0036): the ground context,
  the ground contact, the footprint probes, and the **hazards** a Surface can
  have. A landing that takes your feet (`landingImpact`, ice today) and the
  speed a crash knocks you down at (`crashMinSpeed`, `WALL_IMPACT_MIN_SPEED`
  on every Surface today) are both answered here, so the wall-Impact rule asks
  the ground under the Character rather than reading a constant.
- `InteractionController` — Hit and Grab from this Character's side: the
  verbs, their epochs and cooldowns, and being in a hold, in either role.
- `RagdollController` — every down episode (ADR 0006/0015/0023): into
  Ragdoll, getting up, a correction either way, elimination, the Respawn, and
  what the snapshot reports while down.

**`GrabHolds`** (`simulation/GrabHolds.ts`) takes the cross-Character half of
Grab out of `RapierSimulation` — starting a hold, the tether before the step,
keeping or ending it after, letting go of whoever leaves — so Grab is two
files that sit side by side instead of three places in two classes.

**A motion state is a row, not a branch.** `MOTION_MODES` (beside the state
machine) says what each state *does*: its input scale, whether the capsule or
the ragdoll moves the body, which velocity model runs, and what the snapshot
reports. The controller reads those fields and never asks which state it is
in. The *transitions* stay in `CharacterStateMachine`, where they were: a
full State pattern would have scattered one legible `switch` over five files
to buy nothing the three planned features need.

### Where the planned features go

- **Mud, slipping on a landing:** data only — a `landingKnockdown` on mud in
  `SURFACES`, which `SurfaceController.landingImpact` already reads for ice.
  Slipping while *running* on mud would be a new hazard on `SurfaceController`,
  asked from the capsule tick.
- **Ice, a crash at any speed:** `SurfaceController.crashMinSpeed` answers
  lower for ice (a Surface field, read there). Other Characters are excluded
  from the wall-Impact rule today (a Bump is one-sided, ticket 04); whether
  "anything" includes them is that feature's decision.
- **Grab:** `InteractionController` for one Character's side,
  `GrabHolds` for the pair.

### Deliberately not done

- **The hold setters stay four** (`clearHold`/`holdWith` before the step,
  `setGrabbingId`/`setHeldByGrabberId` after it). The user's comment asked
  for one `applyCrossCharacterState`, but the two pairs belong to two
  different moments of the tick, and one call would have had to be made twice.
- **Hit's resolution stays in `RapierSimulation`** (`resolveHit`,
  `findNearestInCone`, which `GrabHolds` borrows): nothing planned changes it.
- **Comments were moved verbatim** — the user's call, over their own earlier
  suggestion to shorten them to intent plus an ADR link. Only pointers to code
  that moved were updated.

## Consequences

- `CharacterController.ts` 1838 → 632 lines (most of what is left is its
  documented public API); the parts are 56 + 571 + 404 + 230 + 321, and
  `RapierSimulation.ts` 1643 → 1393 with `GrabHolds` at 310.
- **Proven identical, bit for bit.** A scratch harness ran six Tracks for
  1500 ticks each with eight busy Players — running, jumping, Dashing,
  charging Hits, grabbing, facing each other — plus Characters dropped onto
  every Spring, ice, bounce and mud deck, belt, Volume and Moving Segment, a
  Survival Round with eliminating Falls, a disconnect, direct Impacts, and a
  predicting client reconciled to the server every nine ticks. Every tick's
  full `SimState` was serialised without rounding. It was deterministic,
  caught a 1e-12 relative change in the friction factor within 22 ticks, and
  was identical before and after both steps (the split, then `GrabHolds`).
  Not committed.
- `pnpm bench:sim` (12 Characters, three runs each side): the Character sweep
  time moved between −12 % and +4 % by scenario (the −12 % on the client's 0.02 ms figure), with no direction — noise.

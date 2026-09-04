# 0035 — Character movement becomes a persistent-velocity acceleration model

Since M1 the Character's ground movement has been recomputed from scratch every tick:
`velocity.xz` is assigned `WALK_SPEED * direction`, with Dash adding a separate burst on top and
every other movement effect living in its own branch of `CharacterController`. Velocity never
survives a tick, so there is nothing for a per-surface multiplier to multiply and nothing for a
one-shot impulse to persist into.

A fourth grilling round (2026-09, `/grill-with-docs`) set out to add Surfaces (ice, mud), speed
pads, bounce pads and updrafts and found that every one of them lands on the same wall. Two
research passes (`docs/research/slope-and-surface-movement.md`,
`docs/research/surface-and-volume-mechanics.md`) established what shipped engines actually do, and
it is not what this codebase does.

The first design considered keeping the current model and treating every impulse-shaped mechanic as
a deliberate exception. That was abandoned: once a second exception appeared (a boost pad, which
SuperTuxKart ships as impulse + raised speed cap + fade, and which as a pure continuous multiplier
does almost nothing on a short pad), the "exception" framing was hiding the fact that the model
itself was wrong.

## Decision

- **Velocity persists between ticks.** Each tick applies acceleration toward a desired velocity,
  then drag, then a speed cap — rather than assigning a final velocity outright. This is the
  near-universal kinematic-controller model: Quake 3's `PM_Accelerate`/`PM_Friction`, Source's
  `Accelerate()`/`Friction()`, Unreal's `CalcVelocity`. PhysX and Unity both document that a
  kinematic controller's motion is the author's to write ("users are responsible for applying
  gravity to characters here"; "The Controller does not react to forces on its own"), so no engine
  feature is being reimplemented here — this is the part every project writes itself.
- **Grip is one scalar per Surface that multiplies both acceleration and drag.** Source's
  `m_surfaceFriction` does exactly this; Quake 3's `SURF_SLICK` is the crude version (skip friction,
  swap `pm_accelerate` 10 → `pm_airaccelerate` 1). **Ice does not raise top speed** — in both
  engines top speed is untouched, and the feel of ice is carried entirely by acceleration and turn
  authority. Mud is the mirror image: cap top speed, leave acceleration alone.
- **Slope speed is an explicit multiplier from the signed slope angle**, per Unity's own Character
  Controller documentation ("apply a multiplier to your desired character velocity based on that
  signed slope angle"). **Projecting gravity onto the slope plane and integrating it is explicitly
  not the model while walking** — that is the rigid-body formulation; grounded kinematic
  controllers remove the vertical component instead. Gravity-along-the-plane applies only while
  `Sliding` (ADR 0037), where it is the correct model.
- **One-shot effects are velocity *writes*, latched by an Epoch.** Once velocity persists, a bounce
  pad or launch pad setting velocity is no longer a special case — it is an ordinary write that the
  next tick's acceleration and drag act on. Quake 3's jump pad is the template: velocity **set**
  rather than added (idempotent under replay), computed in shared code, and fired exactly once via a
  latch in the replicated player state. `Epoch` is already this project's name for that pattern
  (`ragdollEpoch`, `respawnCount`) — these mechanics reuse it rather than inventing a mechanism.
- **Dash stops being a special case** and becomes one contributor to the same velocity, which is
  what makes speed-gated rules (ADR 0037's wall Impact) expressible without asking "was this a
  Dash?".
- **The rewrite preserves today's feel; it does not re-tune it.** Every tuning constant changes
  meaning (`WALK_SPEED` becomes a target reached over time, not an instantaneous value), so the
  acceptance criterion is "a player cannot tell the difference", guarded by the existing
  `predictionRegression` harness. Re-tuning happens later, against real ramps and ice — not in the
  same change, where a bad feel could not be attributed to either cause.

## Consequences

- `CharacterController`'s per-tick velocity assignment is replaced by accelerate → drag → cap.
  Dash, Bump, and ground-stick all move onto that path. This is the most invasive change to the
  Character since M1, and it runs inside the client's prediction loop as well as the server's
  authority, so `predictionRegression` is the gate, not a formality.
- Tuning constants keep their names but change meaning; each needs its doc comment rewritten to say
  "target" rather than "speed". `GROUND_STICK_SPEED`'s unit bug (ADR 0037) is fixed as part of the
  same pass.
- Nothing here adds a Snapshot field or a `CharacterMotionState` member — velocity is already
  replicated and already predicted. The Epoch-latched mechanics (M3.7) are the only part that
  touches the protocol, which is why they are sequenced together in one milestone.
- "Scientifically backed" was the standard asked for and is not what this is: there is no academic
  result here. It is convergent engineering practice across Quake, Source, Unreal, Unity and PhysX,
  documented in primary sources. The one momentum-model source (Sonic's `slp * sin(angle)`) is
  community reverse-engineering and is flagged as such in the research doc.

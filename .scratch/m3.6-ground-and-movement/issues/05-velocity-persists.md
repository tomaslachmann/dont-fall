# 05 — Velocity persists between ticks

**What to build:** The movement model itself. Today a Character's horizontal velocity is recomputed
from scratch every tick, so nothing can accumulate, decay, or be written into — which is why ice,
pads, bounces and launches are all currently inexpressible. This ticket replaces that with
accelerate → drag → cap.

It is the one ticket in this milestone that makes nothing new visible. Its deliverable is that a
player cannot tell anything changed.

**Blocked by:** 04 — the slope work lands on the old model first, so that a feel regression has one
suspect rather than two.

**Status:** blocked

- [ ] Velocity persists between ticks: accelerate toward a desired velocity, apply drag, apply a cap
      (ADR 0035 — the model Quake, Source and Unreal all use, and the part every kinematic-controller
      project writes itself, since the engine deliberately does not)
- [ ] Dash becomes a contributor to that velocity rather than its own branch — which is what later
      makes a speed-gated wall Impact expressible without asking "was this a Dash?"
- [ ] Bump and ground contact move onto the same path
- [ ] Tuning constants keep their names but change meaning — a walk speed becomes a target reached
      over time rather than an instantaneous value — and every affected doc comment is rewritten to
      say so
- [ ] **Feel is preserved, not re-tuned.** Re-tuning is explicitly a later pass against real ramps
      and ice; doing both at once makes a bad result unattributable
- [ ] No new replicated field and no new Character state: velocity is already replicated and already
      predicted
- [ ] `predictionRegression` is the gate, not a formality
- [ ] Manually verified live with two browsers: walking, dashing, jumping and bumping another
      Character all feel as they did, and prediction stays clean

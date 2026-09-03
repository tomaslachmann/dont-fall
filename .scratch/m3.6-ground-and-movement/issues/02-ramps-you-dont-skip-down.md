# 02 — Ramps you don't skip down

**What to build:** A Character walks down a ramp smoothly instead of skipping off it every tick.
Tilted geometry has been authorable since M3.5 but has never been walked on; today ground contact is
expressed as a *speed*, which caps clean descent at about 18° — and about 5° mid-Dash. Nothing else
about slopes can be judged until this is fixed.

**Blocked by:** None — can start immediately, in parallel with ticket 01.

**Status:** ready-for-agent

- [ ] Ground-stick becomes a **distance** rather than a speed. This is a unit bug in this codebase,
      not a limitation of the physics engine (ADR 0037)
- [ ] A spike settles whether the engine's own snap-to-ground is used: enable it and measure whether
      the M1-era symptoms it was disabled for — stalling near platform edges, hitching during a Dash
      — still reproduce. That rationale predates most of the current code
- [ ] The spike ends in a decision recorded in this file: the engine's snap-to-ground, or the
      project's own distance-based ground-stick. Fixing the unit may well remove the need for the
      engine feature entirely
- [ ] The comment explaining what is enabled and why is rewritten to describe what is actually true
      afterwards, including that autostep remains off
- [ ] Flat ground feels exactly as it did — `predictionRegression` stays green
- [ ] Manually verified live: a Character walks down a hand-authored 30° ramp without skipping,
      both walking and mid-Dash

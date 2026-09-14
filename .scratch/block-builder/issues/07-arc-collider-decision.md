# 07 — Arc collider form + load test (phase 2, decides Q3)

**What to build:** The measurement that resolves research open question 3:
single Rapier trimesh from shared output vs. convex pieces — decided by data,
plus a collider-count load test.

**Blocked by:** ticket 06 (needs the tessellated arc to measure).

**Status:** planned

## Why

Q3 was deliberately left open: Rapier collapses climb/slide to one wall
angle, so trimesh-vs-convex is a feel and performance question no amount of
paper analysis answers. Guessing here risks either a hitchy arc (wrong form)
or a speculative physics split (wrong complexity).

## What to change

- [ ] Load test: arc-heavy Track (e.g. 10 × 180° arcs) — measure sim tick
  time client + server at 30 Hz, and walk the full arc feeling for hitches
  at chord boundaries (pseudo-normals via `TriMeshFlags.ORIENTED` should
  hide them; verify, don't assume)
- [ ] If measured hitch appears: prototype convex-decomposition of the same
  shared output (same vertices in, different collider out — the generator
  stays the single source of truth either way) and A/B the feel
- [ ] Collider-count budget: document max recommended arc pieces per Track
  next to the measurement numbers, as a builder guideline, not a hard limit
  (ADR 0033 posture: manual Test Mode, not a solver)

## Done when

- [ ] Decision recorded (in this file's notes + a line in the research doc):
  trimesh or convex, with the numbers that decided it
- [ ] No speculative split: if trimesh measures clean, convex is not built
  "for safety"

## Watch out for

**Measuring the wrong thing.** Tick-time averages hide one-frame hitches at
chord boundaries. Measure p99/pmax frame times during a full-speed Dash
along the outer rim (fastest movement = worst case, per M3.6's autostep
rationale), not average FPS standing still.

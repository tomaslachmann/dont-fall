# M3.6 — Ground and the movement model

Recorded from an eight-round `/grill-with-docs` session (2026-09). The milestone definition and its
"Done when" live in `docs/milestones/M3.6.md`; the decisions live in ADR 0035 (persistent-velocity
acceleration model), ADR 0036 (Surface/Volume data model), ADR 0037 (`Sliding`, slope thresholds,
speed-gated wall Impact). This file records only what those three do not: the reasoning the session
produced about *how* to build it, and the facts that were verified along the way.

## Verified facts this design rests on

- `WALK_SPEED = 6` against `GROUND_STICK_SPEED = 2` caps descent at `atan(2/6) ≈ 18.4°`. With
  `DASH_SPEED = 15` adding on top (total up to 21) it collapses to **≈ 5.4°**. Verified in
  `packages/shared/src/tuning.ts`.
- The installed `@dimforge/rapier3d-compat@0.20.0` defaults `maxSlopeClimbAngle` and
  `minSlopeSlideAngle` to **both 45°** — there is no angle at which a Character slides.
- **0.20.0 is the latest published JS binding** (`npm view … version` → `0.20.0`,
  `dist-tags.latest` → `0.20.0`). The `rapier3d` **Rust** crate's higher version numbers are a
  separate line; the JS bindings lag it (JS 0.19.3 → Rust 0.30.0). There is no upgrade available,
  so the thresholds must be set explicitly rather than inherited from a newer release.
- `RapierSimulation` keeps `spinnerByHandle`, `propByHandle` and `characterIdByHandle`, but **no
  handle map for statics** — the concrete blocker for reading the Surface under a Character.
- `Checkpoint.volume` is an `OrientedBox` tested with `pointInOrientedBox`, already correct for
  rotated/tilted Segments since ADR 0034's review. That pipeline is what Volumes reuse in M3.7 —
  and the reason its *name* has to move out of the way.

## Sequencing, and why

Every ticket is a vertical slice — a narrow but complete path through authoring, resolution,
simulation and verification — rather than a layer delivered on its own. The first cut of this
breakdown opened with a deliberately behaviour-free "plumbing" ticket; that was replaced, because
**mud works on today's movement model** (capping top speed needs no acceleration), so the Surface
path can be cut end-to-end from the first ticket instead of laying pipe nobody can walk through yet.
Ice cannot: before velocity persists there is nothing for a grip scalar to multiply, which is why
the two Surfaces sit at opposite ends of the milestone.

Ground contact (02) is independent of the Surface path and can run in parallel. Everything about
slopes hangs off it, because slope behaviour is unobservable while a Character skips down ramps. The
movement-model rewrite (05) is placed after the slope work deliberately: landing slopes on the old
model first means a later feel regression has one suspect rather than two. The rename (07) is
independent of all of it and only gates M3.7's Volumes.

## Testing posture

Existing seams and prior art, not new frameworks. `packages/shared/src/track/*` unit tests for the
Surface collapse; `RapierSimulation`-level integration tests for slope behaviour, in the style of
the tilted-static-collider tests ADR 0034's ticket 01 added; and `predictionRegression.harness.test.ts`
as the gate for the movement-model rewrite — it is the only thing in the project that can answer
"does this still feel the same" without a human.

## Deliberately unresolved

The numeric values (walkable limit, slide limit, snap distance, grip scalars for ice and mud). The
research documents recommend starting points; the session took the deliberate position that the
*structure* is a decision and the *numbers* are a measurement, to be taken against real ramps once
they exist.

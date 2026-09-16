# 04 — The squash: a Spring that visibly fires

**What to build:** the client's cosmetic squash-and-release on the Spring that
fired, driven by `launchPadEpoch` — no new replicated state, no moving collision
(ADR 0069).

**Blocked by:** 01 (needs `launchPadOwners`), 02.

**Status:** done (2026-09-15).

## What to change

- [x] `apps/client/src/render/springSquash.ts`: a pure timeline —
      `squashScale(msSinceFire) → { y, xz }` — compress ≈66 ms to 0.55, release
      ≈180 ms to 1.12, settle ≈120 ms back to 1. Tuning consts, not literals.
- [x] A per-Segment latch: `{ segmentIndex → firedAtMs }`, restarted (never
      stacked) when it fires again. Two Characters on one Spring in one tick is
      one squash.
- [x] Fire detection: a Character's `launchPadEpoch` **value** changed since the
      last frame (never a boolean — a replayed prediction tick that re-produces
      the same epoch must be a no-op), then the Segment is the owner of the
      launch pad whose trigger contains that Character's capsule centre. Local
      and remote Characters take the same path; the local one simply gets there
      a round trip early.
- [x] Apply to the placed Asset's own visual instance: scale about its foot
      (these Assets sit on `y = 0`), multiplying the Segment's own
      `segmentScale` rather than replacing it. Transform-only — the clones'
      shared geometry and materials stay shared.
- [x] `assetVisuals.ts`: expose the instance for a Segment index (the placement
      list is already built in Track order) so the stage can reach it.
- [x] A Segment whose Asset has no `launch` never animates, and a launch with no
      resolvable owner is silently ignored — a missing squash must never be a
      thrown error in the render loop.

## Tests

- [x] `squashScale` shape: 1 at 0, minimum at the compress time, overshoot > 1
      during release, exactly 1 after the total duration, monotonic within each
      leg.
- [x] The latch: same epoch twice = one animation; a new epoch restarts it; two
      Characters, one tick, one Segment = one animation.
- [x] A replayed prediction tick re-producing an already-seen epoch does not
      re-fire (the ADR 0013 discipline, exercised through `PredictionLoop`'s
      real path if reachable).
- [x] Owner resolution picks the Segment whose trigger contains the Character,
      on a Track with two Springs close together.
- [x] The instance's scale returns exactly to `segmentScale` when the animation
      ends (no drift after repeated fires).

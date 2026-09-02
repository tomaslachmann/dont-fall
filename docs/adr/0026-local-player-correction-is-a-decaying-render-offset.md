# 0026 — The local Character's correction is a decaying render-time offset; the simulation always reconciles

ADR 0013 shipped local replay for the predicted Character and deferred "positional
error-smoothing … as feel-tuning" — the client snapped the rendered pose to the replayed
result and reset the render-interpolation baseline (`renderPreviousSnapshot`) on every
correction. A 2026-09 playtest ("walking straight, the character slightly snaps roughly
once a second; after a collision it doesn't settle exactly at the impact spot"), traced
with a deterministic headless harness (`apps/client/src/predictionRegression.harness.test.ts`)
and researched against primary sources (`docs/research/m2-prediction-reconciliation-loop.md`),
showed three things:

1. `RECONCILE_POSITION_ERROR = 0.2` is **exactly one 30 Hz walk-step** (`WALK_SPEED /
   TICK_RATE_HZ`). The server consumes queued input FIFO, decoupled from each input's tick
   number, and steps physics unconditionally every tick — so when a client's input queue
   momentarily empties (ordinary jitter / frame-time variance), the server's reported
   position for a tick sits ~0.2 u ahead of the client's prediction for it. That one-tick
   phase slip parks on the threshold and, with no smoothing, pops the rendered Character
   ~0.2 u backward — visible, ~1×/s while walking, worse below 60 fps.
2. Every shipping predict/reconcile loop surveyed (Valve `cl_smoothtime` 0.1 s; Unreal
   `NetworkSmoothingMode` / `NetworkSimulatedSmoothLocationTime` 0.1 s; Gambetta; Fiedler
   *State Synchronization*) **always corrects the simulation on any real disagreement and
   always smooths the visual** — a hard "below X, do nothing" threshold is not a standard
   pattern.
3. The full-tick LEAD *drop* (`leadStepMs = -TICK_MS` when the command queue is fat) yanks
   the render-interpolation alpha in a single frame — a second, connection-quality-scaled
   backward pop, distinct from (1).

## Decision

**The predicted Character's continuous transform is corrected through the same decaying
render-time error offset ADR 0022 already ships for pushed Props** (`decayPropError`,
`retain = 0.5^(dtMs / halfLifeMs)`). The Rapier body / gameplay state always snaps to the
replayed authoritative result; only the *rendered* transform carries the offset, which
decays to zero. Smoothing is never applied between the state update and the simulation
(Fiedler: it ruins the extrapolation).

- **Position half-life ≈ 100 ms** (Valve + Unreal both land there for a character; Props'
  200 ms is for a shoved crate where a slower ease reads as weight — wrong for a capsule
  you are steering). 150 ms is an acceptable smoother alternative for a party game.
  Facing ≈ 50 ms. Below a few-mm epsilon, zero the offset. Past a hard-snap distance
  (`RECONCILE_HARDSNAP_M`, reuse `PROP_ERR_HARDSNAP_M`'s 2.0 u — Fiedler's 2 m, ≈ Unreal's
  `NetworkNoSmoothUpdateDistance` scaled) drop the offset and snap.
- **The correct-or-ignore threshold is retired.** The *simulation* reconciles toward the
  server state on any disagreement past a float-noise epsilon (`RECONCILE_POSITION_EPSILON
  ≈ 0.02 u`, ≈ `PROP_ERR_SETTLED_M`) — forward replay of ~LEAD ticks at 30/s is cheap.
  `RECONCILE_POSITION_ERROR = 0.2` no longer exists as a gate; it must never again equal
  one walk-step.
- **The offset never crosses a `motionState` change.** Discrete state and its pose snap
  (ADR 0006 / 0013 / 0023, unchanged); the offset applies only while `Controlled` /
  `Stagger`, and is zeroed on entering and leaving a down state. While down the local
  Character is already drawn from the server snapshot (ADR 0015 addendum) — the offset
  simply does not apply there.
- **The correction stops resetting `renderPreviousSnapshot`** to a post-correction snap —
  the offset, not a baseline reset, carries the visual delta, so render interpolation
  stays continuous.
- **The LEAD *drop* drains gradually** — a small fraction of a tick per frame while the
  command queue is over target — instead of a full tick at once. The *inject* side (queue
  starving) stays responsive. This is the render-alpha-safe form of ADR 0021's feedback.

Harness result at a 60 fps render cap, walking straight, across lan / wifi / bad-network ×
capable / weak machine: worst rendered backward step drops from **~22 cm (baseline) to
< 1.5 cm**, with no added input latency on a direction change and no change to where the
Character settles against a wall. Reconciliations still fire at the same rate — the offset
makes them invisible, it does not make them rare (that is ADR 0027's concern).

## Consequences

- `RECONCILE_POSITION_ERROR` is replaced by `RECONCILE_POSITION_EPSILON` (≈ 0.02) and a
  reused hard-snap constant. `CAPSULE_ERR_HALFLIFE_MS` (~100) and a facing half-life join
  the tuning constants.
- The `decayPropError` / error-offset machinery moves to (or is already reachable from)
  `packages/shared` so both the Prop path (ADR 0022) and the capsule path consume it. A
  Character pushing a Prop has both offsets live and reseeded on the same reconcile —
  verified in the harness not to beat against each other.
- ADR 0013's deferred "positional error-smoothing (if and when it's added)" is now
  decided: it is this. The rest of ADR 0013 (local replay, discrete state snaps) stands.
- The systematic ~0.2 u bias itself is **not** removed by this ADR — only hidden. Removing
  it at the source (the server simulating `input[serverTick]` rather than FIFO) is
  deferred to ADR 0027 pending an integration test the headless harness cannot run.
- `docs/networking-model.md` §2 (Character — local, "Handoff / correction" column) and the
  invariants list are updated to describe the offset.

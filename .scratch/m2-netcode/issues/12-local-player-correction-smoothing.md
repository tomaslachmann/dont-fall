# 12 — The local Character's reconciliation correction is a decaying render-time offset

**ADR:** `docs/adr/0026-local-player-correction-is-a-decaying-render-offset.md` (supersedes
ADR 0013's deferred smoothing; ADR 0021 forward note for the LEAD-drain part).
**Research:** `docs/research/m2-prediction-reconciliation-loop.md`.
**Harness:** `apps/client/src/predictionRegression.harness.test.ts` — already red→green on
this fix; the `PROPOSAL` constant there is exactly this ticket's config.

**Blocked by:** nothing (works on top of the shipped protocol v2). **Does NOT need** ticket 13.

**Status: done (2026-09-02).**

---

## The defect (given — traced, not to re-verify)

Walking straight, the local Character pops ~0.2 u backward roughly once a second; worse
below 60 fps; and it doesn't settle cleanly against a wall. Two causes:

1. `RECONCILE_POSITION_ERROR = 0.2` = exactly `WALK_SPEED / TICK_RATE_HZ` (one 30 Hz
   walk-step). A one-tick client/server phase slip (from the server consuming input FIFO
   and stepping physics on a starved tick — the deeper bias, ticket 13) parks on the
   threshold. With no smoothing, each crossing pops the rendered pose. `reconcile()` also
   resets `renderPreviousSnapshot`, so render interpolation jumps too.
2. The LEAD *drop* (`leadStepMs = -TICK_MS` when `smoothedQueueDepth` is over target)
   subtracts a whole tick from `predictionAccumulatorMs` in one frame → the render alpha
   snaps → a second backward pop, scaled by connection quality.

Harness result at a 60 fps cap, lan/wifi/bad-net × capable/weak machine: worst rendered
backward step **~22 cm → < 1.5 cm**, no added turn latency, wall settle unchanged.

---

## Scope

### 1. Retire the correct-or-ignore threshold (ADR 0026)

- `packages/shared/src/tuning.ts`: replace `RECONCILE_POSITION_ERROR = 0.2` with
  `RECONCILE_POSITION_EPSILON = 0.02` (float-noise floor; ≈ `PROP_ERR_SETTLED_M`) and add
  `RECONCILE_HARDSNAP_M = PROP_ERR_HARDSNAP_M` (2.0) — the drop-the-offset-and-snap
  distance. Delete the old constant and its long comment.
- `apps/client/src/main.ts` `reconcile()`: `needsCorrection` fires on `serverDown ||
  localDown || motionState mismatch || positionError > RECONCILE_POSITION_EPSILON`. The
  prediction-tick guard (ADR 0023) is unchanged. `positionError > RECONCILE_HARDSNAP_M` is
  a new branch that zeroes the offset (below).

### 2. The capsule error offset (ADR 0026, reuses ADR 0022's mechanism)

- Factor the decay out of `apps/client/src/propPrediction.ts` so it is reachable for the
  capsule too. Either move `decayPropError` + `PropError` to
  `packages/shared/src/state/` (parallel to `interpolate.ts`), or add a shared
  `errorOffset.ts` helper both consume. The capsule wants a **configurable half-life**
  (props hard-code 200/70 ms), so the shared helper takes `halfLifeMs`.
- New tuning: `CAPSULE_ERR_HALFLIFE_MS = 100` (Valve `cl_smoothtime` 0.1 s, Unreal
  `NetworkSimulatedSmoothLocationTime` 0.1 s; 150 is an acceptable smoother alt — the
  harness sweep says 75–200 all clean, 50 leaks ~2.7 cm). `CAPSULE_ERR_ROT_HALFLIFE_MS =
  50` for facing.
- `main.ts`: a `capsuleErrorOffset: { position: Vec3; rotation: Quat }`, zeroed at start.
  - In `reconcile()` while not down and `motionState` unchanged: capture the sim pose
    before `reconcileCharacter`, run the replay, then
    `capsuleErrorOffset.position += simPoseBefore − simPoseAfterReplay` (the exact
    `PropPredictionController.reseedAfterReconcile` shape). Clamp: if the resulting
    magnitude `> RECONCILE_HARDSNAP_M`, zero it. On a `motionState` change or the
    hard-snap branch, zero it.
  - Each frame: decay `capsuleErrorOffset` by `0.5 ^ (dtMs / CAPSULE_ERR_HALFLIFE_MS)`
    (rotation by its own half-life); zero below a mm epsilon. Zero it whenever
    `c.motionState` differs from the last frame's, or the Character is down (it's drawn
    from the server snapshot then — ADR 0015 addendum — so the offset doesn't apply).
  - Render the local Character at `renderCharacter.position + capsuleErrorOffset.position`
    (rotation composed). **Camera-follow, the mirror/obstacle sync, and every gameplay
    read use the raw pose** (Fiedler: never smooth into the sim).
- `reconcile()` **stops** doing `renderPreviousSnapshot = sim.snapshot()` — the offset
  carries the visual delta now, so render interpolation keeps its baseline. (Keep it only
  on the down-state branch if it's still load-bearing there — check.)

### 3. Gentle LEAD drain (ADR 0021 forward note)

- `main.ts` predict-loop LEAD feedback: the *inject* side stays as-is (responsive when
  `smoothedQueueDepth < 1`). The *drop* side, while `smoothedQueueDepth` is over the top
  of the band, subtracts a small fraction of a tick per frame (~`TICK_MS * 0.15`),
  continuously — never `-TICK_MS` at once. `LEAD_ADJUST_FRAMES` no longer gates the drop.

### 4. Net-graph

- `NetMetrics` already has a correction-distance ring buffer. Add the current
  `‖capsuleErrorOffset‖` to the overlay (one number) so playtests can see the ease working.

---

## TDD seam

The decay is a pure function — unit-test the shared helper (half-life behaviour, hard-snap,
frame-rate independence) as `propPrediction.test.ts` already does for props. The
integration behaviour is covered by `predictionRegression.harness.test.ts`'s
`describe("60 fps render cap — proposal must hold here")` block — those assertions are the
acceptance criteria; keep them green with the real `main.ts` wiring (the harness ports
`main.ts`, so the two must not drift — if a harness knob becomes real code, delete the knob
and point the test at the real path).

## Done when

- Harness `60 fps render cap` block green against the real reconcile path (not the knob).
- `propPrediction.test.ts` extended for the shared/configurable decay helper.
- Typecheck + full suite green. `RECONCILE_POSITION_ERROR` gone from the codebase.
- `/code-review` at **high** (intricate netcode). Then commit; then ticket 13 separately.

## Explicitly deferred to ticket 13

Removing the *systematic* ~0.2 u bias (server simulates `input[serverTick]`). This ticket
makes the correction invisible; it does not make corrections rare. That's fine — every
shipping loop always corrects + always smooths (research §3).

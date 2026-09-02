# 0022 — A pushed Prop is predicted as a decaying render-time error offset (supersedes ADR 0016)

ADR 0016 removed client-side Prop prediction entirely after the first attempt — a per-Prop
"grace ticks" window that hard-switched the rendered pose from the advanced local prediction
to the stale server pose on grace expiry — made a pushed box visibly jump backward on
release. A later fix (ADR 0017) showed the interpolation was also naive, and fixing that
plus the user's own research established: **prediction of the pushed Prop is necessary for
feel; the first attempt failed on the *shape of the handoff*, not on the idea.**
(`docs/research/m2-shared-prop-prediction.md`.)

Without prediction, a pushed box waits the interpolation delay (~66 ms) *plus* a full RTT
for the server to see the push and snapshot it back — ~90–130 ms of dead box, the "heavy
laggy box" symptom.

## Decision

Every Prop is interpolated (ADR 0017) **except the one Prop the local Character is
contacting**, for `PROP_PREDICT_GRACE` ticks after last contact. That Prop is simulated
locally by the client's Rapier, but what is *rendered* is the simulated pose **plus a
render-time error offset that decays exponentially toward zero** (Glenn Fiedler, *State
Synchronization*). The Rapier body always holds the authoritative state — smoothing is
never applied between the state update and the simulation (Fiedler: it ruins the
extrapolation).

- Client 3-state machine per Prop: `PINNED → PREDICTED → SERVER-MOVING → PINNED`. Every
  transition, and every server snapshot while not PINNED, adds `serverPose − localPose` to
  the accumulated offset — it never moves the rendered pose directly.
- Position offset decays ×0.95/frame while ‖error‖ ≤ 0.25 m, ×0.85/frame while ≥ 1 m, lerp
  between; orientation blend 0.1 → 0.5 by magnitude; hard-snap (drop the offset) past 2 m.
  **All four numbers are verbatim from Fiedler** (0.95/0.85/0.1→0.5 from the 2015 article,
  the 2 m snap from the 2004 one).
- Velocity and angular velocity are **snapped, never smoothed** (Fiedler's explicit rule
  for derivative quantities). We additionally *aligned-gate* the velocity correction — skip
  it when `dot(current, target) ≤ 0` — so a box that just hit a wall isn't yanked toward
  its stale pre-collision velocity. **The aligned gate is our extension** (from Unity
  Ultimate Glove Ball's `BallStateSync`), not a Fiedler citation.
- `PropSnapshot` gains `velocity`, `angularVelocity` (omitted when at rest), and `atRest` —
  a re-simulated body replaying from `v = 0` every snapshot produces a 30 Hz sawtooth. No
  per-Prop sequence number: `SimState.tick` stamps the whole snapshot.
- `PROP_PREDICT_GRACE = clamp(ceil(RTT / TICK_MS), 2, 8)` ticks — a **derived heuristic**,
  not a documented formula. Tune empirically; the 8-tick cap (~267 ms) may be lowered.
- Two players push the same box: the server resolves it, both clients' offsets decay to the
  server's result. No client ever holds authority ("borrow simulation for feel, never
  authority" — the server-authoritative equivalent of peer-to-peer ownership transfer,
  which does not apply here).

## Consequences

- ADR 0016's "Props are *never* predicted" narrows to "Props are interpolated-only *except*
  the one you're touching". ADR 0016's other content (Props are pinned obstacles in the
  local prediction world; the server never calls `syncPropsToSnapshot`) stands.
- Cost scales with "Props one client is touching" (~0–2), not match Prop count. A profiling
  pass on N simultaneously-predicted Props at 30 Hz / 12 players is still owed (no source
  quantifies it).
- The error-offset mechanism is reusable: it is the same family as the capsule's positional
  error smoothing that ADR 0013 deferred.

---

## Implementation note (2026-09-02, ticket 11.8)

Landed on branch `m2-protocol-v2`.

- **`apps/client/src/propPrediction.ts`** — `decayPropError` (the pure Fiedler smoothing,
  time-based half-lives so it is frame-rate independent), `graceTicksForRtt`, and
  `PropPredictionController` (the per-Prop `pinned → predicted → server-moving` machine,
  the accumulated `PropError` offsets, and the reconcile hooks
  `captureBeforeReconcile` / `reseedAfterReconcile`).
- **`packages/shared`** — `PROP_ERR_*` and `PROP_PREDICT_GRACE_*` tuning constants;
  `mulQuat` / `conjugateQuat` / `dotQuat` in `math/quat.ts`; `Prop.applyAuthoritativeState`
  (the aligned-gate on linear velocity lives here); `RapierSimulation.setPredictedProps`
  (a predicted Prop is skipped by the every-tick pin to `followPoses` and simulates
  freely), `consumeContactedProps`, `applyAuthoritativePropState`.
- **`main.ts`** — `setPredictedProps` before the predict loop, `frame(...)` after it,
  `renderPoses(...)` into the Stage, and the predicted-Prop seed + re-seed around the
  replay in `reconcile`. The net-graph's `predProps` counter is wired.

Deviations from the decision above, all minor:

- The rotation error is carried as a single error quaternion `qErr`
  (`rendered = qErr ∘ target`), decayed by `slerp(identity, qErr, retain)`; the
  "quaternion dot 0.1 → 0.5" band is read off `|qErr.w|`.
- A **rotation hard-snap** was added for symmetry with the position one
  (`PROP_ERR_ROT_HARDSNAP_DOT ≈ 150°`) — the decision table only specified a position
  hard-snap. Same rationale: past that angle it is a genuine desync, not something to
  rubber-band.
- The `server-moving → pinned` settle check gates on the **rotation** residual as well as
  position, so a lingering angular offset is decayed out rather than snapped to identity
  on re-pin.
- Entering `predicted` from `server-moving` keeps the decaying residual offset rather than
  reseeding, so a re-touched Prop never pops.
- When the interpolation buffer underruns (no `serverRender`), the whole machine resets to
  all-pinned rather than freezing mid-prediction with stale offsets.

Still owed (unchanged): a playtest to tune `PROP_PREDICT_GRACE_TICKS` and the rotation
decay band (the `0.5 / 0.1` dot values map to 120°–168°, so almost all real angular error
currently decays at the slow 200 ms half-life — may want it more aggressive), and the
N-simultaneously-predicted-Props profiling pass.

## Amendment (2026-09, same-tick pin regression)

**Ticket 06's original implementation exempted a Prop from the every-tick pin if it had
been contacted in that same tick** (`&& !this.contactedProps.has(i)`), so a fresh shove's
movement survived at least until the next frame. ADR 0016 (2026-09) correctly removed this
along with all Prop-prediction machinery when Props stopped being predicted at all — but
when this ADR reintroduced prediction, the pin loop's exemption was only restored for
`predictedProps` (the render layer's *next-frame* decision), not for `contactedProps` (this
tick's *not-yet-classified* contact). `predictedProps` is set once per frame, before the
predict loop, from the previous frame's `consumeContactedProps()` read — so on the exact
tick a contact first registers, the Prop is in neither set yet, and the shove (applied
moments earlier in the same tick's `beginTick`) was immediately pinned straight back to the
stale pre-shove pose before it was ever visible. Most noticeable during a Dash, since
`resolveCollisions` shoves a Prop on the same collision that can also trigger `DashWall`.

**Fix:** `RapierSimulation.tick()`'s pin loop restored the same-tick exemption
(`this.predictedProps.has(i) || this.contactedProps.has(i)`). Regression test:
`RapierSimulation.test.ts` › "a shove on the very tick a Prop is first contacted survives
that tick...".

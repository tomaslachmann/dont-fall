# 11 — Protocol v2 implementation index

The grilling session (2026-09) settled the M2 network protocol. Spec: `docs/networking-model.md`.
ADRs: 0018–0025, plus amendment notes on 0015/0016/0017. This is the implementation surface,
in dependency order. Each item becomes its own ticket file (`12-…`, `13-…`, …) when picked up.

**Status (2026-09-02):** 11.1–11.9 landed on branch `m2-protocol-v2`.
11.6 landed except its deferred parts (sparse bones list, full local-ragdoll-body
removal, one-shot-effect gating helper — nothing to gate yet). 11.8 (pushed-Prop
prediction) landed — `apps/client/src/propPrediction.ts` (3-state machine + Fiedler
decaying error offset), `RapierSimulation.setPredictedProps` / `consumeContactedProps` /
`applyAuthoritativePropState`. **Still owed:** a playtest to validate the feel, and a
profiling pass on N simultaneously-predicted Props at 30 Hz / 12 players (ADR 0022).
All tests green (141 shared + 50 client + 10 server), typecheck clean.

**Post-v2 defect (2026-09):** implementing v2 surfaced a reconciliation pop of the local
Character (~1 walk-step backward, ~1×/s while walking). Diagnosed with
`apps/client/src/predictionRegression.harness.test.ts`; researched in
`docs/research/m2-prediction-reconciliation-loop.md`. Two follow-on tickets:

- **`12-local-player-correction-smoothing.md`** — ADR 0026: the local correction is the
  same decaying render offset ADR 0022 ships for Props; sim reconciles unconditionally;
  `RECONCILE_POSITION_ERROR = 0.2` retired; gentle LEAD drain. Harness-validated at a
  60 fps cap across network/machine conditions (worst backward step ~22 cm → < 1.5 cm).
  **Done (2026-09-02).** `packages/shared/src/state/errorOffset.ts` (`decayPositionOffset`,
  shared by the Character and by `propPrediction.ts`'s `decayPropError`); tuning replaces
  `RECONCILE_POSITION_ERROR` with `RECONCILE_POSITION_EPSILON` / `RECONCILE_HARDSNAP_M` /
  `CAPSULE_ERR_HALFLIFE_MS`; `main.ts` wires the capsule offset + gentle LEAD drain; net-graph
  shows `capOff`. All tests green (147 shared + 75 client + 10 server), typecheck clean.
- **`13-tick-addressed-server-input.md`** — ADR 0021 forward note, shipped as **ADR 0027**:
  server simulates `input[serverTick]` instead of FIFO, removing the systematic ~0.2 u bias
  at the source. **Done (2026-09-02).** `apps/server/src/index.ts` (server-owned
  `serverTick`, tick-matched queue lookup, honest `lastInputTick` ack); `main.ts` seeds
  `predictionTick` into the server's tick space once, sized from measured RTT
  (`INITIAL_LEAD_TICKS_MIN`/`_MAX`, `packages/shared/src/tuning.ts`); validated by the new
  `apps/server/src/tickAddressedInput.integration.test.ts` (a real `startServer` + a real,
  timer-driven client over a real loopback WebSocket with modelled latency/jitter — the
  integration test this ticket was blocked on). All tests green (148 shared + 77 client +
  12 server), typecheck clean.

---

## 11.1 — `protocol.ts` v2: the wire shapes (do first, mechanical)

Rewrite `packages/shared/src/net/protocol.ts` to the v2 interfaces in `networking-model.md` §3,
and migrate every call site so the build stays green. This is one atomic change, not a
half-migration.

- `WelcomeMessage`: `id` → `playerId` + `sessionToken` (`crypto.randomBytes(32).toString('base64url')`)
  + `config { snapshotHz, graceWindowMs }`. Server issues both; client stores `sessionToken`,
  uses `playerId` everywhere it used `id`.
- `SnapshotMessage`: `+ serverTimeMs` (server's `performance.now()`), `+ commandQueueDepth`.
- `InputMessage`: `{ tick, input }` → `{ inputs: [{ tick, input }] }`. Client sends an array of 1
  for now (redundancy tail is 11.4). Server: iterate, dedupe by `tick > lastInputTick`.
- New `PingMessage` / `PongMessage` / `ReclaimMessage` types (handlers are stubs / no-ops here).
- `SimState`/`CharacterSnapshot`: `teleported` → `respawnCount` (11.2), `bumpSeq` → `ragdollEpoch`
  + `ragdollCause` + `phaseStartTick` (11.6), `PropSnapshot` + `velocity`/`angularVelocity`/`atRest`
  (11.5). Split these into their own tickets below; this ticket does the renames that are pure
  mechanical (`playerId`, `serverTimeMs`, `commandQueueDepth`, `InputMessage` array).

**Done when:** build + all tests green on the v2 shapes; no behaviour change yet beyond the
`InputMessage` array (which already lets the server tolerate >1 input per packet).

**Blocked by:** nothing.

---

## 11.2 — `respawnCount` replaces `teleported`

`CharacterSnapshot.teleported: boolean` → `respawnCount: number` (monotonic per Character,
incremented in `RapierSimulation` on every Respawn). The renderer (`scene.ts` /
`interpolateState`) holds `lastSeenRespawnCount` per Character and snaps (no interpolation)
when it changes, instead of watching for a one-tick `teleported === true`.

**Why:** the interpolation buffer can skip the single tick `teleported` is true (low fps,
coalesced snapshots) → the renderer interpolates the Respawn as a fly-across-map. ADR 0015/0023, Q9.

**Blocked by:** 11.1.

---

## 11.3 — Time-sync handshake (ADR 0019)

- New client `TimeSync` module: sends `ping{ clientTimeMs }`, handles `pong`, keeps a
  16-sample ring of `{ rtt, offset }`, discards >1σ from the median, takes the offset from
  the lowest-RTT sample. Burst 8 at join, then 1/s.
- `estimatedServerTick(now)` = `lastTickReceived + (now - lastSnapshotArrivedAt)/TICK_MS + slewedOffset`,
  all via `performance.now()`, never `Date.now()`.
- Apply the offset via a clamped slew (~15–30 ms/s), snap past ~100 ms.
- Server: reply to `ping` with `pong{ clientTimeMs, serverTimeMs }`; stamp every snapshot
  with `serverTimeMs`.
- `SnapshotInterpolator` takes its clock from `TimeSync` instead of the first-snapshot anchor
  + `OFFSET_EASE`. Delete the anchor/ease code.
- Feedback loop: use `commandQueueDepth` from snapshots to nudge `LEAD` (see 11.4).

**Blocked by:** 11.1.

---

## 11.4 — Redundant input + LEAD (ADR 0021)

- Client: each `InputMessage` carries the current input + the last **K = 2** unacknowledged
  inputs (by `tick`). Drop from the send buffer once `lastInputTick` passes them.
- Server: input queue dedupes by `tick`; target holding 1–2 commands.
- Client `LEAD`: initial `clamp(ceil((rtt/2)/TICK_MS)+1, 1, 3)`; then adjust toward
  `commandQueueDepth ≈ 1–2` at a bounded rate (no step jumps). The client's `predictionTick`
  runs `LEAD` ahead of `estimatedServerTick`.

**Blocked by:** 11.1, 11.3 (LEAD needs the time estimate).

---

## 11.5 — `PropSnapshot` velocity + at-rest, and interp-delay formula (ADR 0020, prep for 0022)

- `PropSnapshot` + `velocity: Vec3`, `angularVelocity: Vec3`, `atRest: boolean`. `Prop.snapshot()`
  reads `body.linvel()` / `body.angvel()` / `body.isSleeping()`. Omit the velocity fields (or
  zero them) when `atRest`.
- `interpolateState` leaves velocity alone (not rendered) but carries it through so a future
  predicted Prop has it.
- `INTERP_DELAY_MS` becomes `clamp(INTERP_RATIO / snapshotHz * 1000, minimum, 250)` with
  `INTERP_RATIO = 2`; stop deriving it from `TICK_MS`. `snapshotHz` comes from `WelcomeMessage.config`.
- Server snapshot send accumulator (decouple snapshot rate from tick rate; ship at 30 Hz).

**Blocked by:** 11.1.

---

## 11.6 — Ragdoll wire shape + prediction-tick guard (ADR 0023)

- `bumpSeq` → `ragdollEpoch` (rises on **every** entry to `Ragdoll`, server-side).
- `+ ragdollCause` (enum Bump/Fall/DashWall/Spinner), `+ phaseStartTick`.
- `bones` → a sparse/indexed list (`{ index, position, rotation }[]`), count as data — still
  all 11 for now, but not a fixed-length array.
- Close ticket 09: `localSim` never activates a ragdoll body; the client's down-state pose is
  the interpolated server `bones` (this is already partly done — ADR 0015 addendum renders the
  down local Character from `serverRender`).
- Prediction-tick guard: the client tags its predicted ragdoll with `predictionTick` = P;
  `reconcile()` ignores any non-down snapshot with `tick < P`.
- GettingUp: client derives the blend from `phaseStartTick` (no `0..1` float on the wire).
- One-shot effect gating helper: `isFirstForwardSim(tick)` for predicted effects;
  `epoch > lastApplied` for snapshot-delivered ones. (No networked effects yet — ship the helper.)

**Blocked by:** 11.1. **Amends:** ADR 0015's revert path.

---

## 11.7 — Spinner at the prediction tick (ADR 0025)

`stage.updateSpinners(...)` is fed `estimatedServerTick + LEAD` (the client's prediction tick),
not `serverInterp.renderTick(now)`. Applies to all clients. Add the measurable revision
criterion (max angular offset) to the net-graph overlay so playtests can read it.

**Blocked by:** 11.3 (needs the tick estimate).

---

## 11.8 — Pushed-Prop prediction (ADR 0022 — supersedes ADR 0016)

The client 3-state machine (PINNED → PREDICTED → SERVER-MOVING) + the decaying render-time
error offset. `PROP_PREDICT_GRACE = clamp(ceil(RTT/TICK_MS), 2, 8)`. Fiedler smoothing
constants (0.95 / 0.85 / 0.1→0.5 / 2 m snap) + the aligned-gate on velocity. Re-adds the
`contactedProps` concept ADR 0016 removed, but as a *client render-layer* thing, not a
sim-authority thing.

**Blocked by:** 11.1, 11.5 (needs `velocity`/`atRest` on the wire), 11.3 (grace uses RTT).
**Reopens:** ADR 0016.

**Done (2026-09-02):**
- `apps/client/src/propPrediction.ts` — `decayPropError` (pure Fiedler smoothing),
  `graceTicksForRtt`, `PropPredictionController` (per-Prop state machine, error offsets,
  `frame` / `renderPoses` / `captureBeforeReconcile` / `reseedAfterReconcile`).
- `packages/shared` — `PROP_ERR_*` / `PROP_PREDICT_GRACE_*` tuning constants;
  `mulQuat` / `conjugateQuat` / `dotQuat`; `Prop.applyAuthoritativeState` (aligned-gated
  velocity); `RapierSimulation.setPredictedProps` / `consumeContactedProps` /
  `applyAuthoritativePropState` (predicted Props skip the every-tick pin).
- `main.ts` wires it into the frame loop and `reconcile`; net-graph shows `predProps`.
- **Not done:** playtest validation; N-predicted-Props profiling.

---

## 11.9 — Net-graph overlay (`NetMetrics`, pull model)

A mutable `NetMetrics` struct owned by the client net/prediction layer; the HUD reads it each
frame and draws plain-DOM text. Fields per `networking-model.md` §8, including correction-distance
p50/p95/max (ring buffer) and the Spinner angular-offset estimate.

**Blocked by:** 11.3, 11.4 (most fields come from those).

---

## 11.10 — CONTEXT.md / model-doc upkeep

Already done in the grilling session: `CONTEXT.md` §Networking, `docs/networking-model.md`.
This ticket is the reminder to keep the model doc's entity table current as 11.1–11.9 land —
flip `Status` and fill the real constant values.

---

## Suggested order

`11.1` → `11.2` + `11.5` (parallel, mechanical) → `11.3` → `11.4` → `11.6` + `11.7` (parallel)
→ `11.8` → `11.9`. `11.10` continuous.

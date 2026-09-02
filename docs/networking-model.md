# DON'T FALL — Networking Model

**This is the living spec.** It says *how the netcode works right now*. The *why* lives in the
ADRs it links; the *deep reasoning and primary sources* live in the research briefs under
`docs/research/` and in `docs/DON'T FALL — Multiplayer Networking Handbook.md` (background
reading, not canon). Settled in a grilling session (2026-09) cross-checked against 50+
primary sources.

Read this first. Change it whenever the model changes; never let it drift from the code.

**Implementation status (2026-09-02):** protocol v2 is on branch `m2-protocol-v2` —
wire shapes, `respawnCount`, time sync, redundant input + LEAD, `PropSnapshot`
velocity + interp-delay formula, ragdoll epoch/cause/`phaseStartTick` + prediction-tick
guard, Spinner at the prediction tick, the net-graph overlay, and **pushed-Prop
prediction (§5, the 3-state machine + Fiedler decaying error offset,
`apps/client/src/propPrediction.ts`)** are done.

A 2026-09 playtest then surfaced a reconciliation pop of the *local* Character (§4.4);
research (`docs/research/m2-prediction-reconciliation-loop.md`) → ADR 0026 (local-player
correction = the same decaying render offset; retire the `0.2` threshold; gentle LEAD
drain) — **ticket 12, done.** `RECONCILE_POSITION_ERROR` is gone from the codebase;
`RECONCILE_POSITION_EPSILON` / `RECONCILE_HARDSNAP_M` / `CAPSULE_ERR_HALFLIFE_MS`
replace it (`packages/shared/src/tuning.ts`), the shared decay helper lives at
`packages/shared/src/state/errorOffset.ts`, and `main.ts` wires the capsule offset +
gentle LEAD drain.

ADR 0021's forward note → **ADR 0027 / ticket 13, done.** The server applies
`input[serverTick]` instead of FIFO next-in-queue (`apps/server/src/index.ts`); the client
seeds `predictionTick` into the server's own tick space once, sized from measured RTT
(`INITIAL_LEAD_TICKS_MIN`/`_MAX`, `packages/shared/src/tuning.ts`); validated by
`apps/server/src/tickAddressedInput.integration.test.ts` — a real `startServer` process
against a real, timer-driven client, the integration test the headless harness couldn't
provide. The systematic ~0.2 u bias is removed at the source, not just hidden — ADR 0026's
offset stays, to hide the smaller residual (real jitter, cross-machine FP) any predict/
reconcile loop still has.

Remaining deferred bits: sparse bones list, full local-ragdoll-body removal, a profiling
pass on N simultaneously-predicted Props, and ticket 13.
See `.scratch/m2-netcode/issues/11-protocol-v2-index.md`.

---

## 1. The three rates

Three independent numbers (Valve Source convention — sim tick ≠ snapshot rate ≠ command rate):

| Rate | What it is | M2 value | Target (12-player, post-binary) |
|---|---|---|---|
| **Simulation tick** | how fast the server advances physics | 30 Hz, fixed (ADR 0004) | unchanged |
| **Snapshot rate** | how often the server sends world state to clients | 30 Hz | 20 Hz |
| **Command rate** | how often the client sends input to the server | 30 Hz (one per predicted tick) | unchanged |

The client's prediction runs at the sim rate. Snapshots carry `state.tick`, so the
interpolation buffer brackets correctly even when snapshots are sparse — dropping to 20 Hz
needs no protocol change, only a bigger playout delay (§4). Decoupled in code from M2 (a
snapshot accumulator in the tick loop); shipped at 30/30/30, tuned down later. See ADR 0020.

---

## 2. Entity model

Every networked thing is one of these categories. The category dictates authority,
prediction, wire data, and handoff. Adding an entity means placing it in a row.

| Entity | Status | Authority | Client predicts? | Wire data (per snapshot) | Handoff / correction | ADR |
|---|---|---|---|---|---|---|
| **Character — local** | Built | Server | **Yes** — full sim replay | `position, velocity, grounded, motionState, checkpointIndex, fallCount, respawnCount, dashCooldownMs, dashing, dashSpeed, lastInputTick, ragdollEpoch, ragdollCause, phaseStartTick, bones` | Local replay from the acked tick; sim reconciles unconditionally, the *continuous transform* eases in via a decaying render-time error offset (half-life ≈ 100 ms), discrete `motionState` snaps and zeroes the offset | 0003, 0005, 0013, 0026, 0027 |
| **Character — remote** | Built | Server | No | same shape; `lastInputTick` ignored | Render-delay interpolation buffer (§4); snap on `respawnCount` / `motionState` change | 0003, 0012, 0017 |
| **Ragdoll (a downed Character)** | Built | Server (full 11-body sim) | Transition only (`motionState` snaps for feel); **not** the physics | `bones` (all 11, from the server), `ragdollEpoch`, `ragdollCause`, `phaseStartTick` | No local ragdoll body. Bones interpolated like a remote entity. Prediction-tick guard on revert (§6) | 0006, 0015, 0023 |
| **Prop — passive** (crate/ball at rest or moved by another player) | Built | Server | No | `position, rotation, velocity, angularVelocity, atRest` (velocities omitted when `atRest`) | Render-delay interpolation buffer; a pinned obstacle in the local prediction world | 0012, 0016→0022, 0017 |
| **Prop — contacted** (the one Prop the local Character is touching) | Built | Server | **Yes**, narrowly — for `PROP_PREDICT_GRACE_TICKS` ticks after last contact | same shape | Client 3-state machine PINNED→PREDICTED→SERVER-MOVING; every transition seeds a **render-time error offset** that decays exponentially. Physics body always snaps to the server state (§5) | 0022 |
| **Spinner** (rotating-bar Obstacle) | Built | Server (pure function of tick) | Recomputes from tick (no divergence possible) | **none** — not in `SimState`; `spinnerAngleAt(tick)` | Rendered at the **prediction tick** (matches the local Character's own collision), not the render tick | 0006, 0025 |
| **Checkpoint / Fall / Finish Zone** (trigger volumes) | Built (Checkpoint/Fall); Finish Zone planned | Server decides | Yes — crossing/fall predicted for instant feedback | `checkpointIndex`, `fallCount`, `respawnCount` on the Character | Server-authoritative; `checkpointIndex` corrects a mispredicted crossing, `respawnCount` a mispredicted/missed Fall | 0015, 0019(scratch) |
| **Static geometry** (Track collision, walls) | Built | None | N/A | config once at join (`PLAYGROUND_STATICS`) | — | 0005 |
| **Track Segment** | Planned (M3) | Server | Deterministic gen both sides | `RoundSeed` + versioned Module catalog id | seed + catalog version must match; mismatch = hard error | — |
| **Item Box / Power-up** | Planned (M4) | Server | Local anticipation VFX only | server sends the *outcome*, or `MatchSeed` + versioned catalog | gameplay RNG is server-only; never "client rolls its own" | — |

### The invariants behind the table

1. **Predict only what the local player drives with their own input.** Character movement,
   jump, dash, checkpoint crossing, fall — yes. Another player, a ragdoll's physics, a Prop
   you're not touching — no. (ADR 0003)
2. **The physics body always holds a valid authoritative state.** Smoothing lives in the
   *render* layer as an error offset that decays to zero — never between the state update
   and the simulation (Fiedler). One mechanism, two consumers: the pushed Prop (ADR 0022)
   and the local Character's correction (ADR 0026). No correct-or-ignore threshold — the
   sim reconciles on any real disagreement; the offset makes it invisible.
3. **A discrete state a snapshot carries is applied by a monotonic counter, never a
   one-tick boolean.** `ragdollEpoch`, `respawnCount` — the renderer/reconciler holds
   last-seen and acts on a change, so a skipped or coalesced snapshot can't lose the event.
   (ADR 0015, 0023; Q9)
4. **Only the server ends a down state.** The local Character never recovers from Ragdoll on
   its own; a prediction-tick guard (§6) stops a stale snapshot from reverting a
   just-started knockdown. (ADR 0015, 0023)
5. **Deterministically-computable entities (Spinner) are shown at the tick relevant to the
   local player**, not a globally-safe render tick — the one place we can have both. (ADR 0025)

---

## 3. Wire protocol (`packages/shared/src/net/protocol.ts` — v2 target)

Plain WebSocket, JSON for M2 (ADR 0011). Binary encoding is deferred (§8). Both ends import
these types; no codegen.

```ts
// ---- server → client ----

interface WelcomeMessage {
  type: "welcome";
  /** Stable, public identity. Keys this client's Character in every snapshot; other
   *  clients see it. NOT a credential. */
  playerId: string;
  /** Secret bearer credential — 32 bytes crypto-random, base64url. Sent ONLY here, to the
   *  owning client, never rebroadcast. Presented on reconnect to reclaim the Character.
   *  Valid until `disconnectedAt + GRACE_WINDOW_MS`. Pure bearer (no transport binding) —
   *  accepted risk (§7). */
  sessionToken: string;
  spawn: Vec3;
  /** Server config the client needs before the first snapshot (rates, delays). */
  config: { snapshotHz: number; graceWindowMs: number };
}

interface SnapshotMessage {
  type: "snapshot";
  state: SimState;              // carries `tick`
  /** The server's own `performance.now()` when this snapshot was built — the client's
   *  clock reference (§4). `tick` alone assumes a perfect setInterval cadence. */
  serverTimeMs: number;
  /** How many of this client's commands the server has buffered but not yet applied.
   *  Feeds the client's LEAD adjustment (§4.3). */
  commandQueueDepth: number;
}

interface PongMessage {
  type: "pong";
  clientTimeMs: number;   // echoed T1
  serverTimeMs: number;   // T2/T3 (server receive ≈ send at this rate)
}

type ServerMessage = WelcomeMessage | SnapshotMessage | PongMessage;

// ---- client → server ----

interface InputMessage {
  type: "input";
  /** The current tick's input plus a redundant tail of the last K unacked inputs
   *  (K = fixed, ~2, like Quake `cl_packetdup` — NOT RTT-adaptive). Server dedupes by
   *  `tick` (ignores `tick <= lastInputTick`). Protects against WebSocket head-of-line
   *  bursts and out-of-order delivery. */
  inputs: { tick: number; input: SimInputs }[];
}

interface PingMessage {
  type: "ping";
  clientTimeMs: number;   // T1, from a monotonic clock (performance.now())
}

interface ReclaimMessage {   // M2: shape only, server does not act on it yet
  type: "reclaim";
  sessionToken: string;
}

type ClientMessage = InputMessage | PingMessage | ReclaimMessage;
```

### `SimState` / `CharacterSnapshot` field changes from v1

| v1 | v2 | Why |
|---|---|---|
| `CharacterSnapshot.teleported: boolean` | `respawnCount: number` (monotonic per Character) | a one-tick boolean is lost if the interp buffer skips that tick (ADR 0015, Q9) |
| `CharacterSnapshot.bumpSeq: number` | `ragdollEpoch: number` (rises on **every** Ragdoll entry, not just Bump/Fall) | the narrow scope was for ADR 0014's gate, which ADR 0015 removed (ADR 0023) |
| — | `CharacterSnapshot.ragdollCause: 0\|1\|2\|3` (Bump / Fall / DashWall / Spinner) | camera kick / hit-react / cause-specific SFX (M4). 4 values max without a field-width bump — known limitation (ADR 0023) |
| — | `CharacterSnapshot.phaseStartTick: number` (tick the current `motionState` phase began) | client derives the GettingUp blend locally; also feeds the epoch/timing logic (ADR 0023) |
| `PropSnapshot { position, rotation }` | `+ velocity, angularVelocity, atRest` (velocities omitted when `atRest`) | a re-simulated body replaying from `v=0` every snapshot produces a 30 Hz sawtooth (ADR 0022) |
| `SnapshotMessage { state }` | `+ serverTimeMs, commandQueueDepth` | time sync + LEAD feedback (ADR 0019, 0021) |
| `WelcomeMessage { id }` | `playerId + sessionToken + config` | identity vs credential split; reconnect shaping (ADR 0024) |
| `InputMessage { tick, input }` | `{ inputs: [...] }` | redundant input tail (ADR 0021) |

---

## 4. Client time model

### 4.1 Interpolation buffer (ADR 0017, refined by ADR 0019/0020)

The non-predicted world (remote Characters, Props, ragdoll bones, Spinner phase, and the
Prop/mirror obstacle poses fed into local prediction) is rendered `INTERP_DELAY_MS` of
*server time* in the past, lerping between the two buffered snapshots that bracket that
moment. Snapshots keyed by `tick · TICK_MS`, so jitter in *arrival* doesn't reach the
output.

```
INTERP_DELAY_MS = clamp(  INTERP_RATIO / snapshotHz * 1000,  minimum, 250 )
```

`INTERP_RATIO = 2` (Valve `cl_interp_ratio` default; near-universal consensus — the
smoothness/accuracy compromise). At 30 Hz → **66.7 ms**. At 20 Hz → 100 ms. Stop tying it to
`TICK_MS`.

Buffer underrun (a snapshot later than the delay) → **hold the latest pose**. Never
extrapolate, never jump backward.

### 4.2 Clock sync (ADR 0019)

Work in **tick space via a monotonic clock** (`performance.now()`), never `Date.now()`:

```
estimatedServerTick(now) ≈ lastTickReceived + (now - lastSnapshotArrivedAt) / TICK_MS  +  offsetCorrection
```

`offsetCorrection` comes from an NTP-style handshake:

- Client sends `ping{ clientTimeMs: T1 }`; server replies `pong{ clientTimeMs: T1, serverTimeMs: T3 }`.
- On receipt at `T4`: `rtt = T4 - T1`, `offset = T3 + rtt/2 - T4`.
- Keep a window of the **last ~16 samples**. (NTP uses 8; a larger window is fine here — a
  different domain with different sampling intervals — but say so in the ADR.) Discard
  samples > 1σ from the median (median-filter variant), then take the offset from the
  **lowest-RTT** sample (lowest RTT statistically correlates with lowest error — RFC
  1129/1305). Both filters are legitimate NTP variants; the ADR states which we use.
- Cadence: burst ~8 at join, then 1/s.
- Apply via **clamped slew**: at most ~15–30 ms/s of correction (derived for this game
  context, *not* a cited NTP constant), snap outright only past ~100 ms of error.
- `serverTimeMs` on every snapshot lets the client detect a *biased-slow* server (GC, 12-client
  JSON load makes sim-time fall behind wall-time) that "tick alone" would read as unbounded drift.

Overwatch-style time dilation (servoing client sim speed) is **not** needed — it fights
packet-loss starvation, which TCP doesn't have.

### 4.3 Input LEAD (ADR 0021; ADR 0026; ADR 0027)

The client runs its prediction tick ahead of `estimatedServerTick` so the server's command
buffer never starves.

- One-time seed into the **server's own tick space** (ADR 0027):
  `predictionTick = round(estimatedServerTick(now)) + initialLeadTicks`, where
  `initialLeadTicks = clamp(ceil((rtt/2) / TICK_MS) + 1, INITIAL_LEAD_TICKS_MIN,
  INITIAL_LEAD_TICKS_MAX)`. Gated on the time-sync and interpolation buffer both being ready;
  before that, `predictionTick` free-runs from 0 and its low tick numbers are simply
  unmatched by the server (repeat-filled), at no cost.
- Then a **feedback loop** (unchanged from ADR 0021): the server reports `commandQueueDepth`
  in every snapshot; the client nudges `LEAD` toward "queue depth ≈ 1–2" **gradually**. The
  *inject* side (queue starving) is responsive; the *drop* side drains a fat queue by a small
  fraction of a tick per frame — never a full `TICK_MS` at once, which yanks the render alpha
  (ADR 0026).
- The server applies `input[serverTick]` (ADR 0027), not FIFO next-in-queue — so
  "physics steps == inputs applied by tick number" holds by construction, and a momentarily
  starved tick no longer biases the server's reported position ahead of the client's own
  prediction for it. The systematic ~0.2u bias this closed is gone at the source; ADR 0026's
  render offset remains, to hide the smaller residual (real jitter beyond LEAD, cross-machine
  Rapier FP residue) that any predict/reconcile loop still has.

### 4.4 Correcting the local Character (ADR 0026)

Reconciliation resets the sim to the server's state for the acked tick and replays forward
(ADR 0013) on **any** disagreement past a float-noise epsilon (`RECONCILE_POSITION_EPSILON
≈ 0.02` — the old `RECONCILE_POSITION_ERROR = 0.2` correct-or-ignore threshold is retired,
it equalled one walk-step). What is *rendered* is `simPose + capsuleErrorOffset`, where the
offset accumulates `renderedBefore − poseAfterReplay` on each reconcile and decays
`0.5^(dtMs / CAPSULE_ERR_HALFLIFE_MS)` per frame (half-life ≈ 100 ms) — the same mechanism
as §5, reused (`packages/shared/src/state/errorOffset.ts`'s `decayPositionOffset`, which §5's
`decayPropError` now also calls). Position only — `CharacterSnapshot` carries no facing/
rotation to reconcile; the model's facing is driven client-side from movement input, not the
network. Drop the offset and snap past `RECONCILE_HARDSNAP_M` (2.0). The offset applies only
while `Controlled`/`Stagger`; a `motionState` change snaps and zeroes it (ADR 0006/0013/0023).
Collision, camera-follow and gameplay read the raw `simPose`.

---

## 5. Pushed-Prop prediction (ADR 0022 — supersedes ADR 0016)

Every Prop is interpolated (§4.1) **except the one the local Character is contacting**, for
`PROP_PREDICT_GRACE` ticks after last contact. That one is *simulated* locally by the
client's Rapier — but what's *rendered* is the simulated pose **plus a render-time error
offset** that decays exponentially toward zero.

Client 3-state machine, per Prop:

```
PINNED  ── local Character contacts it ──▶  PREDICTED
PREDICTED  ── grace lapses ──▶  SERVER-MOVING
SERVER-MOVING  ── it comes to rest / server pose matches ──▶  PINNED
```

Every transition, and every server snapshot while PREDICTED/SERVER-MOVING, computes
`error = serverPose - localPose` and **adds it to the accumulated offset** — it does not
move the rendered pose. The offset then decays each render frame:

| quantity | rule | source |
|---|---|---|
| position offset | ×0.95/frame while ‖error‖ ≤ 0.25 m; ×0.85/frame while ≥ 1 m; lerp between | Fiedler *State Synchronization* (2015), verbatim |
| orientation offset | quaternion blend 0.1 → 0.5 by error magnitude | Fiedler, verbatim |
| hard-snap | ‖error‖ > 2 m → drop the offset, snap | Fiedler (2004), verbatim |
| velocity / angular velocity | **snap, never smooth** (Fiedler's rule); we additionally *aligned-gate* — skip the correction if `dot(current, target) ≤ 0`, so a box that just hit a wall isn't yanked toward its stale pre-collision velocity | Fiedler (snap); the aligned gate is **our extension** (from Unity Ultimate Glove Ball's `BallStateSync`), flagged as such |

The Rapier body itself always snaps to the authoritative state — smoothing is never applied
between the state update and the simulation (Fiedler: it ruins the extrapolation).

`PROP_PREDICT_GRACE = clamp(ceil(RTT / TICK_MS), 2, 8)` ticks — a **derived heuristic**, not
a documented best-practice formula. Tune empirically; the cap of 8 (~267 ms) may be lowered.

Two players push the same box: the server resolves it, and both clients' error offsets
decay to the server's resolution. No client ever holds authority.

Cost scales with "Props one client is touching" (~0–2), not match Prop count.

---

## 6. Ragdoll (ADR 0023 — amends ADR 0015, extends ADR 0006)

- **The server runs the full 11-body articulated ragdoll.** It is the authority for the
  bone poses and for when the knockdown ends. Capsule-only / pelvis-proxy is a *documented
  fallback*, adopted only on a measured problem — a profiling pass at 12 players / ~6
  simultaneous ragdolls checks CPU/bandwidth **and race artefacts** (asymmetric "only one
  client sees it" — the FiveM/Roblox failure mode a profiler misses).
- **The client runs no local ragdoll body** (ticket 09 closed). `bones` come from the
  server, interpolated like a remote entity. Wire shape: a **sparse/indexed list, count is
  data** — a later switch to pelvis-only / key-bones-only is not a schema break.
- The knockdown **transition** is predicted locally (`motionState` snaps to Ragdoll for
  instant feel). The **physics** is not predicted-and-reconciled.
- **Prediction-tick guard** (the correct form of the `downSincePredictionTick` that ADR
  0015 over-removed): the client tags its predicted ragdoll with the prediction tick `P`;
  it **ignores any non-down snapshot with `tick < P`**; the first snapshot with `tick ≥ P`
  decides `motionState`. Stops a stale snapshot from reverting a just-started knockdown.
- `ragdollEpoch` rises on **every** Ragdoll entry. `ragdollCause` (2 bits) rides the same
  choke point.
- **One-shot effects (impact SFX, camera kick, hit-react) — dual gate:**
  - predicted effects: gate on the *first forward simulation of the tick* (Source
    `IsFirstTimePredicted` / Fusion `IsForward` / Unity NfE) — not on resimulated passes.
  - snapshot-delivered effects: gate on `ragdollEpoch > lastAppliedEpoch`.
- **GettingUp**: server-decided start, fixed duration. Wire = `motionState` +
  `phaseStartTick`, not a `0..1` progress float — the client derives the blend locally
  (anchor-tick + local derivation, the same pattern as `spinnerAngleAt`; confirmed
  production practice, Unity NfE 2025).

---

## 7. Player identity & reconnect (ADR 0024)

- **`playerId`** — stable, public, keys the Character, in every snapshot. Not a credential.
- **`sessionToken`** — 32-byte crypto-random (`crypto.randomBytes(32)`, base64url ≈ 43
  chars; **not** a UUID — 122 bits is too few). Sent only in the owner's `WelcomeMessage`,
  never rebroadcast. Pure bearer, **no transport binding** for M2 — recorded as an explicit
  accepted risk: a leaked token (dev tools, network log, XSS) allows Character takeover for
  the grace window. Acceptable for a non-competitive party game with a short-lived token.
- **`GRACE_WINDOW_MS = 90_000`** — how long a disconnected Character is parked and the token
  stays valid. (Revised from a 45 s Q21 draft after a broader genre-category comparison:
  45 s was the "new player claims the slot" window; the returning-player hold is 60–120 s
  for co-op/party, and 90 s sits inside that.)
- The server distinguishes a **graceful disconnect** (client said goodbye) from a **silent
  drop** (timeout). A `reclaim` arriving before the old connection is detected dead must
  cleanly take over the session and discard the orphan — the "ghost session" is the most
  common reconnect bug class.
- **M2: the fields are issued; no reconnect logic runs.** The five-component flow is
  documented here for M-later: *reconnect token · grace window · slot hold · full-snapshot
  rehydration (never replay missed deltas) · idempotency (don't re-apply a mutation the
  client already committed)*.

---

## 8. Observability — net-graph overlay (ADR-less; low-stakes)

Minimal, plain DOM (ADR 0008). **Pull model**: a single mutable `NetMetrics` struct owned
by the client's net/prediction layer, updated in place, read by the HUD each render frame.
(Not because "push has reachability problems" — irrelevant in a single browser process —
but because the render loop already runs on a frame ticker and a skipped HUD frame just
reads the latest value, losing no event.) The metric points are exposed *as observable
state from the net layer*, not as locals in the tick loop.

Fields: RTT · clock offset · snapshot age · input-ack age · predicted tick vs estimated
server tick · input buffer depth · `commandQueueDepth` · reconciliations/sec · correction
distance **p50 / p95 / max** (ring buffer — a histogram distinguishes "a network bug" (one
outlier) from "a mistuned interp delay" (consistently slightly wrong)) · interp buffer
depth · extrapolating? · predicted-Props count.

---

## 9. Explicitly deferred (with trigger conditions)

| Optimization | Trigger to do it | Notes |
|---|---|---|
| **Binary serialization + quantization** | before the 12-player path ships | ~13× smaller than JSON, zero latency cost, no game-logic change. 16-bit fixed-point positions, enums as bits, smallest-three quaternions. Do this *before* lowering snapshot rate. |
| **Snapshot rate → 20 Hz** | after binary; if 30 Hz bandwidth is measured as a problem at 12 players | needs `INTERP_DELAY_MS` at 100 ms (+33 ms latency on all non-predicted entities) |
| **Delta compression** | after binary; per-client baseline tracking | keep last ~32 full snapshots; a client acking older than that gets a full snapshot |
| **Priority accumulator** | when networked object count grows past ~dozens | not needed at 6–10 Props / 12 players |
| **`permessage-deflate`** | only as a stopgap *while still on JSON* | pointless once binary lands (low-entropy data, adds CPU) |
| **Transport binding for `sessionToken`** | if token theft is observed | needs a stable client fingerprint we don't have over plain WS |
| **Overwatch time dilation** | if input starvation is measured (won't happen on TCP) | the fixed LEAD (§4.3) is the 80% version |
| **WebRTC DataChannel transport** | if fast competitive PvP is added *and* WS head-of-line blocking is measured as perceptible on real lossy links | signaling cost not worth it before then |
| **Ragdoll: pelvis-only / key-bones wire shape** | if the profiling pass (§6) shows a problem | schema already carries it (sparse list) — not a break |
| **Lag compensation (targeted capsule rewind)** | only for a future Punch/Grab-style precise mechanic; never a full Rapier-world rewind | M2's Bump/Fall/Prop contacts are Rapier-solver contact events, not raycasts |

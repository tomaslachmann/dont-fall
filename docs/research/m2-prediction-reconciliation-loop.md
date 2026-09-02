# M2 research — the prediction / reconciliation loop: input alignment, the same-tick compare, and smoothing the local-player correction

Seventh file in `docs/research/` (convention: primary-source notes that feed a decision but
are not themselves an ADR — see `m2-client-reconciliation.md`). It builds on:

- `docs/networking-model.md` §2 (Character — local), §4.3 (input LEAD)
- ADR 0013 (local replay; discrete state snaps; positional smoothing *deferred*)
- ADR 0019 (time sync), ADR 0020 (snapshot rate), ADR 0021 (redundant input + feedback LEAD)
- ADR 0022 (the pushed-Prop **decaying render-time error offset** — the machinery this note
  wants to reuse for the capsule), ADR 0003 (no rollback, Rapier not cross-machine deterministic)
- `docs/research/m2-client-reconciliation.md` (the replay backbone; "smooth continuous, snap
  discrete")
- `docs/research/m2-shared-prop-prediction.md` §6 (Fiedler `0.5^(dt/halfLife)` offset, already shipped
  for props in `apps/client/src/propPrediction.ts`)

**Outcome (2026-09):** the recommendation below was prototyped and A/B-tested in
`apps/client/src/predictionRegression.harness.test.ts` (see its `60 fps render cap` block).
The harness-validatable part — retire the `0.2` threshold, capsule render offset (half-life
≈ 100 ms), gentle LEAD drain — is **ADR 0026 / ticket 12** (worst rendered backward step
~22 cm → < 1.5 cm at a 60 fps cap, across network × machine conditions, no added turn
latency). §5a (server simulates `input[serverTick]`) is **ticket 13**, deferred: the
headless harness fakes the client/server tick epoch and a prototype made things worse — it
needs a real integration test first.

## Scope

A deterministic headless harness (`apps/client/src/predictionRegression.harness.test.ts`)
reproduced a ~0.20-world-unit backward **pop** of the *local* Character, ~1×/second while
walking in a straight line, frame-rate-sensitive (invisible at 144 fps, ~1/s at 60, near-constant
at 30). Two causes were traced and are treated here as **given, not to be re-verified**:

1. **Physics-steps ≠ inputs-consumed.** `apps/server/src/index.ts` consumes **one queued input
   per server tick, FIFO** (`inputQueues.get(id)?.shift()`), and steps physics unconditionally
   every `setInterval(TICK_MS)`. When a client's per-tick queue momentarily empties (ordinary
   latency/frame-time jitter) the server still steps, repeating `lastApplied`. Afterwards the
   server's step count for `lastInputTick = N` includes one extra repeated-input step, so the
   server's reported position for tick `N` sits ~`WALK_SPEED / TICK_RATE_HZ` = `6/30` = **0.20 u**
   (one 30 Hz walk-step) ahead of the client's stored prediction for tick `N`.
2. `RECONCILE_POSITION_ERROR = 0.2` is *exactly* that one-tick distance, so the phase slip
   trips a correction; the correction resets `renderPreviousSnapshot = sim.snapshot()`, so the
   render-interpolation baseline jumps and the pop is visible.
3. Secondary bug: on a correction the client does `positionHistory.clear()` then repopulates
   only `tick > acked`, dropping the acked tick's own entry. A snapshot repeating the same ack
   then finds no baseline → `positionError = Infinity` → forced full replay every snapshot until
   the ack advances.

Toggling ticket-11.8 prop prediction, the LEAD variant, and clock-sync changes nothing — this
is baseline behaviour of the loop.

---

## Recommendation (summary — full version at the end)

1. **Server consumes `input[serverTick]`, not FIFO next-in-queue.** Address the input by the tick
   it was stamped for; the LEAD feedback (ADR 0021) already exists to keep it arriving on time.
   This makes "server step count == server tick count == inputs applied by tick number" true by
   construction, which is the property every shipping predict/reconcile loop relies on and the
   one DON'T FALL's server currently breaks.
2. **On a genuinely missing input: repeat the last input** (keep today's behaviour) — but it is
   now rare (only jitter beyond LEAD), and the residual is absorbed by (4), not by a threshold.
3. **Ack = "the last tick the server actually simulated for this player"**; client resets to the
   server state for that tick and replays **strictly forward** (`tick > ack`). Keep the acked
   tick's authoritative position in `positionHistory` (fixes bug 3).
4. **Retire the hard correct-or-ignore threshold.** Reconcile the *simulation* toward the server
   state whenever they disagree (forward-replay is cheap); route the *visual* correction through
   a **decaying render-time error offset on the capsule** — the identical mechanism ADR 0022
   already ships for props (`decayPropError`, `0.5^(dt/halfLife)`), **half-life ≈ 100 ms** for
   position (Valve `cl_smoothtime` 0.1 s; Unreal `NetworkSimulatedSmoothLocationTime` 0.1 s),
   ~50 ms for facing. Hard-snap (drop the offset) past ~2 u (Fiedler; ≈ Unreal's no-smooth
   distance, scaled). **Never** offset across a `motionState` change — snap discrete state
   (ADR 0013 / 0006 precedent), smooth only the continuous `Controlled`/`Stagger` transform.

ADR 0013 needs a superseding ADR; ADR 0021 needs an amendment. ADR 0019 / 0020 stand as-is.

---

## 1. Input buffering & tick alignment — does the server simulate `input[serverTick]`?

**Yes, in every shipping engine surveyed the authoritative advance of a player is driven by
consuming that player's command for the tick being simulated — not "the next command in a
queue" decoupled from its tick number.** DON'T FALL's server is the outlier.

### 1.1 Valve Source

The Source model ties the server's per-player time advance to the client's user commands
themselves. From *Source Multiplayer Networking* (Valve Developer Community; live wiki 403s
automated fetch — verified against the `CoolOppo/fe0586836de3fb2f90f9` gist mirror):

> "During each tick, the server processes incoming user commands, runs a physical simulation
> step, checks the game rules, and updates all object states."
> — <https://gist.github.com/CoolOppo/fe0586836de3fb2f90f9>

> "Instead of waiting for the server to update your own position, the local client just predicts
> the results of its own user commands."

Each `CUserCmd` carries its own frametime; the server replays exactly the commands it received
for a player, so the player's simulated time advances by the sum of the frametimes of the
commands actually processed — it does not free-run a player's movement on ticks where no command
arrived.

**`sv_maxusrcmdprocessticks`** is the cvar that bounds catch-up when a burst of commands arrives
after a stall. It "specifies maximum user commands that server will handle from a client in a
single server frame" and "sets the maximum amount of ticks that can be processed … when a user
is catching up as a result of packet loss" (Total CS command reference,
<https://totalcsgo.com/commands/svmaxusrcmdprocessticks>; feature request / description in
ValveSoftware/Source-1-Games#414, <https://github.com/ValveSoftware/Source-1-Games/issues/414>).
Its observable effect on a client that *under-delivers* commands is documented as:

> "clients might observe incorrect prediction on movement when running with sustained fps below
> 25 fps … even when a local client encounters incorrect prediction on movement all other
> players in the server still see their movement as smooth and … always within max movement
> speed."
> — <https://totalcsgo.com/commands/svmaxusrcmdprocessticks>

i.e. Source's answer to "the client didn't send a command for this tick" is **the client eats a
local misprediction; the server does not fabricate legal-speed motion to cover the gap**. The
clamp exists precisely so a lossy/cheating/low-fps client cannot make the server advance it
faster than one command-tick per server frame. Default value: commonly cited as `24` for
CS:GO-era builds; the anti-speedhack "backlog" figure `3` also appears — see *Where the primary
sources are thin*.

### 1.2 Overwatch — the adaptive command buffer

Timothy Ford, *"Overwatch" Gameplay Architecture and Netcode*, GDC 2017 (GDC Vault `1024001`);
mechanism cross-checked against Edgegap's architecture write-up
(<https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback>,
secondary — flagged) and the GameDev.net "Overwatch — Client Input Buffer + Dynamic
FixedTimeStep" thread (<https://gamedev.net/forums/topic/701605-overwatch-client-input-buffer-dynamic-fixedtimestep/>).

- Simulation runs on fixed **16 ms command frames (~60 Hz)** (7 ms / ~128 Hz in tournament
  config).
- The server holds a **per-client command buffer** and wants it at roughly **1–2 buffered
  commands** — "enough that a tick always has a fresh command to consume, not so much that input
  lag piles up."
- **The client runs ahead** so its command for server tick `T` arrives *before* the server
  reaches `T`: "The client's clock is always ahead of the server by half round-trip time plus
  one buffered command frame" (≈ 96 ms at 160 ms RTT).
- **Missing / late commands:** "the client bundles every input since the last server-acknowledged
  movement state into a single packet" — redundant tail, so an isolated loss is covered by the
  next packet ("filling holes before simulation runs").
- **Sustained starvation → time dilation:** "Upon detection of input starvation, it notifies the
  client, which begins dilating time" — the client treats a 16 ms frame as **~15.2 ms**,
  "simulating slightly faster and pouring more inputs into the network pipe," then "gradually
  drains that buffer" once healthy. **The servo target is buffer occupancy (a jitter measure),
  not RTT.**

DON'T FALL's ADR 0019 already declined full time dilation (TCP has no packet-loss starvation)
and ADR 0021 ships the "cheap 80 %": a fixed-then-feedback LEAD driven by the server-reported
`commandQueueDepth`, nudged toward "queue depth ≈ 1–2." That is the right call — but it only
*works* if the server actually simulates the command addressed to the current tick (§2).

### 1.3 Photon Quantum — input delay

Quantum is predict-rollback (not DON'T FALL's model), but its handling of a missing input is
instructive: "players' last inputs are usually repeated during Predicted frames, so that the
local simulation advances based on such predictions" and a later Verified frame rolls back any
misprediction. It reduces mispredictions with **input delay**: "Adding a little bit of Input
Delay reduces the amount of predicted frames … can be configured … by setting `OffsetMin` to a
small value, such as `2`."
— <https://doc.photonengine.com/quantum/current/concepts-and-patterns/mispredictions-and-entity-views>

So Quantum trades ~2 frames of input latency for far fewer corrections — the same trade DON'T
FALL's LEAD makes, from the other direction (LEAD pushes the *client* ahead so the *server*
never has to predict).

### 1.4 Unreal — `UCharacterMovementComponent`

From *Understanding Networked Movement in the Character Movement Component*
(<https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine>):

> "Autonomous proxies process movement locally in `TickComponent`, record it, then send it to
> the server to be reproduced and applied authoritatively."

> "The server simulates from the location where its own copy of the character was when it got
> the `ServerMove` call."

> "If the server's timestamp and the client's timestamp have too large of a discrepancy, the
> client's timestamp is considered expired and the move is discarded."

Missing moves:

> "The system for buffering saved moves already ensures that movement information lost in transit
> will be resubmitted and evaluated."

The server advances the character by `MoveAutonomous` **per received `SavedMove`**, using the
client's own delta-time (clamped). If the client stops sending moves, the character stops — the
server does not free-run it. The server acks the last good move; the client replays its
`SavedMoves` queue forward from the correction.

### 1.5 Buffer / lead length shipping games target, and how they adapt it

| Game / engine | Target buffer / lead | Adapts on |
|---|---|---|
| Overwatch | 1–2 buffered commands; client ½ RTT + 1 command-frame ahead | buffer occupancy (jitter), via time dilation |
| Photon Quantum | `OffsetMin ≈ 2` frames input delay | fixed; server plugin manages clock/latency |
| Unreal CMC | move buffer absorbs 1 RTT of moves; timestamp-expiry clamp | fixed windows; `ServerMove` timestamp checks |
| Source | `cl_cmdrate ≈ 30`, bundled; `sv_maxusrcmdprocessticks` clamps catch-up | fixed clamp |
| **DON'T FALL (ADR 0021)** | LEAD `clamp(ceil((rtt/2)/TICK_MS)+1, 1, 3)`, feedback to "queue ≈ 1–2" | `commandQueueDepth` (a jitter measure) ✓ |

The consistent figure is **1–2 buffered commands**, and the ones that adapt (Overwatch)
adapt on measured *buffer occupancy* — which folds in jitter — not on RTT. DON'T FALL's design
matches this; the gap is purely server-side consumption.

---

## 2. The same-tick reconciliation comparison

**"Compare client-predicted pos for tick `N` vs server pos for tick `N`" is the standard**, and
the thing that makes it valid is that both sides have applied the *same ordered set of inputs*
from the same base — which shipping loops guarantee by making the server's authoritative advance
*be* the act of consuming a distinct client command per step.

### 2.1 The canonical loop

Gabriel Gambetta, *Client-Side Prediction and Server Reconciliation*
(<https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html>):

> "when the server replies, it includes the sequence number of the last input it processed."

> "based on what I've seen up to your request #1, your position is `x = 11`."

> "It discards its copies of sent input up to #1 – but it retains a copy of #2, which hasn't
> been acknowledged by the server" … "applies all the input still not seen by the server."

Yahn Bernier, *Latency Compensating Methods…*, GDC 2001 (the loop, per
`docs/research/m2-client-reconciliation.md`):

> `"from state" <- state after last user command acknowledged by the server;`
> `"command" <- first command after last user command acknowledged by server;`
> `while (true) { run "command" on "from state" ...; "from state" = "to state"; "command" = next; }`

The ack is the **last input the server *simulated***, the client resets to the server's state
*for that input*, and replay is **strictly forward**. Neither Gambetta nor Bernier applies a
threshold — the client reconciles on every server message; §3.

### 2.2 What guarantees both sides ran the same number of steps

Nothing in the algorithm — it has to be arranged. The shipping arrangement:

- **Source:** the server processes the user commands it received; each advances that player's
  sim time by the command's own frametime. A tick with no command does not advance that player.
  Step count for a player == commands processed for that player.
- **Unreal:** `MoveAutonomous` runs once per `SavedMove`; the server's character advances by the
  moves it got, in order. Same invariant.
- **Overwatch / Quantum:** the sim consumes exactly one command per command-frame; the buffer
  (Overwatch) or input delay (Quantum) exists to make sure there *is* one.

**DON'T FALL breaks this invariant.** `simulation.tick()` runs every `setInterval(TICK_MS)`
regardless; `queue.shift()` is FIFO and `entry.tick` is used only for dedupe/ordering
(`apps/server/src/index.ts` lines ~139–146, 172–181), never for scheduling. On an empty queue
the server repeats `lastApplied` and steps anyway. So for `lastInputTick = N` the server may
have taken `N + k` physics steps (`k` = repeated-input fills), and its position for `N` is `k`
walk-steps ahead of the client's stored prediction for `N`. The harness — which runs both
Rapier worlds in one process, so there is *no* floating-point divergence — measures this as a
clean `0.20 u` = `WALK_SPEED / TICK_RATE_HZ`, confirming the cause is step-count, not FP drift.

### 2.3 The fix shipping games use

Address the input by tick. The server keeps its own `serverTick`; each tick it simulates the
queued input whose `tick === serverTick` (or the newest with `tick < serverTick` if that exact
one never arrived, = "repeat last"), and advances `serverTick` by exactly one. Then:

- server step count == `serverTick` increments,
- the input applied at server tick `T` is the same input the client applied at its prediction
  tick `T` (the client already stamps `inputBuffer.push({ tick: predictionTick, … })` and runs
  `predictionTick` a LEAD ahead of the estimated server tick),
- `positionHistory.get(T)` vs "server position reported for `lastInputTick = T`" is an
  apples-to-apples same-tick compare, and in production the *only* residual is Rapier's
  cross-machine FP non-determinism (ADR 0003) — small, unbiased, and exactly what a decaying
  error offset is for (§4), not a systematic 0.2 bias that a threshold has to be tuned around.

### 2.4 The ack / history bug (defect 3)

`reconcile()` does `positionHistory.clear()` then stores only `tick > acked`
(`apps/client/src/main.ts` lines ~187–191). The acked tick's own authoritative position —
which *is* `server.position` — is dropped. The very next snapshot, if it repeats the same
`lastInputTick` (server starved a tick, or a duplicate/reorder), finds no `positionHistory`
entry for `acked` → `positionError = Infinity` → unconditional full replay, every snapshot,
until the ack advances. The harness's `keepAckedInHistory` candidate (`positionHistory.set(acked,
{ ...server.position })` after reconcile) is the correct minimal fix and should ship regardless
of the rest.

---

## 3. The correction threshold

**A hard "below `X`, do nothing" threshold is not standard.** The shipping consensus is:
*always* reconcile the simulation, *always* smooth the visual correction, and reserve an
instantaneous **snap** for errors past a *large* distance.

### 3.1 Valve

Source has no documented correct-or-ignore threshold. `cl_smooth` (default on) always eases the
error over `cl_smoothtime`:

> "By gradually correcting this error over a short amount of time (`cl_smoothtime`), errors can
> be smoothly corrected. Prediction error smoothing can be turned off with `cl_smooth 0`."
> — Source Multiplayer Networking (gist mirror as above)

With `cl_smooth 0`, "prediction error correction can be quite noticeable and may cause the
client's view to jump erratically" — i.e. Valve's position is *the correction always happens;
the only choice is whether it's smoothed*.

### 3.2 Unreal

`AGameNetworkManager::MAXPOSITIONERRORSQUARED` — "the square of the max position error that is
accepted in network play without being corrected" — default **`3.0`** (uu², so ~**1.73 cm** of
allowable un-corrected error), tested via `ExceedsAllowablePositionError()`
(<https://forums.unrealengine.com/t/reducing-server-position-corrections-increasing-error-tolerance/21529>;
config key `[/Script/Engine.GameNetworkManager] MAXPOSITIONERRORSQUARED`). At ~1.7 cm this is
"correct on essentially any real disagreement." Unreal then leans entirely on smoothing:

- `NetworkMaxSmoothUpdateDistance` = **256** uu — "Maximum distance character is allowed to lag
  behind server location when interpolating between updates."
- `NetworkNoSmoothUpdateDistance` = **384** uu — "Maximum distance beyond which character is
  teleported to the new server location without any smoothing."
  (<https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/CharacterMovementComponent>;
  default values confirmed via
  <https://forums.unrealengine.com/t/how-does-networkmaxsmoothupdatedistance-networknosmoothupdatedistance-work/684340>
  and the `dawnarc.com` CMC defaults dump.)

So Unreal's only "threshold" is a **snap-vs-smooth** switch at a large distance (384 uu ≈ 3.8 m),
not a correct-vs-ignore switch.

### 3.3 Gambetta / Fiedler

Gambetta: reconcile on every server message, unconditionally. Fiedler (*State Synchronization*):
always apply, adapt the *decay rate* to magnitude — "0.95 for small position errors (25 cms or
less) while having a tighter blend factor of 0.85 for larger distances (1 m or above)" — and
hard-snap (drop the offset) past ~2 m.

### 3.4 Is DON'T FALL's `0.2` too tight?

`RECONCILE_POSITION_ERROR = 0.2` u = one full `WALK_SPEED` step per tick = `0.2 / 0.35` ≈
**0.57× capsule radius**. Against Unreal's ~1.7 cm always-correct it is actually *loose*. The
problem is not the magnitude — it is that the loop currently produces a **systematic ~0.2 bias**
(the §1 step-count slip) that parks right on the threshold, and there is **no smoothing layer**,
so each time it crosses, the correction pops. Tightening or loosening `0.2` only changes how
often the un-smoothed pop fires. The fix is (a) remove the systematic bias (§2.3) and (b) always
smooth (§4); after that the threshold's only defensible job is a float-noise epsilon (a few
`mm`) or a snap-vs-smooth switch at ~2 u.

---

## 4. Smoothing the local-player correction (the key question)

Every shipping engine hides the local correction the **same way DON'T FALL already hides the
pushed-Prop correction** (ADR 0022): the collision body / gameplay state snaps to the
authoritative value; a separate **render-only offset** carries the visual from where it was to
where the body now is, decaying to zero over ~100 ms.

### 4.1 Unreal — `NetworkSmoothingMode` + mesh-offset-from-capsule

`ENetworkSmoothingMode`
(<https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/ENetworkSmoothingMode>):

> **Disabled:** "No smoothing, only change position as network position updates are received."
> **Linear:** "Linear interpolation from source to target."
> **Exponential:** "Exponential. Faster as you are further from target."

Default is **Exponential** (CMC constructor; `dawnarc.com` dump). The technique, for *both* the
simulated proxy and the autonomous (local) proxy: the **capsule** (collision) is moved to the
corrected/replayed position immediately; the **mesh** is rendered at `capsule +
MeshTranslationOffset`, and that offset is interpolated to zero:

> "Network smoothing is a process that smooths out this motion, interpolating the character
> gradually from the source location towards a target location instead of snapping it to the
> target instantly." … the system uses `SmoothClientPosition` with `NetworkSmoothingMode`.
> — Understanding Networked Movement (as above)

> "`UCharacterMovementComponent::Crouch()` … apply an offset to the current smoothing state …
> `ClientData->MeshTranslationOffset` (current interp location) and `OriginalMeshTranslationOffset`
> (start of interp location)." … "the capsule … always triggers
> `UCharacterMovementComponent::SmoothCorrection()`."
> — Unreal issue tracker UE-231679 (<https://issues.unrealengine.com/issue/UE-231679>)

Time constants (CMC defaults, `dawnarc.com` dump — cross-checked against the 5.4 Python API
property text):

| property | default | doc text |
|---|---|---|
| `NetworkSimulatedSmoothLocationTime` | **0.100 s** | "How long to take to smoothly interpolate from the old pawn position on the client to the corrected one sent by the server. Not used by Linear smoothing." |
| `NetworkSimulatedSmoothRotationTime` | **0.033 s** | rotation equivalent |
| `ListenServerNetworkSimulatedSmoothLocationTime` | **0.040 s** | "only used on Listen servers" (near-zero latency ⇒ shorter window) |
| `ListenServerNetworkSimulatedSmoothRotationTime` | **0.033 s** | — |
| `NetworkMaxSmoothUpdateDistance` / `NetworkNoSmoothUpdateDistance` | 256 / 384 uu | smooth up to 256, teleport past 384 |

Exponential mode's rate is derived from that time; Linear divides the remaining distance by the
remaining time. Epic's own forum guidance is that Exponential "looks better for most cases" and
Linear is preferred when a constant catch-up speed matters
(<https://forums.unrealengine.com/t/linear-or-exponential-for-network-smoothing/406481>).

### 4.2 Valve — `cl_smoothtime`

`cl_smoothtime` default **0.1 s**. The prediction error (the vector between the un-corrected
predicted origin and the corrected one) is stored and paid down linearly across that window as
the view is rendered; new errors during the window replace/extend it. `cl_smooth 0` → the raw
per-correction jump, "view … jump erratically" (Source Multiplayer Networking, as above).

### 4.3 Overwatch

The talk states smoothing makes the correction "in the vast majority of cases, invisible" but
does not publish the algorithm or window. Treated as corroboration only (secondary /
paywalled-video — flagged).

### 4.4 Fiedler — the offset DON'T FALL already ships

*State Synchronization* (<https://gafferongames.com/post/state_synchronization/>):

> "calculating and maintaining position and orientation error offsets that we reduce over time.
> Then when we render … we don't render them at the simulation position and orientation, we
> render them at the simulation position + error offset."

> "you should not apply smoothing at the simulation level because it ruins the extrapolation."

Decay = `retain = 0.5^(dt/halfLife)` per frame; Fiedler's `0.95 @ 60 fps` ≈ **225 ms** half-life
(small error ≤ 25 cm), `0.85 @ 60 fps` ≈ **71 ms** (large error ≥ 1 m), lerped between; hard-snap
past 2 m. This is verbatim what `apps/client/src/propPrediction.ts::decayPropError` implements
(`PROP_ERR_HALFLIFE_NEAR_MS = 200`, `_FAR_MS = 70`, `PROP_ERR_HARDSNAP_M = 2.0`).

### 4.5 Should the capsule use the identical mechanism? Yes. What half-life?

**Yes** — ADR 0013 explicitly deferred it and named it as "the same family as the capsule's
positional error smoothing"; ADR 0022's implementation note calls the mechanism "reusable … the
same family as the capsule's positional error smoothing that ADR 0013 deferred." The sources
converge:

| source | window / half-life for a walking character correction |
|---|---|
| Valve `cl_smoothtime` | 0.1 s window |
| Unreal `NetworkSimulatedSmoothLocationTime` | 0.1 s (0.04 s listen-server) |
| Fiedler (small error, ≤ 25 cm — the DON'T FALL case, ~0.2 u) | ~0.2 s half-life |
| DON'T FALL props today (`PROP_ERR_HALFLIFE_NEAR_MS`) | 0.2 s |

**Recommend position half-life ≈ 100 ms** (Valve + Unreal both land there for a *character*;
props' 200 ms is for a shoved crate where a slower ease reads as weight, wrong for a capsule you
are steering). As a per-frame retain factor: `0.5^(16.67/100) ≈ 0.891` at 60 Hz, `0.5^(33.3/100)
≈ 0.794` at 30 Hz. Facing/rotation ≈ 50 ms. Hard-snap past ~2 u (Fiedler; ≈ Unreal 384 uu scaled
to the playground). Below a few-mm epsilon, zero the offset so it doesn't buzz on FP noise.
**Never** run the offset across a `motionState` transition — snap the state machine and its
pose (ADR 0013, ADR 0006, `m2-client-reconciliation.md`), apply the offset only while
`Controlled` / `Stagger`, and seed a fresh offset (or zero it) on `GettingUp → Controlled`.

---

## 5. Frame-rate independence

### 5.1 Why the symptom is frame-rate-sensitive

The pop fires when the client's per-tick input queue *on the server* empties for a tick. That
happens when, over a short window, the client delivers **< 1 new input per server tick**. The
client emits inputs only inside its fixed-step predict loop (`apps/client/src/main.ts` lines
~357–374): one input per accumulator step, `sendInput()` inline.

- **144 fps:** `elapsedMs ≈ 6.9 ms`, so most frames run 0 ticks and occasionally 1; averaged
  over any ~33 ms the loop emits ~1 tick's worth, and the LEAD keeps `commandQueueDepth ≥ 1`.
  The server rarely starves → rare pop.
- **30 fps:** `elapsedMs ≈ 33.3 ms ≈ TICK_MS`. The harness adds ±15 % deterministic frame
  jitter (`run()`), so a frame of 28 ms runs **0** steps (sends nothing) and the next of 38 ms
  runs **2**. The 0-step frame starves the server for that tick → repeat-last → +0.2 slip →
  pop. At 30 fps this is nearly every second; at 60 fps (`16.7 ms`, two frames per tick) the
  jitter rarely produces a 0-tick *pair*, so it's ~1/s.

So the frame-rate sensitivity is a direct consequence of coupling the **input-send cadence** to
the **render-frame-driven step loop**, plus a server that starves silently.

### 5.2 What shipping games do

- **"Fix Your Timestep" accumulator** (<https://gafferongames.com/post/fix_your_timestep/>):
  `accumulator += frameTime; while (accumulator >= dt) { integrate(); accumulator -= dt; }` with
  `alpha = accumulator / dt` interpolation between `previousState` and `currentState`, and a
  `if (frameTime > 0.25) frameTime = 0.25` spiral-of-death clamp. **DON'T FALL already does all
  of this** for prediction stepping (`MAX_STEPS_PER_FRAME`, `predictionAccumulatorMs`,
  `localAlpha`, the `EPSILON_MS` last-tick guard). The accumulator is not the problem.
- **Decouple the command-send cadence from the render frame.** Source sends user commands at
  `cl_cmdrate` (~30/s) *independent of fps*, bundling multiple commands per packet when fps >
  cmdrate and sending the newest command plus a redundant tail. DON'T FALL half-does this
  (`INPUT_REDUNDANCY` tail) but still only *generates* an input inside a step, and only *sends*
  when a step runs.
- **Keep the command buffer ≥ K.** Overwatch's whole time-dilation loop is "hold the buffer at
  1–2." DON'T FALL's LEAD feedback is the TCP-appropriate version of this — but it currently
  targets `smoothedQueueDepth` between `[1, 2.5]` and only injects/drops **one tick per
  `LEAD_ADJUST_FRAMES = 12`**, i.e. it corrects a starvation over ~12 frames = ~200 ms at 60 fps
  / ~400 ms at 30 fps — too slow to prevent the 30 fps 0-step-frame starvation, only to recover
  from it.
- **Sub-tick input sampling** (CS2) — samples input between ticks and applies a fractional
  first/last step. Overkill for a 30 Hz party game; noted, not recommended.

### 5.3 The frame-rate-robust arrangement for DON'T FALL

1. Server simulates `input[serverTick]` (§2.3) — a 0-step client frame no longer desynchronises
   step-count from input-count; it just means `input[serverTick]` might be briefly missing,
   handled as "repeat last" + smoothed residual, not a systematic bias.
2. Raise the effective LEAD floor / speed up the LEAD feedback so `commandQueueDepth` stays
   ≥ 1 even at 30 fps with jitter (inject a tick as soon as `smoothedQueueDepth < 1`, not once
   per 12 frames; the *drop* side can stay lazy).
3. Optionally, generate-and-send the current input once per frame even on a 0-step frame
   (stamped for the next `predictionTick`), so the redundant-tail packet still goes out and the
   server's `input[serverTick]` is more likely already queued. Cheap; matches Source's
   fps-independent `cl_cmdrate`.
4. Always-smooth (§4) makes whatever residual survives invisible regardless of fps.

---

## Where the primary sources are thin

- **`sv_maxusrcmdprocessticks` exact default & missing-usercmd semantics.** The Valve wiki does
  not document it; Total CS and community references give the behaviour and disagree on the
  default (`24` vs `3`). Source's precise "no usercmd this tick" path (hold vs. run a null
  command that repeats buttons) is in `player_command.cpp` / `CPlayerMove`, which I could not
  fetch. The load-bearing claim — *the server does not free-run a player at legal speed to cover
  a missing command; the under-delivering client mispredicts locally* — is well attested by the
  cvar's documented purpose and effect.
- **Overwatch.** GDC Vault video is the primary source; the command-buffer target (1–2), the
  15.2 ms dilation figure, and "½ RTT + one command frame ahead" are from the talk but reached
  here via Edgegap (secondary) and GameDev.net threads. Exact servo gains, buffer size, and the
  local-correction smoothing algorithm are not published.
- **Unreal source.** `github.com/EpicGames/UnrealEngine` is gated (404/403 to WebFetch). The CMC
  smoothing time-constant defaults come from a third-party defaults dump (`dawnarc.com`)
  cross-checked against the official Python API *property descriptions* (which omit numeric
  defaults) and the issue tracker. `MAXPOSITIONERRORSQUARED = 3.0` is from the Epic forums, not
  a primary header. Treat the numbers as "very likely correct, not from the header."
- **Valve `cl_smoothtime` distribution curve.** The wiki says "gradually corrected over
  `cl_smoothtime`" but not the exact easing function; `CInput::CheckPredictionError` /
  `CBasePlayer::GetSmoothedVelocity` were not fetched.
- **No source quantifies** the perceptibility threshold for a residual capsule pop at DON'T
  FALL's speed (6 u/s) and camera distance, nor the CPU cost of reconciling-every-snapshot with
  forward replay at 12 players on the Node server. Both are harness/playtest items.

---

## Recommendation for DON'T FALL

Constraints: 30 Hz fixed sim, plain WebSocket/TCP (no UDP, no rollback — ADR 0003), ≤ 12
players, Rapier on both ends, client predicts only its own capsule.

### 5a. Server input-consumption model — **tick-addressed, not FIFO**

The server keeps `serverTick` and, each tick, applies the queued input with `tick === serverTick`
(else the newest with `tick < serverTick` — "repeat last"), advancing `serverTick` by one.
`commandQueueDepth` stays as-is for the LEAD feedback. This restores "server step count ==
`serverTick` == inputs applied by tick number," the invariant §2.2 shows every shipping loop
relies on, and collapses the systematic 0.2 bias to zero, leaving only unbiased Rapier
cross-machine FP residual for §5c to absorb.

### 5b. Missing input — **repeat last, honestly acked**

Keep "repeat `lastApplied`" for a tick whose input never arrived (simplest; matches Source's
"catch-up is bounded," Quantum's "repeat last input on predicted frames"). Do **not** rollback
when the real input arrives late (ADR 0003). The ack (`CharacterSnapshot.lastInputTick`) is
**the last `serverTick` the server simulated for this player** — including repeat-filled ticks —
so the client always has a base to reset to and replays strictly forward.

### 5c. Ack semantics & the history fix

- `lastInputTick` = last simulated server tick (5b).
- Client `reconcile()`: after `replayLocalCharacter`, **also** `positionHistory.set(acked, {
  ...server.position })` (the harness `keepAckedInHistory` fix) so a repeated ack computes
  `positionError = 0` instead of `Infinity`. Ship this even before the rest.
- Replay stays forward-only from `acked` (`tick > acked`), unchanged.

### 5d. Correction threshold — **retire the correct-or-ignore threshold**

- Reconcile the *simulation* toward the server state whenever `positionError` exceeds a small
  **float-noise epsilon** (`~0.02 u`, ≈ `PROP_ERR_SETTLED_M`) *or* any discrete-state
  disagreement (unchanged from today). Forward replay of ~LEAD + jitter ticks at 30/s is cheap.
- `RECONCILE_POSITION_ERROR = 0.2` is either deleted or redefined as that epsilon
  (`RECONCILE_POSITION_EPSILON = 0.02`). It must **no longer** equal one walk-step.
- Add a **hard-snap distance** `RECONCILE_HARDSNAP_M = 2.0` (drop the error offset, snap the
  render) — Fiedler's 2 m, and Unreal's `NetworkNoSmoothUpdateDistance` 384 uu scaled to the
  playground. Reuse `PROP_ERR_HARDSNAP_M`'s value.

### 5e. Local-player correction smoothing — **reuse ADR 0022's offset**

- A `CapsuleErrorOffset` (`{ position: Vec3; rotation: Quat }`), same shape as `PropError`.
- On every reconcile while `Controlled` / `Stagger`: `offset += renderedPoseBefore −
  poseAfterReplay` (add to the accumulator; never move the rendered pose directly), exactly like
  `PropPredictionController.reseedAfterReconcile`.
- Decay each render frame with `decayPropError`'s `0.5^(dtMs / halfLifeMs)`, **`halfLifeMs ≈
  100`** for position (`CAPSULE_ERR_HALFLIFE_MS`), **`~50`** for facing. (Retain ≈ 0.89/frame at
  60 Hz, ≈ 0.79/frame at 30 Hz.) Drop the offset past `RECONCILE_HARDSNAP_M`; zero it below the
  epsilon.
- Render the local Character at `simPose + offset`. Collision / camera-follow / gameplay all use
  the raw `simPose` (Fiedler: never smooth into the sim).
- **Do not** carry the offset across a `motionState` change: snap discrete state and its pose
  (ADR 0006 / 0013), zero the offset on entering and leaving a down state. While down the local
  Character is already drawn from the server snapshot (`main.ts` renderCharacter branch) — the
  offset simply doesn't apply there.
- This also removes the need for `renderPreviousSnapshot = sim.snapshot()` on a correction (the
  line that currently makes the pop visible): with the offset absorbing the delta, render
  interpolation can keep its baseline.

### 5f. Frame-rate robustness

- Speed up the LEAD *inject* side: add a tick the moment `smoothedQueueDepth < 1`, not once per
  `LEAD_ADJUST_FRAMES`. Keep the drop side rate-limited (draining a fat queue slowly is fine;
  starving is not).
- Generate + send the current input once per render frame even on a 0-step frame (stamped for
  the next `predictionTick`), so the redundant-tail packet still goes out — fps-independent
  `cl_cmdrate` behaviour.

---

## Impact on existing ADRs

| ADR | Action | One-line decision the new/updated ADR records |
|---|---|---|
| **ADR 0013** (client reconciliation) | **Superseding ADR** | "The predicted capsule's continuous transform is corrected through the ADR 0022 decaying render-time error offset (`halfLife ≈ 100 ms`, hard-snap past 2 u), applied only while Controlled/Stagger; reconciliation of the *simulation* is unconditional (float-noise epsilon only); `RECONCILE_POSITION_ERROR = 0.2` is retired. Discrete `motionState` still snaps, never offset." |
| **ADR 0021** (redundant input + feedback LEAD) | **Amend** | "The server simulates `input[serverTick]` (the command stamped for the tick being simulated), not FIFO next-in-queue; a missing command repeats the last applied input and is reflected honestly in `lastInputTick`. The LEAD *inject* response is immediate (`commandQueueDepth < 1`), not rate-limited. Input is generated and sent once per render frame, decoupled from the step loop." |
| **ADR 0019** (time sync) | **No change** | mechanism stands; note only that the "keep `commandQueueDepth` ≥ 1" invariant is now load-bearing for *prediction correctness*, not just latency — belongs in the ADR 0021 amendment, not here. |
| **ADR 0020** (snapshot rate decoupled) | **No change** | reconciliation keys off `lastInputTick`, indifferent to snapshot rate; unaffected. |
| **ADR 0003** (no rollback) | **No change** | forward-only replay on one machine; the server never re-simulates a late input. Explicitly *not* violated. |
| **ADR 0022** (pushed-Prop error offset) | **No change** (reference) | the capsule offset is a second consumer of the same `decayPropError` / offset machinery; factor the decay helper into `packages/shared` if it isn't already reachable from both. |

---

## Open questions for a proposal + test pass (prototype in the harness first)

1. **Does tick-addressed consumption + immediate LEAD-inject drive `serverStarveCount` to ~0**
   at 30 / 60 / 144 fps under the harness's wifi jitter profile (`owdMs 45, jitterMs 20`)? This
   is the primary success metric — the pop should disappear at the *source*.
2. With the capsule error offset added, measure rendered `forwardΔ` back-spikes (the harness's
   `back` / `overshoot` counters): target **zero** perceptible (> ~2 cm) backward frames at
   30 fps.
3. **Half-life sweep** `{50, 100, 150, 200} ms`: at what point does the ease read as
   rubber-banding on a real direction change vs. a pop on a correction? (Fiedler warns a single
   factor misbehaves — check whether the capsule needs the magnitude-adaptive near/far blend or
   whether a single 100 ms is enough given corrections are now tiny.)
4. **`keepAckedInHistory` in isolation** — confirm it removes the `Infinity → forced full
   replay every snapshot` path (harness `reasons: no-history-for-acked` count → 0) independent
   of everything else.
5. **Cost:** reconcile-every-snapshot (no ignore threshold) — count Rapier steps/second on the
   server-equivalent path at 12 simulated Characters; confirm it stays well under the 33 ms tick
   budget.
6. **Cross-machine FP residual:** the harness runs both Rapier worlds in one process. Add a
   deliberate small perturbation to the client world (or a second process) to measure the
   *real* unbiased residual the offset must absorb in production, and confirm 100 ms half-life
   handles it without visible drift.
7. **Interaction with the pushed-Prop offset:** while shoving a crate, both the capsule offset
   and the prop offset are live and reseeded on the same reconcile — check they don't beat
   against each other (the crate is a local obstacle for the capsule prediction).
8. **`motionState` boundary:** verify the offset is zeroed cleanly on `Controlled → Ragdoll` and
   `GettingUp → Controlled` and never carries a stale capsule offset into a getup pose.

---

## Primary sources

- **Valve Developer Community — *Source Multiplayer Networking*.** Live wiki
  <https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking> (403s automated
  fetch); verbatim mirror <https://gist.github.com/CoolOppo/fe0586836de3fb2f90f9>.
  (`cl_smooth` / `cl_smoothtime`; "processes incoming user commands, runs a physical simulation
  step"; interpolation-period formula.)
- **Valve — `sv_maxusrcmdprocessticks`.** ValveSoftware/Source-1-Games#414
  <https://github.com/ValveSoftware/Source-1-Games/issues/414>; Total CS
  <https://totalcsgo.com/commands/svmaxusrcmdprocessticks>.
- **Gabriel Gambetta — *Client-Side Prediction and Server Reconciliation*.**
  <https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html>
  ("the sequence number of the last input it processed"; discard acked, re-apply pending).
- **Yahn Bernier (Valve) — *Latency Compensating Methods in Client/Server In-game Protocol
  Design and Optimization*, GDC 2001.**
  <https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization>
  (the from-state / replay-forward loop; quoted via `m2-client-reconciliation.md`).
- **Timothy Ford (Blizzard) — *"Overwatch" Gameplay Architecture and Netcode*, GDC 2017.** GDC
  Vault <https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and>. Secondary:
  Edgegap <https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback>,
  GameDev.net <https://gamedev.net/forums/topic/701605-overwatch-client-input-buffer-dynamic-fixedtimestep/>.
  (adaptive command buffer 1–2; ½ RTT + 1 command-frame lead; 16 → 15.2 ms time dilation.)
- **Photon Quantum — *Mispredictions and Entity Views* / input delay.**
  <https://doc.photonengine.com/quantum/current/concepts-and-patterns/mispredictions-and-entity-views>
  ("last inputs are usually repeated during Predicted frames"; `OffsetMin = 2` input delay).
- **Unreal Engine — *Understanding Networked Movement in the Character Movement Component*.**
  <https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine>
  (autonomous proxy record-and-replay; server "simulates from the location where its own copy …
  was when it got the `ServerMove`"; SavedMove buffering covers lost moves).
- **Unreal Engine — `ENetworkSmoothingMode`.**
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/ENetworkSmoothingMode>
  (Disabled / Linear / Exponential text).
- **Unreal Engine — `CharacterMovementComponent` network-smoothing properties.**
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/CharacterMovementComponent>
  (property descriptions). Defaults (0.100 / 0.033 / 0.040 s; 256 / 384 uu; Exponential) via a
  third-party CMC-defaults dump (`dawnarc.com`, 2016-06, "UE4 CharacterMoveComponent 各个属性的意义及默认值")
  — flagged as not-from-header. `MAXPOSITIONERRORSQUARED = 3.0` via
  <https://forums.unrealengine.com/t/reducing-server-position-corrections-increasing-error-tolerance/21529>.
  Mesh-offset technique via UE-231679 <https://issues.unrealengine.com/issue/UE-231679>.
  Linear-vs-Exponential guidance
  <https://forums.unrealengine.com/t/linear-or-exponential-for-network-smoothing/406481>.
- **Glenn Fiedler / Gaffer On Games — *State Synchronization*.**
  <https://gafferongames.com/post/state_synchronization/> (render at `sim position + error
  offset`; "not … at the simulation level … ruins the extrapolation"; 0.95 / 0.85 adaptive
  factors; 2 m snap).
- **Glenn Fiedler / Gaffer On Games — *Snapshot Interpolation*.**
  <https://gafferongames.com/post/snapshot_interpolation/> ("3X the packet send rate"; "if a
  snapshot is lost we can just skip past it").
- **Glenn Fiedler / Gaffer On Games — *Fix Your Timestep*.**
  <https://gafferongames.com/post/fix_your_timestep/> (accumulator loop; `alpha =
  accumulator / dt`; `frameTime > 0.25` spiral-of-death clamp).

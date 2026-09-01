# M2 research — client/server time synchronisation and decoupling snapshot rate from tick rate

> `docs/research/` is a convention parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs): primary-source notes that feed a design discussion but
> are not themselves a decision record. If the recommendations below are adopted they
> should be captured as an ADR (this note expects to update ADR 0017 and add one new
> ADR for the time-sync handshake).

Scope: two questions the current netcode leaves open.

**Part A — time sync.** ADR 0017's `SnapshotInterpolator` anchors the client render
clock to server time on the *first* snapshot (`offsetMs = localNow − tick·TICK_MS`),
then eases `offsetMs` toward each newly observed offset at 2 % per snapshot
(`OFFSET_EASE = 0.02`). No RTT measurement, no ping/pong, no explicit resync. When does
"anchor once + slow ease" break, and what is the minimum-robust replacement?

**Part B — snapshot rate.** The server currently emits one snapshot per 30 Hz tick to
every client (`apps/server/src/index.ts`, the `setInterval(TICK_MS)` loop). Simulation
tick rate, snapshot/update rate, and client command rate are three independent numbers
in every shipping engine surveyed. Should DON'T FALL decouple them for M2, and to what?

Constraints unchanged from ADR 0002/0003/0004/0011: browser client, WebSocket/TCP
transport (no UDP, no packet loss but head-of-line blocking + jitter), authoritative
Node server, fixed 30 Hz Rapier sim, predict-local-Character-only + snapshot-interpolate
everything else, up to 12 players, target RTT 0–100 ms, party game not competitive FPS.

---

## Recommendation

### A. Time sync

**Replace "anchor once + slow ease" with an explicit NTP-style ping/pong handshake plus
a clamped-slew clock, and carry the server's own clock in every snapshot.** Concretely:

1. **Protocol additions.**
   - Add `serverTimeMs: number` to `SnapshotMessage` — the server's monotonic clock
     (`performance.now()`, or a `hrtime`-derived ms value) captured at the instant the
     snapshot is serialised, *alongside* the existing `state.tick`. Tick stays the
     interpolation key (perfectly spaced sim-time); `serverTimeMs` is what clock sync
     and server-slowdown detection read.
   - Add a `ping` / `pong` message pair. `ping` (client→server): `{ type: "ping",
     clientTimeMs }`. `pong` (server→client): `{ type: "pong", clientTimeMs,
     serverTimeMs }` where `serverTimeMs` is sampled when the server *processes* the
     ping, and the server replies immediately from the socket read (not from the tick
     loop) to keep queueing delay out of the sample.

2. **Offset estimation (client).** On each pong compute
   `rtt = nowMs − clientTimeMs` and `offset = serverTimeMs + rtt/2 − nowMs`
   (Simpson's stream-based technique; identical to SNTP's four-timestamp form). Keep a
   sliding window of the last ~16 samples and **use the offset paired with the lowest
   RTT in the window** (NTP's clock-filter rule — see §A2) rather than an average of
   all of them; a mean is corrupted by every TCP-retransmit / head-of-line spike.
   Simpson's "discard samples > 1σ above the median RTT, mean the rest" is an
   acceptable alternative and is the version explicitly designed for TCP.

3. **Cadence.** Burst ~8 pings ~250 ms apart immediately after `welcome` to converge
   before the player is really playing (Simpson: "five or more times, pausing a few
   seconds each time" — tighten the spacing since a DON'T FALL match is 3–5 min, not a
   strategy game). Then 1 ping/s for the rest of the match. A pong is ~40 bytes; 1/s is
   free. Every received snapshot is *also* a passive one-way offset sample
   (`serverTimeMs − nowMs + estimated_one_way`) — use those to detect a step change
   between pings, but trust the ping/pong samples for the actual correction.

4. **Applying the correction — clamped slew, with a snap threshold.** Follow Source's
   `clockdriftmgr`: correct the client's render clock toward the newest good estimate
   at a **bounded rate** (Source: `cl_clock_correction_adjustment_max_amount` = 200
   ms/s), and **snap** only when the error exceeds a hard threshold (Source:
   `cl_clockdrift_max_ms` = 150 ms — "Maximum number of milliseconds the clock is
   allowed to drift before the client snaps its clock to the server's"). For DON'T
   FALL: slew at ≤ ~25 ms/s (≈ 0.8 ms per 30 Hz frame — below the ~1-frame-per-second
   visual-motion budget), snap if off by > ~100 ms. This subsumes today's
   `OFFSET_EASE`.

5. **The playout buffer then only has to absorb jitter, not clock error.** The
   time-sync offset locates "server-now" on the client's timeline; `INTERP_DELAY_MS`
   is subtracted from that to get the render target. If the offset is accurate to
   ~10 ms, the interpolation delay only needs to cover network jitter + one snapshot
   interval (§A3, §B7). A poor offset estimate forces `INTERP_DELAY_MS` to be inflated
   to hide the error — which is effectively what ADR 0017's conservative 50 ms is
   doing today.

6. **Client-side input lead — the cheap 80 % of Overwatch time dilation.** Once the
   client knows the server tick, timestamp outgoing `InputMessage.tick` as
   `estimatedServerTick + LEAD`, with `LEAD = ceil((rtt/2) / TICK_MS) + 1` clamped to
   `[1, 3]`. At 0–100 ms RTT that is 1–2 ticks. This keeps the server's per-client
   input queue at ~1 command without the server-driven dilation feedback loop. Full
   time dilation (§A4) is not needed for M2 and should be revisited only if playtest
   telemetry shows the server's `lastApplied` fallback firing often.

### B. Snapshot / tick / command rate

**Decouple in code now; ship M2's 2-player validation at 30/30/30; flip snapshots to
20 Hz for the 12-player path.** Concretely:

| Rate | M2 validation (2p) | 12-player target | Primary precedent |
|---|---|---|---|
| Simulation tick | 30 Hz (fixed, ADR 0004) | 30 Hz | — |
| Snapshot / update rate | 30 Hz | **20 Hz** | L4D/L4D2: 30-tick sim, `cl_updaterate` default 20 |
| Client command rate | 30 Hz (1 per predicted tick) | 30 Hz | Source `cl_cmdrate` ≈ 30, independent of both |

- **Protocol change required: none for the decoupling itself.** `SnapshotMessage`
  already carries `state.tick`, and `SnapshotInterpolator` already keys the buffer by
  `tick · TICK_MS`, so snapshots for ticks 0, 3, 6, 9… interpolate correctly with no
  change. The only protocol addition is `serverTimeMs` (Part A), which is needed
  regardless.
- **Implement behind a constant.** `SNAPSHOT_SEND_EVERY_N_TICKS` in
  `packages/shared/tuning.ts` (or a server config value), default `1`. The tick loop
  emits a snapshot when `tick % N === 0`. This is a ~3-line change to
  `apps/server/src/index.ts`.
- **`INTERP_DELAY_MS` must track the snapshot interval, not `TICK_MS`.** Redefine it as
  Valve's formula: `max(cl_interp, cl_interp_ratio / snapshotHz)` capped at 0.25 s,
  with `cl_interp_ratio = 2` (survive one lost/stalled snapshot). At 30 Hz snapshots
  that is 66 ms (up from today's 50 ms); at 20 Hz it is 100 ms. Make it a function of
  the configured snapshot rate.
- **Reconciliation is unaffected by snapshot rate.** It keys off `lastInputTick`
  echoed in the snapshot; at 20 Hz the client simply reconciles 20×/s instead of 30,
  replaying the same unacknowledged-input tail. Prediction error has ~17 ms longer to
  accumulate between corrections — negligible at this game's speeds.
- **Bandwidth: real but small, and dominated by the JSON-vs-binary decision.** A
  ~12-player JSON snapshot is ≈ 3–4 KB (handbook §13.2). 30 Hz → ~960 kbit/s down per
  client; 20 Hz → ~640 kbit/s (−33 %). Binary packing (handbook: ~245 B) drops both to
  well under 100 kbit/s, at which point snapshot rate barely matters for bandwidth and
  the decision is purely about smoothness vs latency. So: **do the binary-encoding
  pass first**; then 20 Hz snapshots buy render-delay latency back only if bandwidth is
  still a concern at 12 players.
- **Cost of 20 Hz: +33 ms of render delay on everything non-predicted** (other
  players, Props, own ragdoll, Spinner phase). At 0–100 ms RTT a 100 ms playout delay
  is still well inside what Source ships as its default (`cl_interp 0.1`). The local
  predicted Character is unaffected (rendered at the live prediction tick, per ADR
  0017).

---

## PART A — client/server time synchronisation

### A1. When "anchor once + slow ease" fails

Today's mechanism (`apps/client/src/snapshotInterpolation.ts`):

```ts
const observedOffset = nowMs - serverMs;               // serverMs = state.tick * TICK_MS
this.offsetMs = this.offsetMs === null
  ? observedOffset                                     // anchor on first snapshot
  : this.offsetMs + (observedOffset - this.offsetMs) * 0.02;   // 2%/snapshot ease
// render target = nowMs - offsetMs - INTERP_DELAY_MS
```

`observedOffset` is not the true clock offset — it is `trueOffset + oneWayDownlinkDelay
+ serverTimerJitter`. Every failure below is a case where that contamination, or a
change in it, is not handled.

The 2 %/snapshot ease at 30 Hz has a time constant of ~1/(0.02·30) ≈ 1.7 s (≈ 5 s to
fully converge). That is the number to hold against each scenario.

| Failure | Mechanism | Severity for a party game (RTT 0–100 ms) |
|---|---|---|
| **Poisoned anchor: first snapshot delayed** | The anchor is `localNow − tick·TICK_MS` of snapshot #1. If snapshot #1 is late (TCP connect + slow-start, server WASM/Rapier init, a GC pause) by 100–300 ms, the offset is baked 100–300 ms too high. The render target sits that much further in the past → everything non-predicted is 100–300 ms extra-laggy, easing out over ~5 s. | **Moderate–bad.** Happens once per match, at the worst time (match start). "Felt laggy for the first few seconds." Directly fixed by a handshake that takes the *lowest-RTT* sample instead of the first. |
| **Step latency change mid-match (wifi roam, route change, cell handoff)** | `observedOffset` jumps by the one-way delay change (say +60 ms) and stays there. The ease corrects at ~1.7 s time constant. During that window the render target is up to 60 ms *ahead* of the newest buffered snapshot → sustained **buffer underrun** → `sample()` hits the "hold the latest pose" branch → the whole non-predicted world **freezes / micro-stutters for 1–2 s**. A latency *drop* is benign (just extra delay, eased out). | **Bad.** A 1–2 s freeze of other players reads as a hard network glitch. Wifi/mobile players hit this regularly. This is the strongest single argument for a real resync path. |
| **Burst of delayed packets (TCP head-of-line blocking)** | A lost segment stalls the whole stream for ~1 RTT; a burst then arrives. Because the buffer is keyed by `tick·TICK_MS`, spacing is preserved and the interpolator *holds* during the gap (freeze for the stall duration, ~50–100 ms) then resumes cleanly. The ease sees a cluster of high `observedOffset` and nudges `offsetMs` up ~2 % per sample → slight semi-permanent latency creep until it decays back. | **Mild.** The stall-length freeze is unavoidable without a deeper buffer (§B7); the ease contamination is small. Party-game-tolerable but visible under real wifi loss. |
| **Server event-loop / GC pause** | `setInterval` fires late; several ticks' snapshots batch up. `serverMs` values are still correctly spaced so the interpolator handles the batch fine (this is exactly what ADR 0017 fixed). `observedOffset` spikes for the batch → ease nudges `offsetMs` → small transient added latency, recovers. | **Mild.** ADR 0017's tick-keyed buffer already absorbs the structural part. |
| **Client GC / tab-throttle / rAF stall** | `requestAnimationFrame` stops, then `sample(nowMs)` resumes with a large `nowMs` jump → render target leaps forward → underrun → hold latest → catch up over the next frames. | **Mild** (and largely unavoidable; a background tab is not a gameplay state). |
| **Monotonic clock drift between the two machines** | Consumer crystals drift ~10–50 ppm. At 50 ppm that is 3 ms/min → ~9–15 ms over a 3–5 min match. The ease is a low-pass filter that tracks a steady ramp with a small fixed lag (`driftRate / easeBandwidth`), so *slow* drift is actually the thing "anchor + ease" handles best. | **Negligible** at match length. Would matter for a 30-min lobby-idle session. |
| **Server sim runs slower than wall-clock** (sustained overload, not a one-off pause) | If the server completes only ~28 ticks/wall-second, sim-time (`tick·TICK_MS`) falls behind wall-time permanently. The render target, advanced by wall-clock, chronically outruns the buffer → chronic underrun / stutter. The ease treats it as unbounded drift and never catches up. | **Bad if it happens**, and *invisible to diagnose* without a server wall-clock in the snapshot (§A5). |

**Bottom line for the party game:** slow drift and structural jitter are already handled
well enough. The two that actually hurt — poisoned anchor at start, and the multi-second
freeze on a mid-match latency step — are precisely the two that a ping/pong handshake
with lowest-RTT sample selection and a clamped-slew-with-snap correction fixes.

### A2. The minimum-robust approach (NTP-style offset estimation)

**The four-timestamp exchange.** RFC 5905 §8 (NTP v4), the canonical form:

> `theta = T(B) - T(A) = 1/2 * [(T2-T1) + (T3-T4)]`
> `delta = T(ABA) = (T4-T1) - (T3-T2)`

where T1 = client send, T2 = server receive, T3 = server send, T4 = client receive.
`theta` is the clock offset, `delta` the round-trip delay. When the server processes and
replies in one step (T2 ≈ T3), this collapses to the game-standard form:
`rtt = T4 − T1`, `offset = T3 + rtt/2 − T4`.

**Zachary Booth Simpson, *A Stream-based Time Synchronization Technique For Networked
Computer Games* (1 March 2000, mine-control.com)** — the primary source for the
TCP-friendly version, tested in the shipped RTS *NetStorm: Islands At War* (Titanic
Entertainment, 1997). Verbatim algorithm:

> 1. Client stamps current local time on a "time request" packet and sends to server
> 2. Upon receipt by server, server stamps server-time and returns
> 3. Upon receipt by client, client subtracts current time from sent time and divides
>    by two to compute latency. It subtracts current time from server time to determine
>    client-server time delta and adds in the half-latency to get the correct clock
>    delta.
> 4. The first result should immediately be used to update the clock since it will get
>    the local clock into at least the right ballpark
> 5. The client repeats steps 1 through 3 five or more times, pausing a few seconds
>    each time. Other traffic may be allowed in the interim, but should be minimized
>    for best results
> 6. The results of the packet receipts are accumulated and sorted in lowest-latency to
>    highest-latency order. The median latency is determined by picking the mid-point
>    sample from this ordered list.
> 7. All samples above approximately 1 standard-deviation from the median are discarded
>    and the remaining samples are averaged using an arithmetic mean.

> The only subtlety of this algorithm is that packets above one standard deviation above
> the median are discarded. The purpose of this is to eliminate packets that were
> retransmitted by TCP.

Simpson explicitly frames this as *the* reason a game on TCP/WebSocket needs outlier
rejection: a retransmitted segment "will cause this one sample to fall far to the
right on the latency histogram, on average twice as far away as the median." Results:
"synchronizations less than 100ms," "reasonably accurate (150ms or better), quick to
converge."

**NTP's clock-filter rule (David Mills, `eecis.udel.edu/~mills/ntp/html/filter.html`;
RFC 5905 §10)** — the "keep the lowest-RTT sample" trick the task asked for, stated at
the source:

> The clock filter algorithm … uses a sliding window of eight samples and picks out the
> sample with the least expected error.

> the offset and delay samples from the on-wire protocol are inserted as the youngest
> stage of an eight-stage shift register, thus discarding the oldest stage.

> In each peer process the clock filter algorithm selects the stage with the smallest
> delay, which generally represents the most accurate data, and it and the associated
> offset sample become the peer variables of the same name.

Rationale (the "wedge scattergram"):

> As the delay increases, the offset variation increases, so the best samples are those
> at the lowest delay. … if a way could be found to find the sample of lowest delay, it
> would have the least offset variation and would be the best candidate to synchronize
> the system clock.

This holds "when the delays are statistically identical in the reciprocal directions" —
i.e. it assumes symmetric routing, the same caveat Simpson names.

**Which to use for DON'T FALL:** either works; NTP's "lowest delay in an 8–16 window" is
simpler to implement than Simpson's median±1σ and degrades more gracefully (you always
have *a* sample). Use lowest-RTT over ~16 samples. Simpson's is the fallback if
lowest-RTT proves too noisy at very low ping (LAN, where all RTTs are ~1 ms and the
"lowest" is arbitrary — there, an average is fine because there are no retransmit
spikes to corrupt it).

**How often to ping.** Simpson: "five or more times, pausing a few seconds each time."
For a short match, front-load: ~8 samples ~250 ms apart right after `welcome` (≈ 2 s to
a stable estimate), then 1/s steady-state to catch step changes. Cost is trivial (a
pong is tens of bytes).

**Blending a new estimate without a visible jump — clamp the correction rate.** This is
Source's `clockdriftmgr` (see §A5 for the cvar text). Never assign the new offset
directly to the render clock; move the render clock toward it at a bounded ms-per-second
slew, and reserve an instantaneous snap for gross errors past a threshold. Source's
shipped numbers: correct at up to `cl_clock_correction_adjustment_max_amount` (200 ms/s,
and only when the error exceeds `cl_clock_correction_adjustment_max_offset`), snap past
`cl_clockdrift_max_ms` (150 ms). DON'T FALL wants a *gentler* steady slew than 200 ms/s
because the whole non-predicted world visibly shifts with the render clock — target
~15–30 ms/s (imperceptible at 30 fps) with a snap at ~100 ms.

**Relationship between the time-sync offset and the interpolation buffer's playout
delay.** They stack: `renderTargetServerMs = (clientNow − clockOffset) − playoutDelay`.
The clock offset's *job* is to put "server-now" on the client clock; the playout delay's
*job* is to sit far enough behind server-now that the two bracketing snapshots have
arrived. If the offset is wrong by `e`, the effective playout delay is `playoutDelay ∓
e` — too small on one side (underrun/stutter) or too large on the other (excess
latency). So an accurate offset lets `INTERP_DELAY_MS` shrink to *just* jitter + one
snapshot interval; an inaccurate one forces it to be padded to hide `e`. ADR 0017's
`1.5 × TICK_MS` = 50 ms is doing exactly that padding job today, in place of a real
offset estimate.

### A3. Valve's interpolation-period formula

From the Valve Developer Community wiki *Source Multiplayer Networking* and the
companion *Interpolation* page (live wiki blocks automated fetches; text below verified
against the `CoolOppo/fe0586836de3fb2f90f9` and `ribasco/046c333024db9e75b2e4f314baa11799`
GitHub gist mirrors, which reproduce the wiki verbatim):

> interpolation period = max( cl_interp, cl_interp_ratio / cl_updaterate )

capped at a maximum of 0.25 s. Definitions:

| cvar | meaning | default |
|---|---|---|
| **`cl_interp`** | interpolation delay expressed directly in **seconds**. "A value equal to 0.1 means your game displays you the data received 100 milliseconds before the last data received." | historically `0.1`; modern advice is to set it to `0` and let `cl_interp_ratio` drive |
| **`cl_interp_ratio`** | interpolation delay expressed as a **count of snapshot intervals**. "You want to go back in time of 2 updates? OK, cl_interp_ratio equals to 2." | `2` (CS:GO/CS2) |
| **`cl_updaterate`** | snapshots per second the client asks the server for. "means 'hey server … send me N times/second an update of the world.'" Clamped by the server's `sv_maxupdaterate` / `sv_minupdaterate`, and can't exceed the server tick rate. | `20` |

> Source defaults to an interpolation period ("lerp") of 100-milliseconds
> (`cl_interp 0.1`).

with the note that the default `cl_interp 0.1` "derives from the default `cl_updaterate
20`" (i.e. 2 intervals at 20 Hz).

**Translated to DON'T FALL at 30 Hz snapshots:**

- `cl_interp_ratio = 2` → `2 / 30 = 66.7 ms`. Survive one entirely missing snapshot.
- `cl_interp_ratio = 1` → `1 / 30 = 33.3 ms`. No slack; any late snapshot underruns.
- Current hardcoded `INTERP_DELAY_MS = 1.5 × TICK_MS = 50 ms` ≈ `cl_interp_ratio 1.5` —
  between "no slack" and "survive one drop." Reasonable for a clean LAN test, thin for
  real wifi.

**At 20 Hz snapshots** (the §B recommendation): `2 / 20 = 100 ms`, matching Source's own
shipped default exactly.

**Recommendation:** stop tying `INTERP_DELAY_MS` to `TICK_MS`. Define it as
`max(0, 2 / snapshotHz)` — 66.7 ms at 30 Hz, 100 ms at 20 Hz — and consider making it
lightly adaptive (grow toward ~3 intervals when underruns are observed, à la Fiedler
§B7), since WebSocket's failure mode is *bursty HOL stalls*, not the steady 2–5 % loss
Valve's `cl_interp_ratio 2` is tuned for.

### A4. Overwatch's time dilation (GDC 2017, Timothy Ford)

Timothy Ford (Lead Gameplay Programmer), *"Overwatch" Gameplay Architecture and
Netcode*, GDC 2017 (GDC Vault `1024001`). Mechanism, as reconstructed from the talk and
Edgegap's architecture deep-dive:

- The server watches its **per-client input buffer** and wants it held at roughly **1–2
  buffered commands** — enough that a tick always has a fresh command to consume, not so
  much that input lag piles up.
- **Starvation** (buffer running dry, e.g. from packet loss or jitter): the server
  signals the client to run its simulation **slightly faster** — the talk's example is
  treating a 16 ms frame as **~15.2 ms** — so the client emits command frames a little
  quicker and refills the server's buffer *before* a gap causes a misprediction.
- **Flooding** (buffer growing): the server signals the client to dilate the other way
  and drain it. "This feedback loop runs constantly."
- Independently, "the client bundles every input since the last server-acknowledged
  movement state into a single packet," so a lost packet is covered by the next one
  ("filling holes before simulation runs").
- Net effect on the client timeline: "The client's clock is always ahead of the server
  by half round-trip time plus one buffered command frame."

**Is it needed for DON'T FALL over WebSocket/TCP?** No, not for M2.

- The problem time dilation exists to solve is **input-buffer starvation under packet
  loss**. TCP/WebSocket does not lose packets — it retransmits. So the steady-state
  starvation Overwatch fights doesn't occur.
- What *does* occur is **head-of-line-blocking bursts + jitter**: during a ~1-RTT stall
  the server's tick loop finds no new input and falls back to `lastApplied` (the
  current `apps/server/src/index.ts` already does exactly this), then a burst of queued
  inputs arrives at once (bounded by `MAX_QUEUED_INPUTS = 6`, older ones dropped). That
  is a transient, not a persistent starvation the server needs to servo against.

**The cheap 80 % version — a fixed client-side input lead.** Have the client send inputs
tagged for a tick slightly *ahead* of its estimate of the current server tick:

```
InputMessage.tick = estimatedServerTick + LEAD
LEAD = clamp(ceil((rtt/2) / TICK_MS) + 1, 1, 3)
```

At the 0–100 ms target RTT, `rtt/2 ≤ 50 ms ≤ 1.5 ticks`, so `LEAD` is 1–2 ticks
(~33–66 ms). This reproduces Overwatch's "½ RTT + one command frame ahead" statically,
keeps the server queue near one command, and needs nothing from the server beyond the
`serverTimeMs` field (so the client can estimate the server tick at all — which today
it cannot). Revisit full dilation only if telemetry shows the `lastApplied` fallback
firing frequently at 12 players.

*(Server-side note: the current server consumes exactly one queued input per tick
regardless of the input's `tick` field — it uses `tick` only for ordering and
dup-rejection, not for scheduling. A fixed input lead only helps if the server also
starts treating a client that is running ahead as "on time" rather than letting its
queue grow. With `LEAD` in place and `MAX_QUEUED_INPUTS = 6`, the queue should sit at
~1–2, which is the Overwatch target anyway.)*

### A5. Does the server need to send wall-clock time, or is the tick number enough?

**Tick number alone is enough for interpolation, but not for clock sync or for
detecting a slow server.**

- **For interpolation:** `state.tick · TICK_MS` is a perfect, jitter-immune sim-time
  axis (this is the core insight of ADR 0017 and it is correct). Snapshots for ticks 0,
  3, 6… still bracket a render target cleanly. No wall-clock needed here.
- **What breaks when `setInterval(33.33ms)` drifts:** Node timers fire *late* and
  unevenly — `setInterval` guarantees "not before" the delay, never "on time," and
  under load it slips further. Two distinct cases:
  1. *Jitter around a correct mean rate* (timer fires at 30/31/29/33 ms but averages
     33.33): harmless. Sim-time and wall-time stay locked over any window > ~1 s; the
     tick-keyed buffer absorbs the unevenness.
  2. *A biased slow rate* (GC pressure, CPU contention → the loop truly completes < 30
     ticks per wall-second): sim-time falls permanently behind wall-time. The client's
     render clock (advanced by real `performance.now()` deltas) outruns the newest
     available `tick`, producing **chronic buffer underrun** — persistent micro-stutter
     of the whole non-predicted world — that "anchor + ease" reads as unbounded drift
     and never resolves. This is a real risk for a single-threaded Node server also
     doing JSON serialisation for 12 clients at 30 Hz.
- **Fix: timestamp every snapshot with the server's own monotonic clock**
  (`serverTimeMs`) *in addition to* the tick. Then the client can:
  - do continuous passive offset estimation (each snapshot is a one-way sample),
  - **detect case 2 directly**: compare the rate of `serverTimeMs` advance against the
    rate of `tick` advance; if `serverTimeMs` is climbing faster than `tick · TICK_MS`,
    the server is behind real-time and the client should widen its buffer / surface a
    "server overloaded" diagnostic rather than stutter silently,
  - anchor clock sync on `serverTimeMs` (a real clock) instead of on `tick · TICK_MS`
    (which silently assumes a perfect cadence).

The `pong` reply needs the server clock regardless (§A2). Adding the same field to
`SnapshotMessage` is nearly free (one number per message) and removes the hidden
"the server keeps perfect 30 Hz" assumption from the whole client clock model.

Recommended: **carry both.** `tick` stays the interpolation key and drives tick-based
visuals (Spinner phase). `serverTimeMs` drives clock sync and server-health detection.

---

## PART B — decoupling snapshot rate from tick rate

### B6. Valve Source: three independent rates

From *Source Multiplayer Networking* (gist mirrors as in §A3):

> The server simulates in discrete time steps called ticks. By default, the timestep is
> 15ms, so 66.666… ticks per second are simulated.

> The tickrate is set to 66 in CSS, DoD:S and TF2, and 30 in L4D and L4D2.

> the client sends command packets at a certain rate of packets per second (usually 30)

> [the server] decides after each tick whether it needs to send a snapshot to the
> clients or not … not necessarily after every tick.

So three numbers:

| rate | Source cvar | what it governs |
|---|---|---|
| simulation tick | `sv` tickrate (launch option) | how often the server advances physics/logic |
| snapshot / update rate | `cl_updaterate`, clamped by `sv_maxupdaterate` / `sv_minupdaterate` | how often the server sends world state to a client |
| command rate | `cl_cmdrate` | how often the client sends bundled user commands |

**Why decouple:**

- **Snapshots are the expensive message** — size scales with entity count × player
  count; commands and sim ticks are cheap and roughly constant. Capping snapshot rate
  independently is the main server-bandwidth lever.
- L4D/L4D2 is the concrete precedent that matches DON'T FALL: a 30-tick sim with the
  default `cl_updaterate 20` — i.e. **30 Hz sim / 20 Hz snapshots / ~30 Hz commands**,
  a co-op physics-ish game for a handful of players.

**What the client does when it sim-ticks faster than it receives snapshots:** exactly
what DON'T FALL already does. Non-predicted entities are **interpolated** between the
last two buffered snapshots (Valve: "positions and animations can be continuously
interpolated between two recently received snapshots"; Gambetta: "client-side prediction
works independently of the update delay"). The locally predicted Character runs the
shared sim step every tick regardless of snapshot arrivals and is reconciled whenever a
snapshot does land. If snapshots stop entirely for > 2 intervals, Source optionally
extrapolates (`cl_extrapolate`, capped at 0.25 s); ADR 0017 chose to *hold the last
pose* instead, which is the safer choice for physics props (Fiedler: extrapolated rigid
bodies "extrapolate through the floor").

### B7. Is there a real benefit to 20 Hz snapshots for DON'T FALL?

**Bandwidth saving.** Snapshot is broadcast to every client every send. Using the
handbook's measured JSON size (§13.2: ~3.2 KB for 8 players + 6 props; call it ~4 KB at
12 players):

| snapshot rate | JSON, per client down | binary-packed (~245 B), per client down |
|---|---|---|
| 30 Hz | ~120 KB/s (~960 kbit/s) | ~7.4 KB/s (~59 kbit/s) |
| 20 Hz | ~80 KB/s (~640 kbit/s) | ~4.9 KB/s (~39 kbit/s) |
| saving | −33 % (~320 kbit/s) | −33 % (~20 kbit/s) |

So 20 Hz saves a third either way, but **the absolute number only matters while the
protocol is JSON**. ~960 kbit/s downstream per client × 12 = ~11.5 Mbit/s out of one
server process is a genuine cost (and a mid-tier home uplink for a self-hosted server);
~59 kbit/s × 12 = ~0.7 Mbit/s is nothing. This is why the recommendation sequences
binary encoding *before* dropping the snapshot rate.

**Cost to interpolation smoothness.** Linear interpolation between 20 Hz samples (50 ms
apart) instead of 30 Hz (33 ms apart) is slightly coarser on sharp direction changes —
mitigated by Hermite interpolation using velocity (handbook §4; would need velocity in
the snapshot, which it may already carry). At this game's speeds and camera distance,
linear at 20 Hz is very likely fine.

**Cost to buffer sizing / playout delay — yes, lower snapshot rate needs a BIGGER
buffer.** This is direct from both primary sources:

- Valve: `interpolation period = max(cl_interp, cl_interp_ratio / cl_updaterate)` — the
  playout delay is **inversely proportional to snapshot rate**. `cl_interp_ratio 2` → 66
  ms at 30 Hz, 100 ms at 20 Hz.
- Fiedler (*Snapshot Interpolation*): "the amount of delay that works best at 2-5%
  packet loss is 3X the packet send rate. At 10 packets per-second this is 300ms." Delay
  scales with the send interval.

So 20 Hz snapshots ⇒ `INTERP_DELAY_MS` goes 66 → 100 ms ⇒ **+33 ms of latency on every
non-predicted entity**. At 0–100 ms RTT and a party-game feel bar, 100 ms render delay
is acceptable (it is Source's shipped default). But it is a real, permanent cost paid by
every player to save bandwidth that binary encoding would also save.

**Cost to reconciliation:** minimal. Reconciliation replays unacknowledged inputs off
`lastInputTick`; a 20 Hz snapshot rate just means corrections arrive 20×/s. Error has
~17 ms longer to accumulate between corrections — sub-millimetre at walking speed,
irrelevant.

### B8. What must the wire protocol carry?

**For snapshots not arriving every tick: `state.tick` is already sufficient.**
`SnapshotInterpolator` keys its buffer by `serverMs = state.tick · TICK_MS` and brackets
the render target between whatever two buffered entries straddle it. Snapshots for ticks
0, 3, 6, 9 … interpolate with zero code change. The `MAX_BUFFERED = 64` cap and the
prune logic are unaffected.

**Does reconciliation care about snapshot rate?** No. It keys off
`CharacterSnapshot.lastInputTick` echoed by the server, replays every buffered input
after that tick, and snaps `motionState` on change (per ADR 0006 / the reconciliation
research). None of that references how often snapshots arrive.

**What the protocol *does* still need added:**

- `serverTimeMs` on `SnapshotMessage` — for clock sync and slow-server detection (§A5).
  This is the only required addition and it is orthogonal to the snapshot-rate change.
- `ping` / `pong` message types (§A2).
- (Already present and sufficient: `state.tick`, `CharacterSnapshot.lastInputTick`,
  `InputMessage.tick`.)

**Nice-to-have if going to 20 Hz:** per-entity linear velocity in the snapshot (for
Hermite interpolation), if not already carried.

### B9. Recommendation: decouple now or keep 1:1 for M2?

**Decouple the code path now; default it to 1:1 (30 Hz) for the 2-player validation;
switch snapshots to 20 Hz for the 12-player path — and do the binary-encoding pass
before you rely on that 20 Hz for bandwidth.**

Concrete config:

```
packages/shared/tuning.ts
  TICK_RATE_HZ                 = 30      // unchanged (ADR 0004)
  SNAPSHOT_SEND_EVERY_N_TICKS  = 1       // M2 2-player validation; set to 2 → 15 Hz, or gate on player count
  // command rate stays 1 InputMessage per predicted tick = 30 Hz
```

Wait — 30 / 2 = 15 Hz, not 20. If a true 20 Hz is wanted, the server needs a separate
snapshot accumulator (`snapshotAccumulatorMs += TICK_MS; if (>= 1000/20) emit`) rather
than a tick divisor. **Recommended: use the accumulator and target 20 Hz** to match
L4D's shipped ratio; the tick-divisor (15 Hz) is simpler but pushes `INTERP_DELAY_MS` to
133 ms.

```
INTERP_DELAY_MS = max(0, cl_interp_ratio / snapshotHz)   with cl_interp_ratio = 2
               = 66.7 ms at 30 Hz  |  100 ms at 20 Hz  |  133 ms at 15 Hz
```

Rationale for the phased approach:

- **At 2 players, snapshot rate is a non-issue for bandwidth** (~160 kbit/s JSON). Debug
  netcode with the fewest moving variables — 30/30/30 keeps snapshot-arrival reasoning
  identical to tick reasoning.
- **The decoupling is cheap to build now and expensive to retrofit later** — a snapshot
  accumulator in the tick loop plus making `INTERP_DELAY_MS` a function of snapshot
  rate. Building it now means the 12-player path is a config change, not a redesign,
  which is what "architected for 12" (ADR 0011) asks for.
- **L4D's 30/20/30 is the direct primary-source precedent** for a small-player-count
  physics-flavoured game and is the right 12-player target.
- **Binary encoding first**: it saves the same ~⅓ (and much more), costs no render
  latency, and makes the 20 Hz-vs-30 Hz choice purely about smoothness — at which point
  30 Hz may simply win.

Protocol changes needed for all of the above: **add `serverTimeMs` to `SnapshotMessage`;
add `ping`/`pong`.** Nothing else — `state.tick` already carries what sparse snapshots
need.

---

## Where the sources are thin

- **Exact per-game snapshot-rate defaults.** The Valve wiki gives the *formula* and the
  `cl_updaterate` default (20) and the L4D/L4D2 tick rate (30), but a definitive "L4D
  ships snapshots at exactly 20 Hz" statement is inferred from `cl_updaterate 20` being
  the client default, not stated outright. CS2's "sub-tick" model changed the picture
  again and its networking docs are sparse. Treat "L4D ≈ 30/20/30" as well-supported but
  not quoted verbatim.
- **The 0.25 s cap on the interpolation formula** appears in the wiki text and in
  secondary summaries of it, but the gist mirror I verified `cl_interp` against
  ("`ribasco`") explicitly notes it "contains no mention of a 0.25-second cap." The cap
  is real (it's `cl_interp`'s documented max and matches `cl_extrapolate`'s 0.25 s
  limit) but my primary copy of the exact sentence is the live wiki, which blocks
  automated fetch. Low risk; flagged for honesty.
- **Overwatch time dilation — exact thresholds.** The GDC talk gives the *mechanism* and
  the "15.2 vs 16 ms" illustrative number and "1–2 buffered commands," but not the real
  servo gains, the exact buffer target, or the signalling packet format. GDC Vault video
  is the primary source; I worked from the talk's well-known content plus Edgegap's
  architecture write-up (secondary). The 80 %-version recommendation (fixed input lead)
  does not depend on those missing details.
- **Source `clockdriftmgr` cvar text.** Verified `cl_clockdrift_max_ms` (150, "snaps its
  clock to the server's") and `cl_clock_correction_adjustment_max_amount` (200 ms/s)
  against the AlliedModders CS:GO cvar dump and Total CS command reference; the
  `clockdriftmgr.cpp` source file itself (VSES/SourceEngine2007 mirror) was intermittently
  fetch-blocked (HTTP 451), so the top-of-file algorithm comment is not quoted verbatim
  here. The behaviour — ease toward server tick at a clamped ms/s rate, snap past a
  threshold — is well attested by the cvar help strings and the in-game "Slamming client
  tick to server tick" log message.
- **Clock-offset accuracy over WebSocket specifically.** Simpson's "< 100 ms, often
  better" and NTP's sub-ms are both for different transports/conditions than a browser
  WebSocket over consumer wifi. No primary source measures NTP-style sync accuracy
  specifically over a browser `WebSocket`. Expectation for DON'T FALL: tens of ms after
  the initial burst, which is why the design keeps a clamped slew and a snap threshold
  rather than trusting any single estimate.
- **DON'T FALL's actual snapshot byte size.** The 3.2 KB / 245 B figures are the
  handbook's own worked estimate (§13.2), not a measurement of the current
  `JSON.stringify(SnapshotMessage)` output. Worth measuring before committing to a
  snapshot rate on bandwidth grounds.

---

## Primary sources

- **Valve Developer Community — *Source Multiplayer Networking*.** Live wiki
  <https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking> (blocks
  automated fetch); verbatim gist mirrors:
  <https://gist.github.com/CoolOppo/fe0586836de3fb2f90f9>,
  <https://gist.github.com/ribasco/046c333024db9e75b2e4f314baa11799>.
- **Valve Developer Community — *Interpolation*** <https://developer.valvesoftware.com/wiki/Interpolation>
  (interpolation-period formula, `cl_interp` / `cl_interp_ratio` / `cl_updaterate`).
- **Yahn Bernier (Valve) — *Latency Compensating Methods in Client/Server In-game
  Protocol Design and Optimization*, GDC 2001.**
  <https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization>
  (client prediction/replay; "Command Execution Time = Current Server Time − Packet
  Latency − Client View Interpolation").
- **Gabriel Gambetta — *Fast-Paced Multiplayer*, parts 1–3.**
  <https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html>,
  <https://www.gabrielgambetta.com/entity-interpolation.html> (input sequence numbers,
  server ack of last processed input, replay of pending inputs, render-in-the-past).
- **Glenn Fiedler / Gaffer On Games — *Snapshot Interpolation*.**
  <https://gafferongames.com/post/snapshot_interpolation/> (interpolation buffer; "3X
  the packet send rate" at 2–5 % loss; "if a snapshot is lost we can just skip past
  it").
- **Glenn Fiedler / Gaffer On Games — *Deterministic Lockstep*.**
  <https://gafferongames.com/post/deterministic_lockstep/> (playout delay buffer; "pause
  a little bit initially so you have a buffer"; adaptive speed-up/slow-down for buffer
  safety).
- **Glenn Fiedler / Gaffer On Games — *State Synchronization*.**
  <https://gafferongames.com/post/state_synchronization/> (visual smoothing via decaying
  error offset; two smoothing factors).
- **Zachary Booth Simpson — *A Stream-based Time Synchronization Technique For Networked
  Computer Games*, 1 March 2000.** Original host (`mine-control.com/zack/timesync/`) is
  down; verified via Wayback Machine
  <https://web.archive.org/web/2018/http://www.mine-control.com/zack/timesync/timesync.html>.
  The TCP/stream-friendly ping-pong clock sync with median±1σ outlier rejection.
- **David L. Mills — NTP *Clock Filter Algorithm*.**
  <https://www.eecis.udel.edu/~mills/ntp/html/filter.html>; RFC 5905 §8, §10
  <https://www.rfc-editor.org/info/rfc5905/> (offset/delay formulas; eight-stage shift
  register; "selects the stage with the smallest delay").
- **Source engine `clockdriftmgr.cpp` (VSES/SourceEngine2007 mirror).**
  <https://github.com/VSES/SourceEngine2007/blob/master/se2007/engine/clockdriftmgr.cpp>
  (intermittently fetch-blocked); cvar semantics cross-checked against the AlliedModders
  CS:GO cvar list <https://forums.alliedmods.net/archive/index.php/t-186668.html> and
  Total CS <https://totalcsgo.com/commands/clclockdriftmaxms>.
- **Timothy Ford (Blizzard) — *"Overwatch" Gameplay Architecture and Netcode*, GDC
  2017.** GDC Vault <https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and>;
  architecture deep-dive (secondary)
  <https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback>.

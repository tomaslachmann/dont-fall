# 0109 — A remote Character turns smoothly over a real network

## Context

The user, on 2026-09-19, after playing the online stack (ADR 0108) against a real
player: "když jsem zkoušel na serveru proti real hráči, tak mám ještě problém s
otáčením 'cizího' charakteru, chci to taky vysmoothovat". In other words, the other
Character's turning was jerky, and they wanted it smooth. Its position looked fine.

A diagnosis measured the whole path before anything changed. Its harnesses were
built on the real classes (`InputRouter`, `PredictionLoop`, `SnapshotInterpolator`,
`TimeSync`) and ran over modelled internet links: in-order TCP with jitter, spikes
and loss. Each finding was then re-checked by a second agent with a harness of its
own. The metric is the drawn remote yaw rate over a steady 3 rad/s turn: how much
it varies from frame to frame (CV), and how many frames stand still. Today it
varied 10% on a LAN, 64% with both players at 60 Hz on an 80 ms round trip (5 still
frames/s), and 146% with the other player on a 144 Hz screen (30 still frames/s).

Four causes, each at a different place:

1. **The server ticked slow.** `setInterval(runTick, TICK_MS)` drifts. It rounds to
   whole milliseconds and re-arms after the callback, so it measured 28.8–29.5 Hz
   natively and 25.4–27.4 Hz in the `game-api` Docker image. The client predicts
   at a true 30 Hz, so its LEAD drained forever. Every snapshot's `serverTimeMs`
   also re-anchored the viewer's clock into a ~13% sawtooth.
2. **The LEAD counted frames.** It drained 5 ms every frame (72% of a 144 Hz
   frame; at 240 Hz the owner's simulation stopped) and injected at most once per
   12 frames. With feedback a round trip late, it hunted. When the server's input
   queue emptied, `InputRouter.takeFor` repeated the last input, so facing held
   for a Tick and then jumped. Facing was also sampled once per frame and stamped
   on every Tick that frame stepped, so a stretched or doubled Tick carried 0× or
   3–6× the usual turn. **This hits rotation only.** Position is integrated inside
   the fixed step, so a repeated or unevenly sampled `moveDirection` still makes
   even steps. That is why only rotation looked wrong.
3. **The viewer's clock counted transit time against the buffer.** ADR 0019
   renders at the server's *now* minus the Interpolation Delay (66.7 ms). A
   Snapshot is already one-way latency old when it arrives. So above ~33 ms one
   way, the buffer ran dry, held the newest pose, then jumped. That was 65% of
   frames at RTT 80 ±20. This hit position too.
4. **Nothing smoothed the rig.** `remoteCharacterPool` wrote the interpolated
   facing straight onto the rig.

Refuted: facing is not quantised, clamped or change-gated on the wire or in the
simulation.

## Decision

**Fix each cause where it starts. A short follow on the remote rig is the last
layer, never a substitute.** The first proposal was the follow alone plus the LEAD
fix. The user rejected that ("you sometimes recommend lazy work"). The measurements
agree: a filter cannot hide a 120–240 Hz owner's LEAD cycles, and it would have
left the server running 10–15% slow.

### A. The server ticks on a grid (`apps/server/src/match/tickScheduler.ts`)

- Tick *n* is due at `anchor + n·TICK_MS` on `performance.now()`. It is a product
  off one anchor, never a running sum, so late wakes and float error never add up.
  A tick never runs before it is due.
- **One tick per wake.** A wake that is behind runs one Tick and re-arms at once,
  so libuv's poll phase reads the sockets between catch-up Ticks. Input that
  arrived during a stall is in hand for the Ticks it addresses, and one overloaded
  Match never holds the shared API process (ADR 0054/0058) for five Ticks in a row.
  The re-arm is in a `finally`, so a throwing Tick does not stop the loop, as with
  `setInterval`. The cost: once the process is over budget, throughput is 2–5% lower
  than a burst, since Node's soonest re-arm is 1 ms.
- **`MAX_CATCH_UP_TICKS` = 5**, the server's twin of `MAX_STEPS_PER_FRAME`. A wake
  that finds six or more Ticks due (200 ms or more past the last one) runs five,
  one per wake, and forgives the rest, so the grid restarts from then.
- **Each snapshot's `serverTimeMs` is its Tick's grid time**, not the moment it
  happened to run. The Countdown's end and `raceTimeMs` stop jittering, and a
  voiced count can no longer replay when the end moves a few ms later. For "go"
  that took `MatchCalls` too. The end now sits on the grid, before the RUNNING
  Snapshot even leaves the server, and every frame until it arrived took the end
  up again and said "go" again: 0.8 extra per Countdown at 144 Hz and 10 ms one
  way, up from 0.4. A Countdown's end is now taken up only until its "go" is due,
  so a stall that moves the end later afterwards cannot replay it either.
- The Match loop starts only after the port is bound. A failed bind used to leave
  a Match ticking forever.

Measured natively: 28.8–29.4 Hz → 29.995 Hz. With one Match at a 40 ms Tick, the
longest event-loop turn dropped from 200 ms to 40 ms.

### B. The LEAD counts time (`packages/shared/src/net/lead.ts`)

- Over the queue band (`QUEUE_DEPTH_HIGH` = 2.5), drain
  `LEAD_DRAIN_TIME_FRACTION` = 0.1 of elapsed time. This is time dilation of the
  owner's own prediction and never stops it: the owner is drawn 10% slower while it
  runs, where today it was 30% slower at 60 Hz, 72% at 144 Hz, and stopped at
  240 Hz.
- At the server's queue cap (`MAX_QUEUED_INPUTS − 1`), drain
  `LEAD_DRAIN_SATURATED_FRACTION` = 0.5. There the server is already shedding this
  Player's input, so a half-speed owner for a moment costs less than seconds of
  ignored input. The average starts this drain and **the newest report ends it**.
  The average trails the queue by about five reports, and at 150 ms one way the
  drain it held on went on after the queue was back under the cap, into
  starvation.
- **How fast that recovers depends on latency.** The drain runs on for a round
  trip after the queue is back under the cap. With a Snapshot every Tick, at 40 ms
  one way, a 500 ms server stall is recovered in 0.6 s and a 1 s one in 1.6 s,
  against 2.6 s and 7.6 s at the ordinary drain. At 150 ms one way they take 1.6 s
  and 2.6 s, and 7–10 Ticks still starve after the queue is back under the cap.
  When the average ended the drain, that was 21 Ticks, and 1.9 s and 2.9 s. There a
  +200 ms spike recovers about as fast with this drain as without it (1.7–1.9 s).
- Under the band (`QUEUE_DEPTH_LOW` = 1), inject one Tick at most every
  `LEAD_INJECT_COOLDOWN_MS` = 300. A 200 ms cooldown overshot, because an inject
  shows up in the reported depth a round trip later.
- **It acts only on fresh feedback.** The controller adjusts only while the last
  depth report is younger than `LEAD_FEEDBACK_FRESH_MS` = 250, and drains only the
  part of a frame that report covers. The change-only idle phases (LOBBY, LOADING,
  RESULTS; ADR 0057) no longer drain or inject blind. Before, a Round could start
  with the Player's input ignored for seconds.
- It lives in shared beside `errorOffset` and `reconcileGate`, owns its moving
  average (`leadReceiveQueueDepth`), and `swapTrack` gives a new PredictionLoop a
  new controller.

Starved server Ticks went from 2.9–8.4/s (144 Hz owner) and 10–15/s (240 Hz) to
link spikes alone: 0.08–0.19/s at RTT ≤ 80, and none on a spike-free link.

### C. Each Tick carries the body's yaw at its own time

- `PredictionLoop.step` takes an input or a function of where, inside this frame's
  advance, the Tick's boundary fell. The frame loop hands each Tick its facing
  eased between the last two samples (`apps/client/src/net/tickInput.ts`).
  `PredictionLoop` never looks inside `SimInputs`.
- Recorded inputs, the ADR 0021 redundant tail and replay all carry the per-Tick
  value.
- At 144 Hz the per-Tick turn's CV went from 7.9% to 1.3%. Two Ticks stepped in one
  frame no longer carry the same facing.
- **A stall the `MAX_STEPS_PER_FRAME` clamp drops now skips its Tick numbers.**
  The prediction Tick advances by the whole elapsed time, and the local simulation
  is synced to it. Before, a hitch left the prediction Tick behind the server's,
  and the server discarded every input as stale until the LEAD's injects won the
  Ticks back. That meant 1.3 s after a 300 ms hitch and 90 s after a 10 s hidden
  tab. It is now 34 ms for all of them.

### D. The playout clock counts from arrivals (`SnapshotInterpolator`)

- Each arrival gives a lag, `arrival − tick time`, which holds the clock offset,
  the send time, one-way latency and jitter in one number.
- The **Playout Floor** follows the least of those lags:
  - it drops at once to any lower lag;
  - it rises at most `PLAYOUT_FLOOR_RISE_RATE` = 3%;
  - it is bounded from below by the least lag of the last
    `PLAYOUT_FLOOR_WINDOW_MS` = 1000 ms, but only when arrivals cover that window
    with no gap over `PLAYOUT_FLOOR_WINDOW_MAX_GAP_MS` = 200. That keeps a
    post-stall burst and the idle phases on the rise alone.
- What is drawn is `now − (floor + Interpolation Delay)`, slewed:
  - it closes `elapsed / PLAYOUT_SLEW_TIME_MS` (500) of the gap each frame;
  - it runs at most `PLAYOUT_SLEW_MAX_RATE` = 15% fast or slow;
  - it jumps only past `PLAYOUT_SNAP_MS` = 250. In practice that means a late first
    Snapshot jumping the world forward.
- The Interpolation Delay now absorbs jitter only. At RTT 80 ±20, underruns went
  from 64.6% to 1.8%; at RTT 120 ±30, from 100% to 11.6%.
- ADR 0019's two failure modes stay fixed: a poisoned first Snapshot is dropped as
  soon as a better one lands, and a latency step is recovered in 1.2–2.9 s (+50 to
  +260 ms). A step past ~280 ms is recovered through one backward jump.
- `estimatedServerTick` stays on the ping clock. ADR 0027 seeds the prediction
  Tick from it and needs the server's real *now*.

### E. Remote rigs follow their facing (`apps/client/src/render/remoteYaw.ts`)

- A critically damped follow (SmoothDamp), solved exactly per frame so it does not
  depend on frame rate. **`REMOTE_YAW_SMOOTH_MS` = 25** was measured end to end
  with every part above in: it is the smallest value keeping still time under half
  a frame per second on typical links. After the facing stops, the turn stays above
  a tenth of its speed for 49 ms, which bridges a one-Tick (33 ms) hold. At 20 ms
  that is 39 ms.
- It snaps on first sight and on a Respawn. It never snaps on a large gap, so a
  get-up or a long stall swings round instead of popping.
- **It is exact during a hold, in either role, and during every Spin.** A Held
  body is placed at its grabber's carry point from the server's facing, so a
  smoothed grabber would drift off its own hands. The rate measured while pinned
  carries into the release, so letting go of a Spin continues without a hitch.
- While down, the rig keeps the yaw it went down with, then turns to the live
  facing on the get-up instead of snapping.

### The mirrored yaw, on both rigs

A carried body's rotation is written as a quaternion. three.js then reads its Euler
`y` back through an `asin`, so past a quarter turn it reads `(π, π − yaw, π)`.
Zeroing `x` and `z` then drew the mirror image.

- The pool's down branch and the local Character both did this.
- The local one also *sent* it as facing (ADR 0085), for the whole carry and after
  it. That was half of all holds (|facing| < π/2): 0.3 was sent as 2.84.
- The pool now writes the rotation whole.
- `localCharacter.ts` keeps one `bodyYaw` that every branch writes and `facing()`
  reads. It is never read back off Euler angles.

### A Held own body waits for the drawn world

`ownDrawnFromServer`: the local Character is drawn from the server only once its
own state is down or Held **and** the interpolated world shows it too. Until then
the reconciled prediction is drawn. With D, the drawn world is the full
Interpolation Delay behind at every latency, and the victim of a Grab used to jump
back to its pre-catch spot for a few frames.

- A hold taken on the feet waits for the drawn tick to reach the first Held
  Snapshot's Tick (`heldSinceTick`, kept per Snapshot). The drawn row's state is
  the later Snapshot's, so over the Tick before, it already reads Held while its
  position is still lerped up from the ground. Drawn then, the body fell out of
  the hands and rose again over a Tick: from 1.40 m to 1.02 m at 144 Hz.
- A hold taken on a Character already down has no such Tick. It stays drawn from
  the server throughout, as it was while down.
- Still open: when the grabber walks, the switch-over frame pops the body back by
  carry speed × (newest − drawn tick). The prediction has it at the newest
  Snapshot's carry point, the drawn world at the catch's. At 3.6 u/s that is
  about 0.1 m, at most 0.22 m (60–144 Hz, 5–60 ms one way).

### A handed-back Prop never runs backward

With D, the gap at hand-back grew by the one-way latency. A Prop still sliding at
3–6 u/s was drawn moving backward on 49% of hand-backs at 60 Hz and 68% at 144 Hz.

- `decayHandedBackError`: while SERVER-MOVING, the offset's part along the server
  Prop's velocity shrinks no faster than the drawn server pose advanced along it
  that frame. A dry-buffer frame advances nothing, so the offset holds.
- Exempt: below `PROP_HANDBACK_MIN_SPEED` = 0.5 u/s, at rest, and past the 2 m
  hard snap.
- The hand-back frame itself draws exactly the predicted pose as it was drawn,
  at the sub-tick alpha. The newest tick raw runs up to a tick of motion ahead of
  it: seeded from that, the frame jumped up to 20 cm further at 6 u/s, then
  paused.
- Result: 0 of 1000 hand-backs drawn backward at either rate, with at most ~100 ms
  longer convergence.

## Considered options

- **The follow alone, or the follow and the LEAD fix only.** Rejected above: at
  120–240 Hz owners it left 4–33 still frames/s, and the server kept running slow.
- **Extrapolating facing on the server for a starved Tick.** After B, starvation
  is link spikes alone, and changing the authoritative input path, which Hit and
  Grab aim from, is not worth it for those.
- **The ping clock minus half the RTT**, for D. It assumes a symmetric path, and a
  16-sample ping window follows a latency step slowly. Arrivals measure what the
  buffer needs directly.
- **An adaptive Interpolation Delay.** With latency out of it, the fixed 66.7 ms
  absorbs 33–67 ms of jitter. What is left is TCP head-of-line spikes that no sane
  delay covers.
- **Turning the body inside the shared step.** That is right in principle, but it
  needs ADR 0085 reopened and the Spin follow-through moved, for a remaining
  per-Tick CV of ~3%.
- **Filling a skipped span with the last input on replay.** It removes a ~100–200 ms
  off-Tick window at high latency. But the final settle is identical, and after a
  long hitch it replays up to 120 Ticks per correction.

## Consequences

- **End to end** (5 seeds × 30 s, real classes; yaw CV / still frames per second):

  | Link | Today | Now |
  |---|---|---|
  | LAN, 60 Hz both | 10% / 0 | 2% / 0 |
  | RTT 80, 60 Hz both | 64% / 5.35 | 18% / 0.39 |
  | RTT 80, owner 144 Hz, viewer 120 Hz | 146% / 29.8 | 18% / 0.81 |
  | RTT 120 ±30, 144 Hz viewer | 196% / 74.6 | 35% / 3.73 |

  Rotation is now smoother than position (CV 0.35–0.65× of it). What is left comes
  from link spikes, which also stop position.
- **Everything remote is drawn about one-way latency further in the past** than
  ADR 0017/0020 intended: 94 vs 71 ms behind the server's *now* at RTT 40, 116 vs
  81 at RTT 80. The old clock never actually delivered its figure; it underran
  instead. Mirror capsules (ADR 0012), remote riders on Moving Segments (ADR 0061)
  and the own-body transitions read from the server (down, Held, a Hurl's release)
  all show the full delay at every latency, ~35–45 ms later over the internet than
  before. ADR 0025's criterion becomes
  `spinnerAngularSpeed × (LEAD + one-way + INTERP_DELAY)`.
- **Remote rotation trails by `REMOTE_YAW_SMOOTH_MS` minus half a frame:** +17 ms
  at 60 Hz, +21.5 ms at 144 Hz. The first frame of a hold closes that lag in one
  step, at most rate × (T − half a frame): 11.5° at the 12 rad/s turn cap on 60 Hz,
  14.8° on 144 Hz. The catch masks it, since on the same frame the Held body snaps
  into the carry.
- **Forgiven server stalls shift arrival lag for good**, by (lateness − 133 ms), and
  only for stalls over ~170 ms. The playout floor recovers from that like any
  latency step.
- **Tuning** lives in `tuning/netcode.ts`: `LEAD_*`, `QUEUE_DEPTH_*`, `PLAYOUT_*`,
  `REMOTE_YAW_SMOOTH_MS`, `PROP_HANDBACK_MIN_SPEED`. `MAX_CATCH_UP_TICKS` is in
  `tuning/clock.ts`.
- **Still open, for the record:** a handed-back Prop decelerating to rest is drawn
  4–12 cm past where it stops and slides back. The offset cannot know where the
  server's Prop will stop.
- **Waiting on the user:** all of it, live — remote turning online, the owner's 10%
  and 50% drains, the Held and Hurl transitions, a pushed Prop's hand-back. No
  harness replaces the real link.

Amends ADR 0017, 0019, 0020 (the render clock), 0021 and 0026 (the LEAD), 0022
(the Prop hand-back), 0025 (the Spinner criterion), 0045 and 0085 (per-Tick facing,
the remote follow, the mirror), 0104 (the Held own body), and ADR 0004's server
half (the Tick scheduler).

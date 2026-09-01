# M2 research — client-side prediction of server-authoritative *shared* dynamic Props

Fourth file in `docs/research/` (convention: primary-source notes that feed a decision but
aren't themselves an ADR — see `m2-client-reconciliation.md`,
`m2-collision-and-predicted-ragdoll.md`).

Scope: how a browser, server-authoritative, fixed-30 Hz, Rapier-on-both-ends game should
handle a **shared** dynamic physics object — a crate or ball with *no single owner* that any
Character can shove by walking or dashing into it. The first attempt (ADR 0016's predecessor,
ticket 06) was a per-Prop "grace ticks" window: on local contact the Prop went "locally live",
the client's own Rapier simulated it for `PROP_LOCAL_SIM_GRACE_TICKS` after last contact, then
**hard-switched** back to the raw server snapshot pose on grace expiry, with a
`PROP_HARD_CORRECT_DISTANCE` hard-snap on top. Symptom: the box **jumped backward** to the
stale server pose the instant you stopped pushing. ADR 0016 reverted it to interpolation-only;
playtesting now says that reads as "a heavy laggy box" and the shove fantasy is core
(`CLAUDE.md`). ADR 0016 is being reopened. This file establishes the correct pattern from
primary sources.

`PropSnapshot` today carries **only** `position` + `rotation` (`packages/shared/src/simulation/Prop.ts`).
The server sends one tick-stamped `SimState` per 30 Hz tick (`apps/server/src/index.ts`); the
client renders the non-predicted world through a ~50 ms render-delay interpolation buffer
keyed by `SimState.tick` (ADR 0017).

---

## Recommendation

**Prediction of a pushed Prop is worth it — but only for the narrow case of "a Prop the local
Character is in contact with right now (plus a short grace)", and only implemented as a
render-time error offset that decays exponentially, never as a hard switch or a
grace-then-snap.** This is Glenn Fiedler's "State Synchronization" mechanism and it is exactly
what Unity's *Ultimate Glove Ball* ships in code. The reverted design failed on the *handoff
shape*, not on the idea: it swapped the rendered pose from "advanced local prediction" to
"stale server pose" in one frame. Fiedler's rule is that the **simulation** state is always
snapped to a valid physical value (the server's), and only the **visual** transform carries a
separate position/orientation error that is blended toward zero over several frames — so the
object never pops, it eases.

Concretely for DON'T FALL:

1. **Wire shape.** Extend `PropSnapshot` to `{ position, rotation, linearVelocity,
   angularVelocity, atRest }`. `atRest` is one bit; when set, the two velocity vectors are
   omitted from the wire entirely (Fiedler; Glove Ball). No per-Prop sequence number —
   `SimState.tick` already stamps every Prop monotonically and ADR 0017's buffer already keys
   on it. No `lastTouchedBy` for v1 (the client knows its own contact locally); an optional
   1-bit "contacted by another Character" hint is a later anti-fighting lever (Q4).
2. **Three Prop states on the client**, not two:
   - **Pinned** (server `atRest` and no local contact) — ADR 0016 behaviour unchanged: follow
     the interpolated pose inert, a solid obstacle for local prediction.
   - **Predicted** (local Character contacted it within `PROP_PREDICT_GRACE_TICKS`) — a real
     dynamic body in the local prediction world, stepped by the shared sim (the local push
     included), its physical state reset to the server's tick-T value at every reconcile and
     replayed forward, its *rendered* pose = sim pose + a decaying error offset.
   - **Server-moving** (server `!atRest`, no local contact) — render-delay interpolation only
     (ADR 0017), no local sim. Covers "someone else pushed it" and "it's still coasting from
     my push after grace lapsed".
3. **The handoff** Predicted → Server-moving (grace lapses) and Predicted → Pinned: don't
   switch the rendered pose. Seed `errorOffset = predictedPose − targetPose` and decay it to
   zero over frames while rendering from the target (interpolated / pinned) pose. Same for the
   per-reconcile correction while Predicted.
4. **Smoothing constants** (Fiedler's, adapted to a time base so they're frame-rate
   independent): retain factor per frame `= 0.5 ^ (dtMs / halfLifeMs)`, `halfLife` blended
   linearly from **200 ms** at ≤ **0.25 m** error to **70 ms** at ≥ **1.0 m** error; above
   **2.0 m** zero the offset immediately (visual teleport — a genuine desync, don't rubber-band
   it across the playground). Orientation: same two half-lives blended by quaternion dot
   between **0.1 and 0.5**.
5. **Grace model** is contact-based, not a bare timeout: Predicted starts on the first local
   contact tick and ends `PROP_PREDICT_GRACE_TICKS` after the last. Default
   `PROP_PREDICT_GRACE_TICKS = max(2, ceil(RTT / TICK_MS))` capped at 8 — long enough that the
   server's acknowledgement of your push is already in the interpolation buffer by the time
   you hand back, so the residual error to smooth is small.

**Verdict:** ship it. The interpolation buffer already costs ~50 ms; without prediction a
pushed box also waits the full RTT/2 for the server to see the push and snapshot it back —
~90 ms of dead box at 80 ms RTT, which is the "heavy laggy box". Local prediction of the
contacted Prop removes all of that for the one object the player is touching, and the Fiedler
error-offset makes the correction invisible. Every *other* Prop stays interpolation-only —
ADR 0016's instinct was right for those, wrong only in being universal.

---

## 1. The predicted ↔ authoritative handoff — how shipping games avoid the backward snap

### 1.1 Glenn Fiedler, *State Synchronization* — the error-offset mechanism

Fiedler's networked-physics sample synchronises ~900 shared cubes that any player can shove,
server-authoritative, clients running full physics. His answer to "object snaps when the
correction lands" is to keep the correction **out of the simulation** and put it in a
separate visual offset:

> "calculating and maintaining position and orientation error offsets that we reduce over
> time. Then when we render the cubes … we don't render them at the simulation position and
> orientation, we render them at the simulation position + error offset"
> — [gafferongames.com — State Synchronization](https://gafferongames.com/post/state_synchronization/)

Why not smooth the simulation itself:

> "you should not apply smoothing at the simulation level because it ruins the extrapolation"
> — [State Synchronization](https://gafferongames.com/post/state_synchronization/)

The decay is an exponentially smoothed moving average toward zero — multiply the offset by a
retain factor each frame — with the factor **adapted to the error magnitude**:

> "having 0.95 for small position errors (25cms or less) while having a tighter blend factor
> of 0.85 for larger distances (1m error or above)"
> — [State Synchronization](https://gafferongames.com/post/state_synchronization/)

Between those two thresholds the factor is blended linearly by the amount of positional error;
orientation uses the same two factors blended by the quaternion dot product "between dot 0.1
and 0.5". Those coefficients are per-frame at 60 fps; expressed as a half-life they are ~225 ms
(0.95) and ~71 ms (0.85), which is where this file's 200 ms / 70 ms recommendation comes from
(and why it must be recomputed from real frame `dt`, not applied as a fixed per-frame
multiply).

The shape this produces on the exact DON'T FALL failure: you push the box, your local sim has
it ahead; snapshots arrive ½ RTT behind; at reconcile the box's **sim** state is set to the
server's tick-T pose and replayed forward (with no push input, since you've released) — it
ends up behind where you rendered it. The **visual** offset = behind − rendered is then
decayed to zero over ~5–10 frames. The box eases back a few centimetres instead of teleporting.
Fiedler's adaptive factor means a big disagreement (two players, Q4) decays faster.

### 1.2 Unity *Ultimate Glove Ball* — the same mechanism, in shipped code

Meta's open-source VR sample networks one shared ball that any player hits, with a
server-authoritative grab. The relevant file is
[`BallStateSync.cs`](https://github.com/oculus-samples/Unity-UltimateGloveBall/blob/main/Assets/UltimateGloveBall/Scripts/Arena/Balls/BallStateSync.cs)
(and the tutorial page
[`Documentation/BallPhysicsAndNetworking.md`](https://github.com/oculus-samples/Unity-UltimateGloveBall/blob/main/Documentation/BallPhysicsAndNetworking.md)).

The doc's summary:

> "State Synchronization … each client runs Unity Physics locally and synchronizes with server
> data." … "Includes gradual position, rotation, and linear velocity correction to prevent
> pops and jerky movements." … "Uses a jitter buffer to apply packets in order and discard
> late ones."
> — BallPhysicsAndNetworking.md

The packet (`BallStateUpdate` + `BallPacket`, `BallStateSync.cs` ll. 30–80):

| field | type | note |
|---|---|---|
| `Sequence` | `uint` | "server frame number when packet is sent" |
| `IsGrabbed` | `bool` | ball assigned to a glove |
| `GrabbersNetworkObjectId` | `ulong` | which glove |
| `Position` | `Vector3` | |
| `Orientation` | `Quaternion` | |
| `SyncVelocity` | `bool` | **false ⇒ the two velocity fields are not serialized at all** (`ll. 56–60`) |
| `LinearVelocity` | `Vector3` | only if `SyncVelocity` |
| `AngularVelocity` | `Vector3` | only if `SyncVelocity` |

`SyncVelocity = grabber == null && velocity.magnitude > 0.01f` (`l. 207`) — i.e. it *is* the
at-rest bit: "Only sync velocities if ball is not at rest and not grabbed". On the receiving
side, no-velocity packet ⇒ "we can assume the ball is stationary and set velocities to zero"
(`ll. 349–356`).

The correction (`ApplyPacket`, `ll. 300–348`), with the serialized tuning fields (`ll. 96–107`):

```csharp
m_smoothingFactorPosition = 0.75f;   // Range(0,1)
m_smoothingFactorRotation = 0.1f;
m_smoothingFactorVelocity = 0.95f;
m_errorSnapThresholdInMeters = 5f;

positionError  = (targetPosition - transform.position) * m_smoothingFactorPosition;
if (positionError.magnitude > m_errorSnapThresholdInMeters)
    m_rigidbody.position = targetPosition;                 // hard snap only past 5 m
else
    m_rigidbody.MovePosition(Vector3.Lerp(transform.position,
                                          targetPosition - positionError,
                                          Time.fixedDeltaTime));   // ease the rest
rotationError = Quaternion.Slerp(targetRotation * Inverse(transform.rotation),
                                 identity, m_smoothingFactorRotation);
m_rigidbody.MoveRotation(targetRotation * rotationError);
```

Three things transfer directly to DON'T FALL:

- **Hard snap is a last resort past a large distance** (5 m here — this file recommends 2 m for
  the smaller playground), never the normal correction.
- **Velocity correction is aligned-gated**: `if (Vector3.Dot(m_rigidbody.linearVelocity,
  update.LinearVelocity) > 0f)` — "If ball hits something and changes direction we don't apply
  velocity until they are aligned again" (`ll. 326–339`). This is the `dash-into-a-wall`
  case: don't yank the box's velocity toward a stale pre-collision server value.
- **Snap vs ease by ownership**: "If we did not throw the ball we do a hard snap to the current
  state instead of lerping" (`ll. 257–266`, `281–293`). The client that *caused* the motion
  eases; a client seeing someone else's action snaps to the first authoritative frame then
  eases. DON'T FALL's equivalent: the Predicted state (you're pushing) eases; entering
  Server-moving because *another* player pushed it, snap to the interpolated pose then run
  local prediction from there.

Send/buffer cadence (`ll. 89–94`, `157–186`, `411–426`): server sends every `m_updateRate`
FixedUpdates, client drains its jitter buffer every `m_bufferFlushRate = 4` FixedUpdates, in
`Sequence` order, dropping any packet with `Sequence <= m_latestSequenceNumber` (`l. 411`),
buffer capped at 64 with oldest-dropped (`ll. 423–424`). DON'T FALL already has the tick-keyed
equivalent (ADR 0017); the lesson is just "in-order, drop stale, cap the buffer".

### 1.3 Valve Source — client-side prediction errors and `cl_smooth`

Source predicts only the local player and corrects prediction errors by easing, not snapping:

> "If they are different, a prediction error has occurred. This indicates that the client
> didn't have the correct information about other entities and the environment when it
> processed the user command."
> "By gradually correcting this error over a short amount of time (`cl_smoothtime`), errors can
> be smoothly corrected. Prediction error smoothing can be turned off with `cl_smooth 0`."
> — [Valve Developer Community — Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
> (the live VDC returns 403 to automated fetches; quoted via the
> [CoolOppo gist mirror of the page](https://gist.github.com/CoolOppo/fe0586836de3fb2f90f9)
> and Google's cached excerpt — both consistent with the vetted quotes in
> `m2-client-reconciliation.md`.)

Source's telling move for *physics props* specifically is to **avoid predicting them**.
Multiplayer maps are told to use `prop_physics_multiplayer`, not `prop_physics`:

> "`prop_physics_multiplayer` … is identical to `prop_physics` except that it bounces away from
> collision (if `sv_turbophysics` is enabled) … to avoid the prediction errors that normal
> physics objects typically generate."
> — [Valve Developer Community — prop_physics_multiplayer](https://developer.valvesoftware.com/wiki/Prop_physics_multiplayer)
> (403 to fetch; quoted via search excerpt.)

So Source's shipped answer for shared physics debris is: simplified server-side collision
response + interpolation, *not* client prediction. That is the ADR 0016 position, and it is a
legitimate primary-source-backed choice — it is only being overridden here for the one Prop
the player is actively shoving, because shoving is DON'T FALL's core verb and Source's props
are set dressing.

### 1.4 CS2 — predicted physics effect with a timeout-revert

CS2's 2024 damage-prediction feature is a predicted-then-reverted cosmetic, the same family
as ADR 0016's "reversible: … a CS2-style predicted-then-timeout-revert":

> "Predicted ragdolls without a confirmation or correction from the server within a short time
> window will now revert."
> — Counter-Strike release notes, 2024-12-03, quoted via the
> [Liquipedia mirror of the official notes](https://liquipedia.net/counterstrike/2024-12-03_Patch)
> (counter-strike.net serves a JS shell to automated fetches; vetted the same way in
> `m2-collision-and-predicted-ragdoll.md`).

This is worth knowing as the fallback shape, but it is *weaker* than the Fiedler error-offset
for a **continuously pushed** object: a revert is still a visible discontinuity, just a
delayed one. Fiedler's decaying offset has no discontinuity at all. Use timeout-revert only if
the error-offset approach somehow leaves a Prop stuck predicted with no server contact (it
shouldn't — the grace lapses on its own).

### 1.5 Overwatch (GDC 2017, Timothy Ford)

The talk *'Overwatch' Gameplay Architecture and Netcode*
([GDC Vault](https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and))
predicts aggressively on the client and reconciles by rollback-and-replay against the
authoritative server, with smoothing making the correction "in the vast majority of cases,
invisible". A first-party transcript with a passage about *shared non-player physics objects*
specifically could not be retrieved; the widely-cited characterisation ("predict everything by
default, including rockets", correct via replay) comes from
[Edgegap's write-up of the talk](https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback)
— **secondary**, flagged. Overwatch also has no crate-shoving mechanic, so it corroborates
"prediction + smooth replay" as a general stance but says nothing load-bearing about *shared*
props. This is the thinnest source in this file, same as in the ragdoll research.

---

## 2. What the wire snapshot must carry for local physics to *converge*

The client's local Rapier can only stop fighting the server if each snapshot gives it enough
to re-seed a *valid physical state*, not just a pose. Fiedler's `StateUpdate` struct:

```
struct StateUpdate {
    int   index;
    vec3f position;
    quat4f orientation;
    vec3f linear_velocity;
    vec3f angular_velocity;
};
```

plus the **at-rest bit**:

> "there's no point wasting bandwidth sending (0,0,0) over and over while an object is at rest"
> — [State Synchronization](https://gafferongames.com/post/state_synchronization/)

serialized as `if ( !at_rest ) { serialize_vector(linear_velocity); serialize_vector(angular_velocity); }`.

And the priority boost when an object *goes* to rest, so its final resting pose is reliably
delivered:

> "tracking objects which have recently come to rest and bumping their priority until an ack
> comes back for a packet they were sent in"
> — [State Synchronization](https://gafferongames.com/post/state_synchronization/)

(DON'T FALL sends the full `SimState` every tick with no priority scheme yet — the handbook
§13.3 defers the priority accumulator until Prop counts grow. Until then every Prop is in
every snapshot, so the "resting object's final pose might be lost" risk the boost mitigates
only bites under packet loss; note it, don't build it.)

### 2.1 Field-by-field for `PropSnapshot`

| field | need it? | quantized size (per handbook §13.2 / Fiedler *Snapshot Compression*) |
|---|---|---|
| `position: Vec3` | yes (have it) | 3 × 16-bit fixed-point ≈ **48 bits** (Fiedler: 50 bits at 512 vals/m over the playground bounds) |
| `rotation: Quat` | yes (have it) | smallest-three, `2 + 3 × 11` bits ≈ **35 bits** (Fiedler uses 9-bit for snapshot-interp, up to 15-bit for state-sync precision; 10–12 is ample at our scale/rate) |
| `atRest: bool` | **add** | **1 bit** |
| `linearVelocity: Vec3` | **add**, omitted when `atRest` | 3 × 12-bit ≈ **36 bits** |
| `angularVelocity: Vec3` | **add**, omitted when `atRest` | 3 × 10-bit ≈ **30 bits** |
| `sequence` / frame no. | **no** | `SimState.tick` already does this for the whole snapshot |
| `lastTouchedBy` | **no** for v1 | (optional later: 1-bit "contacted by another Character" hint, see Q4) |

Totals: **resting Prop ≈ 84 bits ≈ 10.5 bytes**; **moving Prop ≈ 150 bits ≈ 19 bytes**. This
lands almost exactly on Fiedler's measured "127 bits at rest, 160 bits moving" per cube in
*Snapshot Compression*
([gafferongames.com](https://gafferongames.com/post/snapshot_compression/)), which also
records that "linear interpolation is good enough at 60HZ" — i.e. at high enough send rate you
can *drop* velocity from the wire and interpolate. DON'T FALL sends at 30 Hz and wants the
client to *simulate* the Prop, not just interpolate it, so velocity has to be on the wire when
the Prop is moving — Glove Ball reaches the same conclusion for the same reason.

Why velocity is non-negotiable for the Predicted state: reconcile resets the Prop body to the
server pose **and** re-runs buffered ticks. If it re-runs from `velocity = 0` every time, the
box decelerates to a crawl and every snapshot re-accelerates it — a 30 Hz sawtooth, the exact
failure ADR 0017 diagnosed for naive interpolation. With the server's actual `linearVelocity`
as the replay base, the replayed ticks continue the motion smoothly.

The current `Prop.follow()` (`Prop.ts` ll. 82–87) already zeroes linvel/angvel on every pin —
correct for the **Pinned** state, wrong for **Predicted**. The new code needs a
`Prop.applyAuthoritativeState({ position, rotation, linearVelocity, angularVelocity })` for the
reconcile path.

---

## 3. Authority / grace model — when the client borrows simulation, when it hands back

### 3.1 Ownership frameworks are peer-to-peer concepts — name what maps and what doesn't

The commercial frameworks the handbook §5 cites solve *distributed* authority, which DON'T
FALL does not have. Stated plainly:

- **Photon Fusion "Dynamic" ownership + anti-oscillation cooldown**
  (`doc.photonengine.com/fusion` — the whole domain is behind a Gcore bot-check, consistent
  with prior research; described via handbook §5 and its reference list, and the
  [Fusion Godot ownership-modes page](https://doc.photonengine.com/fusion-godot/current/manual/replication/ownership-modes)
  cited there): "Dynamic — anyone takes over instantly, with a cooldown against oscillation" —
  this
  is about *which client* writes the authoritative state. **Irrelevant** to DON'T FALL: the
  server always writes it. Fusion also offers a genuinely relevant tier — its Physics Addon's
  "Full Physics Prediction" where "physics simulation is run on both resimulation and forward
  ticks", positioned as the expensive opt-in above interpolation-only (prior research,
  §ragdoll). That tier *is* the DON'T FALL "Predicted" state.

- **Normcore `RealtimeTransform` ownership**
  ([docs.normcore.io — Networked Physics](https://docs.normcore.io/realtime/networked-physics),
  [RealtimeTransform](https://normcore.io/documentation/realtime/realtimetransform)): "Only the
  client that owns a RealtimeTransform is considered the source of truth"; on collision it
  "will attempt to request ownership of this second object as well, so the same client can
  simulate both of the objects in the collision"; and "RealtimeTransform will automatically
  clear ownership when the Rigidbody goes to sleep." This is **client-authoritative
  per-object**, a hybrid, not server-authoritative. **The ownership transfer is
  P2P-only.** What *does* map: the sleep→clear-ownership idea is exactly the DON'T FALL
  at-rest→Pinned transition, and "simulate both bodies in a collision on one machine to hide
  interaction delay" is why the *pushing Character and the Prop it pushes* must be in the same
  (local) sim — which they already are (ADR 0012).

- **Spatial "transfer ownership to the faster body on contact"**
  ([toolkit.spatial.io — Network Physics](https://toolkit.spatial.io/docs/multiplayer/network-physics)):
  "if the two objects that collided are owned by different clients … object ownership will be
  transferred to the owner of the object that has higher velocity." Explicitly a
  **peer-authoritative** construct — the handbook already flags it as "relevant only for
  peer-authoritative topologies; in server-authoritative DON'T FALL you don't need this
  complexity because the server decides all collisions directly." Correct.

**The server-authoritative equivalent of all three:** there is no ownership token. The client
*borrows simulation for feel* — it runs local physics for a Prop it's touching so the push is
immediate — but it never holds authority. The server simulates every Prop every tick
regardless, and its snapshot always wins via the error-offset correction. "Borrow, never own."

### 3.2 The grace model: contact-based, RTT-sized

Fiedler and Glove Ball both keep *every* shared object in local simulation *all the time* —
they can afford it (dedicated physics budget, ~900 cubes is the stress test). DON'T FALL
should not: a 12-player match with N Props, each client stepping every Prop locally *and*
reconciling+replaying it every snapshot, multiplies the ADR 0013 replay budget by N. So gate
it:

- **Enter Predicted** on the first tick the local Character's capsule is in contact with the
  Prop (the local sim already detects this to call `Prop.shove()`).
- **Stay Predicted** until `PROP_PREDICT_GRACE_TICKS` after the last contact tick.
- **`PROP_PREDICT_GRACE_TICKS = clamp(ceil(measuredRTT / TICK_MS), 2, 8)`** — sized so that by
  the time you hand back, the snapshots you'll interpolate already include the server's
  response to your push, making the residual error (hence the visible ease) small. A fixed `4`
  (~133 ms) is a fine starting constant if RTT isn't measured yet.
- This is **not** the reverted design. The reverted design's grace expiry did a hard switch
  from local-sim pose to raw-snapshot pose. Here, grace expiry seeds an error offset and
  decays it — Fiedler §1.1. There is no frame on which the rendered pose jumps.

The reverted design also had a *second* bug: a smaller jump *the other way* when you started
pushing (ADR 0016 "a smaller jump the other way when you start"). Same fix: entering Predicted,
seed `errorOffset = currentRenderedPose − localSimPose` (they differ because the local sim was
just handed the interpolated pose, ~50 ms stale) and decay it. Every state transition routes
through the same "seed offset, decay to zero" primitive.

---

## 4. Two players push the same box from opposite sides

Server resolves it one way (say the box barely moves — the two pushes roughly cancel). Client A
predicted the box moving away from A; client B predicted it moving away from B. Both are wrong.

Gambetta names this as unavoidable and not a bug:

> "even if the world is completely deterministic and no clients cheat at all, it's still
> possible that the state predicted by the client and the state sent by the server don't
> match" — because "each client only controls its own entity's prediction while other players
> remain under server authority"
> — [gabrielgambetta.com — Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)

**Correct handling — no special case is needed; the general mechanism covers it:**

1. Each client's *Prop simulation* state is reset to the server's tick-T value at every
   reconcile (position, rotation, both velocities) and replayed forward with only that
   client's own inputs. So within ½ RTT the box's simulated state on both clients matches the
   server.
2. The disagreement shows up purely as a *visual* error offset. On A, `errorOffset =
   (A's predicted "box moved away") − (server "box barely moved")` is large, so Fiedler's
   adaptive factor decays it on the **fast** curve (70 ms half-life). A sees the box "give"
   back toward centre over ~4 frames — reads as B resisting, which is physically what
   happened.
3. Because the offset is render-only and bounded (2 m hard-snap ceiling), there is no
   feedback loop, no oscillation, no fighting. Fiedler's ~900-cube sample is exactly this
   scenario at scale and is stable.

**Optional dampener (defer to a follow-up):** add the 1-bit "contacted by another Character
this tick" hint to `PropSnapshot`. When a Predicted Prop's latest snapshot has it set, halve
the local `Prop.shove()` impulse (or drop `PROP_PREDICT_GRACE_TICKS` to 1) so the client
leans on the server sooner in a genuine two-player contest. Not needed for correctness — the
error-offset already converges — just reduces the size of the ease in the contested case.

---

## 5. Does prediction even pay off here? (30 Hz, WebSocket/TCP, 0–80 ms RTT)

### 5.1 The case against (and it's real)

- Gambetta, Fiedler, and Valve all draw the same line: **prediction is for entities the local
  player controls; everything else is interpolation.** Gambetta: dead reckoning "only for
  high-predictability entities like vehicles", otherwise interpolate
  ([Entity Interpolation](https://www.gabrielgambetta.com/entity-interpolation.html)). Fiedler
  on extrapolating physics objects you don't control: "you simply can't accurately match a
  physics simulation with an approximation"
  ([Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)). Valve
  ships `prop_physics_multiplayer` specifically so props *don't* need prediction (§1.3).
- A shared Prop has no owner, so "predict it" means "predict a body whose motion depends on
  inputs from up to 11 other players you don't have" — for any tick where someone else is also
  touching it, the prediction is guaranteed wrong.
- Rapier is not cross-machine deterministic (ADR 0003), so even a solo push diverges over a
  few ticks.

### 5.2 The case for (the user's lived experience, and the one good analog)

- ADR 0017's buffer already renders the non-predicted world **~50 ms in the past**. Without
  Prop prediction, a box you lean into also has to wait for: your input to reach the server
  (~RTT/2) + the server to simulate the push + the resulting snapshot to travel back and land
  in your buffer (~RTT/2 + buffer). Net: the box visibly starts moving **~50 ms + RTT** after
  you touch it. At 80 ms RTT that's ~130 ms; at 40 ms RTT ~90 ms. That is precisely a "heavy
  laggy box", and it is what ADR 0016 explicitly accepted as the trade-off.
- Prediction of the *contacted* Prop removes the entire `50 ms + RTT` for that one object: it
  moves on the same frame you touch it, because your local sim pushes your local copy.
- The one primary source that is a genuine analog — **shared physics object, any player hits
  it, server-authoritative-ish, and the game is *about* hitting it** — is Ultimate Glove Ball,
  and it runs local physics on every client with smoothed correction (§1.2). A ball that only
  interpolated would "feel dead" in a game whose verb is hitting the ball. DON'T FALL's verb is
  shoving; the same logic applies to the box you're shoving.

### 5.3 Verdict

**Predict the contacted Prop. Interpolate every other Prop.** The split matters:

- The narrowness (only while locally contacted + short grace) means the "predicting inputs you
  don't have" objection barely applies — for the brief window you're pushing, *your* input is
  the dominant force, and the rare two-player contest is handled by §4.
- Doing it as a render-time error offset (not a sim-level blend, not a hard switch) is what
  makes it safe — the simulation always runs from server truth, so divergence self-heals every
  ½ RTT and only a small, decaying visual offset is ever shown.
- Keeping every non-contacted Prop on ADR 0017's interpolation buffer means the cost scales
  with "Props any one client is touching" (≈ 0–2), not "Props in the match".

ADR 0016 is therefore **reopened but mostly upheld**: its universal "Props are never
predicted, interpolated-only" narrows to "Props are interpolated-only *except* one the local
Character is in contact with, which is predicted via a decaying render-time error offset — never
a hard correction or a grace-then-snap". The reverted `PROP_LOCAL_SIM_GRACE_TICKS` /
`PROP_HARD_CORRECT_DISTANCE` design stays dead; what replaces it is Fiedler's error-offset,
which is a different mechanism, not a retuning of the old one.

---

## 6. Concrete spec for DON'T FALL

### 6.1 `PropSnapshot` wire shape

```ts
export interface PropSnapshot {
  position: Vec3;
  rotation: Quat;
  atRest: boolean;                 // NEW — 1 bit on the wire
  linearVelocity: Vec3;            // NEW — omit from wire when atRest
  angularVelocity: Vec3;           // NEW — omit from wire when atRest
}
```

No sequence field (`SimState.tick` covers it). No `lastTouchedBy` (optional 1-bit
`contactedByOther` hint is a Q4 follow-up). Server sets `atRest` from
`RigidBody.isSleeping()` / velocity-below-threshold; when `atRest`, the binary encoder writes
neither velocity vector (handbook §13.2 already plans the binary pass). ~10.5 B resting,
~19 B moving per Prop.

### 6.2 Client Prop state machine

```
                 ┌─────────── local capsule contacts Prop ──────────┐
                 v                                                    │
  PINNED  ──────────────►  PREDICTED  ──── grace lapsed & server ────►  SERVER-MOVING
  (atRest, no contact)     (contacted ≤ grace)   atRest ──────────────►  PINNED
     ▲                          │                                          │
     └──────── server atRest, no local contact ◄───────────────────────────┘
```

- **PINNED**: `Prop.follow(interpPose)` — inert, zeroed velocity, solid obstacle. Unchanged
  from ADR 0016.
- **PREDICTED**: Prop is a live dynamic body in the local prediction world. Local sim steps it
  (including `Prop.shove()` from the local capsule). Every reconcile:
  `Prop.applyAuthoritativeState(serverTickTState)` then replay buffered ticks. Rendered at
  `simPose + errorOffset`.
- **SERVER-MOVING**: no local sim; render from ADR 0017 buffer. Still a local-prediction
  obstacle, pinned each frame to the interpolated pose (ADR 0016's every-frame fix).

Every transition seeds `errorOffset = poseBefore − poseAfter` and lets the decay (6.3) run it
to zero. No transition changes the rendered pose on its own frame.

### 6.3 Error-offset smoothing (render only)

Per Prop, per render frame:

```ts
const posErrMag = length(errorOffset.position);
const hl = lerp(PROP_ERR_HALFLIFE_NEAR_MS, PROP_ERR_HALFLIFE_FAR_MS,
                clamp01(invLerp(PROP_ERR_NEAR_M, PROP_ERR_FAR_M, posErrMag)));
if (posErrMag > PROP_ERR_HARDSNAP_M) {
  errorOffset.position = ZERO;                      // visual teleport — genuine desync
} else {
  const retain = Math.pow(0.5, dtMs / hl);
  errorOffset.position = scale(errorOffset.position, retain);
}
// rotation: same, blended by quaternion dot between PROP_ERR_ROT_DOT_LO / _HI
renderPose.position = simOrInterpPose.position + errorOffset.position;
```

New constants in `packages/shared/src/tuning.ts` (replacing the deleted
`PROP_LOCAL_SIM_GRACE_TICKS` / `PROP_HARD_CORRECT_DISTANCE`):

| constant | value | source |
|---|---|---|
| `PROP_PREDICT_GRACE_TICKS` | `clamp(ceil(RTT/TICK_MS), 2, 8)`, fixed `4` until RTT is measured | §3.2 |
| `PROP_ERR_NEAR_M` | `0.25` | Fiedler "25cms or less" |
| `PROP_ERR_FAR_M` | `1.0` | Fiedler "1m error or above" |
| `PROP_ERR_HALFLIFE_NEAR_MS` | `200` | Fiedler 0.95/frame\@60 ≈ 225 ms half-life |
| `PROP_ERR_HALFLIFE_FAR_MS` | `70` | Fiedler 0.85/frame\@60 ≈ 71 ms half-life |
| `PROP_ERR_HARDSNAP_M` | `2.0` | Glove Ball uses 5 m; scaled to the smaller playground |
| `PROP_ERR_ROT_DOT_LO` / `_HI` | `0.1` / `0.5` | Fiedler, verbatim |

Velocity correction on the reconcile path is **aligned-gated** (Glove Ball `ll. 326–339`):
only pull the local Prop's `linvel` toward the server value when
`dot(localLinvel, serverLinvel) > 0`, so a box that just hit a wall isn't yanked toward its
stale pre-collision velocity.

### 6.4 What does not change

- Non-contacted Props: ADR 0017 render-delay interpolation buffer, verbatim.
- Props as obstacles in local prediction: ADR 0012, pinned every frame to the interpolated
  pose, verbatim.
- Server: simulates every Prop fully every tick, authoritative, unchanged. It never calls the
  client sync path.
- Character-to-Character Bump: still server-authoritative, still not predicted (ADR 0012 /
  0015). This ADR only concerns Prop motion.

---

## 7. Where the primary sources are thin

- **Overwatch on shared props** — the GDC 2017 talk's stance (predict widely, reconcile by
  replay, smoothing hides it) is only available first-party as the video; no transcript
  sentence about *shared non-player physics objects* was retrievable. The "predict everything
  including rockets" characterisation is from
  [Edgegap](https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback),
  secondary. Corroborating, not load-bearing.
- **Photon Fusion docs** — entire `doc.photonengine.com` domain is behind a Gcore bot-check
  (consistent across all prior research). Fusion's ownership modes and the "Full Physics
  Prediction" tier are quoted via the handbook §5 and search excerpts, not direct fetches.
- **Valve Developer Community** — returns HTTP 403 to automated fetches. `Source Multiplayer
  Networking`, `Prediction`, and `prop_physics_multiplayer` are quoted via the CoolOppo gist
  mirror and search excerpts; the core quotes match what `m2-client-reconciliation.md` already
  vetted against the same pages.
- **Gambetta** — only Part I (`client-server-game-architecture.html`) and Part III
  (`entity-interpolation.html`) fetched cleanly; Part II
  (`client-side-prediction-server-reconciliation.html`) was summarised by the fetch tool
  rather than quoted verbatim. The reconciliation-loop description is paraphrased from that
  summary and is consistent with Bernier (already vetted in `m2-client-reconciliation.md`).
- **Fiedler's exact code** — the fetch tool enforces a short quote limit, so the `StateUpdate`
  struct and the `if (!at_rest)` serialization are reproduced from its summaries of
  [State Synchronization](https://gafferongames.com/post/state_synchronization/) and
  [Snapshot Compression](https://gafferongames.com/post/snapshot_compression/); the numeric
  constants (0.95 / 0.85, 25 cm / 1 m, dot 0.1 / 0.5, 901 cubes, 256 kbit/s, 127/160 bits) are
  quoted precisely and cross-checked across two fetches of the same page.
- **Ultimate Glove Ball** — `BallStateSync.cs` was read in full from `raw.githubusercontent.com`
  (primary, current `main`); line numbers cited are from that read. `m_updateRate = 25`
  FixedUpdates is a surprisingly low server send rate (the doc doesn't explain it); DON'T FALL
  should not copy that number, only the mechanism.
- **No source quantifies** the CPU cost of N client-side predicted Props each reconciled +
  replayed per snapshot at 30 Hz with 12 players. The grace model (§3.2) keeps N ≈ 0–2 in
  practice, but a profiling pass on the real server with several players crowding one crate is
  still needed before assuming it's free — same open measurement item as the ragdoll research.

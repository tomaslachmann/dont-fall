# M2 research — ragdoll replication: bone-set on the wire, server authority, the epoch, and the timing-window bug

Third file in `docs/research/` on the knockdown/ragdoll problem, and it **extends**
`m2-collision-and-predicted-ragdoll.md` — read that first. That file answered *"should the client
predict its own ragdoll?"* (no — snap the state, drive the pose from the authority) and *"how do you
stop a double-applied transition?"* (tick-aligned overwrite + a monotonic id for server-only events).
This file answers the questions those left open, now that ADR 0015 has shipped:

- **Q1** — how much of the skeleton goes on the wire: all 11 bones, the pelvis only, or a middle
  ground? And what does the client do for the bones it isn't sent?
- **Q2** — does the *server* need a full 11-body articulated ragdoll, or can it stay capsule-only and
  let the client invent the flop?
- **Q3** — the timing-window bug: the client locally predicts a knockdown at tick T while an older
  `Controlled` snapshot for T−2 is still in flight. How do shipping games stop the revert-then-
  re-trigger flicker?
- **Q4** — `ragdollEpoch` + `ragdollCause` on the wire: should the epoch rise on *every* knockdown,
  is `cause` worth sending now, and what is the canonical "apply this one-shot effect exactly once"
  mechanism?
- **Q5** — `GettingUp` over the wire: server-decided or fixed-duration, and how is the
  ragdoll→animation blend timed across the network?

Established and not re-litigated: server-authoritative, no rollback, 30 Hz, WebSocket, Rapier both
ends, up to 12 players; the knockdown *transition* is predicted locally for instant feel and snaps,
the ragdoll *physics* is not predicted-and-reconciled (ADR 0015); Character = kinematic capsule +
11-bone articulated ragdoll (ADR 0006).

---

## Recommendation

**Wire shape for `CharacterSnapshot` while down — send all 11 bones, keep `bones` exactly as it is
today, and add three tiny fields:**

| field | while | shape | why |
|---|---|---|---|
| `motionState` | always | enum (4) | unchanged (ADR 0006/0013/0015) |
| `bones` | `Ragdoll` / `GettingUp` only | `BoneSnapshot[11]` (pos + quat) | unchanged. Server sends the **authoritative** pose (already blended toward standing during `GettingUp`). The client interpolates it like a remote entity and runs **no local ragdoll body at all** — this is ticket 09. |
| `ragdollEpoch` | always | monotonic `uint16` | rename of `bumpSeq`; **rises on every entry into `Ragdoll`** (Bump, Fall, DashWall, Spinner), not just Bump/Fall. "One epoch = one VFX/SFX trigger" (Handbook §6). |
| `ragdollCause` | always (or while down) | enum `Bump\|Fall\|DashWall\|Spinner` — 2 bits | set where the epoch rises. Cheap now, expensive to retrofit into the knockdown path later; already useful for camera kick / hit-react direction even before networked SFX exist. |
| `phaseStartTick` | always | `uint` tick | the tick the current `motionState` phase began. Disambiguates a missed episode, lets the client compute a deterministic getup blend if it ever needs to, and is the anchor for the Q3 timing guard. |

**Server runs the full 11-body authoritative ragdoll — do not go capsule-only.** It is already
built, it is the single source of truth every client (including the owning one, since ADR 0015's
addendum) interpolates, and ~4–6 concurrent ragdolls × 11 bodies ≈ 45–66 extra dynamic bodies at
30 Hz is not a real risk at a 12-player ceiling (the profiling pass `m2-collision-and-predicted-
ragdoll.md` §3.4 already flagged still stands, but nothing primary suggests it will fail). A
capsule-only server would make the bones client-invented and mutually inconsistent, and would
directly contradict the ADR 0015 addendum that draws the local downed player *from the server's
bones*.

**Timing-window guard (Q3): tag the locally-predicted ragdoll with the tick it was predicted on
(`P`), and do not let an authoritative snapshot older than `P` revert it.** Wait for a snapshot with
`tick ≥ P`: if that one says `Controlled`, the client mispredicted — revert then; if it says
`Ragdoll`, adopt its `ragdollEpoch` and carry on. This is the Unity NfE "classify within ~5 ticks or
discard after a grace period" pattern and CS2's "revert if unconfirmed within a short window",
applied to the *revert* direction. ADR 0015's "only the server ends a down state" is unchanged and
still necessary; this adds "an out-of-date snapshot doesn't *start*-then-*unstart* one."

**One-shot effects (Q4): two mechanisms, two triggers.** Locally-predicted effects (the predicted-
knockdown camera kick, speed-lines cutoff) fire only on the first *forward* simulation of a tick,
never on a replayed one — Source's `IsFirstTimePredicted`, Fusion's `IsForward`, Unity NfE's
`IsFirstTimeFullyPredictingTick`. Snapshot-delivered effects (the impact SFX for a knockdown the
client never predicted) fire once per `ragdollEpoch` — apply iff `epoch > lastAppliedEpoch`.

**`GettingUp` (Q5): server-decided start, fixed duration.** The server's authoritative ragdoll
settle-check decides *when* `Ragdoll → GettingUp` happens (already true — the `authoritative` flag);
the duration is the fixed `GETUP_MS` (already true). Send `motionState` + `phaseStartTick`; do **not**
send an explicit `0..1` progress float — it is redundant with `phaseStartTick` and the server already
sends the blended bone pose every `GettingUp` tick, so the client just interpolates that. This is
exactly ALS-Refactored's model: a multicast RPC starts a fixed-length get-up montage, the anim
graph blends out of the snapshotted final ragdoll pose.

---

## 1. Q1 — how much of the skeleton goes on the wire

### 1.1 Every documented shipping engine replicates the pelvis/root only (or nothing)

**Unreal Engine — "only the hip location is replicated."** The canonical statement is in Epic's
long-standing physics/networking documentation (UDN, mirrored where the live page 403s to automated
fetches):

> "For Ragdoll physics, only the hip location is replicated. It is often possible to tear off
> completely and not replicate at all."
> — Epic Games UDN physics/networking docs, quoted verbatim by
> [ikrima.dev — UE4 Gamedev Guide, *Physics replication*](https://ikrima.dev/ue4guide/networking/network-replication/physics-replication/)
> ("referencing Epic Games' UDN Physics documentation"), and independently surfaced by two
> web searches of the phrase. The live Epic pages
> ([Tear Off](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Networking/TearOff),
> the legacy [Networking Overview](https://docs.unrealengine.com/udk/Three/NetworkingOverview.html))
> 403 to WebFetch.

Two things follow from that sentence. First, the *rest of the skeleton is not on the wire* — each
client simulates the other ~10 bones locally and independently, anchored to the replicated hip.
Second, "tear off" (`AActor::TearOff` / `bTearOff`) is a common further step: once every client has
been told "you are now a ragdoll," the server stops replicating the actor **entirely** and each
client's ragdoll lives out its flop with zero further correction.

**Unreal — what a physics actor actually replicates.** Actors don't replicate transforms directly;
they replicate `ReplicatedMovement` (`FRepMovement`), and for simulated proxies:

> "When Actors replicate movement, they do not replicate their transforms directly. Instead, all
> Actors maintain a replicated variable called `ReplicatedMovement`, which uses the structure
> `FRepMovement`." … "when they receive movement updates from the server, they set their location,
> rotation, and velocity to whatever the server says they should be, with a few additional processes
> to make their movement smoother and more believable."
> — [Unreal Engine — Understanding Networked Movement in the Character Movement Component](https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine)

`FRepMovement` carries one location, one rotation, one linear velocity and one angular velocity —
the *root body's*. For a physics-simulating actor with `bRepPhysics = true` that is the single
simulated root; there is no per-bone channel. The gamedev-guide mirror adds the compression detail:

> "The vectors are compressed to integer resolution … Quats are compressed to only send 3 values;
> the 4th value is inferred from the other 3."
> — [ikrima.dev — *Physics replication*](https://ikrima.dev/ue4guide/networking/network-replication/physics-replication/)

**ALS-Refactored (Sixze) — the reference community UE5 ragdoll-networking implementation.** It
replicates exactly one value: `RagdollTargetLocation`, a `FVector_NetQuantize` (quantized pelvis
position).

> `UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "State|Als Character", Transient, Replicated)`
> `FVector_NetQuantize RagdollTargetLocation{ForceInit};`
> — [`Source/ALS/Public/AlsCharacter.h`](https://github.com/Sixze/ALS-Refactored/blob/main/Source/ALS/Public/AlsCharacter.h)

Every machine — server, owning client, and every simulated proxy — runs the *full* physics-asset
ragdoll locally:

> `GetMesh()->SetSimulatePhysics(true);`
> `// This is required for the ragdoll to behave properly when any body instance is set to simulated in a physics asset.`
> `GetMesh()->ResetAllBodiesSimulatePhysics();`
> — [`Source/ALS/Private/AlsCharacter_Actions.cpp`, `StartRagdollingImplementation`](https://github.com/Sixze/ALS-Refactored/blob/main/Source/ALS/Private/AlsCharacter_Actions.cpp)

The owner writes its own pelvis position up to the server each tick
(`if (bLocallyControlled) SetRagdollTargetLocation(PelvisLocation)` →
`ServerSetRagdollTargetLocation` RPC). Every *non*-owner instance applies a **soft** corrective pull
toward the replicated location — never a snap, never per-bone:

> `static constexpr auto PullForce{750.0f};`
> `static constexpr auto InterpolationHalfLife{1.2f};`
> … pull applied to `Spine03` if `HorizontalSpeedSquared > 300²` else `Pelvis`, only when the
> distance is between `MinPullForceDistance{5.0f}` and `MaxPullForceDistance{50.0f}` cm.
> — [`AlsCharacter_Actions.cpp`, `RefreshRagdolling`](https://github.com/Sixze/ALS-Refactored/blob/main/Source/ALS/Private/AlsCharacter_Actions.cpp)

So ALS's answer is exactly the Unreal-docs pattern: **one point on the wire (the pelvis), a full
local cosmetic ragdoll on every machine, a gentle spring correction on the non-authoritative
copies, and no per-bone data anywhere.**

**Source engine — the flop is not on the wire at all.** Confirmed again from the prior file's
sources:

> "these client-side ragdolls are handled completely on a per-client basis … at the expense of
> being virtually nonexistent on the server, being inconsistent across client perspectives, and
> only colliding with entities that have physics objects on the client."
> — [Valve Developer Community — Ragdoll](https://developer.valvesoftware.com/wiki/Ragdoll)
> (VDC blocks automated fetches; corroborated by
> [Prop_ragdoll](https://developer.valvesoftware.com/wiki/Prop_ragdoll):
> "Server-side ragdolls can create a lot of network traffic, so they should be used carefully in
> multiplayer games.")

**Halo: Reach — "don't network ragdolls."** David Aldridge, GDC 2011,
*I Shot You First: Networking the Gameplay of Halo: Reach* — one of the core bandwidth rules, quoted
via the [Wolfire session summary](https://www.wolfire.com/blog/2011/03/GDC-Session-Summary-Halo-networking)
([GDC Vault](https://www.gdcvault.com/play/1014345/I-Shot-You-First-Networking)).

**Overwatch — locally simulated, non-authoritative, per-client.** Still not first-party-confirmed
for ragdolls specifically (the GDC 2017 talk covers prediction/interpolation but no retrievable
ragdoll sentence). The widely-repeated characterisation — "someone dies and their body flies off …
no one else saw it, nor can you rewatch it in the replays as every client renders it differently" —
is [community, not primary](https://news.ycombinator.com/item?id=39923201). Flagged as corroborating
only.

**Preliminary finding: confirmed.** The pelvis-only pattern holds across every engine whose approach
is documented. What the client does for the other bones is a **local, display-only, non-authoritative
ragdoll sim** whose root is softly pinned to the authoritative pelvis — explicitly *not*
predict-and-reconcile (rejected in the prior file), and *not* a canned animation (the getup is
canned; the flop is physics).

### 1.2 The three options for DON'T FALL

| | on the wire | client work | divergence | JSON cost / downed char | binary cost / downed char |
|---|---|---|---|---|---|
| **(a) all 11 bones** | 11 × (pos + quat) | interpolate only; **no local ragdoll body** | none (one authoritative pose everywhere) | ~1.4–1.8 KB | ~0.11 KB (16-bit pos + smallest-three quat ≈ 10 B/bone) |
| **(b) pelvis pos+rot only** | 1 × (pos + quat) | run a **full local 11-body Rapier ragdoll**, soft-pin its pelvis | per-machine (Rapier not cross-machine deterministic, ADR 0003) | ~0.13 KB | ~0.01 KB |
| **(c) pelvis + head + 2 hands** | 4 × (pos + quat) | local sim for the other 7, 4 pinned | reduced but nonzero | ~0.5 KB | ~0.04 KB |

The Handbook §13.2 bandwidth baseline: today's JSON `SimState` is ~3.2 KB / snapshot for 8 players +
6 props (~95 KB/s at 30 Hz); a bit-packed binary version is ~245 B (~7 KB/s). Against that baseline:

- **Option (a) in JSON is genuinely expensive** — 4–6 simultaneous ragdolls in a pile-up adds
  ~6–11 KB/snapshot (~180–330 KB/s) *just for bones*, more than doubling the packet.
- **Option (a) in the binary/quantized protocol is nearly free** — ~0.1 KB/downed char, so even 12
  players all down is ~1.3 KB/snapshot of bones. Quaternions compress to smallest-three (Unreal does
  exactly this — "send 3 values; the 4th value is inferred"); positions quantize to 16-bit
  fixed-point (Handbook §13.2: "visually indistinguishable from full float64").

**Recommendation: option (a).** It is what ticket 09 already specifies, it removes the divergence
source *and* the client-side 11-body physics cost entirely (the client interpolates a POJO), it
reuses the `applyRemoteCharacters` path ADR 0006 built, and it is the only option compatible with
ADR 0015's addendum (local downed player drawn from `serverRender.characters[myId].bones`). Its one
real cost — bandwidth — is a JSON artefact that the Handbook §13.2 binary-protocol work (already on
the roadmap, "largest one-shot gain, low risk") erases. Gate it as it already is: `bones` is empty
unless `motionState ∈ {Ragdoll, GettingUp}`.

Option (b) is the shipping-engine default, but for DON'T FALL it *re-introduces* everything ADR 0015
and ticket 09 remove: 11 jointed Rapier bodies per client × 12 clients, per-machine divergence, the
`snapRootTo` per-snapshot yank, and the `GettingUp`-blend anchor pop the ADR 0015 addendum
specifically fixed by drawing from the server. Keep (b) in your pocket only as the fallback if a
profiling pass somehow shows quantized 11-bone bandwidth is still too high at 12 players — then
drop to (c) (pelvis + head + 2 hands is enough for a readable comedy flop) before going to full (b).

---

## 2. Q2 — does the server need the full articulated ragdoll?

**Source's answer is "no" — the client invents the flop and the server keeps a simplified body or
none** (§1.1). Halo: Reach's is "no, and don't even network it." So there *is* primary-source
precedent for a capsule-only server.

**But those games send zero bone data.** The moment DON'T FALL chooses option (a) — bones from the
server, client interpolates — the server *must* have an articulated ragdoll to read those bones
from. `Ragdoll.readBones()` reads 11 Rapier bodies; there is nothing to serialise if the server only
steps a capsule. And ADR 0015's addendum already commits to this: the local downed player is drawn
from `serverRender.characters[myId].bones`, so a capsule-only server breaks a shipped design.

The trade the task frames:

- **Server-side full ragdoll** — authoritative, identical bone pose on every client, comedy that
  everyone-in-the-room sees the same. Cost: 11 bodies × N concurrent ragdolls of Rapier solver work
  per 30 Hz tick, plus the ragdoll-vs-prop / ragdoll-vs-ragdoll contact pairs from
  `m2-collision-and-predicted-ragdoll.md` §3.
- **Server-side capsule-only** — cheap and deterministic, but every client's flop is invented and
  mutually inconsistent.

For a party game where the ragdoll is *pure comedy*, inconsistency is not a correctness problem —
Source and Overwatch ship it. The deciding factors are different:

1. **DON'T FALL already built the server ragdoll** (ADR 0006, ticket 05) and already ships ADR 0015's
   addendum that depends on it. Removing it is net *new* work to make the game *look worse* (12
   divergent flops instead of one shared one).
2. **The cost is not scary.** No primary source quantifies Rapier's N-jointed-body cost (flagged
   thin in the prior file and still thin), but 45–66 extra dynamic bodies at 30 Hz on a server that
   already runs 12 capsules + props is not on the face of it a problem, and the `RAGDOLL_MAX_TICKS`
   backstop bounds how long any ragdoll is live.
3. **Spectators/replays later** (roadmap: Betting/Spectator) need *one* authoritative flop, not 12
   client guesses.

**Recommendation: keep the full 11-body authoritative server ragdoll.** Run the profiling pass
(`m2-collision-and-predicted-ragdoll.md` §3.4) with ~6 concurrent ragdolls among props before M2
ships, so the number is measured rather than assumed — but treat capsule-only as a fallback for a
measured failure, not a default.

---

## 3. Q3 — the timing-window bug class

### 3.1 The scenario, in DON'T FALL's actual code

`main.ts`'s `reconcile()` (post-ADR-0015) corrects whenever
`serverDown || localDown || motionState mismatch || positionError > threshold`. Now:

1. Tick T: the client's own collision detection predicts a dash-into-wall knockdown →
   `localSim` motionState snaps to `Ragdoll`. Instant feel, as designed.
2. A server snapshot for **tick T−2** — still `Controlled`, capsule-based, the server hasn't seen
   the crash yet — arrives at T+1.
3. `reconcile()` sees `localDown == true`, `serverDown == false` → `needsCorrection` →
   `reconcileCharacter` runs the not-down branch → `returnToControlled()` → replays unacked inputs.
4. If replay *reproduces* the crash (the dash input is in the buffer and still clips the wall) →
   fine, re-ragdolls at the same epoch. If replay *doesn't* (the exact ADR 0015 root cause: an
   ordinary `RECONCILE_POSITION_ERROR` nudge moved the trajectory a few cm and it no longer crosses
   `DASH_WALL_MIN_SPEED_RATIO` at the wall) → the client reverts to `Controlled`…
5. …and ~1–2 ticks later the *real* server `Ragdoll` snapshot for tick T arrives and snaps it back
   down.

Result: `Ragdoll(predicted) → Controlled(reverted by a stale snapshot) → Ragdoll(server)` — a
visible capsule↔ragdoll flicker, and if a one-shot impact effect is keyed on "entered Ragdoll" it
fires twice.

### 3.2 How shipping frameworks prevent it

**The state-vs-event distinction (from `m2-client-reconciliation.md` / prior file, restated):** a
snapshot is *the value of a field at a tick*, not an *event*. Reconciliation resets predicted state
to the server's value for the acknowledged tick and re-simulates forward, so recomputing tick T's
`motionState` from a corrected base is idempotent — it can't "add" a second ragdoll. That handles
the *double-compute*. It does **not** by itself handle a stale snapshot *older than the local
prediction* dragging the state backwards, because the client has no newer authoritative value to
override it with yet.

**Photon Fusion — `IsResimulation` / `IsForward`, and re-simulation always starts from the latest
server state:**

> "The Resimulation Loop reconciliates the local state with the latest state received from the
> Server or Host by resetting the network state to the most recent state received and resimulating
> all the ticks from the most recent server tick … up until the current predicted local tick."
> `Runner.IsResimulation` "indicates the current tick has been simulated previously and is being
> simulated again now"; `Runner.IsForward` "indicates the current tick is being simulated for the
> first time."
> — Photon Fusion, *Network Simulation Loop* (docs behind a Gcore bot-check; quoted via search
> excerpt of [doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop](https://doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop)
> and the [Simulation API reference](https://doc-api.photonengine.com/en/fusion/current/class_fusion_1_1_simulation.html))

> "`IsFirstTick` and `IsLastTick` may be true twice during Fusion's Simulation Loop; once during the
> Resimulation Loop and once during the Forward Loop, so these properties must be used in
> conjunction with `Runner.IsForward` or `Runner.IsResimulation`."
> — same source

The key property: Fusion *only ever resimulates from a server tick forward*. It never applies a
server tick that is **older** than one it has already incorporated — the buffer discards those. That
is the structural version of the guard below.

**Source — `IsFirstTimePredicted`:**

> "Testing `prediction->IsFirstTimePredicted()` ensures that code is only executed when the client
> first predicts an action, and not when it checks against subsequent server updates."
> — Valve Developer Community, *Prediction* (VDC 403s to WebFetch; quoted via search excerpt of
> [developer.valvesoftware.com/wiki/Prediction](https://developer.valvesoftware.com/wiki/Prediction))

Source handles the *effect* side (don't replay the sound) but its command-replay model, like
Bernier's, is "reset to last acked, re-run forward" — it never runs a command *behind* the ack.

**Unity Netcode for Entities — `IsFirstTimeFullyPredictingTick` and a spawn-classification window:**

> "`NetworkTime.IsFirstTimeFullyPredictingTick` … is a common flag used in predicted systems, which
> guards one off operations (like the instantiation of predicted ghost spawns, and V/SFX on the
> client) so that they only happen once."
> — [Unity — Netcode for Entities, *Prediction*](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-n4e.html)

> "When the first snapshot update for this entity arrives, we detect that the received update is for
> an entity already spawned by client … The default classification system matches predicted spawns
> based by their types and spawning tick (should be within five ticks). … the locally predicted
> spawn will be deleted after a grace period."
> — [Unity — Netcode for Entities, *Ghost spawning*](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/ghost-spawning.html)

**Unreal — Resimulation-mode snapping and its rendering interpolation:** when a resim leaves an
object somewhere other than the client had it —

> "an object might be at a different state than before the resimulation, which could cause snapping
> of the object's position. In this case, the mode interpolates the rendering of the object from its
> current state to the new state." … "Higher latency and / or higher velocity will degrade the
> quality of the physics replication."
> — [Unreal Engine — Networked Physics Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/networked-physics-overview)

Unreal only offers this for a single simulated rigid body, not an articulated skeleton — consistent
with §1.

### 3.3 Is ADR 0015 + a monotonic epoch enough?

**Almost.** ADR 0015 guarantees the client can never get *ahead* of the server on when a knockdown
*ends*, so a late snapshot can't re-trigger a fresh episode after the client recovered on its own.
The epoch guarantees a one-shot effect fires once per episode. Neither stops §3.1's flicker, which
is about a snapshot *older than the local prediction* reverting a knockdown the client just
*started*.

**What's still needed: prediction-tick gating on the revert.** Tag the locally-predicted ragdoll
with the tick it was predicted on, `P`. Then in `reconcile()`:

- A **non-down** authoritative snapshot with `serverTick < P` does **not** clear the local ragdoll.
  Keep predicting; keep waiting.
- The first authoritative snapshot with `serverTick ≥ P` is decisive:
  - says `Ragdoll`/`GettingUp` → the prediction was right; adopt its `ragdollEpoch`, re-anchor,
    proceed (ADR 0015's unconditional down-sync).
  - says `Controlled` → the client genuinely mispredicted (a dropped dash input, the ADR 0015
    threshold-flip). *Now* revert to `Controlled` — exactly once, cleanly, no flicker because no
    stale snapshot ever bounced it.
- Backstop: if no `tick ≥ P` snapshot confirms within ~N ticks (packet loss), revert anyway —
  CS2's "revert if unconfirmed within a short time window", Unity NfE's "delete after a grace
  period."

This is a handful of lines (`predictedRagdollTick: number | null` on the client's reconcile state,
one comparison) and it is the direct analogue of Unity NfE's "match the predicted spawn to a server
update within 5 ticks, or discard." It composes with — does not replace — ADR 0015.

Note this is *only* for the client-predicted knockdown (dash-into-wall / self-collision). A
server-only knockdown (Bump, hazard) is never locally predicted, so `P` doesn't exist for it and
ADR 0015's unconditional down-sync already handles it.

---

## 4. Q4 — `ragdollEpoch` + `ragdollCause` on the wire

### 4.1 Should the epoch rise on every knockdown?

**Yes.** Handbook §6 is explicit about the contract:

> "Klíčové pravidlo: **jedna epoch = jedno spuštění vizuálního efektu**. `activateFromStanding()`
> nesmí být zaměněno za `applyAuthoritativePose()` — první je jednorázová akce spuštěná změnou
> epoch, druhá je pokračující synchronizace pozice bones každý tick."
> — Handbook §6 ("one epoch = one visual-effect trigger; `activateFromStanding()` must not be
> confused with `applyAuthoritativePose()`")

Today `bumpSeq` only rises on Bump and Fall (`SimState.ts` doc comment; a dash-into-wall / Spinner
knockdown "carries no new `bumpSeq`"). That means it is **not** a true "this is a new down episode"
signal — a client keying an impact VFX/SFX on it would get nothing for half the knockdown causes.
ADR 0014 deliberately scoped it that way for a reconciliation gate that ADR 0015 then removed, so
the narrow scope now has no upside. Make it rise on **every** transition into `Ragdoll` —
`beginRagdoll()` is the single choke point, plus the Fall path and the reconcile-forced entry.
Rename `bumpSeq → ragdollEpoch` while touching it (CONTEXT.md term; propose it there).

### 4.2 Is `ragdollCause` worth sending now?

**Yes — send it now.** Arguments:

- It is **2 bits** (`Bump | Fall | DashWall | Spinner`). Even in JSON it is one short string.
- It is set at exactly the same choke point as the epoch — `beginRagdoll()` already knows whether it
  was handed a Fall (no impulse), a dash-wall knockback, a Spinner impulse, or a Bump. Threading it
  onto the snapshot later means re-plumbing that path and the reconcile-forced entry.
- It is **already useful without networked SFX**: the camera kick direction, the hit-react lean, and
  which way the speed-lines cut are all cause-dependent and all client-side render decisions the
  client can't currently make for a remote player's knockdown.
- The alternative — infer cause from context on the client — is fragile (a Bump and a dash-wall hit
  look similar from bone data alone).

The prior file's §2.2 already recommended "give every server-originated impact a monotonic
`impactSeq` (or `(tick, sourceId)` pair)"; `ragdollEpoch` *is* that id, and `ragdollCause` is the
small payload that rides with it.

### 4.3 The canonical "apply exactly once despite replay/interpolation" mechanism

Two independent primary sources, two names for the same idea — **gate the side effect on "this is
the first, forward simulation of this tick," not a replayed/resimulated pass:**

1. **Source — `IsFirstTimePredicted`:** "code is only executed when the client first predicts an
   action, and not when it checks against subsequent server updates" — Valve Developer Community,
   *Prediction* (via search excerpt of
   [developer.valvesoftware.com/wiki/Prediction](https://developer.valvesoftware.com/wiki/Prediction)).
2. **Unity Netcode for Entities — `IsFirstTimeFullyPredictingTick`:** "a common flag used in
   predicted systems, which guards one off operations (like the instantiation of predicted ghost
   spawns, and V/SFX on the client) so that they only happen once" —
   [Unity NfE, *Prediction*](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-n4e.html).
3. **Photon Fusion — `IsForward` (with `IsFirstTick`/`IsLastTick`):** side effects gate on
   `Runner.IsForward` so they "execute only once per logical event" and don't re-fire "during the
   Resimulation Loop" — Fusion *Network Simulation Loop* (via search excerpt).

For a *snapshot-delivered* one-shot (an effect the client can't predict and only learns about from
the wire), the mechanism is different — you can't gate on "first forward tick" because the client
never simulated it. There you gate on the monotonic id: **apply iff `ragdollEpoch > lastAppliedEpoch`,
then store it.** A stale or interpolated-across-many-frames snapshot carrying an already-applied
epoch is ignored. Handbook §6's own words: the epoch is "monotónní counter, ne boolean, aby
nedocházelo k opětovnému spuštění efektu na stejném stale snapshotu" (monotonic counter, not a
boolean, so an effect isn't re-triggered on the same stale snapshot).

DON'T FALL therefore needs both: an `isReplaying` / first-forward flag on the sim context (deferred
from ticket 08, ticket 09 checklist item) for predicted effects, and `epoch > lastAppliedEpoch` for
snapshot-delivered ones.

---

## 5. Q5 — `GettingUp` over the wire

### 5.1 Server-decided start, fixed duration

DON'T FALL already does the right thing and it matches ALS-Refactored:

- **Start is server-decided.** The `authoritative` server's `CharacterStateMachine.tick()` moves
  `Ragdoll → GettingUp` when `(timer ≥ RAGDOLL_MIN_TICKS && ragdollSettled) || timer ≥
  RAGDOLL_MAX_TICKS` — a settle-check on the *server's* authoritative ragdoll body. The client's
  `localSim` is non-`authoritative`, so it never makes this call itself (ADR 0015). ALS does the
  same shape: `StopRagdolling()` runs on the authority and fans out a `MulticastStopRagdolling` RPC;
  simulated proxies (`GetLocalRole() <= ROLE_SimulatedProxy`) can't initiate it.
- **Duration is fixed.** `GETUP_TICKS = msToTicks(GETUP_MS)`, `GETUP_MS = 450`. ALS plays a fixed
  get-up **montage** (`GetUpFrontMontage` / `GetUpBackMontage`, chosen by whether the pelvis roll
  says the ragdoll landed face-up or face-down) and blocks input for its length:

  > `if (bGrounded && GetMesh()->GetAnimInstance()->Montage_Play(SelectGetUpMontage(bRagdollFacingUpward)) > 0.0f)`
  > `{ AlsCharacterMovement->SetInputBlocked(true); SetLocomotionAction(AlsLocomotionActionTags::GettingUp); }`
  > — [`AlsCharacter_Actions.cpp`, `StopRagdollingImplementation`](https://github.com/Sixze/ALS-Refactored/blob/main/Source/ALS/Private/AlsCharacter_Actions.cpp)

### 5.2 `phaseStartTick`, not a `0..1` progress float

Send `motionState` + `phaseStartTick` (the tick the current phase began). Reasons:

- With option (a) the server already sends the **blended** bone pose every `GettingUp` tick —
  `blendGettingUpBones(getupBones, capsuleCentre, elapsed)` runs server-side — so the client needs
  *no* getup math at all; it interpolates the POJO like any remote entity. An explicit progress
  float would be redundant with data already implied by the bones.
- `phaseStartTick` still earns its ~4 bytes: it is the Q3 timing-guard anchor, it lets the client
  detect a *missed* episode (server says `GettingUp` at tick X but the client never saw a `Ragdoll`
  snapshot — ADR 0015's edge case, currently handled by entering `Ragdoll` then `GettingUp` in one
  reconcile), and it makes the getup blend deterministically reconstructable if a future change ever
  wants the client to predict the `GettingUp → Controlled` return locally for feel.

### 5.3 The ragdoll→animation blend across the network

ALS's pattern: on `StopRagdolling`, `SnapshotFinalRagdollPose()` captures the ragdoll's last pose,
physics is switched off, and the anim graph blends from that snapshot into the montage. DON'T FALL's
`blendGettingUpBones` is the same idea — `getupBones = this.ragdoll.readBones()` captures the pose at
the `Ragdoll → GettingUp` boundary, then it lerps toward the standing rest pose over `GETUP_TICKS`.

The only networking subtlety with option (a): the client must not blend from *its own* last ragdoll
frame (there is no local ragdoll body any more) but from *the server's* — which it already has,
because it was interpolating the server's `Ragdoll` bones right up to the boundary, and the server's
first `GettingUp` snapshot carries the already-blended pose. So the transition is seamless by
construction: `interpolateState` "snaps (no blend) on any `motionState` change" (ADR 0006) precisely
because the *body being drawn* swaps, and the pose on each side of that snap is the server's.

---

## 6. Where the primary sources are thin

- **Rapier's cost for N articulated ragdolls at 30 Hz** — still undocumented anywhere first-party
  (flagged in `m2-collision-and-predicted-ragdoll.md` §3.4 and unchanged). The Q2 recommendation to
  keep the full server ragdoll rests on "already built + not obviously a problem," not a measured
  number. The profiling pass is still owed.
- **Photon Fusion docs** — the entire `doc.photonengine.com` domain sits behind a Gcore bot-check;
  every Fusion quote here is a search excerpt of the official page or the `doc-api.photonengine.com`
  API reference, not a direct fetch. The `IsResimulation` / `IsForward` / `IsFirstTick` semantics
  are consistent across all three surfaces and across the prior file.
- **The Unreal "only the hip location is replicated" sentence** — lives in Epic's UDN physics docs,
  which 403 to automated fetches. Quoted via the ikrima.dev gamedev-guide mirror (which cites the
  UDN source) plus two independent search corroborations of the exact phrase. The *mechanism* it
  describes is independently confirmed by ALS-Refactored's actual source (pelvis-only replicated
  property + local full sim + soft pull) and by the `FRepMovement` simulated-proxy docs.
- **Valve Developer Community** — `Ragdoll` and `Prediction` both 403 to WebFetch; quoted via search
  excerpts, consistent with the prior file's use of the same pages.
- **Overwatch ragdoll handling** — no retrievable first-party sentence; community characterisation
  only, treated as corroborating not load-bearing (same as the prior file).
- **Exact `FRepMovement` member list / `bRepPhysics` doc string** — the live Epic API page returned
  only a table-of-contents shell to WebFetch. The claim used ("a physics actor replicates one root
  body's transform + linear + angular velocity, no per-bone channel") is supported by the
  Networked-Movement doc's simulated-proxy description and by ALS's implementation, not by a direct
  quote of the struct docs.

---

## 7. Concrete recommendation for DON'T FALL (feeds a superseding/extending ADR)

**This extends ADR 0006 / 0013 / 0015 and closes out ticket 09. It does not reverse anything.**

### 7.1 `CharacterSnapshot` down-state wire shape

```
motionState    : "Controlled" | "Stagger" | "Ragdoll" | "GettingUp"   (unchanged)
bones          : BoneSnapshot[11]   — only while Ragdoll/GettingUp (unchanged shape).
                 Server sends the AUTHORITATIVE pose; during GettingUp it is already
                 blended toward standing (blendGettingUpBones runs server-side).
                 Client INTERPOLATES it like a remote entity. No local ragdoll body
                 on the client at all (ticket 09).
ragdollEpoch   : uint16 monotonic   — rename of bumpSeq. Rises on EVERY entry into
                 Ragdoll (Bump, Fall, DashWall, Spinner). One epoch = one VFX/SFX.
ragdollCause   : "Bump" | "Fall" | "DashWall" | "Spinner"   — 2 bits. Set at
                 beginRagdoll()'s choke point. Drives camera kick / hit-react /
                 speed-line cutoff now; impact SFX later.
phaseStartTick : uint   — tick the current motionState phase began. Timing-guard
                 anchor (7.3), missed-episode disambiguation, deterministic getup.
```

Quantize hard in the binary protocol (Handbook §13.2): 16-bit fixed-point bone positions,
smallest-three quaternion (~10 B/bone → ~0.11 KB/downed character; 12-down worst case ≈ 1.3 KB /
snapshot). `bones` stays empty unless down.

### 7.2 Server ragdoll

Keep the **full 11-body authoritative articulated ragdoll** (ADR 0006). It is the single source of
truth every client interpolates, including the owning client (ADR 0015 addendum). Run the
`m2-collision-and-predicted-ragdoll.md` §3.4 profiling pass (~6 concurrent ragdolls among props)
before M2 ships; treat capsule-only as a fallback for a *measured* failure only.

### 7.3 Timing-window guard

Client tags its locally-predicted ragdoll with the prediction tick `P`.

- A non-down authoritative snapshot with `serverTick < P` does **not** clear the local ragdoll.
- The first snapshot with `serverTick ≥ P` decides: `Ragdoll`/`GettingUp` → adopt its `ragdollEpoch`,
  proceed (ADR 0015 unconditional down-sync); `Controlled` → revert once, cleanly.
- If nothing confirms within ~N ticks → revert anyway (CS2 timeout / Unity NfE grace period).

Composes with ADR 0015 ("only the server ends a down state"); does not replace it. Only applies to
client-predicted knockdowns — server-only knockdowns have no `P` and ADR 0015 already covers them.

### 7.4 One-shot effects

- **Predicted** effects (predicted-knockdown camera kick, speed-line cutoff): fire only on the first
  *forward* simulation of a tick — an `isReplaying` flag on the sim context (Source
  `IsFirstTimePredicted`, Fusion `IsForward`, Unity NfE `IsFirstTimeFullyPredictingTick`).
- **Snapshot-delivered** effects (impact SFX for a knockdown the client never predicted): apply iff
  `ragdollEpoch > lastAppliedEpoch`, then store it.

### 7.5 `GettingUp`

Server-decided start (authoritative settle-check — already the case), fixed `GETUP_MS` duration
(already the case). Wire = `motionState` + `phaseStartTick`. No explicit `0..1` progress float — the
server already sends the blended pose each `GettingUp` tick and the client interpolates it. Matches
ALS-Refactored (fixed get-up montage, multicast-RPC start, blend out of the snapshotted final
ragdoll pose).

### 7.6 CONTEXT.md

Propose adding: **Ragdoll Epoch** (monotonic per-Character counter; one increment = one knockdown
episode = one impact VFX/SFX trigger) and **Ragdoll Cause** (`Bump` / `Fall` / `DashWall` /
`Spinner`). Retire **bumpSeq** from the glossary in the same change.

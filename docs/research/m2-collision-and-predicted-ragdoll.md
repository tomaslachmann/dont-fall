# M2 research — predicting the local player's ragdoll, double-applied transitions, and ragdoll-vs-dynamic collision

Second file in `docs/research/` (see `m2-client-reconciliation.md` for the convention: primary-source
notes that feed a decision but aren't themselves an ADR).

Scope: three questions left open by ADR-0003 (predict only the local Character, no rollback,
Rapier is not cross-machine deterministic), ADR-0006 (kinematic capsule + 11-bone articulated
ragdoll, state machine `Controlled → Stagger → Ragdoll → GettingUp → Controlled`), and ADR-0013
(local-replay reconciliation; continuous error replays, discrete `CharacterStateMachine`
transitions snap).

- **Q1** — should the client predict its own physics ragdoll at all, given an 11-body jointed
  ragdoll diverges from the server within a few ticks?
- **Q2** — how do prediction frameworks stop a discrete transition that is *both* locally
  predicted *and* independently produced by the server (`dash → wall → Ragdoll`) from firing
  twice?
- **Q3** — should the articulated ragdoll collide with dynamic props / moving obstacles, or is
  that a known solver-instability trap?
- plus a short note on teleport/snap detection for the cosmetic `Wobble` deriver.

---

## Recommendation

**Q1 — do not free-simulate the local ragdoll as a predicted physics body.** Every shipping
title whose approach is documented treats the knockdown/death flop as **cosmetic and
client-local**, never as a predicted-then-reconciled authoritative body: Source builds a
*client-side* ragdoll that is "virtually nonexistent on the server" and only collides with
client-side physics props ([Valve Developer Community — Ragdoll](https://developer.valvesoftware.com/wiki/Ragdoll)); Counter-Strike 2's "Predict Kill
Ragdolls" plays the *victim's* death flop early as a prediction that silently reverts if the
server doesn't confirm ([CS2 release notes, 2024-11-13](https://www.counter-strike.net/news/updates)); Halo: Reach's rule was literally
"don't network ragdolls" ([Aldridge, GDC 2011, *I Shot You First*](https://www.gdcvault.com/play/1014345/I-Shot-You-First-Networking)); Unreal only offers full
physics prediction (Resimulation) for **rigid single-body** replicated actors and warns that
"higher latency and / or higher velocity will degrade the quality" ([Unreal — Networked Physics Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/networked-physics-overview)). This is Q1's
**option (b)**: on a predicted knockdown, immediately snap `motionState` to `Ragdoll` (ADR-0013
already mandates the snap), play the ragdoll **driven from interpolated server snapshots exactly
like a remote Character's ragdoll**, and — because a snapshot is only every ~33 ms — let the
client run its own *display-only, non-authoritative* forward integration of the bones between
snapshots (interpolate/extrapolate), with the pelvis/root following the interpolated server
position, not a re-simulated predicted one. The capsule stays predicted and replayed as ADR-0013
says; the ragdoll bones were never in the `(state, inputs) -> state` contract as a predicted
quantity and should not be. Option (a) (current: predict + hard-snap the root every snapshot) is
the one approach no source endorses; option (c) (predict + ease the root) still pays full
resimulation cost on 11 jointed bodies per rolled-back tick (ADR-0013's own budget note) to
produce a body that is wrong anyway.

**Q2 — the transition is data on a tick, and reconciliation is a tick-aligned overwrite, so it
is applied exactly once by construction if `motionState` is part of the replayed state.** Bernier's
replay, Photon Fusion's Resimulation Loop, and Unity Netcode for Entities' rollback all re-run
predicted ticks by **resetting every predicted field to the server's value for the last
acknowledged tick and re-simulating forward** — the client never "adds" a second Ragdoll,
it recomputes tick T's `motionState` from the corrected base and takes whichever value the shared
step produces ([Fusion — Network Simulation Loop](https://doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop),
[Unity NfE — prediction](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-n4e.html)).
A stale `Ragdoll` snapshot for tick T re-triggering a *fresh* ragdoll+getup only happens if the
client treats "snapshot says Ragdoll" as an **event** rather than as **the value of a field at a
tick**. Fix: (1) make `motionState` + the tick its current phase started on part of the
snapshot and the replay base, so applying the server's tick-T state is idempotent; (2) for
genuinely event-shaped things the server originates and the client can't predict (hit by another
player), carry a monotonic `impactSeq` / event id and apply each id once — the same
correlation-window idea Unity NfE uses to match a predicted spawn to the server's within ~5 ticks
([Unity NfE — ghost spawning](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/ghost-spawning.html));
(3) keep ADR-0006's existing guard (`GettingUp` uninterruptible, re-entering `Ragdoll` doesn't
restart the timer) as the backstop. CS2 additionally ships a blunt **timeout**: a predicted
ragdoll with no server confirmation "within a short time window" reverts ([CS2 release notes,
2024-12-03](https://www.counter-strike.net/news/updates)).

**Q3 — enabling ragdoll-vs-dynamic-body collision is standard and correct, but it is also the
exact scenario physics engines name as their worst stability case, so gate it.** Unity's own
ragdoll-stability page lists "pushed with a large force" and large mass ratios as the conditions
under which "the joint solver is unable to keep the Rigidbody components of a Ragdoll together"
([Unity — Joint and Ragdoll stability](https://docs.unity3d.com/Manual/RagdollStability.html)) —
which is precisely "dash a ragdoll into a prop." Rapier gives you the switch (`solver_groups` /
per-collider groups, and joints already default to contacts-enabled between non-adjacent bones),
plus the mitigations: `RigidBodyBuilder::additional_solver_iterations` for the ragdoll bodies,
non-zero `contact_skin`, keep prop mass within ~1–10× bone mass, and rely on CCD against fixed
geometry ([Rapier CHANGELOG](https://raw.githubusercontent.com/dimforge/rapier/master/CHANGELOG.md),
[Rapier — colliders](https://rapier.rs/docs/user_guides/javascript/colliders/),
[Rapier — rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)). Recommendation:
let ragdoll bones collide with dynamic props (this is on the server, the authority; clients just
interpolate the result), keep self-collision **off** between jointed neighbours, cap the prop
mass ratio, give the ragdoll bodies 4–8 extra solver iterations, and treat any prop that can pin
a Character as a design bug the `RAGDOLL_MAX` timeout already covers.

**Cosmetic aside** — the `Wobble` deriver should do what `interpolateState` already does for
remote entities and what Source's `cl_smooth` / Fiedler's visual smoothing do: detect a
render-frame position delta above a threshold, treat it as a teleport, drop that frame from the
derivative and reset the deriver's history, resume next frame.

---

## 1. Q1 — Should a client predict its own physics ragdoll?

The problem restated: a freely-flung 11-body jointed ragdoll is chaotic; Rapier is deterministic
per-machine but not across machines (ADR-0003), so the client's predicted ragdoll and the
server's authoritative ragdoll diverge within a few ticks. The three candidate approaches:

- **(a)** predict the ragdoll locally, hard-snap its pelvis/root to the server position every
  snapshot (~33 ms) — the current approach, described as janky.
- **(b)** don't predict the ragdoll — on a predicted knockdown, snap the state machine and play
  the ragdoll from interpolated server snapshots, like a remote entity (optionally with a canned
  hit-react to cover the first frames).
- **(c)** predict the ragdoll but ease/smooth the root corrections instead of snapping.

### Option A — predict + hard-snap the root every snapshot (current)

**What it solves:** the root is authoritative-correct at every snapshot; the local player sees a
ragdoll respond on the same frame the knockdown is predicted (zero input-to-flop latency).

**What it costs:** the snap itself. ADR-0013 already budgets resimulation as "~22 physics ticks
in one frame" at 300 ms RTT, and notes each replayed tick for this project is "a real Rapier step
on a capsule (plus, while not `Controlled`, an articulated ragdoll)" — so option (a) pays the
*most expensive* version of the resimulation cost to produce a pose the server will contradict.
Between snapshots the predicted bones drift; every snapshot yanks the root back. No surveyed
source runs a predicted authoritative ragdoll for the local player.

**When it misbehaves:** worst exactly when the ragdoll matters — a hard, fast impact, where
divergence per tick is largest, so the ~33 ms correction is largest.

### Option B — don't predict the ragdoll; snap state, interpolate the bones from snapshots

**What it solves:** removes the divergence source entirely. The ragdoll the local player sees is
the *same* body, from the *same* data, as every remote observer's — it is driven by the server
snapshots through the code path ADR-0006 already built for remote Characters
(`SimState.character.bones`, `interpolateState` "snaps (no blend) on any `motionState` change").
The predicted knockdown still feels instant because the *state transition* is predicted and
snapped locally (ADR-0013); only the bone motion comes from the network. Between the ~33 ms
snapshots the client interpolates (and may briefly extrapolate) the bone transforms for smooth
rendering — this is display-only dead-reckoning, not authoritative prediction, so a small
overshoot corrected on the next snapshot reads as motion, not a pop.

**What it costs:** the first 1–2 frames after a *locally predicted* knockdown have no server bone
data yet (the server hasn't seen the dash-into-wall). Options: hold the capsule's last pose for
~1 frame, or play a very short canned "hit react" clip, until the first `Ragdoll` snapshot for
that Character arrives, then cross-fade to the networked bones. Also: the local player's own
ragdoll is now shown at the same interpolation delay as everyone else's (ADR-0003 already accepts
this delay for "a forgiving party game").

**When it misbehaves:** if the interpolation buffer underruns (packet loss), the local ragdoll
stalls or extrapolates visibly — same failure mode ADR-0003 already accepts for remote entities,
no worse for the local one.

### Option C — predict + ease the root corrections

**What it solves:** hides the per-snapshot yank of option (a) behind a short positional decay
(the §"error smoothing" technique from `m2-client-reconciliation.md`).

**What it costs:** still runs the full 11-body resimulation every rolled-back tick (ADR-0013's
budget line), still produces a diverging pose, and now also lags the *rendered* root behind the
*simulated* one — so on a fast tumble the visible ragdoll is both wrong in shape and late in
position. Unreal's Resimulation mode does exactly this easing for its (single rigid body) case
and still warns it is not free:

> "An object might be at a different state than before the resimulation, which could cause
> snapping of the object's position. In this case, the mode interpolates the rendering of the
> object from its current state to the new state." … "Higher latency and / or higher velocity
> will degrade the quality of the physics replication."
> — [Unreal Engine — Networked Physics Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/networked-physics-overview)

Unreal restricts this mode to actors "that replicate their movement and their root component is
set to simulate physics" — i.e. a single simulated rigid body, not an articulated skeleton — and
positions the cheaper **Predictive Interpolation** mode as the default, noting actors replicated
that way "are more performant and less network intensive compared to Actors replicated through
Resimulation" (same page).

### What shipping games / frameworks actually do for the local player's ragdoll

**Source engine — the local ragdoll is a client-only cosmetic body.** Source distinguishes a
server `prop_ragdoll` (full collision, authoritative, expensive) from the *client-side* ragdoll
spawned when a player or NPC dies:

> "Unlike server-side `prop_ragdoll`s, these client-side ragdolls are handled completely on a
> per-client basis and are much cheaper and simpler than their server-side counterparts, at the
> expense of being virtually nonexistent on the server, being inconsistent across client
> perspectives, and only colliding with entities that have physics objects on the client."
> — [Valve Developer Community — Ragdoll](https://developer.valvesoftware.com/wiki/Ragdoll)
> (the live wiki blocks automated fetches; this passage is quoted from the VDC page text as
> surfaced in search — corroborated by the parallel [`prop_ragdoll`](https://developer.valvesoftware.com/wiki/Prop_ragdoll)
> and [Physics Entities on Server & Client](https://developer.valvesoftware.com/wiki/Physics_Entities_on_Server_%26_Client) pages.)

> "Server-side ragdolls can create a lot of network traffic, so they should be used carefully in
> multiplayer games." — [Valve Developer Community — Prop_ragdoll](https://developer.valvesoftware.com/wiki/Prop_ragdoll)

So Source's answer is: the flop you see is *not* synced and *not* predicted-then-reconciled —
it's a local visual, and the authoritative "dead body that blocks a doorway," when it's needed
at all, is a separate simplified server body.

**Counter-Strike 2 — the predicted ragdoll is an opt-in cosmetic prediction that reverts.**
CS2's 2024 damage-prediction feature predicts the *victim's* death animation locally before the
server confirms the kill:

> Damage prediction settings were added, "allowing clients to immediately play audio/visual
> effects of inflicting damage without waiting for confirmation from the server." By default only
> "Predict Kill Ragdolls" is enabled — "damage prediction for the animation of dead bodies
> falling after your kills — before confirmation from the server that the opponent is dead" —
> while predicted body-shot and head-shot effects are off by default. "Damage prediction … comes
> with the risk of occasionally being wrong."
> — [Counter-Strike release notes, 2024-11-13](https://www.counter-strike.net/news/updates)
> (quoted via the [Liquipedia mirror of the official notes](https://liquipedia.net/counterstrike/2024-11-13_Patch);
> counter-strike.net serves a JS shell to automated fetches.)

> "Predicted ragdolls without a confirmation or correction from the server within a short time
> window will now revert." — [Counter-Strike release notes, 2024-12-03](https://liquipedia.net/counterstrike/2024-12-03_Patch)

Note the shape: it's a *prediction* (snap now, hope the server agrees) with an explicit
*timeout-revert*, not a resimulated physics body. This is essentially option (b) plus a
short-lived predicted trigger.

**Halo: Reach — "don't network ragdolls."** David Aldridge's GDC 2011 gameplay-networking talk
lists, as a core bandwidth strategy:

> "Change gameplay to require less networking (e.g. don't network ragdolls)."
> — David Aldridge, *I Shot You First: Networking the Gameplay of Halo: Reach*, GDC 2011
> ([GDC Vault](https://www.gdcvault.com/play/1014345/I-Shot-You-First-Networking); quoted via
> the [Wolfire Games session summary](https://www.wolfire.com/blog/2011/03/GDC-Session-Summary-Halo-networking),
> which transcribes the talk's slides closely. Full video: [Internet Archive](https://archive.org/details/youtube-h47zZrqjgLc).)

Where a dead body *does* get relevance (the talk notes a corpse gets near-maximum network
priority for a few seconds because players watch the kill), it's synced as a low-fidelity
prioritised object, not predicted on the client.

**Overwatch — locally simulated, non-authoritative, not reconciled.** The GDC 2017 talk
(*'Overwatch' Gameplay Architecture and Netcode*, Timothy Ford, [GDC Vault](https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and))
covers prediction for the local player's movement and abilities and interpolation for everything
else, but a transcript with an explicit ragdoll passage could not be retrieved from a primary
source. The widely-repeated community characterisation — Overwatch simulates death ragdolls
locally and non-authoritatively, so "no one else sees it" the same way and replays re-derive it
per client ([Hacker News discussion](https://news.ycombinator.com/item?id=39923201), *not*
primary) — is consistent with Ford's stated architecture but is flagged here as **not
first-party confirmed**. This is the thinnest of the Q1 sources.

**Photon Fusion — physics prediction is opt-in and explicitly the expensive tier.** Fusion's
Physics Addon lets a `NetworkRigidbody` either just interpolate from the authority or run "Full
Physics Prediction," where "physics simulation is run on both resimulation and forward ticks …
which gives the highest quality interaction between physics objects and local players, at the
highest CPU cost" — with interpolation-only positioned as the cheaper default
([Fusion 2 — Physics Addon](https://doc.photonengine.com/fusion/v2/addons/physics-addon-2.0);
Photon's docs sit behind a bot-check, quoted via search excerpt). Fusion also moves the
interpolated render transform onto "a child transform of the Rigidbody which contains no
Colliders" — i.e. the visual body and the physics body are deliberately decoupled.

**Common thread:** no source runs a *predicted, reconciled, authoritative* articulated ragdoll
for the local player. The knockdown *trigger* may be predicted (CS2); the *pose* is either
client-cosmetic (Source, Overwatch-as-described) or interpolated from the authority (Fusion
default, Halo). ADR-0006 already built the interpolated path for remote Characters.

---

## 2. Q2 — Not double-applying a transition that is both predicted and server-resolved

`dash → wall → Ragdoll` is produced by the shared step on the client immediately and by the
server ~½ RTT later. The failure: the client predicts Ragdoll at tick T, recovers by tick
T+40, then a snapshot for tick T (still saying `Ragdoll`) arrives late and is misread as "start
a new ragdoll now."

### 2.1 The mechanism replay frameworks use: tick-aligned overwrite, not event application

The root cause of the double-fire is treating a snapshot as an *event* ("the server says
ragdoll → ragdoll him") instead of as *the value of a field at a known tick* ("at tick T,
`motionState == Ragdoll`; I predicted the same; nothing to do").

Every replay-style reconciler is structured as the second thing:

**Bernier (GDC 2001) — replay from the last acknowledged tick.** The algorithm resets to the
server's state for the last acknowledged command and re-runs the buffered commands:

> `"from state" <- state after last user command acknowledged by the server;`
> `"command" <- first command after last user command acknowledged by server;`
> `while (true) { run "command" on "from state" to generate "to state"; … "from state" = "to
> state"; "command" = next "command"; }`
> — Yahn Bernier, *Latency Compensating Methods in Client/Server In-game Protocol Design and
> Optimization*, GDC 2001 ([GDC Vault](https://www.gdcvault.com/play/1013277/Latency-Compensating-Methods-in-Client);
> PDF mirror: [web.cs.wpi.edu](http://web.cs.wpi.edu/~claypool/courses/4513-B03/papers/games/bernier.pdf)).
> (Quoted as vetted in `m2-client-reconciliation.md`; the PDF is not machine-readable by the
> fetch tool.)

Bernier is explicit that discrete flags travel in that state vector like any other field —
lag-compensation "might actually require forcing additional state info backwards, too (for
instance, whether the player was alive or dead or whether the player was ducking)," and predicted
weapon state ("ammo, when the next firing of the weapon can occur, what weapon animation is
playing") is "part of the authoritative server state and … replicated to the client" for direct
replay. Nothing is applied as a delta; the tick's state is *set*.

**Photon Fusion — the Resimulation Loop, `IsResimulation` vs `IsForward`.** Fusion's own words:

> "The Resimulation Loop reconciliates the local state with the latest state received from the
> Server or Host by resetting the network state to the most recent state received and
> resimulating all the ticks from the most recent server tick … up until the current predicted
> local tick." `Runner.IsResimulation` "indicates the current tick has been simulated previously
> and is being simulated again now"; `Runner.IsForward` "indicates the current tick is being
> simulated for the first time."
> — [Fusion 2 — Network Simulation Loop](https://doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop)
> and [Fusion 1 — Network Simulation Loop](https://doc.photonengine.com/fusion/v1/manual/network-simulation-loop)
> (Photon docs are behind a Gcore bot-check; both pages quoted via search excerpts. The
> `IsResimulation` / `IsForward` split is also documented on the
> [Fusion Simulation API reference](https://doc-api.photonengine.com/en/fusion/current/class_fusion_1_1_simulation.html).)

The practical rule this exposes to game code: **side effects that must happen once — spawning a
VFX, playing a one-shot sound, incrementing a counter — are gated on `IsForward` so they don't
re-fire on every resimulated pass over the same tick.** State changes themselves are safe to
recompute because resimulation *starts* by resetting to the authoritative value. `dash → Ragdoll`
recomputed during resimulation from a corrected base simply yields `Ragdoll` again (or doesn't,
if the correction removed the collision) — it is never "applied twice."

**Unity Netcode for Entities — rollback re-runs all predicted components.** NfE's prediction
"runs for entities that have the `PredictedGhost` and `Simulate` components"; on a new snapshot
"the `PredictedSimulationSystemGroup` runs from the oldest tick applied to any entity, to the
tick the prediction is targeting (this is called 'rollback')"
([Unity NfE — prediction](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-n4e.html)).
Predicted state is restored from the snapshot and recomputed; it is not diffed against the
client's prior guess.

**Takeaway for DON'T FALL:** put `motionState` (and the tick its current phase started —
`phaseStartTick`) into `SimState.character` as replicated, replayed fields. Reconciliation
already resets `SimState` to the server's tick-T value before replaying inputs (ADR-0013). Then
applying a stale tick-T `Ragdoll` snapshot is a no-op if the client's tick-T prediction was also
`Ragdoll` and its `phaseStartTick` matches — there is no separate "trigger a ragdoll" code path
to fire.

### 2.2 Correlating a genuinely event-shaped, server-only transition — apply it once

Some transitions the client *cannot* predict: `Controlled → Ragdoll` because **another player**
shoved you, or a server-only hazard. These are real events, they arrive only in snapshots, and
they must be applied exactly once even though the same snapshot is received/processed across
several frames and several resimulation passes.

Unity NfE's predicted-spawning classification is the canonical primary-source pattern for
"match my local guess to the server's version, within a window, or discard":

> "When the first snapshot update for this entity arrives, we detect that the received update is
> for an entity already spawned by client and from that time on, all the updates are applied to
> it." The default classification system matches predicted spawns "based by their types and
> spawning tick (should be within five ticks)." If no match is found "the locally predicted
> spawn will be deleted after a grace period."
> — [Unity Netcode for Entities — Ghost spawning](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/ghost-spawning.html)

Applied here: give every server-originated impact a monotonic `impactSeq` (or `(tick, sourceId)`
pair) in the snapshot. The client keeps `lastAppliedImpactSeq`; an impact is applied iff its seq
is greater. A stale snapshot replaying an already-applied `impactSeq` is ignored. This is
distinct from §2.1: §2.1 transitions need no id because they're recomputed from inputs the client
already has; §2.2 transitions need an id because the client has no way to regenerate them and
must dedupe the delivery.

### 2.3 Refractory / timeout windows as a backstop

Two independent primary-source instances of "un-apply or suppress after a fixed window":

- **CS2:** "Predicted ragdolls without a confirmation or correction from the server within a
  short time window will now revert." — [CS2 release notes, 2024-12-03](https://liquipedia.net/counterstrike/2024-12-03_Patch)
- **Bernier's teleport handling** (one level down, for interpolated objects): detect that "the
  distance between the origin at one update and another is too big, and thereby presumed to be a
  teleportation/warp," and then "just move the object to the latest known position and start
  interpolating from there" — i.e. a discontinuity is handled by a one-shot snap, never by
  repeated correction. ([Bernier, GDC 2001](https://www.gdcvault.com/play/1013277/Latency-Compensating-Methods-in-Client),
  quoted as vetted in `m2-client-reconciliation.md`.)

ADR-0006 already has the game-specific version of this: `GettingUp` is uninterruptible, and
re-entering `Ragdoll` while already ragdolled does not restart the timer. That guard, plus
`RAGDOLL_MAX`, means even a mis-handled duplicate can't soft-lock the Character — it would at
worst extend one ragdoll. Keep it; it is the cheap backstop behind §2.1/§2.2.

### 2.4 Distinguishing predicted-and-confirmed from server-only

| | client predicts it? | needs an event id? | reconcile how |
|---|---|---|---|
| `dash → wall → Ragdoll` | yes (shared step) | no | recompute from replayed inputs; tick-aligned state is idempotent (§2.1) |
| shoved by another player → `Ragdoll` | no | yes (`impactSeq`) | apply once by id; ignore stale re-delivery (§2.2) |
| server hazard / out-of-band knockdown | no | yes | same as above |

The client's replay naturally produces the first row; the second and third rows are the only
ones that need the sequence-id plumbing.

---

## 3. Q3 — Should the articulated ragdoll collide with dynamic props?

Current state per ADR-0006's ticket-05 notes: ragdoll bones collide with static geometry only
(`collisionGroups.ts` keeps the ragdoll from fighting the capsule), so a dash into a physics box
sends the ragdoll through it.

### 3.1 It is standard to let ragdolls hit dynamic bodies — Rapier gives you the switch

Rapier filters interactions with two independent mechanisms:

> "The most efficient way of preventing some pairs of colliders from interacting with each other
> is to use collision groups or solver groups." The `collision_groups` filter runs "right after
> the broad-phase, at the beginning of the narrow phase" and "should be preferred most of the
> time because it skips more computations"; `solver_groups` lets contacts be *detected* but skips
> "contact forces" — useful for "sensor-like" contact events without a physical response.
> — [Rapier — Colliders (collision/solver groups)](https://rapier.rs/docs/user_guides/javascript/colliders/)

Between two bodies joined by a joint, Rapier's default is that contacts **are** computed unless
you turn them off:

> "Indicates if contacts are enabled between colliders attached to the rigid-bodies linked by
> this joint." — [Rapier — `ImpulseJoint.contactsEnabled` / `setContactsEnabled`](https://rapier.rs/javascript3d/classes/ImpulseJoint.html)

So the conventional ragdoll setup in Rapier is: one collision group for ragdoll bones;
`contactsEnabled = false` on each joint so directly-jointed neighbours (upper arm / forearm)
don't jitter against each other; bones in the group's *filter* for world static, dynamic props,
and (optionally) other ragdolls, but not for the owning capsule. Enabling the "prop" bit in the
bone filter is a one-line change from the current static-only setup.

### 3.2 The known costs — this is physics engines' worst-named stability case

Unity's ragdoll-stability guidance names the exact failure mode "flung into a prop" produces:

> "Under extreme circumstances (such as spawning partially inside a wall or pushed with a large
> force), the joint solver is unable to keep the Rigidbody components of a Ragdoll together."
> "If Rigidbody components connected with Joints are jittering, try increasing the Default Solver
> Iterations value to between 10 and 20." "Avoid large differences in the masses between Rigidbody
> components connected by Joints."
> — [Unity — Joint and Ragdoll stability](https://docs.unity3d.com/Manual/RagdollStability.html)

Rapier's own history shows jointed-body stability is an ongoing solver concern, and shows the
levers:

> v0.18.0 — "Non-linear constraints solver rewritten for improved stability and convergence.
> Bodies can receive additional solver iterations via
> `RigidBodyBuilder::additional_solver_iterations`."
> v0.29.0 — "Major velocity constraints solver rework … up to 25% performance improvement."
> v0.35.0 — "Contact clustering and recycling reduce solver work on composite and resting
> contacts. Block solver uses lexicographic manifold point ordering for reduced jiggle in piles."
> — [Rapier CHANGELOG](https://raw.githubusercontent.com/dimforge/rapier/master/CHANGELOG.md)

> "The contact skin of the collider acts as if the collider was enlarged with a skin of width
> `contactSkin` around it, keeping objects further apart when colliding. A non-zero contact skin
> can increase performance, and in some cases, stability."
> — [Rapier — Collider docs (`contactSkin`)](https://rapier.rs/javascript3d/classes/Collider.html)

Joint motor overshoot is a documented instability at high stiffness/damping
([dimforge/rapier #125](https://github.com/dimforge/rapier/issues/125): "for high values of
stiffness and damping the motor will overshoot its target, producing instabilities") — relevant
only if the ragdoll uses motorised joints for an active-ragdoll look; spherical joints with
limits are the safer default Rapier itself recommends "to simulate ragdolls arms, pendulums,
etc." ([Rapier — Joints](https://rapier.rs/docs/user_guides/rust/joints/)).

For the "flung into a box" case specifically, Rapier's CCD covers tunnelling on the way in:

> "Fast dynamic bodies always run CCD against fixed colliders"; `ccd_enabled` upgrades a body to
> "bullet" status for kinematic/dynamic sweeping.
> — [Rapier CHANGELOG, v0.35.0](https://raw.githubusercontent.com/dimforge/rapier/master/CHANGELOG.md)

### 3.3 Collision-layer conventions

- **Self-collision off between jointed neighbours** (Rapier `contactsEnabled=false` per joint;
  Unreal PhAT ships bodies as non-colliding until you enable pairs — [Unreal Physics Asset Editor
  Interface](https://dev.epicgames.com/documentation/unreal-engine/physics-asset-editor-interface-in-unreal-engine)
  "Enable / Disable Collision for selected bodies"). Non-adjacent bones (hand vs shin) can
  self-collide if you want, at solver cost.
- **Collide with world static + dynamic props.** Standard.
- **Ragdoll vs ragdoll** — enable for the chaos (two players' ragdolls tangling is on-genre), but
  it multiplies contact pairs; acceptable at 2–12 players, watch it at the high end.
- **Ragdoll vs its own owning capsule — off** (already done, `collisionGroups.ts`), and vs other
  players' *capsules* — off too (the capsule is the authority for player-vs-player; a ragdoll
  bone shouldn't shove a Controlled capsule).
- **Mass ratio** — keep prop mass within ~1–10× a bone's mass (Unity's "avoid large differences"
  rule); a heavy crate vs a light hand collider is where the solver explodes.

### 3.4 Where the primary sources are thin

Rapier has **no dedicated ragdoll guide** and its docs don't discuss many-jointed-body-vs-dynamic
stability directly — the Q3 stability evidence is (a) Rapier's changelog and issue tracker
showing the solver levers exist and are actively worked, and (b) Unity's/Unreal's ragdoll docs
for the general convention. No primary source quantifies the perf cost of N ragdoll bodies vs
dynamic props at a given tick rate; that needs a measurement pass on the actual server.

---

## 4. Cosmetic — teleport/snap detection for the `Wobble` deriver

`Wobble` (ADR-0006: "procedural and cosmetic … never affects the capsule collision") is driven by
render-frame position deltas, so a reconciliation snap spikes it. The standard fix is the same
discontinuity-detection every source uses:

- **Bernier:** for interpolated objects, detect "the distance between the origin at one update
  and another is too big … presumed to be a teleportation/warp," then "just move the object to
  the latest known position and start interpolating from there." Also mentions explicit flags
  that "say 'don't interpolate'" or "clear out the position history."
  ([GDC 2001](https://www.gdcvault.com/play/1013277/Latency-Compensating-Methods-in-Client))
- **Source `cl_smooth`:** prediction-error correction, when off, "may cause the client's view to
  jump erratically"; when on, "errors can be smoothly corrected" over `cl_smoothtime` — and the
  correction is bounded, not applied to arbitrarily large jumps.
  ([Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking),
  quoted as vetted in `m2-client-reconciliation.md`.)
- **Unreal `NetworkSmoothingMode`** and **Unity NfE `SwitchPredictionSmoothing`** both smooth
  *only* `Position`/`Rotation` over a chosen duration and both concede residual artifacts on
  fast direction changes ([Unity NfE — prediction switching](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-switching.html):
  "The smoothing process isn't perfect, and fast-moving objects that change direction frequently
  may still experience visual artifacts").

The project's own `interpolateState` already does the teleport-snap for remote entities on a
`motionState` change. `Wobble` should reuse the same idea: when the render-frame position delta
fed into the deriver exceeds a threshold (a value clearly above max skated movement in one
frame), treat that frame as a teleport — skip it, reset the deriver's stored history/velocity,
and resume on the next frame. Do **not** try to feed the snap through the wobble spring; it will
ring.

---

## Recommendation for this project, in detail

Solo dev, first netcode pass (M2), 2–12 players, on-demand server per Match (ADR-0002).
Consistent with ADR-0003 (predict only the local Character, no rollback), ADR-0006 (hybrid
capsule + 11-bone ragdoll, state machine), ADR-0013 (local replay; continuous replays, discrete
snaps).

### Q1 — do not predict the ragdoll as a physics body; snap the state, drive bones from snapshots

1. **Keep the capsule predicted and replayed** exactly as ADR-0013 says. The ragdoll bones were
   never a predicted quantity in the `(state, inputs) -> state` contract — keep it that way.
2. **On a locally-predicted knockdown, snap `motionState` to `Ragdoll` immediately** (ADR-0013 /
   ADR-0006 already mandate the snap). This is what makes the hit feel instant.
3. **Drive the ragdoll pose from the server exactly like a remote Character's ragdoll** — the
   `SimState.character.bones` + `interpolateState` path ADR-0006 already built. The local
   player's own ragdoll now runs at the same interpolation delay as everyone else's; ADR-0003
   already accepts that delay.
4. **Cover the ½-RTT gap before the first `Ragdoll` snapshot** with either a 1-frame hold of the
   capsule's last pose or a very short canned hit-react clip, then cross-fade to the networked
   bones. Between snapshots, interpolate the bone transforms (brief extrapolation on buffer
   underrun is fine — it's display-only).
5. **Delete the per-snapshot pelvis hard-snap of predicted ragdoll bones.** There are no
   predicted ragdoll bones any more; there is nothing to snap.
6. This is Q1 option (b). It removes the divergence source, reuses existing code, and cuts the
   resimulation cost ADR-0013 flagged (no 11-body Rapier step per rolled-back tick — only the
   capsule).

### Q2 — make the transition a replayed field, add event-ids only for server-only transitions

1. **Add `motionState` and `phaseStartTick` to `SimState.character` as replicated, replayed
   fields.** Reconciliation already resets `SimState` to the server's tick-T value before
   replaying (ADR-0013); a stale tick-T `Ragdoll` snapshot then becomes a no-op when the client's
   own tick-T prediction already said `Ragdoll` with the same `phaseStartTick`. No "trigger a
   ragdoll" code path exists to double-fire.
2. **Gate one-shot side effects (impact SFX, camera kick, speed-lines burst) on "first forward
   simulation of this tick,"** not on resimulated passes — Fusion's `IsForward` rule. A small
   `runner.isReplaying` flag on the sim context is enough.
3. **For server-only knockdowns (shoved by another player, hazards): carry a monotonic
   `impactSeq` in the snapshot; apply an impact iff `seq > lastAppliedImpactSeq`.** This is the
   only new plumbing, and it's ~10 lines. Unity NfE's spawn-classification-within-5-ticks is the
   precedent.
4. **Keep ADR-0006's existing guards** (`GettingUp` uninterruptible; re-entering `Ragdoll`
   doesn't restart the timer; `RAGDOLL_MAX`) as the backstop. Optionally add CS2's blunt
   timeout-revert for a predicted ragdoll that the server never confirms within ~N ticks — but
   the guards above may make that unnecessary; add it only if a duplicate slips through in
   practice.

### Q3 — enable ragdoll-vs-dynamic-prop collision, on the server, with guardrails

1. **Add the "dynamic prop" bit to the ragdoll bones' collision filter** (currently static-only).
   This runs on the server — the authority — and clients just interpolate the result, so there is
   zero client/server-divergence risk from doing it.
2. **Keep `contactsEnabled = false` on each ragdoll joint** so directly-jointed neighbours don't
   jitter; leave non-adjacent self-collision **off** for M2 (turn on later only if bodies
   visibly interpenetrate and you have solver budget).
3. **Give the ragdoll rigid bodies `additionalSolverIterations` of ~4–8** and a small non-zero
   `contactSkin`; both are documented stability levers.
4. **Clamp dynamic-prop mass to ~1–10× a ragdoll bone's mass.** A prop heavier than that either
   gets a high dominance group (immovable, ragdoll slides off) or is redesigned. Unity's
   "avoid large mass differences" rule is the whole reason.
5. **Never let a prop pin a Character indefinitely** — `RAGDOLL_MAX` already forces
   `Ragdoll → GettingUp`, and `GettingUp` should teleport the capsule to a valid nearby position
   if the settled ragdoll ended up inside geometry.
6. **Ragdoll-vs-ragdoll: enable it** (on-genre chaos), but keep an eye on contact-pair count at
   the 12-player ceiling; it's the first thing to disable if the server tick budget blows.
7. **Measure.** No primary source quantifies N-ragdoll-vs-prop cost at 30 Hz; do one profiling
   pass on the real server with ~6 simultaneous ragdolls among props before assuming it's free.

### Cosmetic

Add teleport-snap detection to the `Wobble` deriver: if the render-frame position delta exceeds a
threshold well above one frame's skated movement, skip that frame, reset the deriver's stored
history/velocity, resume next frame — the same pattern `interpolateState` already uses for remote
entities on a `motionState` change, and the same one Source (`cl_smooth`), Bernier, and Unreal
(`NetworkSmoothingMode`) all describe. Never feed the discontinuity through the wobble spring.

### What did not yield a clean primary source

- **Overwatch's ragdoll handling** — the GDC 2017 talk's architecture is consistent with
  "locally simulated, non-authoritative," but no first-party transcript sentence about ragdolls
  specifically could be retrieved. Treated as corroborating, not load-bearing.
- **Photon Fusion docs** — the entire `doc.photonengine.com` domain sits behind a Gcore
  bot-check; Fusion quotes here come from search excerpts of the official pages plus the
  `doc-api.photonengine.com` API reference, not direct fetches. The `IsResimulation` / `IsForward`
  split and the Resimulation Loop description are consistent across all three surfaces.
- **Bernier's paper** — the canonical PDF mirrors are not machine-readable by the fetch tool;
  quotes are reused verbatim from `m2-client-reconciliation.md`, where they were previously
  vetted, citing the same GDC Vault entry.
- **Quantified perf cost of many jointed bodies vs dynamic bodies in Rapier** — not documented
  anywhere first-party; needs measurement.
- **A dedicated Rapier ragdoll guide** — does not exist; Q3 conventions are assembled from
  Rapier's changelog/issues plus Unity's and Unreal's ragdoll docs.

# M2 research — reconciling the local player's Character against server corrections

`docs/research/` is a new convention, parallel to `docs/adr/` (decisions) and `docs/milestones/`
(specs): it holds primary-source research notes that feed a design decision but aren't
themselves a decision record. This is the first file in it.

Scope: given ADR-0003 (predict only the local Character, no rollback of other entities,
Rapier isn't cross-machine deterministic) and ADR-0006 (the Character is a kinematic-capsule
state machine `Controlled → Stagger → Ragdoll → GettingUp → Controlled`, with per-bone ragdoll
transforms while not `Controlled`), how should the client reconcile its own predicted Character
when the server's snapshot disagrees — including the case where the disagreement is a
discrete state change (a Ragdoll landed) rather than a continuous position/velocity error.

## Recommendation

Build **local replay** (Bernier's "run the shared movement code over the buffered commands
since the last acknowledged server state") as the backbone, since ADR-0005's `(state, inputs)
-> state` shared step already exists for exactly this and costs nothing extra to wire up; layer
a short **positional error-smoothing** window (Valve's `cl_smoothtime`, Fiedler's decaying
error-offset, Unity Netcode for Entities' `GhostPredictionSmoothingSystem`) on top, applied only
to the continuous capsule transform, to hide the small residual errors ordinary movement
correction leaves behind; and **never** attempt to smooth a `motionState` transition itself —
snap the state machine and its bone transforms to the server's value the instant a correction
reveals one, exactly the way ADR-0006 already snaps `interpolateState` for remote Characters
on any `motionState` change. Every primary source below that touches this question draws the
same line: continuous transform data gets blended, discrete/logical state gets replaced outright
and only the resulting *pose* is faded in. For a solo dev's first netcode pass with 2–12 players,
ship replay-based reconciliation with a hard state snap first — that alone fixes the vast
majority of ordinary-movement mispredictions invisibly, since the shared step already exists —
and treat positional error-smoothing as a follow-on polish pass, not an M2 blocker.

---

## 1. Hard correction / snap

**What it solves:** the client's authoritative state is always correct on the frame it's
applied — no divergence between the value used for gameplay and the value shown.

**Source:** Yahn Bernier (Valve), [*Latency Compensating Methods in Client/Server In-game
Protocol Design and Optimization*](https://www.gdcvault.com/play/1013277/Latency-Compensating-Methods-in-Client) — the paper that introduced client-side prediction and lag
compensation for the Half-Life engine, GDC 2001. On the first, simplest form of correction (no
smoothing layer at all):

> "Having an authoritative server means that even if the client simulates different results than
> the server, the server's results will eventually correct the client's incorrect simulation.
> Because of the latency in the connection, the correction might not occur until a full round
> trip's worth of time has passed. **The downside is that this can cause a very perceptible shift
> in the player's position** due to the fixing up of the prediction error that occurred in the
> past."

Bernier ships this as the baseline and accepts the visible pop as a real cost — Source's later
engine work (see §2) exists specifically to soften it.

**What it costs:** the "perceptible shift" / "pop" Bernier names directly — on a hard impact,
correcting a position error instantly reads as a stutter or teleport. Cheap to implement (it's
the reconciliation loop with no extra step). Misbehaves worst when corrections are frequent or
large, which is precisely the "another player's impact you couldn't foresee" case this project
is asking about.

**Discrete-state handling — the one point every source agrees on:** Bernier's own algorithm
already treats non-transform state as something you replay/replace exactly, never blend. In the
same paper, the lag-compensation section notes that moving another player backward in time
"might actually require forcing additional state info backwards, too (**for instance, whether
the player was alive or dead or whether the player was ducking**)" — discrete flags are
part of the state vector that gets set, not interpolated. His weapon-prediction section is
explicit about the same principle for locally-predicted state: "**All of the variables that
contribute to determining weapon state** (e.g., ammo, when the next firing of the weapon can
occur, what weapon animation is playing, etc.), are then part of the authoritative server state
and are replicated to the client" for direct prediction/replay — never smoothed. He also
describes handling forcible teleportation of *interpolated* (remote) objects the same way: "we
can determine if the distance between the origin and one update and another is too big, and
thereby presumed to be a teleportation/warp. In that case, **the solution is probably to just
move the object to the latest known position and start interpolating from there**" — i.e. snap
through the discontinuity, resume smoothing only on the far side of it.

---

## 2. Error smoothing / positional reconciliation over time

**What it solves:** exactly the "perceptible shift" Bernier names in §1 — it decouples the
*simulated* corrected value (which must update immediately, for gameplay/collision to be
correct) from the *rendered* value (which can lag behind it briefly so the correction reads as
motion instead of a pop).

**Sources:**

- Valve, [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
  (official Valve Developer Community wiki; content verified via a verbatim archived mirror
  after the live wiki blocked automated fetches). Describing the mechanism added on top of
  Bernier's original hard correction: "By **gradually correcting this error over a short amount
  of time** (`cl_smoothtime`), errors can be smoothly corrected." Disabling it (`cl_smooth 0`)
  is documented as reintroducing exactly Bernier's problem: "Prediction error correction can be
  quite noticeable and may cause the client's view to jump erratically."
- Glenn Fiedler, [*State Synchronization*](https://gafferongames.com/post/state_synchronization/)
  (gafferongames.com networked-physics series). His "Visual Smoothing" section describes the
  same technique for corrected physics objects: "calculating and maintaining position and
  orientation error offsets that we reduce over time... we render them at the simulation
  position + error offset." He notes a single decay factor isn't good enough in practice: "I
  find that using a single smoothing factor gives unacceptable results... The solution I use is
  two different scale factors at different error distances" — i.e. snap-like correction for
  large errors, gentle decay for small ones, rather than one constant for everything.
- Unity, Netcode for Entities — [`GhostPredictionSmoothingSystem`](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/api/Unity.NetCode.GhostPredictionSmoothingSystem.html)
  and [Prediction smoothing](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-smoothing.html)
  (official manual). This is a real shipping framework's documented implementation of the same
  idea: "The `GhostPredictionSmoothingSystem` ... appl[ies] smoothing actions ... to all
  predicted ghosts that miss-predict," registered per component type via
  `GhostPredictionSmoothing.RegisterSmoothingAction<T>()`. The package ships a default action
  "for smoothing out any Translation prediction errors" — i.e. out of the box it only touches
  the continuous transform; any other component (which would include an enum-like state field)
  gets no smoothing unless a developer explicitly registers a custom action for it. The docs do
  not discuss discrete/enum state as a smoothing target anywhere.

**What it costs:** a second layer of bookkeeping (an error offset or a smoothing-action
registry) on top of correction itself; tuning two knobs (rate and cutoff) rather than one, per
Fiedler's own note that a single decay factor misbehaves; and it only ever hides *continuous*
error — every source above applies it to position/orientation/translation specifically, never to
logical/discrete state, because there is no well-defined "80% into a state transition."

---

## 3. Local replay (single-machine resimulation)

**What it solves:** the actual root cause, not just its visual symptom — after a correction, the
client's simulated state converges back to a plausible "now" instead of staying stale for a full
round trip, because it re-runs the local player's own already-buffered inputs forward from the
corrected base tick.

**Sources — this is documented, by name, as the standard mechanism in every "predict-your-own-entity"
framework surveyed:**

- Bernier's original algorithm *is* this technique, close to verbatim:
  > `"from state" <- state after last user command acknowledged by the server;`
  > `"command" <- first command after last user command acknowledged by server;`
  > `while (true) { run "command" on "from state" to generate "to state"; ... "from state" =
  > "to state"; "command" = next "command"; }`

  He is explicit that this replay is single-machine and does not need to match anyone else's
  simulation: it only replays *this client's own* stored commands against *this client's* copy
  of the shared movement code — no other player's input is ever replayed. ([Latency
  Compensating Methods](https://www.gdcvault.com/play/1013277/Latency-Compensating-Methods-in-Client))
- Photon Fusion (Photon Engine's C# multiplayer framework) documents the identical algorithm
  under the name **reconciliation**, in its official manual: "When new states arrive from the
  StateAuthority... Networked objects are set to the most current authority state tick, and
  simulations are repeated from that tick to the local current tick" — Fusion's own terms for
  this are `Resimulation` ("simulating a tick that has been previously simulated") vs. `Forward`
  ("simulating a tick... for the first time locally"), exposed to game code as
  `Runner.IsResimulation` / `Runner.IsForward`. ([Fusion — Network Simulation Loop](https://doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop),
  [Fusion — Execution Control](https://doc.photonengine.com/fusion/v1/manual/execution-control))
- Unity Netcode for Entities documents the same thing under the name **rollback**, applied only
  to predicted (locally-owned) ghosts, and is unusually explicit about its cost, which is
  directly relevant to this project's budget: "the `PredictedSimulationSystemGroup` runs from
  the oldest tick applied to any entity, to the tick the prediction is targeting (this is called
  'rollback')" and "For a 300ms connection, expect **~22 frames of re-simulation** ... physics
  and all other systems in the `PredictedSimulationSystemGroup` will tick ~22 times in a single
  frame." ([Managing latency with prediction](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-n4e.html))

**What it costs, and when it misbehaves:**

- **CPU cost scales with RTT**, not with the size of the error — Unity's own number (~22
  resimulated ticks at 300ms/30Hz-ish) is the concrete budget line to plan around; on a physics
  character (kinematic capsule + Rapier queries) each of those ticks is a real physics step, not
  a cheap transform lerp, so this is the dominant cost of the whole approach.
- **It requires the exact shared step this project already has** (ADR-0005's `(state, inputs) ->
  state`) — without a pure, replayable step function, replay isn't implementable at all. This
  project is unusually well-positioned for it for that reason.
- **It only ever fixes what's replayable.** Bernier's own caveat: "the other caveat is with
  respect to state data that exists solely on the client and is not part of the authoritative
  update data from the server" — anything derived outside the shared step (e.g. purely
  cosmetic client-only effects) has to be special-cased or it won't reconcile.
- **It does not, by itself, hide the visual pop** — replay fixes the *simulated* value; whether
  the *rendered* value pops or eases into place is a separate decision, which is exactly why
  frameworks that implement replay (Fusion, Unity NfE) also ship a smoothing layer (§2) on top
  of it rather than treating replay as sufficient alone.
- **No cross-machine determinism is required**, unlike lockstep — Glenn Fiedler's
  [*Deterministic Lockstep*](https://gafferongames.com/post/deterministic_lockstep/) names
  exactly why full rollback netcode (replaying *other* players' inputs) is fragile: "Even though
  the simulation... is deterministic on the same machine, that does *not* necessarily mean it
  would also be deterministic across different compilers, a different OS or different machine
  architectures," and "Floating point determinism is a complicated subject and there's no
  silver bullet." Local replay sidesteps this entirely because it never needs a second machine
  to reproduce the same result — this is the load-bearing distinction ADR-0003 already draws,
  and Fiedler's own article on the harder, rejected-for-this-project alternative confirms why
  that line is drawn where it is.

---

## Discrete state transitions specifically: what the sources actually say

No source surveyed describes blending a discrete/logical state transition the way position is
blended — because none of them treat it as a continuous quantity in the first place. The
consistent pattern across all of them:

1. **The discrete/logical state is corrected exactly and immediately**, as part of whatever the
   correction mechanism already touches (Bernier's replayed state vector includes
   alive/dead/ducking and full weapon state as ordinary fields, no different from position;
   Unity NfE's rollback re-simulates *all* predicted components on the entity, not just
   transform).
2. **Only the resulting pose/transform gets a visual smoothing pass**, and every framework that
   documents this makes the smoothing pass opt-in per component/field rather than global —
   Unity's `GhostPredictionSmoothingSystem` ships a default action for Translation only; nothing
   is auto-registered for arbitrary state.
3. **A close documented analog to "discrete regime change" is Unity NfE's own
   [prediction switching](https://docs.unity3d.com/Packages/com.unity.netcode@1.4/manual/prediction-n4e.html#prediction-switching)**
   (converting a ghost between the predicted and interpolated timelines live, which — like
   `Controlled → Ragdoll` — is a discrete jump between two different simulation regimes, not a
   continuous change). Their own answer is to smooth *only* Position/Rotation across the jump
   via `SwitchPredictionSmoothing`, over a developer-chosen duration, while conceding it's a
   patch, not a full solution: "isn't perfect, and fast-moving objects that change direction
   frequently may still experience visual artifacts." Even Unity's own official guidance stops
   at "ease the pose," never "blend the mode."
4. **Bernier's teleport-detection logic (§1) is the same pattern one level down**: don't try to
   interpolate through a discontinuity at all — detect it, snap, and only resume smoothing
   after.

This matches what ADR-0006 already does for the *remote*-Character case: `interpolateState`
"snaps (no blend) on any `motionState` change, since the body being drawn swaps." Nothing in the
primary-source material gives grounds to handle the *local, predicted* Character any
differently for the state-machine axis — the only new work reconciliation adds is on the
continuous axis (position/velocity of whichever body — capsule or ragdoll bones — is currently
authoritative).

---

## Recommendation for this project, in detail

Given: solo dev, first netcode implementation (M2), 2–12 players, and a physics character
controller whose "state" is a discrete machine plus an articulated ragdoll, not just a
transform:

1. **Local replay is close to free here and should be the backbone.** ADR-0005 already requires
   the shared `(state, inputs) -> state` step to exist and be identical on client and server —
   that is the entire prerequisite for Bernier/Fusion/Unity-style replay. Buffer the local
   player's own inputs per tick; on receiving a snapshot for a tick the client has already
   simulated past, reset to the server's state at that tick and re-run the buffered inputs
   since. This fixes the common case — small drift from network jitter or a missed edge case in
   client logic — with no visible artifact at all, which matters most since this is a first
   netcode pass and most divergences at 2–12 players over a short match will be minor, not
   Impact-driven.
2. **Budget resimulation cost like Unity's own number, not like a transform lerp.** Each
   resimulated tick is a real Rapier step on a capsule (plus, while not `Controlled`, an
   articulated ragdoll) — at 30Hz that's a meaningfully heavier "~22 ticks in one frame" moment
   than Unity's own transform-only entities. At this project's scale (2–12 players, on-demand
   servers per ADR-0002) this is very likely fine, but it's worth an explicit perf check before
   assuming it is.
3. **Snap the state machine, never smooth it.** When a reconciliation reveals
   `Controlled → Ragdoll` (or any other transition) that the client didn't predict, apply it
   immediately and exactly, the same tick the correction is discovered — matching ADR-0006's
   existing remote-entity precedent and every primary source surveyed. Do not attempt to
   interpolate "50% ragdolled." This isn't a compromise: for this specific game, the ragdoll drop
   *is* the payoff beat ADR-0006 calls "the game's identity" — a hard snap into ragdoll reads as
   the intended impact, not a netcode glitch, the same way a fighting-game hitstun snap reads as
   impact rather than lag.
4. **Reserve positional error-smoothing (§2) for the continuous residual, and treat it as
   optional M2 polish, not a blocker.** After replay, whatever small position/rotation error is
   still visible on the capsule (or, during `GettingUp`, the blend target) is the only thing
   worth feeding through a short (Valve's `cl_smoothtime`-style, a few ticks at 30 Hz) error-offset
   decay — never apply it across a `motionState` boundary. Given this is a first netcode
   implementation, it's reasonable to ship M2 with replay + hard state-snap alone, see how
   visible the residual continuous pop actually is at this game's speed and camera distance, and
   add the smoothing layer only if it's actually needed — consistent with shipping the
   Bernier-era baseline first and adding Source-era smoothing later, which is the same order
   Valve itself did it in.

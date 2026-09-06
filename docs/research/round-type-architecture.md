# Round types over a shared, predicted simulation — where mode rules are allowed to live

Sixteenth file in `docs/research/` (convention: primary-source notes that feed a decision but are
not themselves an ADR). It builds on:

- ADR 0003 (snapshot netcode, predict own Character only, **no rollback**, Rapier not
  cross-machine deterministic), ADR 0005 (the shared `(state, inputs) -> state` step)
- ADR 0039 (Finish Zone is a Module trigger; Qualification is "a pure function of position +
  phase, derived identically on both sides"), ADR 0040 (Match phase is server-authoritative and
  rides the snapshot)
- `packages/shared/src/simulation/RapierSimulation.ts` (the 811-line façade), `CharacterController.ts`
  (1128 lines), `packages/shared/src/match/MatchPhase.ts`

**Question.** M4 ships one Round type (Race). Survival ("last one standing" — a Fall eliminates)
and a collapsing-floor Round change rules the simulation currently hardcodes: respawn-on-Fall,
Qualification-by-Finish-Zone, and when a Round ends. The hard constraint is that the step in
`packages/shared` runs on *both* sides, so a per-mode rule cannot be server-only logic.

---

## Recommendation (summary; argued below)

1. **Split the rule surface in two, along the prediction boundary — not along "mode".** Every
   shipped engine surveyed draws the same line, and none of them draws it where "Round type"
   would suggest:
   - **Simulated rules** — anything that moves a body, or that the local player must *feel*
     without waiting a round-trip. Lives in the shared step. May vary per mode, but only by
     reading **replicated data passed in as a parameter**, never by reading server-only state.
   - **Authority rules** — who scored, who is eliminated, when the Round ends, where you respawn.
     Lives server-only; the *result* is replicated and the shared step reads only the result.
2. **`RoundRules` is a data record in `packages/shared`, not a subclass.** Hand it into
   `RapierSimulation`'s constructor and into `tick()`'s inputs the way Quake hands `gametype` and
   `dmflags` into `pmove_t` — the identical value on both sides, delivered over the wire.
   ([`bg_public.h:161–191`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_public.h#L161-L191);
   trace below.)
3. **Elimination is an authority rule; the *loss of control* that follows it is a simulated
   rule.** They are two different things and both Quake and Source separate them. Argued in §4.
4. **Do not make the Fall→respawn *mechanism* mode-varying.** Make its *destination* data: a
   Race respawns at `progress.respawnPoint`; Survival respawns nowhere and instead latches a
   shared `Eliminated` motion state that zeroes input, exactly as `finishTick` already zeroes
   input today (`RapierSimulation.ts:506–517`). Same code path, different data.
5. **Nothing that decides tick count, iteration order, or which code runs may vary per mode**
   between client and server. §5.
6. Q2 (splitting the big files): **primary sources are genuinely thin.** The only seams shipped
   engines consistently make in a character controller are the collide-and-slide kernel and the
   saved-move/reconciliation bookkeeping — and DON'T FALL already has the second one. §7.

---

## 1. What shipped engines actually do

### 1a. Unreal — GameMode is server-only, which *disqualifies* it as a model here

Epic's own documentation is unambiguous:

> "The Game Mode is not replicated to any remote clients that join in a multiplayer game; it
> exists only on the server."

and, for what it owns:

> "these rules include: The number of players and spectators present … How players enter the game,
> which can include rules for selecting spawn locations and other spawn/respawn behavior."

> "While the Game Mode exists only on the server, the Game State exists on the server and is
> replicated to all clients"

— [Game Mode and Game State in Unreal Engine](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-mode-and-game-state-in-unreal-engine)
(Epic, first-party).

**Read this as a negative result, and it is the whole point of the section.** Unreal can afford to
put spawn/respawn policy in a server-only object *because Unreal never asks a client to predict it*:
`UCharacterMovementComponent` predicts movement, `AGameMode` decides respawns, and the two never
meet in predicted code. If DON'T FALL copied the GameMode shape literally — a `RoundRules` object
living only in `apps/server` — the client could not predict the very thing that makes Survival feel
different from Race. Copy the split, not the location.

Unreal's own predicted subsystem draws the same line internally: Epic's `FPredictionKey` reference
enumerates what a client may predict — "Initial GameplayAbility activation", "GameplayEffect
application", "Gameplay Cue events", "Montages", "Movement" — and excludes GameplayEffect *removal*
([FPredictionKey](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Plugins/GameplayAbilities/FPredictionKey)).
The *activation* is predicted; the bookkeeping that resolves who won is not.

### 1b. Quake III — the strongest precedent, and it is checkable

Quake III's module split is `bg_` (both games), `g_` (server game), `cg_` (client game). The header
says so:

> "bg_public.h -- definitions shared by both the server game and client game modules"
> — [`code/game/bg_public.h:23`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_public.h#L23)

`bg_pmove.c` is the shared, replayed movement step — the exact analogue of DON'T FALL's
`CharacterController` + `RapierSimulation.tick()`. Two facts, both verified by grep against the
released source:

- **`bg_pmove.c` (2069 lines) and `bg_slidemove.c` (325 lines) contain zero references to
  `gametype`.** The predicted movement step does not branch on the game mode at all.
- The *only* shared file that branches on gametype is `bg_misc.c`, in one function, and it takes
  the mode **as an argument**:

  ```c
  /* Returns false if the item should not be picked up.
     This needs to be the same for client side prediction and server use. */
  qboolean BG_CanItemBeGrabbed( int gametype, const entityState_t *ent, const playerState_t *ps )
  ```
  — [`bg_misc.c:1033–1039`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_misc.c#L1033-L1039),
  branching on `GT_1FCTF` / `GT_CTF` / `GT_HARVESTER` at
  [L1129–L1163](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_misc.c#L1129-L1163).

  The comment is the design rule stated by its author. And the callers close the loop:
  the server passes its own cvar,
  [`g_items.c:428`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_items.c#L428)
  `BG_CanItemBeGrabbed( g_gametype.integer, … )`; the client's *prediction* path passes the
  replicated copy,
  [`cg_predict.c:276`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_predict.c#L276)
  `BG_CanItemBeGrabbed( cgs.gametype, … )` — where `cgs.gametype` arrives as a serverinfo
  configstring:
  [`cg_servercmds.c:149`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_servercmds.c#L149)
  `cgs.gametype = atoi( Info_ValueForKey( info, "g_gametype" ) );`

**The same pattern for a plain rule flag.** `pmove_t` carries `noFootsteps` — "true if the game is
setup for no footsteps by the server". The server writes it from `g_dmflags`
([`g_active.c:919`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_active.c#L919)),
the client writes the identical field from the replicated `cgs.dmflags`
([`cg_predict.c:457`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_predict.c#L457)),
and the shared step reads only `pm->noFootsteps`
([`bg_pmove.c:1410`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L1410)).
`pmove_t` even takes the world-query surface as function pointers — "these will be different
functions during game and cgame"
([`bg_public.h:189`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_public.h#L189)).
That is the whole recommended architecture, shipped in 1999: **one shared step, one input struct,
every environment- and mode-dependent knob written into that struct identically on both sides.**

Meanwhile the things a Round type changes in DON'T FALL sit on the server side of Quake's fence.
`respawn()` is in
[`g_client.c:499`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_client.c#L499)
(server game module only); `CheckExitRules()` — "when does the round end" — is at
[`g_main.c:1292`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_main.c#L1292),
and *that* is where the dense gametype branching lives (fraglimit vs capturelimit, L1336 / L1367).
`g_main.c` alone has 24 `gametype` references; `bg_pmove.c` has 0.

### 1c. Source engine — `gamerules` is literally in `game/shared/`, and split by `#ifdef`

Valve's answer is the same line drawn with a preprocessor. `CGameRules` lives in
[`src/game/shared/gamerules.h`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamerules.h)
— compiled into *both* client.dll and server.dll — and the file is explicitly sectioned:

- L121 `// Stuff shared between client and server.` → damage-type queries
  (`Damage_IsTimeBased`, `Damage_ShouldGibCorpse`), `SwitchToNextBestWeapon`,
  **`virtual bool ShouldCollide( int collisionGroup0, int collisionGroup1 );`** (L147), `DefaultFOV`.
  These are simulation-affecting and mode-varying, and they are on both sides.
- L191 `#ifdef CLIENT_DLL` … L208 `#else` → everything from L218 to L410 is server-only, and it is
  precisely our list: `virtual void Think()` (L232, "runs every server frame"),
  `// Client spawn/respawn control` (L291) with `PlayerSpawn`, **`FPlayerCanRespawn`**,
  `FlPlayerSpawnTime`, `GetPlayerSpawnSpot`; `// Client kills/scoring` (L303) with
  `IPointsForKill`, `PlayerKilled`.
- The bridge is an entity: `class CGameRulesProxy : public CBaseEntity` (L88), commented
  "This class has the data tables and gets the CGameRules data to the client." The mode's *data*
  is replicated so the client's `C_GameRules` can answer the shared queries.

Two checkable corroborations:

- **`src/game/shared/gamemovement.cpp` — 4951 lines, also in `game/shared/`, makes zero calls to
  `GameRules()`.** Independently of Quake, Valve's predicted movement step does not consult the
  game mode either.
- Round structure: `CTeamplayRoundBasedRules`
  ([`teamplayroundbased_gamerules.h`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/teamplayroundbased_gamerules.h))
  keeps `CNetworkVar( gamerules_roundstate_t, m_iRoundState )` (L582) plus
  `m_flStateTransitionTime`, `m_nRoundsPlayed`, `m_flCountdownTime` — replicated. The client gets a
  plain `void SetRoundState( int )` fed by replication (L165–L171), while every transition hook —
  `SetupOnRoundStart` (L298), `TimerMayExpire` (L338), `RoundRespawn` (L479) — sits inside the
  single `#ifdef GAME_DLL` block opened at L290. **This is ADR 0040 arrived at independently**:
  phase is server-owned, replicated, read everywhere.
- Valve has explicit machinery for "this must not happen during prediction":
  `IPredictionSystem::SuppressEvents` / `SuppressHostEvents`, filtering out the local player during
  client prediction, "including not sending network data to the local player from the server if
  needed"
  ([`ipredictionsystem.h:18–22`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/ipredictionsystem.h#L18-L22)).

**Where the sources disagree: only on *packaging*.** Quake passes mode as a scalar parameter into
free functions; Valve uses a shared virtual hierarchy with `#ifdef`-gated halves; Unreal uses two
objects with different replication lifetimes. All three agree on the *cut*. Take Quake's packaging —
closest to what `packages/shared` already is (free functions plus a config record), and a virtual
hierarchy buys nothing in TypeScript, where `#ifdef` does not exist and the "both DLLs" problem is
already solved by the module graph.

---

## 2. Mode as data vs mode as code

**Mode as data, in the sense that matters here, is not optional** — the mode value must cross the
wire and be readable inside the shared step (settled by §1). The open question is only whether the
*behaviour* is also data.

The strongest first-party evidence for "mode as data" is Epic's Lyra: "Experiences are defined
using a **LyraExperienceDefinition** class", with "Team Death Match and Control Points both
us[ing] the ShooterCore plugin and … derived from the same parent class", an Experience being
"a much more advanced version of a GameMode" whose scoring model differs per Experience
(Elimination vs Capture)
([Lyra Sample Game](https://dev.epicgames.com/documentation/en-us/unreal-engine/lyra-sample-game-in-unreal-engine)).
Behind it, Game Feature plugins compose gameplay out of a `GameFeatureData` asset plus **Actions** —
the shipped set being *Add Cheats, Add Components, Add Data Registry, Add Data Registry Source, Add
World Partition Content*
([Game Features and Modular Gameplay](https://dev.epicgames.com/documentation/en-us/unreal-engine/game-features-and-modular-gameplay-in-unreal-engine)).

**Read that action list carefully — it is where "mode as data" breaks down.** Every shipped action
is *composition*: attach a component, register a table, load content. None of them is "change the
rule for what happens when a body crosses the kill plane." Epic's data layer chooses **which code
runs**; the code itself is still code. Quake is the same: `gametype` is an integer in a
configstring, but `BG_CanItemBeGrabbed`'s CTF branch is a hand-written `if`.

So the formulation to adopt: **data decides *which* rules apply and with *what* parameters**
(kill-plane behaviour `"respawn" | "eliminate"`, Qualification predicate, time limit,
floor-collapse schedule), while **code implements each rule once, in `packages/shared`,** from a
closed and enumerable set.

Both extremes break. Pure "mode as data" becomes a config format that grows into a scripting
language with no type checking and no determinism story. Pure "mode as code" — a
`SurvivalSimulation extends RapierSimulation` — makes the *subclass identity* state the client must
agree about before it can predict, and subclass dispatch is invisible to the reconciliation code
that has to prove client and server ran the same thing. A `RoundRules` **record**, chosen by a
`roundType` discriminant that rides the snapshot exactly as `phase` does under ADR 0040, sits in
the middle and is what both Quake and Valve actually ship.

---

## 3. ECS / data-driven systems, and what determinism costs

DON'T FALL is not an ECS and this note does not recommend becoming one. Recorded because the
question was asked, and because the determinism costs are the interesting part.

Blizzard's Timothy Ford, *"Overwatch" Gameplay Architecture and Netcode*, GDC 2017
([GDC Vault](https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)), is the
canonical talk. Its official abstract — "'Overwatch' uses a cutting-edge Entity Component System
(ECS) architecture to create a rich variety of gameplay … Blizzard's team leverages ECS to curtail
complexity, even as they continue to add new crazy features" — is **the only content from it cited
here.** I did not obtain the video, a transcript, or the slides; the widely-repeated claims about
it (gameplay netcode confined to ~3 systems of hundreds, 16 ms command frames) are second-hand and
are deliberately not used.

The determinism costs, by contrast, are documented first-party by Unity:

- **System *ordering* is constrained, not guaranteed.** "By default, Unity creates systems in an
  order that doesn't respect system groups, but does respect `CreateAfter` and `CreateBefore`
  attributes", `UpdateBefore`/`UpdateAfter` "only apply relative to direct children of the same
  system group", and a group "re-sorts the system update order for that group before updating
  again" whenever a system is added
  ([Systems update order](https://docs.unity3d.com/Packages/com.unity.entities@1.3/manual/systems-update-order.html)).
  Order is whatever satisfies the declared constraints — so *any* per-mode change to the set of
  systems can silently change the relative order of the systems that remain.
- **Unity's own netcode does not claim determinism.** "In general, Netcode does not guarantee
  determinism if you use unquantized values either. Fundamentally, Netcode is not a deterministic
  package"
  ([prediction details](https://docs.unity3d.com/Packages/com.unity.netcode@1.6/manual/prediction-details.html)),
  and, on the prediction contract, "It isn't necessary for the simulation itself to be fully
  deterministic, although this is something you should aim for (without achieving it) to reduce
  corrections"
  ([intro to prediction](https://docs.unity3d.com/Packages/com.unity.netcode@1.6/manual/intro-to-prediction.html)).

**Applied to DON'T FALL:** the ECS lesson to steal is not the architecture, it is the hazard.
Toggling *systems* per mode makes the executed program mode-dependent, and the executed program is
the thing prediction is trying to keep identical. Toggling *data* inside a fixed program does not.
This is the same conclusion §1 reached from the engine sources, from the opposite direction.

---

## 4. Is elimination-vs-respawn a simulation rule or a match-authority rule?

**Both, and the split is not where the phrasing suggests. The decision is authority; the resulting
loss of control is simulation.** The argument, from sources:

1. **Every surveyed engine puts the respawn decision on the authority side.** Valve makes it a
   pure virtual behind `#else`/server-only: `virtual bool FPlayerCanRespawn( CBasePlayer * ) = 0;`
   and `virtual float FlPlayerSpawnTime( CBasePlayer * ) = 0;` under the comment
   `// Client spawn/respawn control` (`gamerules.h:291–295`). Quake's `respawn()` is in `g_client.c`,
   which the client game never links. Epic lists "spawn/respawn behavior" among the rules of the
   server-only GameMode. Three independent engines, no dissent.
2. **The reason is not tradition, it is that the decision is not a pure function of the local
   player's own input history** — which is the exact precondition for prediction. Elimination in
   Survival depends on the *set of living players*, i.e. on other Characters, which ADR 0003 says a
   client explicitly does not simulate ("Predicting all entities on every client causes desync
   exactly where it hurts most — Character-to-Character collisions"). A client that predicts "I was
   the last one and I won" is predicting a fact about entities it does not own.
3. **But the visible consequence must be predicted, or the mode feels broken.** DON'T FALL already
   proves this and has an ADR for it: ADR 0039's Qualification is deliberately derived in the
   shared step so "a client's own prediction lock[s] at the same Tick, so it never runs half an RTT
   past the finish before being yanked back" (`RapierSimulation.ts:506–517`). Elimination is the
   same shape — you crossed the kill plane, that is a pure function of *your* position, and both
   sides can see it on the same tick.

So the rule decomposes:

| Question | Where | Why |
|---|---|---|
| Did this Character cross the kill plane on tick N? | **shared step** (already: `detectFall`) | pure function of own position; both sides see it identically |
| Does crossing it respawn or eliminate? | **shared data** (`RoundRules.onFall`) | a replicated constant for the whole Round; identical on both sides for every tick |
| Where does it respawn to? | **shared step** (already: `progress.respawnPoint`) | pure function of Checkpoint history |
| Is this Character now out of the Round for scoring? | **server** | it is a Match-authority fact; rides the snapshot as ADR 0040's `qualified` map does |
| Does an eliminated Character still collide / get shoved? | **shared step** | it is physics; must be predicted so other players' shoves feel right |
| Has the Round ended? | **server** (`CheckExitRules` precedent) | depends on all Players, connection state, DNF — none of it predictable |

The `onFall` discriminant is a **constant for the duration of a Round**. That is what makes it
safe: it is not per-tick mode-varying state that could disagree mid-replay, it is a value latched
before COUNTDOWN and carried in the snapshot, exactly as `timeLimitMs` already is (ADR 0038).

---

## 5. Determinism hazards specific to per-mode branching under predict + reconcile

DON'T FALL's "deterministic" is the ADR 0003 kind, not the Fiedler lockstep kind. Fiedler's bar —
"given the same initial condition and the same set of inputs your simulation gives exactly the same
result … Exact down to the bit-level", and the warning that this is "probably not even deterministic
between debug and release builds due to floating point optimizations"
([Deterministic Lockstep](https://gafferongames.com/post/deterministic_lockstep/)) — is explicitly
off the table per ADR 0003/0005. What we need instead is the Unity Netcode bar: aim for identical
so that *corrections stay small and rare*, and let the authority fix the residue.

That reframes the hazard list. A per-mode branch is dangerous not when it produces a slightly
different float, but when it produces a **structurally** different outcome the reconciler cannot
converge on. Concretely, the following must **not** be mode-varying between client and server:

1. **Tick count and step count.** Whatever a mode does, `world.step()` must still be called exactly
   once per tick for everyone. A mode that skips a step for eliminated Characters desynchronises
   the step counter that reconciliation is indexed by — the exact class of bug already diagnosed
   and fixed in `m2-prediction-reconciliation-loop.md` §1 / ADR 0027.
2. **Iteration order.** `RapierSimulation.tick()` iterates `this.characters` (a `Map`, insertion
   ordered) twice. A mode that *removes* eliminated Characters from that map changes the order in
   which bodies are queued into a single shared `world.step()` — and it changes it at a different
   tick on the client than on the server, because the client learns of the elimination later. Do not
   remove; mark.
3. **Set membership of simulated bodies.** Same reason: an eliminated Character must keep existing
   as a body on both sides for as long as its collider matters; the difference is whether it takes
   input, which is already a solved, shared, latched concept (`finishTick` → `IDLE_INPUTS`).
4. **Anything read from server-only state** — the literal restatement of §1. Unity's phrasing of
   the same constraint: predicted systems may only read data that has been network-replicated
   ([intro to prediction](https://docs.unity3d.com/Packages/com.unity.netcode@1.6/manual/intro-to-prediction.html)).
5. **Anything that changes *mid-Round*.** The `qualified`-lock precedent works because
   `finishTick` is monotonic and latched. A collapsing-floor Round's terrain schedule must be the
   same kind of thing: a **pure function of the tick** and of authored data, in the shared package —
   the pattern `Spinner` already uses (`RapierSimulation.ts:501`, "a pure function of the tick", and
   ADR 0025). A server that broadcasts "tile 47 is gone now" and a client that removes it on receipt
   will mispredict every fall onto tile 47 for the whole of one RTT.

Hazards that are *tolerable*, given no rollback:

- Divergence in **discrete** per-mode state (eliminated / qualified) is fine, because ADR 0013's
  rule already handles it: smooth continuous state, **snap** discrete state. An elimination that
  the client latched a tick early or late snaps, and snapping a state change nobody can act on is
  invisible.
- Divergence in the *scoring consequence* is fine because the client never computes it.

---

## 6. The concrete shape for DON'T FALL

Nothing below needs a new mechanism — every piece already exists in the codebase; it is a rename
plus a parameter.

```ts
// packages/shared/src/match/RoundRules.ts — plain data, rides the snapshot next to `phase`
export type RoundType = "Race" | "Survival" | "CollapsingFloor";

export interface RoundRules {
  readonly type: RoundType;
  /** What crossing the kill plane does. Constant for the Round. */
  readonly onFall: "respawn" | "eliminate";
  /** What grants Qualification. */
  readonly qualifyBy: "finish-zone" | "survive";
  /** Authored, tick-indexed, pure function of tick — never a server event. */
  readonly floorSchedule?: FloorCollapseSchedule;
}
```

- `RapierSimulation` takes `RoundRules` in `SimulationConfig` and never branches on anything else.
- `detectFall` becomes: detect (unchanged) → `rules.onFall === "respawn" ? character.fall(...)
  : progress.eliminatedTick ??= this.tickCount`.
- The input lock generalises from `finishTick !== null` to `finishTick !== null ||
  eliminatedTick !== null` — one predicate, one place (`RapierSimulation.ts:513–516`).
- Qualification stays a shared derivation (ADR 0039); "who advances" and "has the Round ended" stay
  server-only (ADR 0040 / Quake's `CheckExitRules`).
- Floor collapse is authored on the Module and evaluated as `f(tick)` in the shared step, alongside
  `Spinner`.

The one genuinely new ADR-worthy decision: **`RoundRules` must be latched before COUNTDOWN and
replicated in the same message that already carries `phase`**, so no tick is ever simulated by one
side under rules the other side does not yet hold. That is Quake's `cgs.gametype` configstring
(`cg_servercmds.c:149`) with different words.

---

## 7. Q2 — where to cut a 1128-line controller and an 811-line façade

**Primary sources are thin here, and I am not going to pad them.** There is no engine
documentation, GDC talk, or published source that gives a size threshold or a decomposition rule
for a character controller. What the *sources themselves* demonstrate, by their own shape, is
narrow but real:

**(a) Shipped engines do not split the character controller by size.** `src/game/shared/gamemovement.cpp`
in Source SDK 2013 is **4951 lines in one file**; Quake III's `bg_pmove.c` is **2069 lines** and
holds 36 `PM_*` functions. Both are 2–4× the size of `CharacterController.ts` and neither was cut.
This is evidence *against* splitting for line count, and it is about as direct as primary evidence
on this question gets.

**(b) The one seam both engines do make is the collide-and-slide kernel.** Quake pulls it into its
own file, 325 lines, `PM_SlideMove` / `PM_StepSlideMove`, zero mode awareness, with the interface
contract stated in the header comment — "input: origin, velocity, bounds, groundPlane, trace
function / output: origin, velocity, impacts, stairup boolean"
([`bg_slidemove.c:1–20`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_slidemove.c#L1-L20)).
The DON'T FALL analogue is `CharacterController.resolveCollisions()` (L816–L884) plus the
ground-normal selection it does — already a coherent unit, and the one extraction with engine
precedent behind it.

**(c) The second seam is the reconciliation/saved-move bookkeeping.** Quake separates it as
`pmove_t` — a struct that is *entirely* the in/out surface of the step, including the "different
functions during game and cgame" callbacks (`bg_public.h:189`); Unreal separates it as
`FSavedMove_Character` / `FNetworkPredictionData_Client_Character`. **DON'T FALL already has this
seam**: `snapshot()` (L953), `reconcileTo()` (L1025), `ReconcileBase` — ~170 lines of the 1128, and
the least entangled part of the file.

**(d) Everything else is a judgement call with no primary source.** The repo has already made the
extractions with local precedent — `JumpController`, `DashController`, `SpeedPadController`,
`CharacterStateMachine`, `Ragdoll`, and `movementVerbs.ts` (404 lines of pure functions). The
residual mass is `beginCapsuleTick` (L556–L816, ~260 lines), a *dispatcher* over those verbs.
Quake's `PmoveSingle`
([`bg_pmove.c:1836`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c#L1836))
is the same thing, likewise long, likewise not split. **No primary source recommends cutting it,
and it should not be cut on line count alone.**

For `RapierSimulation.ts` there *is* a source-backed cut, and it is the same cut Question 1 needs:
the trigger-detection cluster — `findTriggerIndex`, `updateCheckpoint`, `updateFinishZone`,
`updateSpeedPad`, `updateLaunchPad`, `detectFall` (L642–L736, ~95 lines) — is exactly the surface
where per-mode rules land, and it is the only part of the façade that Quake and Source would
recognise as "game rules" rather than "physics plumbing". Extracting it as a shared
`RoundRuleEvaluation(state, rules, tick)` unit serves the modularity goal and the Round-type goal
with one move. That is a design argument from §1's evidence, not a cited recommendation, and it
should be labelled as such.

**Explicitly not claimed:** that 1128 lines is too many; that any particular number is. No primary
source I found asserts either.

---

## 8. What I could not source

- **A verified account of Overwatch's per-mode ECS composition.** Only the GDC session abstract was
  obtainable; the video and slides were not, and I declined to cite secondhand summaries of them.
- **Valve's *Latency Compensating Methods* (Bernier, GDC 2001)** — the Valve Developer Community
  copy is behind bot protection (HTTP 403 / challenge page). Everything §1c attributes to Valve
  comes from the Source SDK 2013 source instead, which is stronger anyway.
- **Photon Quantum's determinism documentation** — `doc.photonengine.com` is behind a CDN challenge.
  Quantum's `SystemsConfig`-as-data-asset model would have been the best available first-party
  source for "which systems run is itself deterministic data"; it is asserted nowhere in this note
  because I could not read it.
- **`UCharacterMovementComponent` / `GameplayPrediction.h` source.** Epic's repository requires an
  authenticated account and the public API reference pages render their bodies client-side, so the
  Unreal claims here rest on Epic's prose documentation and the `FPredictionKey` reference page
  only. No line counts or code structure for Unreal are asserted.
- **Any primary source on module size thresholds.** See §7(d). None exists that I could find; the
  argument there is deliberately built from what engines *did*, not from what anyone *said*.

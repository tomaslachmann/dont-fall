# Codebase audit ahead of M5: oversized modules, misplaced logic, duplication, and the Round-type seams

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — see `docs/research/m2-netcode-transport.md` for the
> convention. This is a read-only inventory of the tree as it stands on branch
> `m4-match-structure` (last commit `c5d9a7d`, M4 ticket 06, plus ticket 07's
> **uncommitted working tree**: `packages/shared/src/match/Lobby.ts`, the lobby handlers
> in `apps/server/src/index.ts`, and `game.ts`'s `LobbySnapshot`/`onLobbyState`
> boundary — the Lobby *Screen* itself is still unbuilt).
>
> **Line numbers are against committed `HEAD` (`c5d9a7d`), not the working tree**, because
> another session is editing `apps/client/src/game.ts` and `CONTEXT.md` live; citing a
> moving file would make this note wrong within the hour. Where the uncommitted work
> changes a finding, it is called out inline (§1.4, §4.1, §4.3, §7). It is not itself a
> decision record — where an item
> would change settled architecture, the ADR it extends or supersedes is named
> inline, and adopting it means writing that ADR, not quietly doing it.
>
> **Read alongside `docs/research/round-type-architecture.md`.** That note (written in
> parallel) argues *where mode rules are allowed to live*, from primary sources. This one
> is the complementary inventory: it does not re-argue the design, it says exactly which
> lines encode the Race assumptions today (§4), which of them sit inside the shared
> deterministic step, and what is and is not protected by tests. Where the two touch, the
> other note is the design authority and this one is the map.
>
> **What this note deliberately does not do:** propose a rewrite. Most of what is
> below is small. Section 7 lists what is already correct and should be left alone,
> and it is longer than section 3 on purpose.

## Recommendation

**Three findings are worth acting on before Round types are designed; the rest is
housekeeping.**

1. **The client's predict/reconcile loop has no seam, so its regression suite tests a
   hand-maintained copy of it.** `apps/client/src/predictionRegression.harness.test.ts:6-8`
   says so in its own header — *"`main.ts`'s frame loop is a DOM/WebSocket closure with
   no seam, so this file ports the deterministic core of it"*. There are now **three**
   implementations of the reconciliation correction gate (`apps/client/src/reconcileGate.ts:35`,
   `apps/client/src/predictionRegression.harness.test.ts:359-371`,
   `packages/shared/src/simulation/RapierSimulation.test.ts:1850-1854`) and two of the
   three are already stale against production — the harness omits ADR 0026's
   hard-snap-vs-epsilon split as production expresses it and both test copies omit the
   `finishTick` term that M4 ticket 02 added (`reconcileGate.ts:39`), while
   `RapierSimulation.test.ts:1854` still uses `positionError > 0.2`, the
   `RECONCILE_POSITION_ERROR` threshold **ADR 0026 retired**. Extracting the loop is the
   single highest-value refactor in the tree.
2. **"This Character's input is locked" is implemented twice, at two layers, by two
   mechanisms** — Qualification's lock inside the shared deterministic step
   (`RapierSimulation.ts:513-516`), and the phase lock outside it, substituted
   independently by the server (`apps/server/src/index.ts:652,672`) and the client
   (`apps/client/src/game.ts:494-500`). Every Round type that changes who may move
   (eliminated-and-spectating, frozen-on-collapse) lands on this fork.
3. **Nothing in the tree knows what kind of Round it is running.** `SimulationConfig`
   (`RapierSimulation.ts:68-121`) has no Round-rules field; `MatchState`
   (`MatchPhase.ts:13-21`) has no Round type and no Round index; `advanceMatchPhase`
   hardcodes the one ending (`MatchPhase.ts:112`). The Race rules are not *scattered* —
   they are, encouragingly, concentrated in about six places, all cited in §4 — but four
   of them sit inside the shared deterministic step and so must be changed as
   client/server-identical data, not as server policy.

Ranked backlog with cost estimates is in §6.

---

## 1. Oversized modules

Six files, 4786 lines between them. For each: what is actually inside, the seams, and —
the part that usually goes unwritten — **what gets harder** after the split.

### 1.1 `packages/shared/src/simulation/CharacterController.ts` (1128 lines)

**What is inside.** Only ~430 lines are executable; the rest is doc comment, and the
comments are load-bearing (they carry the empirical findings behind M3.6/M3.7 tuning).
By region:

| Region | Lines | What it is |
|---|---|---|
| Impact/collision types + `wallImpactKnockback` | 50-102 | Pure, exported, separately tested |
| `CharacterState` (the snapshot shape) | 104-131 | Data contract, mirrored in `SimState.ts:20-116` |
| Field block | 143-287 | 30 fields, ~145 lines, ~70% doc |
| Rapier construction | 288-328 | Capsule, controller, snap-to-ground, slope angles, ragdoll |
| Externally-set per-tick Surface/Volume inputs | 351-372 | Six setters `RapierSimulation` calls each tick |
| One-shot trigger entries | 381-433 | `triggerSpeedPad`, `triggerLaunchPad`, `applyImpact`, `fall` |
| Tick split | 435-513 | `beginTick` / `endTick` / `tick` |
| **The velocity pipeline** | 515-794 | `consumePendingSpeedPadBoost` + `beginCapsuleTick` — **279 lines, one method 239** |
| Collision resolution | 796-882 | Ground pick, wall Impact, `onCollision` fan-out |
| Down-state lifecycle | 884-951, 1113-1120 | `beginRagdoll`, `beginGettingUp`, `respawnAtCheckpoint`, `returnToControlled` |
| `snapshot()` | 953-994 | Reads capsule *or* ragdoll depending on state |
| `reconcileTo` | 996-1111 | 87 executable lines of "what a correction must reset" |

**Seam A — the velocity pipeline (`CharacterVelocityStep`).** `beginCapsuleTick`
(556-794) is one ordered pipeline with a documented precedence:
jump takeoff (563) → dash burst (571) → speed-pad cap tick (578) → Surface-scaled walk
target (585) → *either* Sliding's slope-gravity integration (595-626) *or* gravity +
slope multiplier + `accelerateVelocity` (627-699) → launch-pad SET overriding everything
(701-710) → Volume force on top of even that (712-721) → Rapier sweep (728-735) →
ground-stick / bounce (740-781). The whole thing reads eight instance fields and writes
`this.velocity` in place. Extractable as a pure
`(velocity, inputs, surface, volume, pending) -> velocity` function returning a new
vector, with `movementVerbs.ts` (404 lines, 353 lines of tests) as the proven precedent
— `accelerateVelocity`, `slopeSpeedMultiplier`, `applyVolumeForce`, `dashEnvelope` and
the three controllers already live there and are directly tested
(`movementVerbs.test.ts`).

*What gets harder.* The ordering **is** the semantics, and today it is one screen of
code with the reasoning inline — "a launch pad's SET overrides EVERYTHING computed
above" (702-707) sits five lines from the code it describes. Split, "does the Volume
force apply before or after the launch pad's SET?" becomes a two-file read. Worse, a
pure-function boundary means constructing and returning `Vec3`s where today the code
mutates in place; any accidental aliasing across that boundary is a **client/server
divergence**, which is the one bug class this project cannot cheaply detect (ADR 0005
buys determinism per-machine, not cross-machine, so a divergence shows up as
"reconciliation keeps firing", not as a crash). Also, `beginCapsuleTick` is `private` and
has **no direct test** — every one of its behaviours is asserted through
`RapierSimulation.test.ts`'s full-physics integration tests, so the refactor is protected
end-to-end but not at the seam.

**Seam B — the down-state lifecycle (`CharacterDownState`).** `beginRagdoll` (884-896),
`beginGettingUp` (898-910), `respawnAtCheckpoint` (912-927), `returnToControlled`
(1114-1120), `getupBlendedPosition` (948-951) and `snapshot()`'s down branch (961-975)
are one cohesive cluster owning `this.ragdoll`, `getupBones`, `getupStartTick`,
`getupStartRoot`, `respawnCount`, `ragdollEpoch`, `ragdollCause`.

*What gets harder.* All five call sites toggle `this.collider.setEnabled` (893, 908, 917,
1116) — the capsule collider's enabled flag would become state shared across two objects,
and the failure mode is a Character that ragdolls and never re-enables its collider,
i.e. permanently non-colliding. And `reconcileTo` calls `beginRagdoll`/`beginGettingUp`
directly (1038, 1042) after `machine.snapTo`, so the extracted object needs a
back-reference to the state machine or the reconcile path has to be re-expressed. This
seam is real but it should be second, not first.

**Seam C — `reconcileTo` (996-1111).** Not a code seam so much as a *documentation*
seam: 15 assignments each answering "what must a correction reset because the snapshot
does not carry it" (Surface handle 1064, ground normal 1065-1080, three Surface
multipliers 1081-1083, active Volume 1088, peak fall speed 1094, pending one-shots
1102/1108, jump bookkeeping 1109, pending respawn 1110). Every M3.6/M3.7 mechanic added a
line here and there is nothing that fails if the next one forgets. **The cheapest useful
change in this file is not an extraction at all**: give `ReconcileBase`
(`SimState.ts:167-180`) a sibling "non-replicated per-tick state" type whose fields are
exhaustively reset, so `tsc` catches the omission.

*What gets harder.* Nothing much — but it only pays off if the new type is genuinely
exhaustive, and a partial one is worse than none because it looks like a guarantee.

### 1.2 `packages/shared/src/simulation/RapierSimulation.ts` (811 lines)

**What is inside.** Three distinct responsibilities wearing one class:

| Responsibility | Lines | Notes |
|---|---|---|
| Rapier world + entity↔body maps | 171-286 | Statics, spinners, props, handle maps |
| Character collection + Bump | 288-407 | `addCharacter` (293-335) wires `onCollision` (298-320) |
| Reconciliation/replay entry points | 409-486 | Client-only in practice |
| **The tick** | 488-582 | Spinners, mirrors, `beginTick` × N, one `world.step()`, `endTick` × N, per-Character trigger updates, Surface/Volume resolution, Prop pinning |
| **Client-only prediction plumbing** | 211-234, 376-396, 556-630 | `followPoses`, `predictedProps`, `contactedProps`, `mirrors`, `syncMirrorCharacters`, `setPredictedProps`, `consumeContactedProps`, `applyAuthoritativePropState`, `syncPropsToSnapshot` — **~120 lines that never execute on the server** |
| **Round rules** | 38-66, 632-736 | `CharacterProgress`, `findTriggerIndex`, `updateCheckpoint`, `updateFinishZone`, `updateSpeedPad`, `updateLaunchPad`, `detectFall` |
| Renderer accessors | 757-782 | `getStatics`/`getCheckpoints`/`getSpinners`/`getProps` — **dead in production**, see §2.5 |

**Seam A — the Round rules (`RoundRules` / `TrackTriggers`).** `CharacterProgress`
(39-66) plus the five `update*`/`detect*` methods (647-736) are the entire "what happens
to a Character because of where it is on the Track" cluster: 105 lines, one data
structure, five call sites all inside `tick()`'s post-step loop (524-528). **This is also
the Round-type seam** (§4), which makes it the one extraction with a concrete pending
requirement rather than a tidiness argument.

*What gets harder.* `detectFall` (729-736) does not merely observe — it mutates the
Character (`character.fall(...)`, 735), and `updateSpeedPad`/`updateLaunchPad` call
`character.triggerSpeedPad`/`triggerLaunchPad` (705, 724). An extracted rules object
needs the Character collection, so it is not a leaf; it is a second object holding a
reference back into the first, and the "one shared `world.step()` between `beginTick` and
`endTick`" invariant (492-494) then spans three objects instead of one. Second cost:
today every one of these is exercised through the public `tick()` in
`RapierSimulation.test.ts` (3368 lines, 27 describe blocks) — moving them does not lose
coverage, but it does mean the tests keep testing the composition rather than the unit,
so the extraction buys structure without buying testability unless new unit tests are
written alongside.

**Seam B — client-only prediction plumbing.** ~120 lines guarded by `this.authoritative`
(318) or empty-on-server (`followPoses` 218, `mirrors` 209) live in the class both sides
run. A `PredictionWorld` wrapper is the obvious shape.

*What gets harder.* The Prop-pinning loop at 577-581 has a **documented same-tick
ordering interaction** with `onCollision`'s write to `contactedProps` (318): the comment
at 562-576 records that this exemption was dropped by ADR 0016, not restored by ADR 0022,
and had to be put back — i.e. this exact interaction has already regressed once. Moving
the pinning loop out of `tick()` makes that a cross-object invariant with no compiler
help. And every ADR from 0012 onward is written in terms of "the client's local
prediction `RapierSimulation`"; a wrapper class means the ADR vocabulary and the type
names stop matching. Net: worth doing eventually, not urgent, and it must not be done in
the same change as seam A.

### 1.3 `apps/server/src/index.ts` (799 lines)

**What is inside.** One `startServer` function (200-772) closing over ~18 mutable
bindings, plus two module-level helpers (`fetchTrack` 74-112, `truncateForCloseReason`
121-129).

| Region | Lines | Notes |
|---|---|---|
| `fetchTrack` + retry policy | 41-112 | Pure-ish; only needs a URL |
| Config/state declarations | 200-334 | `fetched`, `simulation`, `sockets`, `serverTick`, `roundStartTick`, `match`, `dnf`, `startRequested`, `roundEnding`, `finalTimeLeftMs`, `inputQueues`, `lastApplied`, `lastInputTicks`, `joinCount`, `lobbyPlayers` |
| Connection handler | 338-605 | Playtest `?track=` reload (340-421), mid-Round join refusal (439-442), registration (444-470), message router (477-589), close (591-603) |
| Lobby message handling | 508-588 | `setNickname`, `setReady`, `selectTrack`, `start` — **uncommitted ticket 07** |
| Tick loop | 607-754 | Phase decision (633-646), tick-addressed input (653-673), sim step (675), clock (696-707), Round endings (710-713), snapshot fan-out (715-746) |

**Seam A — `TrackSource`.** `fetchTrack` (74-112) plus `rebuildSimulationFor` (251-257)
plus the two near-identical reload paths (361-420 and 547-570) are one concern: "replace
the loaded Track atomically". The two reload paths already share a documented discipline
(build the replacement before disposing the original: 385-393 and 556-559) and both
perform the identical four-line reset (`serverTick = 0; roundStartTick = 0;
match = {...}` at 414-418 and 567-569). Extracting a `loadTrack(candidate)` that owns
that reset removes a genuine copy-paste (§3.1).

*What gets harder.* The atomicity is currently guaranteed by a *lexical* rule the comment
spells out — "Everything from here to the end of this `if` is synchronous (no `await`) —
the event loop cannot run another 'connection' handler in between" (380-383). Once the
body moves into a method, that guarantee becomes a convention about a function whose
callers are elsewhere, and nothing stops a future `await` being added inside it. If this
seam is taken, the no-`await` rule needs to become a comment on the extracted function
and ideally an assertion.

**Seam B — `InputRouter`.** `inputQueues`/`lastApplied`/`lastInputTicks`/`MAX_QUEUED_INPUTS`
(325-331), the enqueue/dedupe in the message handler (491-505), and the per-tick
tick-addressed consume (653-673) are one unit implementing ADR 0021 + ADR 0027, with
~50 lines of executable code and its own dedicated integration test
(`tickAddressedInput.integration.test.ts`, 438 lines).

*What gets harder.* Very little — this is the cleanest seam in the file. The one cost:
the honest-ack rule ("`lastInputTicks.set(id, thisTick)` unconditionally", 665-668) is
what ADR 0027 turns on, and it currently sits three lines from `tickInputs[id] = ...`
where the phase lock is applied (672); separating "which input" from "which tick was
acked" risks someone later making the ack conditional again, which is precisely the bug
ADR 0027 fixed.

**Seam C — `MatchLoop`.** The phase/clock/ending cluster (`match`, `roundStartTick`,
`dnf`, `startRequested`, `roundEnding`, `finalTimeLeftMs`, plus 633-646 and 694-713).

*What gets harder.* The loop's error discipline is a single `try` around everything
(628-753) with `serverTick` deliberately committed only after `simulation.tick` succeeds
(627, 676) and `match` committed only after that (683) — "a failed tick retries this
exact decision rather than advancing the Match past a Tick that never ran" (629-632),
with a regression test at `index.test.ts:251`. Splitting the phase decision into another
object means that commit-after-success ordering is enforced by call order across a
boundary rather than by adjacency. Given the server has **1534 lines of black-box tests
over real sockets** and no unit tests of its internals, this is a seam where the tests
would still pass while the invariant broke.

### 1.4 `apps/client/src/game.ts` (780 lines)

**What is inside.** `boot()` (124-780), one function, ~25 closure bindings.

| Region | Lines | Notes |
|---|---|---|
| Handshake + world construction | 128-219 | HUD, physics init, socket, welcome, Track fetch, stage, local sim |
| Prediction/reconciliation state | 221-294 | `inputBuffer` (225), `positionHistory` (226), `capsuleErrorOffset` (235), prop prediction (247), LEAD feedback (275-277) |
| `reconcile` | 296-390 | The ADR 0013/0015/0022/0023/0026 core; the gate call is at 329 |
| Socket handlers | 392-457 | Snapshot ingest, ping/pong, close |
| `sendInput` | 459-463 | ADR 0021 redundant tail |
| **`frame`** | 470-775 | 305 lines: input sampling (494), obstacle re-pin (530-548), LEAD (565-578), predict loop (556-597), prop prediction (613), render composition, camera, HUD string |

**Seam A — `PredictionLoop` (the one to do first).** Everything from `reconcile` (296-390)
plus the predict block (556-597) plus the LEAD feedback (565-578) plus `sendInput`
(459-463) is deterministic given `(elapsedMs, sampledInput, snapshots-in,
RapierSimulation)` — no DOM, no Three.js, no WebSocket. That is exactly the boundary
`predictionRegression.harness.test.ts:1-15` had to reconstruct by hand. Extracting it
makes the harness import the real thing instead of a copy, and collapses the three
correction gates (§3.1) to one.

*What gets harder.* The frame's **ordering** is load-bearing and currently guaranteed by
being one function: obstacle/mirror re-pin from the *interpolated* pose must happen
before the predict loop (523-548, with the sawtooth bug it fixes documented at 526-529),
and `consumeContactedProps` must be drained after it (607-613). Split, those become
documented call-order requirements. Second: `reconcile` writes
`renderPreviousSnapshot` (389) — a render-interpolation baseline — from inside the
network handler, so the extracted loop cannot be purely "sim-side"; it either returns
that baseline or the render layer keeps reaching into it.

**Note on the in-flight ticket 07 work.** The uncommitted `LobbySnapshot`/`onLobbyState`
addition (~69 lines) lands entirely in the shell-boundary and snapshot-ingest regions, not
in `reconcile` or the predict loop, so this seam analysis is unaffected by it — but it does
mean `game.ts` is now 849 lines in the working tree and grows again when the Lobby Screen
arrives. That strengthens seam A rather than weakening it.

**Seam B — the HUD text (716-769).** 54 lines building one template string mixing
gameplay reads (`checkpointIndex` 716, `fallCount`, `qualifiedCount`), netcode telemetry
(`netMetrics.format()`, 768) and controls help (767). Trivially extractable to a
`hudText(state)` alongside `matchBanner.ts`.

*What gets harder.* Genuinely nothing — this is a pure formatting function today in all
but name, and `matchBanner.ts`/`roundTimer.ts` are the precedent. Do it.

**Seam C — `boot`'s handshake (128-219).** Socket → welcome → Track fetch → resolve →
stage → local sim. Already partly extracted (`connection.ts`), and `teardown.ts` gives it
a clean acquisition discipline (`teardown.add` at 129, 136, 165, 167, 169, 205).

*What gets harder.* The teardown ordering is currently "reverse of acquisition, because
they are adjacent". A separate bootstrap module has to return a list of disposers whose
order is then a contract, and the failure mode is a leaked WebGL context — the exact
thing M4 ticket 01 exists to prevent (`scene.ts:560-562`, `teardown.test.ts`).

### 1.5 `packages/shared/src/tuning.ts` (703 lines, 104 constants, 20 sections)

**What is inside.** Roughly 85% doc comment. Sections at 27, 79, 144, 164, 197, 224, 229,
327, 332, 353, 425, 433, 438, 497, 516, 575, 599, 631, 652, 671. **Three of the 20 are not
tuning at all**: "Wire protocol v2" (599-629: `SNAPSHOT_HZ`, `GRACE_WINDOW_MS`,
`INTERP_RATIO`, `INPUT_REDUNDANCY`), "track-service fetch" (631-650), and the two M4
sections (652-703). Meanwhile `DEFAULT_SERVER_PORT`, `DEFAULT_TRACK_SERVICE_PORT` and
`NICKNAME_MAX_LENGTH` — the same kind of value — live in `net/protocol.ts:226-236`. There
is no rule distinguishing the two homes.

**Seam — split by domain**: `tuning/character.ts` (feel: 27-497), `tuning/netcode.ts`
(516-629, joined by the three constants currently in `protocol.ts`), `tuning/match.ts`
(652-703), `tuning/services.ts` (631-650). `packages/shared/src/index.ts:4` re-exports
with `export *`, so all 46 files that import from `@dont-fall/shared` — including the
37-name import at `apps/client/src/game.ts:1-39` and the 33-name one at
`apps/server/src/index.ts:4-38` — are unaffected.

*What gets harder.* Today `grep -n "^export const" tuning.ts` is a complete inventory and
the section headers double as a changelog of which ticket/ADR introduced each value
("M3.7 ticket 01, ADR 0035"). Four files lose that single view. There is also a real risk
of a constant being added to the wrong file and a near-duplicate appearing — the whole
reason CLAUDE.md's working agreements say tuning lives as named constants in one place.

**Honest assessment: this is the least urgent of the six.** The file is long but it is
not tangled, there are no cyclic imports, and a check of all 104 constants found exactly
one used only by tests (`ROUND_END_TICKS`, 703 — production reads `msToTicks(roundEndMs)`
from a parameter at `MatchPhase.ts:115`; `COUNTDOWN_TICKS` at 681 is the same story). No
dead tuning, no duplicated values. Do the netcode/services split only if something else
forces it.

### 1.6 `apps/client/src/scene.ts` (565 lines)

**What is inside.** One `createStage` factory (181-565): renderer/scene/camera/lights
(191-212), world geometry (214-285: statics, checkpoints, finish zones, spinners, props,
kill plane), the local Character rig (287-345: model scaling, wobble pivot, mixer, five
clip actions, `visualState`), remote-player capsules (306-312), camera raycast (347-357),
then ten returned methods (366-564).

**Seam A — `CharacterRig`.** `applyRenderState`'s down-state animation branch (369-435),
`updateCharacterAnimation` (475-542), the mixer/actions/`visualState`/`wobbleState`/
`previousWobblePosition`/`speedLines` cluster (314-345). That is ~150 lines with one
coherent job: drive the local Character's model. It is the only part of the stage with a
state machine of its own (`visualState`, 339).

*What gets harder.* `applyRenderState` also updates the Prop meshes (427-434) and the
comment at 425-426 records why they must be updated *immediately* rather than at
`render()`: `updateCamera` raycasts `collidables` before the frame draws. Splitting
character from props means that ordering constraint spans two objects. And `dispose()`
(543-563) is one walk of one scene graph plus one explicit pair
(`remoteGeometry`/`remoteMaterial`, 553-554) — three owners means three dispose paths and
three chances to leak a material, which is the class of bug M4 ticket 01 and
`disposeSceneGraph` (163-179) exist to prevent.

**Seam B — `WorldScene`.** Statics/checkpoints/finish zones/spinners/props/kill plane
(214-285) is a straight-line "build meshes from the resolved Track" block with no state
except `collidables` and the mesh arrays.

*What gets harder.* Little today — **but** this is exactly where collapsing-terrain
Rounds (§4.4) will need a *mutable* statics API, and doing seam B before that requirement
is understood risks freezing the wrong interface (an immutable `WorldScene` built once
from `StageConfig`, which is what the current shape already is).

---

## 2. Misplaced logic

### 2.1 A Round rule living in `apps/client`: `qualificationPlacement`

`apps/client/src/qualification.ts:18-29` computes standard competition ranking over every
Character's `finishTick`. Its two siblings — `allQualified` and `isEliminated` — are in
`packages/shared/src/match/Qualification.ts:16,32`. Placement is a Round outcome, not a
rendering: the Results Screen (ticket 08, unbuilt) needs it, and so does anything that
ever awards points. It is safe today only because it is a pure projection of replicated
`finishTick`, but ADR 0040's rule is "clients render `phase`… and never compute the end of
a Round themselves", and a placement number is squarely a computed Round outcome.

**Fix:** move to `packages/shared/src/match/Qualification.ts`. ~10 lines, no ADR needed
(it *strengthens* ADR 0040). Its test (`qualification.test.ts`, 41 lines) moves with it.

### 2.2 The correction gate lives in `apps/client` but is not netcode-app-specific

`apps/client/src/reconcileGate.ts:35-40` encodes ADR 0013 + ADR 0015 + ADR 0026 + M4
ticket 02 policy. It is well-factored and well-tested (52 lines of tests). The problem is
not where it lives but that **two other copies exist** that do not import it (§3.2).
Leave it in `apps/client` — only a client reconciles — but make it the only copy.

### 2.3 Two mechanisms for "input is locked"

- **Inside the shared deterministic step:** `RapierSimulation.tick` substitutes
  `IDLE_INPUTS` for any Character with `finishTick !== null`
  (`RapierSimulation.ts:513-516`), with an explicit rationale at 506-512 — doing it in the
  shared step is what makes the client's prediction lock on the same Tick.
- **Outside it, twice:** the server computes `phaseLocksInput(nextMatch.phase)` and
  substitutes `IDLE_INPUTS` before calling `simulation.tick`
  (`apps/server/src/index.ts:652,672`); the client independently substitutes `IDLE_INPUTS`
  when sampling (`apps/client/src/game.ts:494-500`). Both cite the identical reasoning as
  the Qualification lock.

One concept, two layers, three call sites. It works, and `phaseLocksInput`
(`MatchPhase.ts:64`) is correctly shared so the two outer copies agree. But the *reason*
given for putting Qualification's lock inside the sim applies verbatim to the phase lock,
and the next lock ("eliminated Players spectate", "frozen while the floor falls") has no
obvious home. **This is the seam Round types will hit first.**

**Fix (needs a new ADR extending ADR 0040):** feed the already-decided phase into the
shared step as a tick input, so the sim owns "may this Character act" in one place. The
phase would stay server-decided and snapshot-carried — ADR 0040's actual decision is
untouched — but `RapierSimulation.tick`'s signature changes, which is a real, reviewable
architectural change and must not be done silently.

### 2.4 Presentation values inside the deterministic snapshot (accepted, documented)

`dashing` and `dashSpeed` (`CharacterController.ts:118-121`, `SimState.ts:41-44`) exist so
the renderer does not have to derive them from position deltas; `dashSpeed` feeds exactly
one consumer, `scene.ts:540` (`speedLines.setIntensity(dashSpeed / DASH_SPEED)`).
`phaseStartTick` (`SimState.ts:105-110`) exists so the client can derive the GettingUp
blend. These are presentation concerns riding the wire.

**Verdict: leave them.** Both are documented with their rationale, both are cheap, and
the alternative (deriving from position deltas) is the exact bug that got Wobble disabled
(`scene.ts:45-53`). Noted only so a future reader does not "clean them up".

### 2.5 Renderer accessors on the authoritative simulation — dead in production

`RapierSimulation.getStatics/getCheckpoints/getSpinners/getProps` (757-782), plus the
three clone helpers they exist for (`cloneOrientedBox` 130, `cloneSpinnerConfig` 136,
`clonePropConfig` 141), have **no production caller**. The client builds its stage from
`resolveTrack(...)` directly (`apps/client/src/game.ts:152-164`). Their only references
are `RapierSimulation.test.ts:116,119`. ~40 lines of "for the renderer" API on the class
that is supposed to be side-agnostic, kept alive by its own tests.

**Fix:** delete, adjusting the two assertions. Trivial, and it removes a misleading
comment ("for the renderer") from the shared simulation.

### 2.6 The client re-derives nothing the server sends — checked, and it is clean

Explicitly checked, because it is the failure mode ADR 0040 warns about:

- Round clock: server-computed (`index.ts:696-707`), client only formats
  (`game.ts:723` → `roundTimer.ts:13`). ✅
- Countdown: server-computed (`index.ts:723` via `countdownMsLeft`), client renders
  (`game.ts:410`, `matchBanner.ts:37`). ✅
- Phase: server-owned (`index.ts:633,683`), client stores and renders (`game.ts:409`). ✅
- Qualification: **deliberately** derived on both sides — but identically, by the same
  shared code (`RapierSimulation.updateFinishZone`, 675-680), and the server's answer
  overwrites the client's on every reconcile (`RapierSimulation.ts:443-451`). ✅ This is
  the correct shape, and ADR 0039 says so.
- Elimination: derived on both sides from `phase` + `finishTick` via one shared function
  (`Qualification.ts:32`), nothing on the wire. ✅

The one asymmetry: `dnf` rides every snapshot (`protocol.ts:111`, `index.ts:740`) and no
client reads it (§3.5) — that is ticket 08's job, not a defect.

---

## 3. Duplication

Strictly filtered. Four items qualify; ranked by cost of divergence.

### 3.1 (b) **The prediction/reconciliation loop is implemented three times** — the dangerous one

| Copy | Location | Status |
|---|---|---|
| Production | `apps/client/src/game.ts:296-390` (reconcile) + `556-597` (predict) | Canonical |
| Regression harness | `apps/client/src/predictionRegression.harness.test.ts:236-470ish` | Hand-ported; header (6-8) admits it is a port; line refs stale ("as of commit 85d91d7", and to `main.ts`, since renamed `game.ts`) |
| Shared-package desync test | `packages/shared/src/simulation/RapierSimulation.test.ts:1844-1866` | Comment says "main.ts's reconcile(), post-ADR-0015" |

The correction gate specifically:

- `reconcileGate.ts:35-40` — five terms, including `server.finishTick !== local.finishTick`
  and `RECONCILE_POSITION_EPSILON` (0.02).
- `predictionRegression.harness.test.ts:359-371` — a `reason` string ladder; **no
  `finishTick` term**; carries its own `hardSnapM`/`reconcileEpsilon` options.
- `RapierSimulation.test.ts:1850-1854` — four terms, **no `finishTick` term**, and
  `positionError > 0.2`: the literal value of `RECONCILE_POSITION_ERROR`, the threshold
  **ADR 0026 explicitly retired** (the harness even keeps a named constant for it,
  `LEGACY_RECONCILE_THRESHOLD` at line 45, precisely because it no longer exists in
  `packages/shared`).

The harness also re-implements the **server's** tick-addressed input queue
(`harness:276-298` vs `apps/server/src/index.ts:491-505,653-673`) and the LEAD feedback.

**Cost of divergence: highest in the tree.** The regression suite that guards the most
subtle behaviour in the project (ADR 0013/0015/0021/0022/0023/0026/0027) is asserting
against a copy that has already fallen behind production by one M4 field. A future
prediction bug can be "fixed" in the harness and remain in the game.

**Fix:** seam A of §1.4 — extract the loop, have the harness drive the real one. Not
cheap (the harness is 1115 lines and its network model is genuinely useful), but the
first step is small: make both test copies import `needsCorrection` from
`reconcileGate.ts`. That alone kills the stale `0.2`.

### 3.2 (b) The Time Limit range is expressed three times, with two different policies

| Where | What it says |
|---|---|
| `packages/shared/src/tuning.ts:660,668,669` | `DEFAULT_TIME_LIMIT_MS = 180_000`, `MIN_TIME_LIMIT_MS = 10_000`, `MAX_TIME_LIMIT_MS = 30 * 60_000` |
| `apps/track-builder/index.html:95` | `<input id="time-limit" type="number" min="10" max="1800" step="5" value="180">` — the same three numbers, in seconds, hand-typed into markup |
| `apps/track-builder/src/timeLimitField.ts:22` | **clamps** out-of-range to the nearest legal value |
| `apps/track-service/src/validate.ts:38-40` | **rejects** out-of-range with a 400 |

Two problems, not one. First, the HTML attributes are a fourth, uncheckable copy — change
`MAX_TIME_LIMIT_MS` and the builder's spinner silently keeps the old ceiling. Second, the
builder clamps where the service rejects, and both files document their choice as
deliberate (`timeLimitField.ts:13-16` vs `validate.ts:29-32`) — so the rejection path in
the service is unreachable from the builder, the only writer that exists. That is not
wrong, but it means the service's validation is untested by any real caller.

`apps/track-builder/index.html:89` hardcodes `http://localhost:8081` — a fifth instance of
`DEFAULT_TRACK_SERVICE_PORT` (`protocol.ts:236`).

**Fix:** set the input's `min`/`max`/`value` from the shared constants at boot in
`main.ts`. ~5 lines. Cheap, and it is the textbook "constant repeated in HTML and TS".

### 3.3 (b) One HTTP response shape, three hand-written consumer views

`apps/track-service/src/store.ts:17-26` (`StoredTrack`) is the producer. Consumers each
declare their own:

- `apps/track-builder/src/api.ts:5-11` — `StoredTrackResponse` (4 of 7 fields)
- `apps/server/src/index.ts:92` — inline `{ id; revision; track; timeLimitMs? }`
- `apps/client/src/game.ts:151` — inline `{ track: Track }`

The precedent for the fix is already in the tree and explicitly documented:
`TrackListing` was promoted into `packages/shared/src/track/Track.ts:47-58` for exactly
this reason — *"Shared between track-service (the producer) and the Track builder (the
consumer) so the two never silently drift apart (code review, ticket 09 — this used to be
declared separately in each)"*.

**Cost:** moderate. The server already defends against drift by defaulting
`timeLimitMs` (`index.ts:98-101`), which is the right instinct and also the evidence that
drift is expected. **Fix:** promote `StoredTrack` to `packages/shared`, exactly as
`TrackListing` was. ~15 lines.

### 3.4 (a) The "is this Character down?" predicate, six copies

`packages/shared/src/simulation/CharacterController.ts:45`,
`packages/shared/src/simulation/RapierSimulation.ts:28` (`isDownState`),
`apps/client/src/reconcileGate.ts:6`, `apps/client/src/game.ts:281`, and twice more
inline at `game.ts:533` and `game.ts:646`; plus `scene.ts:381,444,498` in the visual
variant. Nine sites total, five distinct definitions.

**Cost: low but non-zero.** `Sliding` was added to `CharacterMotionState`
(`CharacterStateMachine.ts:34`) in M3.6 and correctly needed none of them changed. The
risk is the *next* state — a Round type that adds `Spectating` or `Eliminated` (§4)
almost certainly is "down" for some of these nine and not others, and there is nothing
to grep for.

**Fix:** one exported `isDownMotionState` next to `CharacterMotionState` in
`CharacterStateMachine.ts`; delete the rest. ~20 lines touched, zero behaviour change.

### 3.5 (c) Superficial — leave separate

- **`playgroundSpawn` (`playground.ts:35-40`) vs `trackSpawn` (`Track.ts:166-174`).** The
  same 4×3 grid arithmetic, twice. But `trackSpawn.test.ts:27-31` pins them equal, and
  `playgroundSpawn`/`PLAYGROUND_*` now have **no production caller** — only
  `predictionRegression.harness.test.ts` and `tickAddressedInput.integration.test.ts`.
  This is a well-managed duplicate: the test *is* the sync mechanism. The only real change
  worth making is honesty — `playground.ts` is a test fixture and should stop being
  re-exported from `packages/shared/src/index.ts:34` as public API.
- **`advanceFixed` (`timing/advanceFixed.ts:50-81`) vs `game.ts:556-597`.** The same
  accumulator/`EPSILON_MS`/`MAX_STEPS_PER_FRAME` clamp. But `advanceFixed` has no
  production caller at all (only `advanceFixed.test.ts`), and `game.ts` cannot use it: it
  needs a *different input per tick* plus the LEAD nudge (566-578), neither of which
  `advanceFixed`'s single-`input` signature can express. Either widen `advanceFixed` to
  fit the real loop or delete it and `FixedSimulation.ts` — but do not force them
  together. (`RapierSimulation` implements `FixedSimulation`, `RapierSimulation.ts:170`,
  purely decoratively.)
- **`render.ts`'s wireframe-box helpers** (`addCheckpoint` 51, `addFinishZone` 65,
  `addSpeedPad` 80, `addLaunchPad` 95, `addVolume` 120) look copy-pasted, and they are —
  but each carries a distinct colour and two carry an arrow. Five 6-line functions with an
  obvious shared helper would save ~20 lines and cost the per-marker doc comments that
  explain *why* each looks the way it does. Leave it.
- **`0xffd166`** appears in both `scene.ts:242` and `render.ts:24` as the Finish Zone
  colour, deliberately (`render.ts:59-63`: "the same colour the game itself draws the
  Zone"). Real duplication, negligible cost; a shared palette is a design-system question,
  not a refactor.

*(Stale reference spotted in passing: `render.ts:159` and `api.ts:46` both refer to
`playtest.ts`, a file deleted when Playtest was rewired to the real client/server —
`b832593`. Comment-only.)*

---

## 4. Round-type seams

The target Round types — **a Fall eliminates**, **terrain collapses**, **no respawn at
all** — each break one of three Race assumptions. Every place each is baked in, and which
side owns it.

The governing split: **the shared deterministic step must produce the same answer on both
machines** (ADR 0003/0005), so anything it decides must be *data both sides have* —
`SimulationConfig` at construction, or a tick input. **Server-only match authority**
(ADR 0040) can change freely; the client renders the result.

### 4.1 Assumption: a Fall always respawns at the last Checkpoint

| Site | Layer | What it hardcodes |
|---|---|---|
| `RapierSimulation.ts:729-736` (`detectFall`) | **Shared deterministic step** | Below `killPlaneY` → `fallCount += 1` → `character.fall(respawnPoint, fallCount)`. Unconditional. No other outcome is expressible. |
| `RapierSimulation.ts:39-42` (`CharacterProgress`) | **Shared** | `respawnPoint`, `checkpointIndex`, `fallCount` — the respawn model is the data model |
| `RapierSimulation.ts:647-658` (`updateCheckpoint`) | **Shared** | Advances `respawnPoint`; forward-only |
| `CharacterController.ts:428-433` (`fall`) + `478-479` + `912-927` (`respawnAtCheckpoint`) | **Shared** | Teleport + `respawnCount += 1` + ragdoll flop. ADR 0010: the penalty *is* the flop |
| `RapierSimulation.ts:253` / `tuning.ts:330` | **Shared** | One `killPlaneY` per simulation, fixed at construction |
| `SimState.ts:30-38` | **Wire** | `fallCount`, `respawnCount` replicated; `interpolate.ts:60` snaps on `respawnCount` change |
| `scene.ts:279-285` | Client presentation | Kill-plane visual, from `DEFAULT_KILL_PLANE_Y` passed at `game.ts:160` |

**The client predicts respawn.** `localSim.tick` (`game.ts:586`) runs the same
`detectFall`. So "a Fall eliminates" cannot be a server-side decision layered on top — if
the shared step still respawns, every eliminating Fall is a mispredict-then-correct, which
is the exact pattern ADR 0016 and ADR 0026 were both written to stop.

**Doctrine: half-amended, and the half that is left is now inconsistent.** `CONTEXT.md`
has just gained **Round type** and **Survivor Target**, redefined **Survival** as "a Fall
eliminates", and rewritten **Elimination** to *"What eliminates you is the Round type's
rule: in a Race a Fall never eliminates… in Survival it is exactly what does."* Three
neighbouring entries still state the Race rule as universal and now contradict it:

- **Fall** — *"Triggers a Respawn at the last Checkpoint with a time penalty"*, flatly.
- **Respawn** — *"a short time penalty so a Fall always costs something"*.
- **Round** — *"Ends by Qualification or Time Limit"*, which Survival's Survivor Target
  ending does not fit.

**ADR 0010 is untouched** and still makes the ragdoll recovery *the* Respawn penalty,
while noting M4 as the point to revisit. So a Fall-eliminates Round type still needs a new
ADR amending or superseding ADR 0010, plus the three glossary entries above brought into
line with the new **Elimination** entry. This is doctrine work, not implementation, and it
is cheap — but leaving a glossary internally inconsistent is worse than leaving it stale,
because CLAUDE.md's working agreements make it the naming authority.

### 4.2 Assumption: Qualification is entry into a Finish Zone

| Site | Layer | Note |
|---|---|---|
| `RapierSimulation.ts:675-680` (`updateFinishZone`) | **Shared step** | Latches `finishTick` on first containment; explicitly *not* skipped while down (670-673) |
| `RapierSimulation.ts:59-65` (`finishTick` on `CharacterProgress`) | **Shared** | One latch, no other qualification path |
| `RapierSimulation.ts:513-516` | **Shared** | Qualified ⇒ `IDLE_INPUTS` |
| `RapierSimulation.ts:443-451` | **Shared/client** | Server's `finishTick` overwrites the client's, both directions |
| `SimState.ts:80-88`, `SimState.ts:177-179` | **Wire** | Replicated, and part of `ReconcileBase` |
| `reconcileGate.ts:39` | Client netcode | `finishTick` disagreement forces a correction |
| `Qualification.ts:16` (`allQualified`) | **Server authority** | Round-end condition |
| `Qualification.ts:32` (`isEliminated`) | Shared, client-only caller | `phase ∈ {ROUND_END, RESULTS} ∧ finishTick === null` |
| `Track.ts:265-270`, `Module.ts` `finishZone` | Track data | ADR 0039 |
| `scene.ts:240-250`, `render.ts:65-71` | Presentation | |

Good news: `finishTick` is a **Tick number, not a boolean**, and `allQualified` takes any
`{finishTick}` record (`Qualification.ts:4-6`). A Survival Round ("qualified = still here
at the end") can stamp the same field from a different rule without touching the wire, the
reconcile gate, or the HUD. The seam is narrower than it looks — it is `updateFinishZone`
(6 lines) plus whatever new rule stamps the same latch.

### 4.3 Assumption: exactly one Round-end condition, and exactly one Round

| Site | Layer | Note |
|---|---|---|
| `MatchPhase.ts:112` | **Server authority** | `RUNNING → ROUND_END` iff `allQualified \|\| timeExpired` |
| `apps/server/src/index.ts:710-713` | **Server** | The only producer of those two booleans |
| `MatchPhase.ts:115` | **Server** | `ROUND_END → RESULTS` after a beat; **RESULTS is terminal** (`MatchPhase.ts:89`: "returning to the Lobby for another Round is M4 ticket 08") |
| `MatchPhase.ts:13-21` (`MatchState`) | **Server + wire** | `{phase, phaseStartTick}` — **no round index, no round type, no survivor list** |
| `roundClock.ts:19` + `index.ts:696-707` | **Server** | One clock, from one Revision's `timeLimitMs` (ADR 0038) |
| `index.ts:596` (`dnf`) | **Server** | Only recorded during RUNNING |
| `index.ts:439-442` | **Server** | No mid-Round join |

**A Match is currently one Round, and nothing anywhere names a Round type.** CONTEXT.md
now defines **Round type** ("the rules a Round runs by… chosen independently of the Track
it runs on") and **Survivor Target**; neither term exists in code, in `MatchState`, in
`SimulationConfig`, or on the wire. CONTEXT.md also defines a Match as *"made of several
Rounds"* and Qualification as *"survivors advance to the next Round"*, but no code
expresses advancement: there is no round counter, no carry-over of who survived, and
`rebuildSimulationFor` (`index.ts:251-257`) re-seats *every* connected Player, not the
survivors. This is known and scheduled (ticket 08, "Results and another Round"), but it
matters for the Round-type question: **the place a Round *type* would be selected does
not exist yet**, and it should be designed at the same time as the round loop, not
bolted on after.

**Where a Round type would go, given today's shape.** `MatchState` gains the type;
`SimulationConfig` gains the rules the shared step needs (fall outcome, respawn policy);
`advanceMatchPhase`'s ending predicate becomes a function of the type. The first two are
protocol/shared changes; the third is pure server policy. All three extend ADR 0040
rather than contradicting it — ADR 0040 decides *who owns transitions*, not *how many
kinds of Round there are*.

### 4.4 Terrain that collapses — the one with no seam at all

Statics are created once, in the constructor, as fixed Rapier bodies
(`RapierSimulation.ts:258-272`), recorded in `staticSurfaceByHandle` (271), and **never
removed** — there is no `removeStatic`, and `dispose()` (798-810) frees the whole world.
The client's stage is the same: statics become meshes in one loop at boot
(`scene.ts:214-220`) and are pushed into `collidables`, which the camera raycasts against
(347-357, 459-464); there is no removal path there either.

ADR 0018 classifies statics as *"Static geometry — config at join, no sync"*. Collapsing
terrain breaks that row: it becomes a fourth entity category needing authority, a wire
representation, and a handoff policy. **This requires a new ADR adding a row to
`docs/networking-model.md`'s entity table and amending ADR 0018's classification** — the
one Round type of the three that is a genuine architecture change rather than a rules
change.

The *shape* is already suggested by the Spinner (ADR 0025): a collapse that is a pure
function of `(tick, segmentIndex)` needs no wire data at all and stays deterministic on
both sides. A collapse triggered by a Character stepping on it does not, and is much more
expensive.

### 4.5 Summary: shared-deterministic vs server-only

**Must stay identical on client and server** (change as `SimulationConfig` or tick input,
never as server policy): `detectFall` and the whole respawn path
(`RapierSimulation.ts:729-736`, `CharacterController.ts:428,478,912`);
`updateCheckpoint` (647-658); `updateFinishZone` (675-680); the qualified-input lock
(513-516); `killPlaneY` (253); the `CharacterProgress` fields (39-66) and every
`CharacterSnapshot` field they feed.

**Server-only match authority** (free to change): `advanceMatchPhase` and everything
feeding it (`MatchPhase.ts:91-119`, `index.ts:633-646,710-713`); the Round clock
(`index.ts:696-707`); `dnf` (`index.ts:596`); the lobby/start gate
(`Lobby.ts`, `index.ts:575-588`); mid-Round join refusal (`index.ts:439-442`).

**Shared code, single-sided caller today** (so a second caller is free): `phaseLocksInput`
(both sides already), `allQualified`/`allReady`/`resolveHostId` (server only),
`isEliminated` (client only), `roundTimeLeftMs` (server only).

---

## 5. Test coverage shape

**Where it is dense.** 8100+ lines of tests. `RapierSimulation.test.ts` (3368 lines, 27
describe blocks) covers the shared step end to end — walk, Surfaces, ice, tilted floors,
ground-stick, Sliding, slopes, Fall/Respawn, jump, dash, Impact/ragdoll, Spinner, Props,
wall Impact, the client/server dash-wall desync, the Character collection, reconcile +
replay, Bump, speed pads (plus a dedicated code-review-regression block at 2536), bounce
Surfaces, launch pads, Volumes, Finish Zone/Qualification (3157-3337), and `dispose`.
`apps/server/src/index.test.ts` (1096 lines) covers the server as a black box over real
sockets, including the Round clock, Countdown, Round end, DNF and mid-Round join refusal.
`predictionRegression.harness.test.ts` (1115 lines) is a genuinely excellent deterministic
network harness — with the caveat in §3.1.

**Where a refactor would be flying blind.**

| Extraction (§1) | Protected by | Verdict |
|---|---|---|
| CharacterController velocity pipeline (1.1-A) | `RapierSimulation.test.ts` integration only; `CharacterController.test.ts` is **46 lines and tests exactly one exported pure function** (`wallImpactKnockback`) | **Well covered behaviourally, zero unit coverage at the seam.** Safe-ish, slow to debug |
| CharacterController down-state (1.1-B) | `RapierSimulation.test.ts` "Impact & ragdoll" (1127), "dash into a wall" (1547), "Fall & Respawn" (553); `CharacterStateMachine.test.ts` (204 lines) covers the machine, not the bodies | **Partly blind** — collider enable/disable and bone blending have no direct assertions |
| `RapierSimulation` Round rules (1.2-A) | Dense: Fall/Respawn (553), speed pads (2393, 2536), launch pads (2868), Finish Zone (3157) | **Best-covered extraction in the list.** Do this one first if a shared-package refactor is wanted |
| `RapierSimulation` client-only plumbing (1.2-B) | "client Props are pinned obstacles" (1337-1546), `propPrediction.test.ts` (217) | Covered |
| Server `TrackSource` (1.3-A) | `index.test.ts:506-673` — 7 tests on the Playtest reload path, including the serverTick reset regression (621) | Covered for the connect-time path. **`selectTrack` — the lobby's own copy of the same logic, `index.ts:531-573` — has zero tests** |
| Server `InputRouter` (1.3-B) | `tickAddressedInput.integration.test.ts` (438), `index.test.ts:172,251` | Covered |
| Server `MatchLoop` (1.3-C) | `MatchPhase.test.ts` (193) unit-tests the pure machine; `index.test.ts:748-1088` covers the wiring | Covered |
| **Client `PredictionLoop` (1.4-A)** | The harness — **which tests a copy** (§3.1). `reconcileGate.test.ts` (52) covers the gate; `snapshotInterpolation.test.ts` (179), `timeSync.test.ts` (74), `propPrediction.test.ts` (217) cover the parts | **Blind at exactly the seam being extracted.** The refactor is what *creates* the coverage; sequence it as "extract, point the harness at the real thing, then change behaviour" |
| Client HUD text (1.4-B) | None | Trivial anyway |
| `scene.ts` (1.6) | **`scene.ts` has no test file at all.** Only `teardown.test.ts` (65) and `GameCanvas.test.tsx` (141) touch its lifecycle indirectly; `wobble.test.ts` (126) and `springArm.test.ts` (79) cover extracted leaves | **Fully blind.** Any `scene.ts` split is unguarded. Do not do it opportunistically |
| `tuning.ts` (1.5) | N/A — `tsc` is the test | Safe |

**Other uncovered surfaces worth naming:**

- `apps/server/src/index.ts:511-529` (`setNickname` trimming/`NICKNAME_MAX_LENGTH`,
  `setReady` phase gate) — no direct tests; `setReady` is exercised only incidentally by
  the `readyUpAndStart` helper (`index.test.ts:93-107`).
- `apps/server/src/index.ts:531-573` (`selectTrack`) — the host-only/LOBBY-only gate, the
  re-check after the `await` (547-553), and the simulation swap: **no tests**. This is the
  newest and least-guarded code in the tree, and it duplicates a path that *is* tested
  (§3.1's `TrackSource`).
- `apps/track-service/src/index.ts:58-66` (`isTrack`) — a hand-written validator standing
  in for the `Segment` type (`Track.ts:34-41`). It checks `moduleId` is a string and
  `position` is an `object`; `typeof null === "object"`, so `{moduleId: "x", position:
  null}` passes, and `rotation` is not checked at all — an absent `rotation` reaches
  `segmentOrientation` (`Track.ts:61`) as `undefined` and produces a NaN quaternion rather
  than a 400. `validate.test.ts` covers `unknownModuleIds` and the Time Limit, not this.
  Category (b) duplication *and* a live hole; ~10 lines to close.

---

## 6. Ranked backlog

Risk = (chance of divergence or a real bug) × (blast radius). Cost is rough
implementation size, not review effort.

| # | Item | § | Risk | Cost | Notes |
|---|---|---|---|---|---|
| 1 | Point both test copies of the correction gate at `reconcileGate.needsCorrection` | 3.1 | **High** | **XS** | Kills the stale `0.2` in `RapierSimulation.test.ts:1854` today. Do this first, it is an afternoon |
| 2 | Finish the CONTEXT.md amendment (**Fall**, **Respawn**, **Round** still state the Race rule as universal) and write the ADR amending ADR 0010 | 4.1 | **High** | S (writing) | **Half-done in the working tree already** — the glossary is currently self-inconsistent. No code |
| 3 | Extract the client `PredictionLoop`; harness drives the real one | 1.4-A, 3.1 | **High** | **L** | The structural fix behind #1 |
| 4 | Unify the two input-lock mechanisms (new ADR extending ADR 0040) | 2.3, 4.5 | Med-High | M | Changes `RapierSimulation.tick`'s signature — needs an ADR |
| 5 | Extract `RoundRules` from `RapierSimulation` | 1.2-A, 4 | Med-High | M | Best-tested extraction; the natural home for per-Round-type rules |
| 6 | Tests for `selectTrack`, and share its reload path with the connect-time one | 3.1(server), 5 | Med | S | Newest, least-guarded code; already a copy-paste |
| 7 | Fix `isTrack` (`null` position, missing `rotation`) | 5 | Med | XS | Live hole; 10 lines |
| 8 | Promote `StoredTrack` to `packages/shared` | 3.3 | Med | XS | Precedent already set by `TrackListing` |
| 9 | Drive the builder's time-limit input from the shared constants | 3.2 | Low-Med | XS | 5 lines |
| 10 | One `isDownMotionState`, delete the other five | 3.4 | Low-Med | XS | Pays off when the next motion state lands |
| 11 | Move `qualificationPlacement` into `shared/match` | 2.1 | Low-Med | XS | Ticket 08 will want it |
| 12 | Delete `getStatics`/`getCheckpoints`/`getSpinners`/`getProps` + clone helpers | 2.5 | Low | XS | ~40 dead lines |
| 13 | Extract `hudText` from `game.ts:716-769` | 1.4-B | Low | XS | |
| 14 | Extract `CharacterVelocityStep` | 1.1-A | Low | **L** | Real risk of a determinism regression; only if the file becomes an obstacle |
| 15 | Split `tuning.ts` | 1.5 | Low | S | Cosmetic. The file is not tangled |
| 16 | Split `scene.ts` | 1.6 | Low | M | **Zero test coverage.** Do not do this opportunistically |
| 17 | Decide `advanceFixed`/`FixedSimulation`'s fate (widen or delete) | 3.5 | Low | XS | Currently production-dead |
| 18 | Stop exporting `playground.ts` from shared's public index | 3.5 | Low | XS | Test fixture, not API |

---

## 7. What is already fine — and should be left alone

Named explicitly, because the list above reads worse than the codebase is.

- **The domain vocabulary is real.** Every type, field and test name uses CONTEXT.md's
  terms. `Volume` vs `Checkpoint.trigger` was renamed rather than left ambiguous
  (ADR 0036); `RagdollCause` was renamed `"DashWall"` → `"WallImpact"` when the rule
  changed (`SimState.ts:12-16`). This is unusually well maintained — the glossary leads
  the code rather than trailing it, which is exactly what the in-flight **Round type** /
  **Survivor Target** additions are doing right now (§4.1's caveat is that three
  neighbouring entries have not caught up yet, not that the practice is wrong).
- **`packages/shared/src/simulation/movementVerbs.ts` is the model for every other
  extraction in this note** — pure functions plus three small stateful controllers, 404
  lines with 353 lines of direct tests, and it is exactly what `CharacterController` was
  carved down from.
- **`errorOffset.ts` (33 lines) already de-duplicates the ADR 0022 / ADR 0026 decay** that
  two very different callers (pushed Props, the local capsule) share. That is precisely the
  fix §3.1 wants for the prediction loop, so the pattern is established.
- **`tuning.ts` has no dead and no duplicated constants** — all 104 checked; only
  `COUNTDOWN_TICKS` and `ROUND_END_TICKS` are test-only, and both for a defensible reason
  (production takes the duration as a parameter so tests need not wait three real seconds).
- **`net/protocol.ts` is a single shared source of truth for the wire** with no codegen and
  no second schema — exactly what ADR 0011 chose, and both ends import it.
- **The layering between input, camera and simulation is clean.** `movementDirection`
  (`input/movementDirection.ts:19`) is pure and shared; `KeyboardInput`
  (`apps/client/src/input.ts:23`) is DOM-only; the sim never sees a key code or a camera
  (ADR 0009 held).
- **The `qualified` map, `phase`, `timeLeftMs` and `countdownMsLeft` are all
  server-computed and client-rendered**, exactly as ADR 0040 requires; §2.6 checked each
  one. There is no place the client recomputes something the server sends.
- **`Qualification.ts` is shaped for reuse already** — `allQualified` takes any
  `{finishTick}` record and `finishTick` is a Tick, not a boolean, so a Survival Round
  needs no wire change (§4.2).
- **Resource lifecycle is handled with real care**: `teardown.ts`, `RapierSimulation.dispose`
  (798-810, with its idempotence comment), `disposeGroup` (`render.ts:182`, including the
  `THREE.Line` case an ArrowHelper needs), `renderer.forceContextLoss()`
  (`scene.ts:562`), `mixer.uncacheRoot` (550). Most projects this size leak all of these.
- **The uncommitted lobby protocol is not dead code.** `setNickname`/`setReady`/
  `selectTrack`/`start` (`protocol.ts:172-223`) have a server implementation and no client
  caller because M4 ticket 07's client half — the Lobby Screen — is unbuilt
  (`.scratch/m4-match-structure/issues/07-lobby.md`, status "blocked"); the working tree's
  `LobbySnapshot`/`onLobbyState` addition to `game.ts` is that half arriving, and it
  respects ADR 0008's boundary (a typed callback out of the game, no shared mutable state,
  deduped against the snapshot rate rather than handing React a new object 30×/s). The
  same is true of `dnf` (`protocol.ts:101-111`), which ticket 08 reads.

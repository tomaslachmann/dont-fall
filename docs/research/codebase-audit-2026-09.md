# Codebase audit, 2026-09: god files, dead code, responsibilities

Asked for by the user on 2026-09-18:

> ted musime udelat neco, co jsem odkladal dlouho a to bude lepsi code split
> napric god files, najit stary nepouzivany kod jako treba setNickname atd. pak
> split na zavislosti kdo co ma za co odpovednost, a orchestrace a lepsi
> reusabilita, polymorfie atd.

Everything below is measured, not estimated. `docs/research/codebase-audit-m5.md`
is the previous pass (ahead of M5); where a file appears in both, the growth
since is given.

## 1. The god files

Generated files excluded (`kaykitAssetDefs.ts` 3351, `trapAssetDefs.ts` 807 —
both written by `pnpm convert:*`, never by hand). Tests excluded.

| File | Lines | At the M5 audit | Growth |
|---|---|---|---|
| `packages/shared/src/simulation/CharacterController.ts` | 1752 | 1128 | +55% |
| `packages/shared/src/simulation/RapierSimulation.ts` | 1677 | 811 | +107% |
| `apps/client/src/game/index.ts` | 1535 | 780 | +97% |
| `packages/shared/src/tuning.ts` | 1347 | 703 | +92% |
| `apps/client/src/render/scene.ts` | 1303 | 565 | +131% |
| `apps/track-builder/src/engine.ts` | 1300 | — | — |
| `apps/track-builder/src/scene/viewport.ts` | 1043 | — | — |
| `packages/shared/src/track/Track.ts` | 986 | — | — |
| `apps/server/src/match/matchRuntime.ts` | 859 | — | — |
| `apps/track-builder/src/track/trackEdit.ts` | 819 | — | — |

Every file the M5 audit named has roughly doubled. M4.5 split
`apps/server/src/index.ts` (799 → an entry point plus `match/`, `net/`,
`track/`) and extracted `PredictionLoop` from the client; nothing else on that
list was split, and all of them kept growing.

What is actually inside the worst four:

### 1.1 `apps/client/src/game/index.ts` — one function, 1535 lines

`startGame` is a single `async` function that does, in order: practice-mode
branch, physics init, character-model load, endpoint resolution, socket open,
Track fetch + library load + visual templates, Stage construction, audio volume
wiring, keybinding load, the whole `message` listener (phase changes, lobby
state, standings, Round HUD, DNF, Track reload, run-end and hit events), ping /
time-sync, reconnection, and the construction of a 14-method `GameHandle`.

The diffing alone is four separate hand-written "did this JSON change" caches
(`lastRoundHudJson`, `lastLobbyJson`, `lastResultsJson`, plus the Track ref).

### 1.2 `CharacterController.ts` — 1752 lines, 22 imperative setters

`RapierSimulation` calls **13 setters on every Character every tick**, in a
fixed order, before `endTick` is allowed to mean anything:
`setSurfaceTopSpeedMultiplier`, `setSurfaceGrip`, `setSurfaceBounce`,
`setSurfaceJumpMultiplier`, `setSurfaceLandingKnockdown`, `setLandingSlipRoll`,
`setConveyorVelocity`, `setActiveVolume`, `setRide`, `setGrabSpeedMultiplier`,
`setGrabEngaged`, `setGrabTetherWish`, `setFacing`.

That is temporal coupling written out longhand: the "ground context for this
tick" is one value, spread across thirteen calls that must all happen, in the
right place, or the Character reads last tick's floor. Every Surface property
added since (ADR 0092's two, ADR 0094's one) cost a new setter, a new private
field and a new line in `RapierSimulation`.

### 1.3 `Track.ts` — `resolveTrack` emits 19 arrays from one loop

One `for (const [segmentIndex, segment] of track.entries())` body fills
`statics`, `staticSurfaces`, `staticConveyors`, `staticTrimeshes`, `props`,
`spinners`, `checkpoints`, `finishZones`, `launchPads`, `launchPadOwners`,
`volumes`, `movingSegments`, `conveyors`, `iceDecks`, `mudDecks`,
`bounceDecks`, `warnings`, `staticOwners`, `trimeshOwners`. Adding a Segment
property (ADR 0095's `prop`, ADR 0096's plan) means finding the right place in
a 200-line loop and hoping no other branch needed guarding — which is exactly
what happened with `prop` and the three deck lists.

### 1.4 `tuning.ts` — 182 constants, 33 sections

It began as "the feel values live in one place" (CLAUDE.md's working
agreement). It now also holds the wire protocol's sizes, the API fetch's
timeouts, the economy's XP curve, Match phase durations, the Round HUD's
thresholds and the asset loader's limits. Those are not tuning; they are
configuration that happens to be numeric.

## 2. Dead and vestigial code

Scanned: 2226 exported symbols across `packages/` and `apps/`.

### 2.1 Referenced nowhere (15)

```
apps/client/src/ui/Vignette.tsx        HitFlash, HitWedge, DashWind, Dust
packages/shared/src/track/authoring.ts TRACK_COLORS, widthOf, rampDown
packages/shared/src/cosmetics.ts       skinsUnlockedBetween
packages/shared/src/track/Track.ts     isSegmentProp
packages/shared/src/track/asset.ts     readGlbJson
packages/shared/src/tuning.ts          STANDINGS_READY_TIMEOUT_TICKS
apps/api/src/bets/bets.service.ts      getAccountCoins
apps/client/src/audio/soundBank.ts     EMPTY_SOUND_BANK
apps/track-builder/.../Icons.tsx       EasingIcon
```

(`AUTHORED_TRACKS` also reported, and is a false positive: `scripts/` is outside
the scan.)

Four unused React components in `Vignette.tsx` is the notable one — a whole
reaction-overlay vocabulary nothing mounts.

### 2.2 Referenced only by tests (22)

Mostly legitimate test seams (`FakeAudioContext`, `WithQuery`, `triangleGlb`)
or layout constants a walk test steers by. The ones worth a look:
`PLAYGROUND_STATIC_SURFACES` / `PLAYGROUND_SPINNERS` / `PLAYGROUND_PROPS` /
`PLAYGROUND_CHECKPOINTS` (the M1 playground, kept as a fixture by ADR 0078 —
fine, but it should say so), `dotQuat`, `encodeGateMask`, `launchDefFor`,
`appendModule` (102 test references, zero production).

### 2.3 Over-exported (623)

623 symbols are exported but used only inside their own file. Most are
`tuning.ts` constants, which is deliberate (they are documentation). The rest
is drift: every `interface Options` and private helper that got an `export`
because it was convenient once.

### 2.4 Vestigial features — `setNickname` is the example the user named

`setNickname` is fully wired, and it is the *client telling the server a name
the server should already know*. `Lobby.tsx` has no nickname input — ADR 0052
made Accounts mandatory, so it sends `account.displayName` from a `useEffect`
the moment the roster comes back with a name that does not match. The path is:
React effect → `GameHandle.setNickname` → `ClientMessage` → `lobby.ts` handler
→ Lobby roster.

Checked before writing it down: it is **not** simply deletable. The socket's
`auth` handler resolves `{ accountId, color, skin, hat }` and *not* the display
name, so the roster's only source of a real name today is this round trip —
without it every Player is `"Player"`. Removing it means `resolveAccount`
returning the display name too, after which one message type, one server
handler, one `GameHandle` method, one React effect and one protocol interface
go. That is the shape of the whole category: not dead, vestigial.

Same shape, worth checking with the same eye — each is a `ClientMessage` whose
interface nothing outside `protocol.ts` names: `ReclaimMessage`, `SyncMessage`,
`PickRoundSlotMessage`, `StandingsReadyMessage`.

### 2.5 `apps/client/prototypes/` — 1692 lines

`fan-airflow/` is a spike with its own `main.ts`, four tuning tables
(`streakTuning`, `puffTuning`, `wispTuning`, `realisticTuning`, none referenced)
and a 858-line `airflow.ts`. Nothing in the app imports it. It is not in the
bundle, but it is in the typecheck, the search results and every file listing.

## 3. Duplication worth removing

**The six Surface-sheet builders.** Ice, mud and bounce each have a builder in
the game scene and another in the Track builder — 1047 lines across four files,
with the same clone-the-texture / set-the-repeat / build-the-geometry / seat-it
shape six times. ADR 0096 just put the geometry half in `packages/render`; the
rest (texture cloning, repeat, lift, moving-carrier re-parenting) is still
duplicated. A sheet differs in exactly four things: texture file, tile size,
lift, and whether it is a sheet or a block.

**The builder engine's 61 methods** are a flat façade over `trackEdit.ts`'s
pure functions, and nearly every one is the same three lines: resolve the
primary selection, call the pure edit, `applyEdit`.

## 4. Where polymorphism would actually pay

Not everywhere. ADR 0043 is explicit that a Round type is *data the shared step
reads fields of*, never a subclass — and that decision is right and should not
be reopened. The places where a type would genuinely replace a branch:

- **Surface sheets** (§3): one `DeckOverlayKind` record — texture, tile, lift,
  block-or-sheet — and one builder, called three times per renderer.
- **Segment attachments.** `ice`/`mud`/`bounce`/`conveyor`/`launch`/`prop`/
  `checkpoint`/`start` are eight optional fields, each with its own
  `invalidXReason`, its own `setSegmentX`, its own branch in `resolveTrack`,
  its own clause in `isSegment` and its own line in `duplicateSegment`. A
  registry of attachment descriptors would collapse five of those lists into
  one.
- **Client message handling**: a handler map keyed by `type` instead of one
  listener that reads every field of every message.

## 5. Ranked backlog

Ordered by (value ÷ risk), highest first. Each is one ticket.

| # | Work | Risk | Why |
|---|---|---|---|
| ~~1~~ | ~~Delete the dead exports (§2.1), the vestigial `setNickname` path (§2.4) and `prototypes/`~~ | low | **Done** — see below |
| ~~2~~ | ~~Un-export the drift (§2.3)~~ | low | **Done** (narrowed — see below) |
| ~~3~~ | ~~Six sheet builders → shared loading and tiling (§3)~~ | low | **Done** |
| ~~4~~ | ~~Split `startGame` (§1.1) into boot / session / message-routing / handle~~ | medium | **Done** — ADR 0098 |
| ~~5~~ | ~~`resolveTrack` (§1.3): one pass per output family, or a per-Segment visitor~~ | medium | **Done** — a per-Segment visitor, output byte-identical |
| ~~6~~ | ~~`CharacterController`'s 13 per-tick setters → one `GroundContext` (§1.2)~~ | medium | **Done** — ADR 0098, and it found a live Grab bug |
| ~~7~~ | ~~Segment-attachment registry (§4)~~ | medium | **Done** — ADR 0099, and it found three Attachments a re-chain dropped |
| ~~8~~ | ~~`tuning.ts` → `tuning/` by domain, feel values kept together (§1.4)~~ | medium | **Done** — 13 files, the user's layout, every value proven unchanged |
| ~~9~~ | ~~`scene.ts` (§1.1's sibling): `createStage` → subsystem builders~~ | high | **Done** — ADR 0098 extended; proven identical headlessly |
| ~~10~~ | ~~`CharacterController` → Movement / Surface / Interaction / Ragdoll sub-controllers, and a strategy per motion state (the user's own §USER COMMENT)~~ | high | **Done** — ADR 0101; proven bit-identical |

### What tickets 1–3 actually removed (2026-09-18)

**605 lines added, 2376 deleted**, across 31 files, with every suite green.

- **Deleted outright**: `apps/client/prototypes/` (7 files); `ui/Vignette.tsx` and
  its stylesheet — the whole reaction-overlay vocabulary, unused by the app and
  unreachable from the M9 reference drop, whose own `ui/` kit was never
  committed; the Track builder's three duplicate texture loaders and their two
  tests.
- **Dead exports**: 14 symbols, plus the two things only they read
  (`GlbJsonProbe`, `EASING_CURVES`). Each was verified by hand first — the scan
  is a lead, not a verdict.
- **`setNickname`**: gone end to end, ADR 0097. `resolveAccount` now reads the
  display name off the same `/auth/me` it already called.
- **Un-exported**: 55 values, narrowed from the scan's 144 on two rules —
  **types are never un-exported** (one in an exported signature is part of the
  API whether or not its name is imported), and a **coherent documented
  vocabulary stays whole** (`collisionGroups.ts`'s `GROUP_*` bits are the
  building blocks of the `*_GROUPS` values beside them; un-exporting four of
  five would be worse than leaving all five). What went was drift: layout
  constants private to one Track file, and internal predicates behind an
  exported one.
- **Deduplicated**: six `load*Texture` implementations → one `loadDeckTexture`;
  six clone-and-repeat blocks → one `tileDeckTexture`; three `flatPlane` copies
  → one `deckRectGeometry`. All in `@dont-fall/render`, which is where the
  builder's own comment said this belonged once such a package existed.
- **Checked and deliberately kept**: `ReclaimMessage` is not dead — ADR 0024
  defines the shape for a reconnection the roadmap still lists, and two comments
  point at it. Per-module feel constants (`AirColumn`, `jumpSequence`, the audio
  cue files) stay exported: that is the "named constants, not magic numbers"
  working agreement, not drift.

### What tickets 4 and 6 actually split (2026-09-18)

Recorded as **ADR 0098**, and extended to the Match server's bootstrap, which
the user's own comments below named. Measured, like everything else here:

| File | Before | After | Where the rest went |
|---|---|---|---|
| `apps/server/src/matchServer.ts` | 589 | 119 | `server/{config,ports,statusHttp,connections,seats,perf}.ts` |
| `apps/client/src/game/index.ts` | 1533 | 313 | `game/{types,world,session,serverMessages,frameLoop}.ts` |
| `CharacterController.beginCapsuleTick` | 350 | 37 | nine private methods beside it |

What the split found that the scan could not:

- **A Grab you could use once per life.** `grabEngaged` was pushed `true` by a
  live hold and cleared by nothing but a knockdown — the per-tick reset beside
  it cleared the two values either side and left it out. The verb is gated on
  not already being engaged, so every later press read as "let go" and did not
  even play the reach. Exactly the failure mode §1.2 predicted; fixed by
  `clearHold()`/`holdWith()` moving all three together, with a regression test.
- **A frame loop drawing a disposed Stage.** The client's Track swap disposed
  the old Stage and then `await`ed its way to the new one. It now builds first.
- **Twenty unused imports** in `matchServer.ts`, and five dead locals in the
  client frame (`bootStartedAt`, `fetchStats`, `simStartedAt`, `simSteps`,
  `simMs`) — all left behind when M13 ticket 01's `?perf=1` overlay was deleted.
  §2 could never have found these: it scanned *exported* symbols, and every one
  of these is local. **`noUnusedLocals` is now on** in `tsconfig.base.json`;
  twenty-eight across the repo were cleared to turn it on.

Two of the user's suggestions were not taken, and the reasons are in the ADR:
`resolveCollisions` separates its concerns **in one pass** rather than
collecting contacts into a list (that allocates, per tick, per Character, in
the server's measured hot path), and the Playtest `?track=` connection is **not**
a third connection role — it is a step a connection takes before sitting down
in an ordinary seat.

### What ticket 7 actually collapsed (2026-09-18)

Recorded as **ADR 0099**. `Segment` is now its placement plus
`SegmentAttachments`, and `packages/shared/src/track/Attachment.ts` describes
every Attachment once — in a mapped type over the fields, so one added later
does not compile until it is described. (**Attachment** is new in
`CONTEXT.md`: the code and this audit already said it, the glossary did not.)

| List | Before | After |
|---|---|---|
| API publish validation | 9 `invalidTrack*Reason` loops, 18 lines in `publishTrack` | one `invalidTrackAttachmentReason`, 2 lines |
| `isSegment`'s attachment clauses | 9 | 1 |
| Builder setters | `setSegment{Motion,Conveyor,Ice,Mud,Bounce,Prop,Launch}` | `setSegmentAttachment` (+ `setSegmentLaunch`, which clamps) |
| Re-chain and Duplicate | a hand-written field list each | `attachmentsOf(segment)` |
| Conflict rules | `propConflictReason` + the Surface rule, each naming fields | `attachmentConflictReason`, reading the registry |
| Surface tie-break | `resolveTrack` (bounce > mud > ice) and the panel (bounce > ice > mud) disagreed | one `SURFACE_ATTACHMENTS`, top sheet wins |

`tracks.validation.ts` 337 → 176 lines, `trackEdit.ts` 803 → 742; the registry
itself is 130. Every reason a refused publish gives is unchanged word for word.
Two builder engine methods nothing called (`setSegmentIce`, `setSegmentMud`)
went with it — the scan could not see them, being methods on an object.

**What it found**: the re-chain's own list had stopped at the six Attachments
that existed when it was written. **Bounce, a Spring's height and a Prop were
silently dropped** from any Socket-chained Segment the moment anything
re-placed it — an upstream edit, a drag or nudge of the Segment itself, or
scaling it. Each per-kind test had proved its own Attachment survived; none
existed for these three. The new test runs over every registry key and, with
the old `chainOnto` put back, fails for exactly those three.

Left for ticket 5, deliberately: what each Attachment *does* is still a branch
in `resolveTrack`. Those are nineteen different outputs, not one shape
repeated, and making them one is that ticket's job.

### What ticket 5 actually split (2026-09-18)

`resolveTrack` moved out of `Track.ts` into `track/resolveTrack.ts` and became
**a per-Segment visitor**, not one pass per output family. The either/or in the
backlog was decided by two facts the code had and the table above did not:

- **Four outputs are shared between families** — `warnings`, `props` (an
  Asset Prop before its Module's own), `finishZones` and `launchPads` — and
  their order is observable. One pass per family would have re-interleaved
  them; a visitor keeps every array in exactly the order it had.
- **The bugs §1.3 names were one question asked in many places**: *what kind
  of body is this Segment's collision?* `!hasMotion(...)` and `!isDynamicProp`
  guarded six branches between them, and the client's still Asset visuals
  asked it a seventh time by hand ("the same condition `resolveTrack` uses").

So each Segment is placed once — orientation, scale, belt, attached Surface,
its deck frame (measured once instead of up to four times) and its
**`SegmentBody`**, `still` / `moving` / `prop` — and seven named families read
it in a fixed, commented order: retired-Module warnings, collision, decks,
Module bodies, course, launches, Volumes. Gate Checkpoints stay a last pass,
since they probe floor that only exists once every Segment is placed.
`segmentBody` is exported, and the client's `assetPlacements` now asks it
rather than copying it.

| | Before | After |
|---|---|---|
| `Track.ts` | 957 lines | 524 |
| `resolveTrack` | one 344-line function, 19 local arrays | 30 lines; largest family `resolveCollision`, 79 |
| Collision decision | 6 scattered guards + 1 hand copy in the client | one `segmentBody` switch |

**Proof it did nothing else**: `resolveTrack`'s output for twelve Tracks — the
base race, the four authored Tracks, M1, a synthetic Track with every
Attachment on still, moving and Prop bodies, a Prop with no solid parts, stray
Checkpoint marks, and each retired Module still and moving — serialised before
and after: 65 MB, **byte-identical**.

One deliberate change, for input publish refuses: a belt on a Prop no longer
draws a belt strip. "A Prop has no deck" (ADR 0095) had been applied to the
three sheets but not the belt; `resolveDecks` now returns before all four, and
`Track.test.ts` holds it.

### What ticket 8 actually split (2026-09-18)

The backlog line read three ways — feel in `tuning/` with configuration moved
next to the code that owns it; everything in `tuning/` by domain; or one feel
file beside small configuration files. **The user chose everything in
`tuning/` by domain**, feel and configuration as neighbouring files:

| File | What | Kind |
|---|---|---|
| `clock.ts` | tick rate, `msToTicks`, the fixed-step guards (ADR 0004) | — |
| `character.ts` | gravity, walk speed, the capsule, contact normals | feel |
| `movement.ts` | accelerate/drag/cap, jump, Dash, slopes and Sliding | feel |
| `surfaces.ts` | what ice, mud and bounce cost or give (ADR 0094) | feel |
| `knockdown.ts` | Impact, wall Impact, Stagger, Ragdoll, getting up | feel |
| `fight.ts` | Hit, Grab, Bump | feel |
| `world.ts` | the kill plane, Spinners, Props, Moving Segments, Springs | feel |
| `netcode.ts` | wire protocol, prop and capsule smoothing, lead | configuration |
| `match.ts` | Round clock, Survival, phases, length, Score, Match end, Track fetch | configuration |
| `economy.ts` | XP, beans, spectator wagering | configuration |
| `authoring.ts` | what a Track may store (scale, Spring heights), Asset load limits | configuration |
| `hud.ts` | when the Round HUD calls something out | configuration |

`tuning/index.ts` re-exports all of them, so `@dont-fall/shared` is unchanged
and **no app import moved** — §5 had guessed "~every import in the repo"; the
measured number was 57 files, all inside `packages/shared` and `scripts/`,
each now importing the file it means. No import cycle between the files, no
constant defined after its first use.

**Proof it did nothing else**: all 181 exports of the old `tuning.ts` and the
new index evaluated side by side — same names, same values (functions compared
by source).

What the move found: the old section headers no longer described their
contents — "Bounce" held the whole Stagger/Ragdoll block and the ice-landing
knockdown, "Dash" ended in the capsule's dimensions, and the Segment scale
bounds sat under "Round clock". And nine places credited the Surface
penalties to ADR 0095, the Asset Prop, instead of ADR 0094 — two section
headers and two comments in the Surface tuning, `Surface.ts`, two comments in
its test, `CharacterController`, and a `RapierSimulation` test name; corrected.
Fourteen constants now linked from another file's docs keep their `{@link}`s
resolving through type-only imports, which `noUnusedLocals` counts as used.

### What ticket 9 actually split (2026-09-18)

Recorded as an extension of **ADR 0098**: `createStage` was the fourth
bootstrap of the same shape. `scene.ts` 1303 → 602 (mostly the `Stage` and
`StageConfig` boundary, left where every caller imports it from); the work
moved to `render/stage/{trackVisuals,localCharacter,sounds,cameraRig}.ts`
(421, 434, 134, 57). `updateCharacterAnimation`, 205 lines inside the returned
object literal, is now `LocalCharacter.animate`.

The risk the backlog named ("only renderer nobody can test") was met by
proving instead of testing: a scratch harness built real Stages headlessly for
four Tracks, played 170 scripted frames through every Stage method, and hashed
the whole scene graph each frame plus the camera, the stubbed renderer,
Environment and speed lines, and every audio source. It was deterministic, it
caught a one-word shadow-role mutation on every frame, and it was identical
before and after. It was not committed.

Nothing was found broken. Two things the split made visible:
- the mud and bounce footing exist only for sounds, yet must be built on a
  silent Stage too, because they are scene objects;
- the local Character needs the sounds for its footsteps, and the sounds'
  footing needs the Character already in the scene — the one forward
  reference in `createStage`, commented where it is.

While verifying it, `apps/server/src/net/tickAddressedInput.integration.test.ts`
(real server, real timers) failed intermittently under a loaded machine
(0.169 against a 0.01 bound, about 2 runs in 10). It is independent of this
change — the server never imports the client's renderer — and was left as a
task of its own.

### What ticket 10 actually split (2026-09-18)

Recorded as **ADR 0101**. The cut was decided by what the user said the code
has to make easy next — a random slip on mud, ice knocking you down on a crash
at any speed, and a reworked Grab — rather than by a pattern:

- `CharacterController` (1838 → 632) says the order of a tick; the work is in
  `simulation/character/{Capsule,MovementController,SurfaceController,InteractionController,RagdollController}.ts`.
  Its public API is unchanged.
- **Surface hazards have a home.** `SurfaceController.landingImpact` (ice's
  slip, and mud's as data) and `SurfaceController.crashMinSpeed` (the
  wall-Impact threshold, now asked of the ground rather than read as a
  constant).
- **Grab is two files side by side**: `InteractionController` for one
  Character, and `GrabHolds` — about 250 lines out of `RapierSimulation`
  (1643 → 1393) — for the pair.
- **A motion state is a row** in `MOTION_MODES`: input scale, what moves the
  body, which velocity model, what the snapshot reports. Transitions stay in
  the state machine's one `switch`; a full State pattern would have spread it
  over five files for nothing the planned features need.
- Comments moved verbatim, the user's explicit call.

**Proven identical**: a scratch harness ran six Tracks × 1500 ticks with busy
Players, Characters dropped onto every kind of Surface and device, Survival
eliminations, a disconnect, direct Impacts and a client reconciled every nine
ticks, serialising the full `SimState` unrounded every tick. It caught a 1e-12
relative change within 22 ticks, and was identical after both steps.
`pnpm bench:sim` moved the Character sweeps by −12 % to +4 %, no direction.

With this, the audit's backlog is done.

## 6. What to leave alone

- **ADR 0043's rule**: a Round type stays data, not a class hierarchy.
- **`tuning.ts`'s constants being exported and documented** — that is the
  working agreement, not drift.
- **The generated asset def files** — they are output, and they are correct.
- **`packages/shared`'s determinism boundary** — any split must keep the
  simulation step pure in `(state, inputs)`, which rules out "inject a service"
  style refactors inside it.


**USER COMMENT**

Server matchServer.ts – rozdělení odpovědností
apps/server/src/matchServer.ts je velmi bohatý modul: start serveru, konfigurace, track fetch/reload, HTTP /status, WebSocket připojení, lobby join/leave, spectator režim, DNF logika, performance monitoring, lifecycle close – všechno v jednom souboru.

Doporučení: rozsekat soubor na několik „role-oriented“ modulů, aby bylo jasné, co co dělá:

server/config.ts – normalizace StartServerConfig, čtení envů, výpočet playersToStart, maxPlayers, retry options.

server/ports.ts – listenFirstFree + validace PortRange, aby port-binding logika žila mimo hlavní server.

server/statusHttp.ts – malý modul, který umí připojit /status endpoint na daný MatchRuntime.

server/connections.ts – funkce typu onConnection(rt, socket, req) rozdělená na menší helpery: ensureCapacity, maybeReloadTrack, registerPlayerOrSpectator, wireLobbyHandlers, wireLifecycleHandlers.

server/perf.ts – event-loop monitor + TickPerf wiring, aby match loop byl čitelnější.

Tak získáš menší, tematicky čisté moduly, ve kterých se líp čte flow, aniž bys musel sahat na doménové rozhodnutí z ADR.

Polymorfismus: role připojení (player vs spectator vs playtest)
Dnes je role spojení řešená přes bohaté if‑y: kontrola maxPlayers, výpočet spectating, Playtest ?track= path s vlastním větvením, DNF logika při close.

Místo ručních if‑ů můžeš zavést tenkou vrstvu polymorfismu nad „rolemi“:

Typy jako ConnectionRole = "player" | "spectator" | "playtester" a malý registry objekt nebo třídy:

PlayerConnection – přidá do simulačky, řeší DNF při close, posílá welcome s configem.

SpectatorConnection – registruje se v lobby, ale nepřidává rigid body, nijak nezasahuje do DNF.

PlaytestConnection – při příchodu zodpovídá za track reload (včetně safety kontrol rt.sockets.size === 0).

Hlavní onConnection by jen provedl: const role = resolveRole(rt, req) a pak role.handleJoin(rt, socket) – vnitřní if‑y se tak přesunou do menších jednotek, které se dají testovat izolovaně.

To ti dovolí jednoduše doplňovat další role (např. „admin monitor“) bez přidávání dalších větví do jednoho mega handleru.

Simplifikace konfigurace a env overriding
StartServerConfig je velmi bohatý: obsahuje porty, track service URL, test-only overrides pro countdown, round end, standings timeout, time limit, survivor target, match length, plus playersToStart a maxPlayers z envů.

Doporučení:

Zaved’ čistý typ ServerRuntimeConfig, který je „already normalized“ (žádné undefined, všechno konkrétní čísla/URL), a funkci buildRuntimeConfig(env, startConfig).

Test-only overrides seskup do jednoho „test blocku“, např. testOverrides?: { countdownMs?: number; roundEndMs?: number; ... }, aby signatura StartServerConfig nebyla tolik rozplizlá.

Čtení envů (PLAYERS_TO_START, MAX_PLAYERS) dej do jednoho helperu (např. readPositiveIntEnv), ať se pattern neopakuje a je konzistentní.

To ti zlepší čitelnost při čtení server bootstrapu – uvidíš jasně: 1) validace portRange, 2) init physics, 3) sestavení runtime configu, 4) bootstrap track, 5) start HTTP/WS.

HTTP /status endpoint – vytažení do samostatného modulu
Teď je malý HTTP server se GET /status vybudovaný přímo uvnitř startServer, včetně logiky počítání round čísla podle fáze, filtrace accountId (bez anonymních hráčů).

Doporučení: definovat funkci createStatusHandler(rt: MatchRuntime): RequestListener, která obsahuje jen:

mapování phase → roundNumber | null,

zabalení occupancy/phase/accounts do JSON.

startServer pak jen: const httpServer = createServer(createStatusHandler(rt));. Čtení serveru se tak výrazně zjednoduší, protože HTTP část už nebude „rozplizlá“ uprostřed bootstrapu.

Client-side: struktura a readability
V apps/client/src je vidět snaha o modulární strukturu (audio, components, game, hud, input, net, render, screens, ui, styles, test*).

Doporučení pro čitelnost:

screens můžeš pojmout jako čisté „page controllers“, které používají game (domain logika) a ui (vizuály). Tím udržíš React komponenty tenké – volají domain API a skládají UI.

tokens.ts v clientu už naznačuje design systém; zvaž přesun do packages/ui + import přes @dont-fall/ui/tokens, aby bylo jasné, že je to cross-app systémový koncept.

Otestované helpery (codeSplitBoundary.test.ts, App.test.tsx) můžeš zrcadlit strukturou – testy vedle modulů (např. game/__tests__, net/__tests__), místo agregovaných testů v rootu, aby se lépe navigovalo.

Komentáře vs ADR dokumentace
Komentáře v matchServer.ts jsou velmi bohaté a často obsahují celé ADR příběhy (ticket čísla, kontext proč něco je tak, jak je).

Tohle je super pro tebe jako autora, ale pro čistou čitelnost kódu by se hodilo:

Nechat v kódu kratší „intent“ komentář (např. jednovětné shrnutí) a dlouhé ADR popisy přesunout do odpovídajících dokumentů v docs/ nebo do konkrétních ADR souborů, které už v repo máš.

V kódu jen odkazovat // ADR 0059: see docs/adr/0059_match_server_lifecycle.md – tím zůstane historický kontext, ale samotný modul se výrazně zkrátí a bude se lépe číst.

CharacterController je fakt dobře promyšlený a doménově bohatý, ale z pohledu čitelnosti a „architectural hygiene“ je to typický god‑class kandidát na rozseknutí na menší concern‑moduly a tenkou orchestraci.

Hlavní problém: koncentrace odpovědností
CharacterController dnes řeší v jednom typu prakticky všechno:

kapsli, Rapier kinematic controller, ragdoll a jejich přepínání,

vstupy (jump/dash/hit/grab), slope/slide movement model, pásy, volume forces, conveyor, ride, respawn/wobble,

collision resolving (wall impacts, surface/ground normal, belt, bounce),

grab tether, launch pad, airbornePeakFallSpeed, reconciliation base, snapshotování pro klienta.

Doporučení: zachovat CharacterController jako orchestrátora, ale vytáhnout pod něj několik čistších „sub‑controllerů“:

MovementController – čistě horizontální/vertikální velocity, slope model, sliding logiku (část beginCapsuleTick + pomocné funkce).

SurfaceController – surfaceTopSpeedMultiplier, surfaceGrip, surfaceBounce, conveyorVelocity, activeVolume, včetně walkableUnderfoot a standableGroundBelow.

InteractionController – Hit/Grab/launch pad epochy, cooldowny, grab vztahy (grabbingId, heldByGrabberId, grabTetherWish).

RagdollController – vše kolem down state, ragdollEpoch, ragdollCause, respawn/wobble, beginRagdoll, beginGettingUp, respawnAtCheckpoint, eliminateNow, returnToControlled.

CharacterController by pak volal movement.tick, surface.apply, interaction.tick, ragdoll.tick, čímž bys snížil velikost třídy a usnadnil lokální čtení i testování.

API směrem ven – méně setterů, více „config objects“
Teď máš spoustu setterů: setSurfaceTopSpeedMultiplier, setSurfaceGrip, setSurfaceBounce, setConveyorVelocity, setActiveVolume, setGrabTetherWish, setGrabSpeedMultiplier, setGrabbingId, setHeldByGrabberId, setFacing…

Zkus místo mnoha setterů tenký „per‑tick configuration“ objekt:

applyEnvironment(env: CharacterEnvironment) – obsahuje surface, volume, belt, ride, grab state atd.

applyCrossCharacterState(state: CharacterRelations) – grabbing, heldBy, grabSpeedMultiplier, tether wish.

Tím získáš:

lepší grouping toho, co přichází z RapierSimulation,

nižší riziko, že někde zapomeneš nastavit jednu z hodnot (v testech i runtime).

Polymorfismus: motion state layering
Motion state už máš přes CharacterStateMachine, ale v beginTick/beginCapsuleTick se míchá hodně stavu dohromady.

Doporučení:

pro každý „mode“ (Controlled/Sliding/Stagger/GettingUp/Ragdoll) definuj drobný „strategy“ typ, který se stará o tick logiku v tom módu:

např. MovementModeControlled.tick, MovementModeSliding.tick – celé větve v beginCapsuleTick se zmenší a CharacterController bude jen delegovat podle aktuálního motionState.

získáš přirozenější polymorfismus: přidání nového motion state bude znamenat nový mode‑objekt, ne další if v mega metodě.

Komentáře a ADR vs runtime kód
Komentáře jsou excelentní z pohledu ADR/projektové historie, ale pro čtení runtime kódu jsou extrémně dlouhé.

Doporučení: udržet v kódu krátké „intent“ shrnutí (1–2 věty) a zbytek přesunout do docs/adr/0037-*, docs/research/*, CONTEXT.md – odkázat jen // ADR 0037: viz docs/adr/0037_movement_model.md.

Stejně jako u matchServer.ts: kód bude čitelnější, ADR zůstane dohledatelné.

Čitelnost: struktura metody beginCapsuleTick
beginCapsuleTick je srdce pohybu, ale dnes v sobě míchá: input edge detection (jump/dash/grab), ride logiku, dash/hit/grab gating, surface scaling, slope multiplier, dash+walk wish velocity, launch pad, volume forces, sweep, ground stick/bounce, collisions, rides, kinematic translation.

Refactor po blocích:

processInputs(input) – získat jumpPressed, dashPressed, grabPressed, fullControl, sliding, dashActive, grabEngaged.

updateVerticalVelocity(jump, gravity, ride) – samostatný blok pro Y komponentu, včetně airbornePeakFallSpeed.

computeWishVelocity(input, surface, dash, grab, belt, slope) – čistě výpočet cílové horizontální rychlosti.

applyLaunchAndVolume() – launch pad + volume připnuté na konec.

computeCapsuleSweep() – kinematic controller + snap to ground, bounce/ground stick.

Každý krok může být vlastní privátní metoda; beginCapsuleTick pak bude sekvenční story, ne jeden monolit.

Collision resolving – oddělit reporting od ragdolllu
resolveCollisions dělá zároveň:

vyhledání „nejvíc podlahové“ kolize pro surface/ground,

wall‑impact knockback (přímá aplikace applyImpact),

volání onCollision callbacku pro RapierSimulation.

Doporučení:

rozdělit na dvě metody: collectCollisionContacts() (vrací strukturu se seznamem kolizí, best‑ground contact atd.) a applyCollisionEffects() (wall knockdown / pending impact).

CharacterController si vezme kontakty, upraví vlastní state, RapierSimulation dostane raw kontakty přes callback a řeší cross‑character efekty (spinner, bump, prop).

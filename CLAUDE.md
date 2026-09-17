# DON'T FALL

A chaotic multiplayer obstacle-racing game for the browser. Players run a physics
playground / obstacle course; the core fantasy is **physical chaos and player
interaction** — bumping, shoving, and falling. Fall Guys is the reference for
*match structure only*, never for feel.

Design philosophy: **Easy to understand. Hard to master. Hilarious when you fail.**

## Status

**M1 done** — a local physics playground (`docs/milestones/M1.md`, fully checked).
Tickets 01–07 in `.scratch/m1-playground/issues/`: monorepo + fixed 30 Hz sim + render
interpolation (01); Rapier kinematic-capsule Character, WASD, spring-arm camera,
pointer-lock free-look (02, 02b); platforms + Fall + Checkpoint respawn with a lockout
penalty (03); jump + dash (04); ragdoll state machine (05); `CharacterController`
extracted from `RapierSimulation` (05b); Spinner Obstacle, dynamic Props, dash-into-a-
wall Ragdoll (06); procedural Wobble + feel-tuning pass (07). Plus a pre-M2 polish pass
on Dash (nitro-style build-up, speed-gated wall Ragdoll, speed-lines effect) and a
MushroomKing character model swap — since superseded by BLIP, the final Character
(ADR 0071). See ADRs 0006 / 0009 / 0010.

**M2 done** — netcode (`docs/milestones/M2.md`, "Done when" met and live-verified with 2
browsers). Authoritative Node server at a fixed 30 Hz (ADR 0002/0011); client-side
prediction + local replay for the local Character, discrete state always snaps (ADR
0013); a decaying render-time offset smooths both the local Character's correction and a
pushed Prop's (ADR 0022 / 0026), with the server consuming `input[serverTick]` rather than
FIFO (ADR 0027); Character-to-Character Bump reuses the M1 Impact pipeline one-sidedly
(ticket 04); ragdoll replication + entity-category/time-sync/snapshot-rate protocol-v2
(ADR 0018–0025). Full implementation surface: `.scratch/m2-netcode/issues/`. Two items
remain explicitly deferred as non-blocking polish (predicted-ragdoll jitter, Wobble
disabled for M2) — see M2.md's checklist.

**M3 done** — Procedural Segments (`docs/milestones/M3.md`, "Done when" met). Design settled via
a grilling session cross-checked against `docs/research/m3-track-storage.md`; recorded as ADR
0028 / 0029 / 0030. Tickets 01–06 in `.scratch/m3-procedural-segments/issues/`: Module library
extracted from M1 (01); track-service (new always-on Node service, SQLite/Drizzle, a project
first) scaffold + seeded (02); Match server fetches its Track from track-service (03); Track
builder — standalone tool, place/save with Module + Track visual previews (04); Track builder
local playtest (05); track-service random Track generation (06). All manually verified live
(real running processes; the builder/playtest via a real browser), not just under vitest.

**M3.5 in progress** — Track builder v2: free position + full 3D rotation for Segments
(ADR 0034, `.scratch/m3.5-free-placement/`). Tickets 01–03 landed; 04 (live overlap ghost-feedback)
and 05 (multi-select) are being finished separately.

**M3.6 done** — Ground and the movement model (`.scratch/m3.6-ground-and-movement/issues/`). Settled
in an eight-round grilling session (2026-09) backed by two research passes
(`docs/research/slope-and-surface-movement.md`, `docs/research/surface-and-volume-mechanics.md`) and
recorded as ADR 0035 (Character movement becomes a persistent-velocity acceleration model), ADR 0036
(Surface is a per-Box property, Volume is its own entity kind) and ADR 0037 (a `Sliding` state, two
independent slope thresholds, and a speed-gated wall Impact). Tickets 01–07: mud, the first Surface
(01); ramps you don't skip down (02); `Sliding` down a steep ramp (03); downhill faster, uphill
slower (04); velocity persists — the accelerate/drag/cap movement model (05); ice (06); the
`Checkpoint.volume` → `trigger` rename that frees the word `Volume` (07). Adds no replicated state
except `Sliding`.

**M3.7 done** — Impulses and air (`docs/milestones/M3.7.md`, "Done when" met). Everything needing an
`Epoch` latch, deferred from M3.6 so the replication protocol changes once. Tickets 01–04 in
`.scratch/m3.7-impulses-and-air/issues/`: speed pads and slow pads, an Epoch-latched write plus a
fading `WALK_SPEED` cap (01); bounce Surfaces and launch pads, a one-shot velocity SET following
Quake's jump pad (02); wall Impact re-expressed as a closing-speed threshold rather than "are you
dashing" (03); Volumes as their own entity kind and an updraft demo Module (04). All manually
verified live through the real `apps/client` render/prediction/network pipeline (headless Chrome
over raw CDP against a real match server and track-service), not just track-builder's own preview.

**M4 done** — Match structure + the first Screens (`docs/milestones/M4.md`, "Done when" met: two
Players meet in a Lobby, race one Track against its clock, see who qualified, then go again on
another Track). Design settled in a three-round grilling session, recorded as ADR 0038 (Time Limit
on the Revision) / 0039 (Finish Zone as a Module trigger) / 0040 (server-authoritative phase, Lobby
on the same socket). Tickets 01–08 in `.scratch/m4-match-structure/issues/`: the game bootstrap
behind a typed config/handle boundary (01, ADR 0008); the Finish Zone entity + Qualification (02);
Time Limit authored on the Revision (03); a synchronous Countdown replacing each client's own guess
(04, ADR 0040); Round end + DNF for a mid-Round disconnect (05); the React shell + code-split game,
built on a new `packages/ui` component library and design-system research (06); the Lobby — nickname,
Ready, host-gated start, a live Track pick that reloads both sides' simulation (07); Results — ranked
by finish order then Track progress, falls shown, and an explicit host-only return to the Lobby for
a fresh Round (08). All manually verified live with two browsers; ticket 08's own session confirmed
the real Results Screen rendering ranked server data and the host's "Back to Lobby" action working
end to end, reusing 07's already-verified `selectTrack`/`start` for the second Round.

**M4.5 done** — Tested where it runs (`docs/milestones/M4.5.md`, "Done when" met). A codebase audit
(`docs/research/codebase-audit-m5.md`) redirected the milestone from its opening premise ("some files
are too large") to its real #1 finding: `apps/client`'s predict/reconcile loop had no seam, so
`predictionRegression.harness.test.ts` tested a hand-maintained copy of it that had already drifted
from production. Tickets 01–09 in `.scratch/m4.5-tested-where-it-runs/issues/`: one real
`needsCorrection` gate, the stale `positionError > 0.2` copy retired (01); the predict/reconcile core
extracted into `PredictionLoop` — `game.ts`'s sole production consumer, the regression harness now
drives the real class instead of a port, including its experimental tick-addressed path via a new
`recordTick` primitive (02, ADR 0013/0021/0026/0027 unchanged); one `isDownMotionState` (03);
`qualificationPlacement`/`StoredTrack` moved into `packages/shared` (04); dead code deleted —
`RapierSimulation`'s unused renderer accessors, `playground.ts` off shared's public index (05); HUD
text extracted as a pure function (06); `selectTrack` gets race tests and a real bug they found fixed
(`startRequested` surviving a live Track swap; 07); `apps/client/src` reorganized by kind, resolving
the `game.ts`/`game/` naming collision (08); `apps/server/src/index.ts` reduced to an entry point,
the 620-line `startServer` split into `match/`, `net/`, `track/` folders (09). One documented
exception to "the harness's numbers don't move": driving the real class exposed a genuine
pre-existing production gap in ADR 0026's capsule-offset smoothing under packet loss (a missing
`positionHistory` entry hard-resets the offset instead of decaying it) — a real finding, not a
regression from this milestone, left as a follow-up. Live-verified with two browsers over raw CDP:
Lobby join, Ready, host start, a real Countdown into RUNNING, and a real wall Impact into `Ragdoll`
correctly replicated to the other client.

**M5 done** — Two Round types on one engine (`docs/milestones/M5.md`, "Done when" met: a Match runs a
Race or a Survival Round on the same simulation, with the rules that differ carried as data). Design
settled in a grilling session backed by two research passes and recorded as ADR 0041 (Round configuration:
Track defaults under Round overrides) / 0042 (what a Fall does is the Round type's rule) / 0043 (a Round
type is data in the shared step, never a branch on the mode) / 0044 (one input lock inside the shared
step). Tickets 01–08 in `.scratch/m5-two-round-types/issues/`: one input lock replacing the two mechanisms
at two layers (01); `RoundRules` — a data record the step reads *fields* of, resolved once before COUNTDOWN
and replicated on the snapshot (02); what follows a Fall becomes a rule, not a constant (03); an eliminated
Character is marked, not removed — its body stays in the world with its collider disabled (04); a Survival
Round ends on the Survivor Target or the Time Limit, and everyone still standing Qualifies (05); the arena
Module, one flat platform over a void (06); the Track builder authors a default Survivor Target and the
Lobby picks the Round type, with a Race on a Finish-Zone-less Track refused with a readable reason and no
Track ever tagged with the types it allows (07); live verification (08).

The point was never the abstraction — it was the *second* implementation, which is the only thing that
proves the seam is in the right place. Ticket 08 ran both Round types in two real browsers against one
never-restarted server and found three bugs vitest had not, all in the seam between "marked, not removed"
and machinery written when a departing Character simply vanished: ghost Characters left behind when the
last Player dropped mid-Round (which also meant no later Race could end by everyone Qualifying), a Track
pick freezing everyone already in the Lobby by restarting the Tick epoch under their already-seeded
prediction tick (ADR 0027), and a DNF'd Player listed twice on the Results Screen.

**M6 + M6.1 done** — Hit and Grab, and a real remote Character (`docs/milestones/M6.md`,
`M6.1.md`). Reordered ahead of multi-Round advancement: Survival (M5) is only as good as the
shoving it enables, and every Character but your own still rendered as a capsule. Tickets in
`.scratch/m6-hit-grab-real-character/` and `.scratch/m6.1-hit-that-lands/`: replicated `facing`
(01, ADR 0045); the capsule placeholder retired for a real oriented, animated model (02, ADR 0046);
Hit (03); Grab (04); a ragdoll that holds its shape — joint limits plus self-collision, after
measuring pelvis-to-head collapse at `0.07` under gravity alone with free ball joints (05, ADR
0047). M6.1 then made a Hit able to knock down at all (hold-to-charge, superseding an approach-speed
design that let a swing fire from a Dash) and replaced the reversed-`Death`-clip knockdown with one
posed from the ragdoll's own eleven bones (ADR 0048), plus Grab's procedural arm-reach and a facing
lock so a held pair strafes instead of spinning.

Live verification found what the suites did not: `Ragdoll.activate` applied its impulse to a body
Rapier had not yet given a mass (`chest.mass() === 0` after the bone had sat `Fixed`), so
`applyImpulse` was a silent no-op and a full-charge Hit knocked nobody down. Both milestones'
end-of-milestone verification tickets had sat unfinished while that reached the player — which is
why M7 has no such ticket.

**M7 done** — a Match, not a Round (`docs/milestones/M7.md`). Design settled in a grilling session
and recorded as **ADR 0049**: elimination stops being a property of the Match and becomes a property
of a Round, every Round pays Score by placement, and the highest total after a fixed number of
Rounds wins. This closes the oldest contradiction in the repo — `CONTEXT.md` has always defined a
Match as running "to a single winner, made of several Rounds", and the code has only ever run one.

**M8 done** — Asset-backed Modules (`docs/milestones/M8.md`, ADR 0050). Four authored GLBs
(`platform_straight`, `ramp_45`, `stairs_4step`, `corner_lshape`) load and collide identically on
client and server through one shared GLB reader in `packages/shared`, replacing procedural boxes
for those four Track pieces — the pipeline, not the final art. Tickets 01–05 in
`.scratch/m8-asset-backed-modules/issues/`.

**M8.1 done** — Free-roam practice: `?freeroam=1` boots a local, server-free playtest session
through the same `<GameCanvas>`, so a Track author can spawn-and-run without Lobby ceremony. Landed
inside the M7/M8 commit range rather than its own — `.scratch/m8.1-free-roam/issues/*.md` still
read `Status: planned` even though `practice.ts`, `PracticeHud`, and `PlayRoute`'s branching are
real, tested, and shipped; correcting those four ticket files is outstanding housekeeping, not open
design work.

**M11 in progress** — Moving Segments (`docs/milestones/M11.md`, ADR 0061): any placed piece can Spin /
Swing / Slide, authored in the builder's inspector and played live with an Impact tint; a Character
Rides moving Segments and is pushed/hit through the Bump-scale Impact rule; Spiked Assets always knock
down. Tickets 01–07 in `.scratch/m11-moving-segments/issues/` are done on tests; 08 (folding the M1
Spinner into Motion) is open, as are the live checks.

**M12 done on tests, visual checks pending** — The Environment (`docs/milestones/M12.md`, ADR 0074,
research in `docs/research/track-environment-sky-and-clouds.md`): every Round is drawn under an
author-picked preset (`day`/`sunset`/`night`): gradient sky dome, a cloud floor replacing the drawn kill
plane (with holes a lower band of puffs shows through), drifting instanced cloud puffs, horizon-coloured
fog, palette lights, a PMREM environment map baked from the dome, real shadow maps from the preset's
sun (a texel-snapped box following the local Character), Neutral tone mapping, night stars, and a
multisampled composer target. Render-only by rule (a server test scans for it); the id lives on the
Revision (`environment` column, validated on publish); the three.js code lives in `packages/render`.
The Track builder picks it beside the Time Limit and previews it behind a viewport toggle (fog and
shadows off there). Tickets 01–11 in `.scratch/m12-environment/issues/` are done on tests and
typecheck. No shader has ever been compiled here (no WebGL), so every visual check is also a first
compile, and all of them are the user's, along with: the `day`/`sunset`/`night` palettes (lighting
balanced numerically, recorded per ticket), the still-open cloud style (`puffs.style`, both `soft` and
`toon` built), and the shadow tuning constants.

**Assets only, one seed (ADR 0078)** — the Track builder places Assets only (the procedural tab and
its box drawing are gone; the shared procedural library remains as test fixtures). Stored Tracks were
wiped, and the API seeds exactly one code-owned Track: the base race (`packages/shared/src/track/baseRace.ts`,
id `base-race`, five-minute clock), a Fall Guys-style course of ten obstacle sections and seven
Checkpoints, proven walkable end to end by `baseRace.test.ts`. Whether its moving obstacles' timing
plays fair is the user's live check.

**M13 planned, the next goal** — Smooth on a weaker PC (`docs/milestones/M13.md`, research in
`docs/research/gameplay-performance-culling-and-asset-loading.md`, **ADR 0079**). Settled with the
user on 2026-09-17:
- measure first: a dev frame overlay (`?perf=1` — since deleted, see below), a headless base-race
  simulation benchmark, and a server tick log;
- load only the Track's Assets and share textures (memory-footprint tickets 01/02, kept in
  `.scratch/memory-footprint/issues/`);
- the camera's far plane follows the fog;
- graphics quality levels the player picks in Settings → VIDEO, never switched automatically, with
  shadows off at `low` (ADR 0079 amends 0074);
- warm up shaders and textures before the Round runs.

Physics distance activation is designed only if the measured numbers ask for it (ticket 07). The user
declined a lighter `trap_trapball` visual and non-casting small pieces. Tickets:
`.scratch/m13-smooth-on-weaker-pcs/issues/`.

Progress (2026-09-17):
- **Done on tests:**
  - 01, the `?perf=1` overlay, with a "copy run" button — **deleted on 2026-09-17** at the user's
    request (`perfSession`/`perfMonitor`/`perfOverlay`/`perfText` and the flag are gone; the server
    tick log under `DONTFALL_PERF=1` and `pnpm bench:sim` stay). The before-numbers in the research
    note were taken with it;
  - 02, `pnpm bench:sim`, and `DONTFALL_PERF=1` on the Match server;
  - 04, the far plane at `fogFarPlane`, with the cloud floor faded before it;
  - 05, graphics quality in Settings → VIDEO, `lib/graphicsQuality.ts`, and the canvas no
    longer antialiased;
  - 06, `Stage.warmUp`;
  - memory-footprint 01, Track-only Asset loading on both sides (ADR 0080);
  - memory-footprint 02, `shareTextures`, now in `packages/render`.
- **Waiting on the user:** the after runs and visual checks; the default level (`high`, or
  `medium`?); memory-footprint 05, still a proposal; ticket 07's decisions.
- **Before numbers:** in the research note's "Results", except the Spectator run. No weaker PC is
  available; the dev Mac with 4× CPU throttling stands in for it.
- **What they showed:** start-of-Round hitches, 35.5 MB of Assets loaded, `stage.render()` as the
  CPU cost that grows, and the Characters' own sweeps (not Moving Segments) as the server's hot
  path.

**M14 done on tests, listening pending** — The game has sound (`docs/milestones/M14.md`, research in
`docs/research/game-audio.md`, **ADR 0087** and its amendments). Settled with the user on 2026-09-17:
sound is presentation only, derived on the client from state it already has (no protocol change); one
`AudioContext` with master/effects/environment/music/ui buses; equal-power spatial sound for other players
and moving Assets under a voice budget; CC0 Kenney packs plus CC0/CC-BY Freesound recordings (credited
in-game), generated music, `.ogg` only; a voiced Countdown; Settings → AUDIO wired per device. Tickets
01–14 in `.scratch/m14-sound/issues/` are done on tests and typecheck, each with an "As built":
- Character sounds (`audio/characterSounds.ts`): getting around (05) and fighting (06), from pure
  per-id edge detectors (`movementCues.ts`, `fightCues.ts`, `riseLatch.ts`) fed the drawn Character once
  a frame. A replay's second rise of `launchPadEpoch`/`respawnCount`/`hitEpoch` (not in `ReconcileBase`)
  is silenced by a refractory window.
- Moving Segments (07), fans/belts/Springs (08), Environment ambience (09), match calls on the server's
  clock (10), music outside any Stage on a three-free page context, the Lobby's playlist app-wide and
  the Round's only in a Match's Round (11), Screens click through one
  delegated listener (12), a 12-Character budget run on the real base race (13, no constant moved),
  and a Credits Screen at `/credits` (14).
- **Waiting on the user:** every listening check (levels, picks, whether a whoosh per spinner sweep is
  too busy), and the throttled frame-time check with 12 Characters.

**A Round loads before it counts down, done on tests** — a `LOADING` phase between the start and the
Countdown (**ADR 0089**, settled with the user on 2026-09-17): each client builds the Round's Track and
reports it (`loaded` on the snapshot), and the Countdown starts only once every connected client has,
with no timeout — a Round waits for the people in it, but never for someone who left. The wait is the
Round loader, full-screen: the Track's screenshot (ADR 0085) and its name. The base race carries its own
(`assets/base_race.jpg`, published with the seed).

Found live while wiring it: the game booted on `welcome.trackId` — the Track as of the socket opening,
not the host's pick — and reloaded only in LOBBY, so a client could draw one Track while the server
simulated another (Characters standing inside scenery, never falling), and every Round after the first
drew the previous Round's Track. The boot now follows the snapshot, and a Track mismatch reloads in any
phase (`apps/client/src/game/roundTrack.ts`).

**Round HUD wired, done on tests** — `RaceHUD` and `SurvivalHud` over the live Round (**ADR 0088**, settled
with the user on 2026-09-17), replacing the debug text block, which is deleted. What the mocks showed and
the game lacked is built, not hidden: a live Race placement and Checkpoint Splits computed by the server
(`SnapshotMessage.liveRace`, `packages/shared/src/match/LiveRace.ts`), Personal Bests per Account and
Track (the server reports each Race Round's finished runs to the API's `personal_bests`; the client reads
`GET /tracks/:id/personal-best`), who is right behind you, and a Survival danger warning read off real
state. **Waiting on the user:** the visual check of both HUDs over a live Round.

**Also open: M9** — Design screens reconciliation (`.scratch/m9-design-screens-reconciliation/issues/`).
A new design-screens drop (`apps/client/src/test_components/`) turned out to assume six systems
this game never had — recorded in `docs/research/test-components-design-screens-gap-analysis.md`.
Ticket 04's scope call is decided (**ADR 0052**): DON'T FALL becomes a persisted-identity game —
mandatory Discord login, a two-currency (XP/coins) economy, dynamic pari-mutuel Betting, and full
Friends all get built; Character Select ships as a stub pending new character art (separate,
already-in-progress work); Track discovery gets browsing + filters only. Tickets 01–03 (the
remaining architecture decisions: the HUD boundary for reaction overlays, the Track builder's ADR
0034 fate, reconciling the two design-token/component kits) and 05–10 (component wiring against
today's real backend) are still open; 11–16 (the new systems ADR 0052 commits to) are scoped but
not yet built.

## Tech stack

- **Language:** TypeScript everywhere.
- **Client rendering:** Three.js, hand-written game loop. No full engine (Unity/Godot/PlayCanvas).
- **Physics:** Rapier (WASM). Same module on client and server.
- **Server (from M2):** Node. Authoritative. One instance (one `MatchRuntime` + `WebSocketServer`
  pair, fully isolated simulation state) per Match — spun up on-demand, in-process by the API's
  lobbies module rather than as a separate OS process (ADR 0054/0058).
- **Screens (from M4):** React + `react-router`, code-split from the game module. The Round HUD is a deduplicated React overlay (ADR 0008, 0088).
- **Monorepo:** pnpm workspaces.
- **Client bundler:** Vite.

## Repo structure

```
packages/shared/   Simulation step, domain types, tuning constants. Runs on BOTH client and server.
packages/render/   three.js rendering shared by the game and the Track builder (the Environment, ADR
                    0074). Imported only by apps/client and apps/track-builder, never by apps/server
                    or apps/api (a test holds the line); `three` is a peer dependency.
apps/client/       Three.js renderer, input, camera, prediction, interpolation.
apps/server/       Authoritative match server (M2+). Imports the sim step from shared.
apps/api/          The single always-on service (ADR 0058, Fastify): tracks, assets, auth, and
                    lobbies on one origin (`:8081`), layered controller → service → DAO.
                    Lobbies are real in-process apps/server instances (ADR 0054).
docs/adr/          Architecture decision records. Read these before changing architecture.
docs/milestones/   Milestone specs. Each is a checklist with a one-line "done" definition.
CONTEXT.md         Glossary / ubiquitous language. Use these exact terms in code and docs.
```

## Non-negotiable architecture invariants

These are settled decisions with ADRs. Do not violate them without adding a superseding ADR.

1. **The simulation runs at a fixed 30 Hz.** Rendering runs independently at the
   display refresh rate and interpolates between simulation states. Never couple
   game logic to frame delta time. (ADR 0004)
2. **The simulation step lives in `packages/shared`** and is pure/deterministic
   with respect to `(state, inputs) -> state`. The client runs it for prediction;
   the server runs it as the authority. (ADR 0003, 0005)
3. **The server is authoritative** (from M2). Clients send inputs, never state.
   Clients predict only their own Character; all other entities are interpolated
   from server snapshots. No rollback. (ADR 0002, 0003)
4. **The Character is a kinematic capsule** driven by a state machine
   (`Controlled → Stagger → Ragdoll → GettingUp → Controlled`). The ragdoll is a
   separate articulated body activated on impact/fall. (ADR 0006)
5. **Screens and the HUD are React; the game loop never is.** React owns the app
   shell and routing and mounts `<GameCanvas>`. The Round HUD is a React overlay
   fed display-rounded values the game raises only when they change — never a
   per-frame value through React. (ADR 0008, 0060, 0088)

## Roadmap

| Milestone | Goal |
|-----------|------|
| **M1** | Local physics playground. "Fun to walk, jump, bump, and fall." |
| **M2** | Netcode — 2 players validated, architected for up to 12 (ADR 0011), authoritative server. |
| **M3** | Procedural Segments — build a Track from Modules. |
| **M3.5** | Track builder v2 — free position and full 3D rotation for a Segment (ADR 0034). |
| **M3.6** | Ground and the movement model — ramps, `Sliding`, persistent-velocity movement, Surface grip. |
| **M3.7** | Impulses and air — speed/slow pads, bounce and launch pads, updraft Volumes. |
| **M4** | Match structure — Rounds, Qualification, Time Limit. First Screens: React shell + lobby/results (ADR 0008). |
| **M4.5** | Tested where it runs — the client's prediction loop gains a seam so its regression suite stops testing a copy. |
| **M5** | Two Round types on one engine — a Round type becomes shared data (ADR 0041/0042/0043), proven by building Survival. |
| **M6** | Hit and Grab, and a real remote Character — replicated `facing` (ADR 0045), the capsule placeholder retired (ADR 0046). |
| **M6.1** | A Hit that lands, and a fall you can watch — a Hit that can knock down, and a knockdown drawn from the ragdoll's own bones. |
| **M7** | A Match, not a Round — several Rounds back to back, scored by placement, ending with a winner (ADR 0049). |
| **M8** | Asset-backed Modules — four Track pieces load from authored GLBs, collide identically on both sides (ADR 0050). |
| **M8.1** | Free-roam practice — `?freeroam=1` boots a local, server-free playtest session through the real pipeline. |
| **M9** | Design screens reconciliation — architecture decisions + wiring for a new visual design; scopes the persisted-identity systems below (ADR 0052). |
| **M10** | Visual Module authoring — compose rounded, colored Modules from boxes/cylinders in the builder (no code, no Blender) and export them to the registry. |
| **M11** | Moving Segments — Spin / Swing / Slide on any placed piece, ridden and hit through the Impact rule, previewed in the builder (ADR 0061). |
| **M12** | The Environment — a sky, cloud floor, clouds, fog, light and real shadows a Track's author picks (`day`/`sunset`/`night`), render-only, shared by game and builder via `packages/render` (ADR 0074). |
| **M13** | Smooth on a weaker PC — measured before/after, Track-only Asset loading, far plane at the fog, player-picked graphics quality (ADR 0079), shader warm-up; physics activation only if the numbers ask. |
| **M14** | The game has sound — Character, moving Assets, Environment, music and UI; spatial, budgeted, presentation only (ADR 0087). Done on tests. |
| later | Accounts (mandatory Discord login) → XP/currency → Betting (dynamic pari-mutuel) → Friends (full presence) → Track discovery (browsing + filters) — scope decided in ADR 0052, one milestone each, build order TBD per milestone. Also: collapsing terrain, Power-ups, reconnection, level themes, the Skyfall final. |

## Working agreements

- Read `CONTEXT.md` before naming anything. If you need a term it lacks, propose
  adding it rather than inventing a synonym.
- Tuning values (jump height, dash cooldown, fall threshold, etc.) live as named
  constants in `packages/shared`, not scattered magic numbers.
- Keep `CONTEXT.md` a glossary only — no implementation detail, no decisions.
  Decisions go in `docs/adr/`.
- When a change is hard to reverse, surprising without context, and the result of
  a real trade-off, add an ADR.
- `/code-review` at **medium** for scaffold/plumbing/small-feature tickets;
  **high** only for intricate logic (netcode, physics state machines, procedural
  generation).

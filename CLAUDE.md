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

**Four authored Tracks, done on tests** — two Races and two Survival arenas, written as data beside
the seed (`packages/shared/src/track/`, the user's ask on 2026-09-18: two of each, Fall Guys-style,
branched, 100+ Segments everywhere and 300+ on a Race). **Spin Cycle** (`spin-cycle`, day, 393
Segments, ~770 m, six minutes) is about things that turn: carousels you ride across, turntables you
hop between, bars that sweep the deck you are standing on, and three forks. **Slip Stream**
(`slip-stream`, sunset, 319 Segments, ~790 m) is about Surfaces: belts with you, against you and
across you, ice, mud, inflatable decks, Springs, fans and launch gaps, also three forks. **Cog
Arena** (`cog-arena`, night, 103) is a machine on three levels so a shove is the start of a
comeback: the cog (a hub with a tall bar through the middle and two jumpable sweepers on its band,
eight teeth: the Start, ice, mud, bounce, two belts into spiked wheels, two plain, five pistons),
eight inflatable ledges in the notches 1.5 m down that bounce you back up, and a rim of 24 planks
2.5 m down with two low bars running round it. **Sky Rings** (`sky-rings`, sunset, 132) is a wheel of
seven rings joined by spokes and outer bridges, every bar on them jumpable, the hub the one floor
nothing sweeps. The walks prove the loops: off a tooth onto the rim, up a ledge, back on the hub;
over a spoke's bar and a ring's. Both arenas were rebuilt
on 2026-09-18 so no piece sits inside another (**ADR 0106**, `track/trackOverlaps.ts`, held to zero
by `survivalArenas.test.ts`); the races are not yet (53, 42 and the base race 8 overlapping pairs).

They are **not** boot seeds — ADR 0078 leaves exactly one of those. `pnpm publish:tracks` publishes
them to a running API the ordinary way (a new Revision per run, ADR 0032), so editing one in the
builder is a real edit that nothing undoes. Placement helpers they share live in
`track/authoring.ts`; `baseRace.ts` was deliberately left alone, being the one Track the API
re-syncs on boot. The rest-pose rule every obstacle obeys: with its Motion stopped the course is
still walkable, so a bar that sweeps a deck is never centred on it. `walkTrack.ts` is the shared
scripted playtest — each Race is walked end to end three times, once per set of arms, so every arm
is proven; each arena spawns a full lobby and holds it through a Countdown. **Waiting on the user:**
everything a walk cannot judge — whether the obstacles' *timing* is fair, whether the forks trade
fairly, and how all four look.

**What playing them found, done on tests** — three fixes from the user's first run of those
Tracks (2026-09-18), each measured against the real simulation before anything was changed:
- **ADR 0094, every Surface costs or gives something.** Mud is now the harshest floor in the game
  (`0.4` top speed, `0.7` jump), ice gets the milder speed penalty its `grip` alone never gave
  (`0.8`, amending ADR 0035/0036's "slick Surfaces never touch top speed"), and a bounce deck is
  the only Surface above 1 (`1.35`, roughly doubling a jump). A jump taken on a bounce deck now
  takes the greater of the jump and the deck's own rebound — before, the take-off ran first and the
  rebound branch never did, so arriving hard and jumping was *worse* than arriving hard and
  standing there.
- **ADR 0095, an Asset can be a Prop.** `segment.prop === true` turns a placed Asset into the
  dynamic body `Prop` has been since M1 — it collides as its authored solid parts (ADR 0065), its
  mass follows its own size, and the client draws it from the replicated pose exactly as it draws a
  Moving Segment. Authored in the builder's SURFACE panel as BODY · PLACED / PROP. Used by every
  cone and both arenas' rim bumpers; the base race is untouched.
- **ADR 0096, a Surface sheet is cut to its deck.** Ice, mud and bounce read the Asset's own top
  face (`deckPlanOf`) instead of the footprint rectangle, so a round deck stops wearing a square of
  ice and a holed deck keeps its hole. Six call sites — three in the game scene, three in the
  builder — now share two geometry builders in `packages/render`.

**Waiting on the user:** whether the four Surface numbers play right, whether a shoved cone is fun
(and whether the arenas still have bumpers after three minutes), and how the cut sheets look — no
shader here has ever been rasterised in this repo.

**The subtraction pass, done** — the user's call on 2026-09-18, after a measured audit
(`docs/research/codebase-audit-2026-09.md`): every god file the M5 audit named has roughly doubled
since, so before splitting anything, take things away. Tickets 1–3 of that audit's backlog: **605
lines added, 2376 deleted** across 31 files, every suite green.

Gone: `apps/client/prototypes/` (a 1692-line fan-airflow spike nothing imported); `ui/Vignette.tsx`
and its stylesheet (the reaction-overlay vocabulary, unused by the app — M9 ticket 01, still open, is
what would have wired it); 14 dead exports and the two things only they read; the Track builder's
three duplicate texture loaders. `setNickname` is gone end to end (**ADR 0097**): the client had been
round-tripping the Account's own display name back to a server that authenticates it, so
`resolveAccount` now reads it off the same `/auth/me` it already called. 55 values un-exported —
narrowed from the scan's 144 by two rules kept deliberately: a **type** in an exported signature is
part of the API whether or not its name is imported, and a coherent documented vocabulary stays whole.
Six `load*Texture` implementations became one `loadDeckTexture`, six clone-and-repeat blocks one
`tileDeckTexture`, three `flatPlane` copies one `deckRectGeometry` — all in `packages/render`, which
is where the builder's own comment said they belonged once such a package existed.

Checked and kept on purpose: `ReclaimMessage` is a designed placeholder (ADR 0024, reconnection is
on the roadmap), and per-module feel constants stay exported — that is the working agreement, not
drift.

**The god files, split** — the user's call on 2026-09-18, with their own comments on the audit
naming what each file should become (**ADR 0098**). Three bootstraps that decided the order of
things *and* did all of them now say only the order:

| File | Before | After | Where the rest went |
|---|---|---|---|
| `apps/server/src/matchServer.ts` | 589 | 119 | `server/{config,ports,statusHttp,connections,seats,perf}.ts` |
| `apps/client/src/game/index.ts` | 1533 | 313 | `game/{types,world,session,serverMessages,frameLoop}.ts` |
| `CharacterController.beginCapsuleTick` | 350 | 37 | nine private methods beside it |

`startServer`, `startGame` and `beginCapsuleTick` keep their exact signatures, and ADR 0008's
client boundary (`GameConfig` in, `GameHandle` out) is untouched — it was already right. A
connection's role is a `Seat` (`take`/`release`) rather than three `if`s; the eight per-tick Surface
setters are one `applyGroundContext`; four hand-written JSON dedupe caches are one `ChangeGate`.

**What the split found, which the scan could not**: a **Grab you could use once per life** —
`grabEngaged` was pushed true by a hold and cleared by nothing but a knockdown, while the two
values reset beside it every tick were, so every later press read as "let go" and did not even play
the reach (fixed, with a regression test); a client Track swap that left the frame loop rendering an
already-disposed Stage (it builds before it disposes now); twenty unused imports and five dead
locals left behind when M13 ticket 01's `?perf=1` overlay was deleted — none of which the
subtraction pass could have found, since its scan read *exported* symbols. **`noUnusedLocals` is
on** now (28 cleared repo-wide to turn it on), so that class of drift cannot come back.

**A Segment's Attachments are one registry** — audit ticket 7 (**ADR 0099**). `Segment` is its
placement plus `SegmentAttachments` (Motion, Conveyor, ice/mud/bounce, a Spring's height, Prop,
Start, Checkpoint — **Attachment** is new in `CONTEXT.md`), each described once in
`track/Attachment.ts` by a mapped type the compiler holds complete. Publish validation, the
builder's setter, the re-chain, Duplicate and both conflict rules read it instead of keeping their
own lists. It found the re-chain's list had stopped at six: **bounce, a Spring's height and a Prop
were dropped** from any Socket-chained Segment the moment anything re-placed it, including scaling
it — fixed, with a test over every registry key.

**`resolveTrack` is a per-Segment visitor** — audit ticket 5, in its own `track/resolveTrack.ts`
(`Track.ts` 957 → 524). Each Segment is placed once, with its `SegmentBody` (`still` / `moving` /
`prop` — the question six scattered guards and a hand copy in the client used to ask), and seven
named families read it in a fixed order that keeps every shared output array's order. Its output
for twelve Tracks is byte-identical before and after; the one deliberate change is that a belt on a
Prop (refused at publish) no longer draws a strip.

**`tuning.ts` is `tuning/`, by domain** — audit ticket 8, the user's layout (2026-09-18): feel in
`clock`, `character`, `movement`, `surfaces`, `knockdown`, `fight`, `world`; configuration in
`netcode`, `match`, `economy`, `authoring`, `hud`. Inside `packages/shared` code imports the file it
means; `@dont-fall/shared` still exports all 181 through `tuning/index.ts`, so no app import moved.
All 181 values proven identical before and after.

**`createStage` says the order, not the work** — audit ticket 9, an extension of ADR 0098. `scene.ts`
1303 → 602; the Track's visuals, the local Character (with its 205-line animation state machine),
the Stage's sounds and the camera's spring arm are `render/stage/*.ts`. No suite here can
rasterise, so it was proven instead: a scratch harness built real Stages headlessly and hashed the
whole scene graph, camera and audio over 170 scripted frames on four Tracks — identical before and
after.

**A Character is four parts and an order** — audit ticket 10, **ADR 0101**, the last of the backlog.
`CharacterController` (1838 → 632) keeps its public API and says only the order of a tick; the work
is `simulation/character/{Movement,Surface,Interaction,Ragdoll}Controller.ts` over a shared `Capsule`.
What a motion state does is a row in `MOTION_MODES`; the cross-Character half of Grab is
`GrabHolds`, out of `RapierSimulation`. Shaped by what the user plans next — a random slip on mud,
ice knocking you down on a crash at any speed, a reworked Grab — each of which now has one place
to go (the ADR says where). Proven bit-identical by a scratch harness over six Tracks; comments
moved verbatim, the user's call.

**Ice crashes and mud slips, done on tests** — **ADR 0102**, the user's ask on 2026-09-18, with the
numbers they picked. On **ice**, running into *anything* at 1 u/s or more knocks you down, other
Characters included (the one run into still takes only its ordinary Bump). A crash counts on
arrival: before the fix, ice's grip let velocity build up against a wall, and a Character pressing
into a rail went down without moving, so a touch too slow to count now removes the velocity into it.
A crash into a Character is asked of the world (`crashIntoCharacters`), because Rapier's controller
stopped 3 of 50 capsule-on-capsule run-ups without reporting the contact. In **mud**, a Slip can
happen three ways: 3% per second of running above half mud pace, a coin flip on any turn sharper than
120°, and a hard landing, as on ice. All three come from the same predicted `slipRoll`. The walker
slipped twice on Slip Stream's mudflat and still finished. **Waiting on the user:** how all of it
plays, especially rails and bumpers on ice.

**Mud is a heaped, bubbling mass, done on tests** — **ADR 0103**, the user's look on 2026-09-18
("fall guys style, hrudkovité, bublat místo kaluží, bez zaoblených okrajů"). The mass in
`packages/render/src/mud/` covers the piece out over its bevel so neighbours join. It is cut square
where it stops, with a side that reaches down to where the 45° bevel meets the piece. The top is
heaped into clods on a world grid, and bubbles swell, pop and leave a sinking ring in place of the
puddles. The game drives the bubbles on sim time, the builder on its wall clock (`simmerMud`).
**Waiting on the user:** every number in `mudLook.ts`, since no shader here has been rasterised.

**Grab becomes a wrestle, done on tests** — **ADR 0104**, settled with the user in a question round on
2026-09-18. A caught Character is `Held` (a new motion state): lifted at arm's length, its input
dead except the **Struggle** (wiggling A/D fills an escape meter within a window). Losing it leaves
it **Limp** for the grabber's carry window, with no get-up clock, then a fresh Ragdoll on release.
The grabber walks and turns slower, can only carry, **Spin** (hold Hit) and **Hurl** (release,
aimed along the tangent and pulled toward where it steers), and gets dizzy if it overspins. A swung
or hurled body knocks others down, and **Grab immunity** stops chaining. There are HUDs for both
sides (the `Grabbed.tsx` mock over the live game; a bottom-centre panel for the grabber). It
supersedes ADR 0093's full-speed drag. Tickets 01–07 in `.scratch/grab-wrestle/issues/`, all done on
tests; the ADR's "As built" says what building it settled (`isPlayerDrivenMotionState`,
`syncOwnHold`, a Held body taking no Impact, `carriedPose`, the Hurl speeds measured). **Waiting on the
user:** everything live — the numbers, A/D wiggling, the Limp pose (the `KO_B` clip held), both panels
over a real Round, and the stand-in sounds.

**A Prop can be carried and thrown, done on tests** — **ADR 0125**, the user's ask on 2026-09-23,
settled in two question rounds. With no Character in reach, Grab picks up a Prop up to
`PROP_CARRY_MASS_MAX`. It is carried kinematic, with its colliders off, and the carrier walks,
turns and jumps (up to `PROP_JUMP_MASS_MAX`) less the heavier it is, never Dashing. A tap of Hit
**Tosses** it (new in `CONTEXT.md`); held, Hit Spins and Hurls it; Grab puts it down; a knockdown
or being grabbed drops it. A thrown or swung Prop hits by the Shooter ball's rule times
`mass / PROJECTILE_MASS`, credited to the thrower; a merely rolling Prop still hurts nobody. Only
the authority picks up; a client learns a carry from `carryingProp` / `carriedBy` and draws the
Prop in its drawn hands (`carriedPropPose`). Tickets in `.scratch/carry-props/issues/`.
**Waiting on the user:** every number, and the pick-up priority beside a Character, live.

**A Bomb, done on tests.** **ADR 0126** comes from the user's drop on 2026-09-23
(`BLIP_Bombs_v1`, animated) and was settled in three question rounds. A Bomb is a Prop
with a fuse. Picking it up lights it (5 s, the last 1.5 s a fast tick), and it stays lit
through any number of hands (hot potato). When the fuse runs out it goes off wherever it
is, even in the carrier's hands: the hold ends first, then everyone in reach takes a
`Blast` Impact that falls off from knockdown at the middle to a Stagger at the edge, and
Props are pushed away. The last one to hold it is credited, never for knocking themselves
down. Then it is gone, and 8 s later it lies where it was placed again. A bomb that falls
off the Track goes out on the same clock. The fuse and the return are per-Segment
(`bomb` Attachment, the builder's BOMB panel, MCP `set_bomb`), and the blast's reach and
strength are in `tuning/fight.ts`. `pnpm convert:bomb` makes `bomb_A`/`bomb_B` black and
keeps the clips. The nine static `kaykit_bomb*` Assets are gone. The client plays the
clips from the Snapshot's rows (`packages/render/src/bomb/`), the first Asset clips ever
played, for looks only. The fuse, the blast and the Shooter's shot have the user's
Freesound picks. Tickets in `.scratch/bombs/issues/`. **Waiting on the user:** every
number, the look and the sounds, live.
The same day, after the user's first look: a Blast throws about three times further
(its own `BOMB_BLAST_LAUNCH_SPEED`, not the scale Hit, Bump and Hurl share) and reaches
6 m (ADR 0126, amended). **ADR 0127** lets a Shooter fire Bombs (SHOOTER · AMMO, MCP
`set_shooter` `ammo`). A shot bomb leaves lit (3 s), knocks down on a direct hit as a ball
does, can be caught and thrown back, goes off wherever it is, and waits for its Shooter
rather than going home.

**A Prop is Lifted and Tossed as the rig does it, done on tests** — **ADR 0128**, from the user's
`BLIP_Carry_v1` drop on 2026-09-24 (our `blip_with_coliders.glb` plus `Pickup_Ground`, `Carry_Walk`,
`Throw_Item`), settled in three question rounds. `pnpm graft:blip` copies the new clips into `BLIP.glb`,
which the game loads. Nothing else in that file changes. Grab at a lying Prop is a **Lift**
(new in `CONTEXT.md`): `Pickup_Ground` 1.5× as fast, the carrier standing still. The Prop is picked
up when the hands reach it. A flying one is caught instead, with no Lift, so ADR 0127's thrown-back bomb
still works. A Toss winds up for 0.4 s, predicted on the carrier's own client, and then lets go. A Spin,
a Hurl and a put-down are unchanged. The server knows only times and a measured grip. Every client draws
a carried Prop between its carrier's drawn hand bones (`CarriedPropPlacer`), so no hand curve is kept in
step anywhere. `modelBones.test.ts` holds the grips and the clip events to the real file.
**Waiting on the user:** everything live. Whether 1.2 s and 0.4 s of standing still play right; the pop
at the touch; and big Props. With the new pose's hands on the belly, `propGripOffset` puts every Prop
out in front at hand height, never raised between the hands (see the ADR's "As built").

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

**Every Track is known before a loader shows it, done on tests** — **ADR 0105**, the user's ask on
2026-09-18 ("blank screens Loading Track… — nothing from our design"). Signing in holds on until the
Track listing and every Thumbnail have loaded (`useTrackArt`, `lib/trackArt.ts`), and Thumbnail URLs
are pinned to the listed `revision`. `<GameCanvas>` names the Round's Track from the route's own
Lobby snapshot before the game has raised one. Every wait is composed from the mocks' pieces: the
Round loader (the screenshot as the Stage's field, `ROUND n OF m`, the name, the mode, what it waits
on) and the plain wait (the menu's Stage, the Logo, a status chip), replacing the old kit's
`Screen`. The Lobby's Round thumbs and BetweenRounds' next-up card show the real picture. The four
authored Tracks carry their own Thumbnails (`assets/<id>.jpg`, rendered from code-written cameras by
`pnpm render:thumbnails` through the builder's dev-only `thumbnail.html`, sent by
`pnpm publish:tracks`). **Waiting on the user:** the look of every wait, and republishing the four
Tracks so their pictures reach the API.

**Online play, verified locally** — **ADR 0108** (superseding the hosting half of ADR 0107, the
user's call on 2026-09-18 after GitHub Pages proved fiddly: "why not simply in Docker"). Online is the
same Docker stack as local on one address: a `web` service (`apps/web/`, nginx) serves the game at `/`,
the builder at `/builder/` and passes `/api/` (HTTP and every Lobby socket, `/api/match/<port>`,
carried on by the API's own proxy) to the API; both apps are built with `VITE_SERVER_URL=/api`, read
against the page's own origin. `pnpm run online` runs `docker compose up -d --build api web`,
publishes missing authored Tracks and prints the one link (a Codespace's forwarded 8088, made public;
locally http://localhost:8088). The Codespace has Docker (`docker-in-docker`) and runs it on every
start. Verified on an isolated stack (18081/18088): game, builder, deep links, `/api`, publishing,
and a real Lobby `welcome` through `/api/match/<port>`. Kept from ADR 0107: the proxy, `?server=`,
`BASE_URL`-aware URLs, the Pages workflow (still deploys, no longer the way to play). **Waiting on the
user:** the first session in a Codespace (see `README.md`).

**A remote Character turns smoothly online, done on tests** — **ADR 0109**, the user's report on
2026-09-19 after playing the online stack against a real player: the other Character's turning was
jerky. Measured before anything changed, on harnesses around the real classes. There were four
causes, and each is now fixed where it starts:
- The Match server ticked at 25–29 Hz on a drifting `setInterval`. It now runs on a grid
  (`tickScheduler.ts`), one Tick per wake, and stamps each Snapshot with its Tick's grid time.
- The LEAD counted frames: it drained 72% of a 144 Hz frame and hunted into input starvation.
  It now counts time, lives in `packages/shared/src/net/lead.ts`, and acts only on fresh feedback.
- Facing was stamped once per frame on every Tick. Each Tick now carries the yaw at its own time,
  and a clamped hitch skips its Tick numbers instead of leaving the server ignoring input for seconds.
- The viewer's clock counted transit time against the Interpolation Delay. It now counts from the
  **Playout Floor**, the least recent arrival lag.

On top of that, remote rigs follow their facing through a 25 ms critically damped follow, exact
during holds and Spins. Found and fixed on the way:
- a carried body's yaw read back mirrored off Euler angles, on both rigs; the local one *sent* it
  as facing;
- a Held own body drawn from its pre-catch pose;
- a handed-back Prop drawn running backward.

End to end, at RTT 80 with the other player on 144 Hz, the drawn turn rate's variation fell from
146% to 18% and still frames from 30/s to 0.8/s. The cost: everything remote is drawn about one-way
latency further in the past. **Waiting on the user:** all of it, live.

**One seat per Account, done on tests** — signing in on a second tab takes the seat and closes the
first, with a reason the Screen shows (**ADR 0090**, the user's call on 2026-09-17). Found while
playtesting: two tabs on one Account used to take two seats, two sets of Score, and one
`match_participants` row between them.

**Round HUD wired, done on tests** — `RaceHUD` and `SurvivalHud` over the live Round (**ADR 0088**, settled
with the user on 2026-09-17), replacing the debug text block, which is deleted. What the mocks showed and
the game lacked is built, not hidden: a live Race placement and Checkpoint Splits computed by the server
(`SnapshotMessage.liveRace`, `packages/shared/src/match/LiveRace.ts`), Personal Bests per Account and
Track (the server reports each Race Round's finished runs to the API's `personal_bests`; the client reads
`GET /tracks/:id/personal-best`), who is right behind you, and a Survival danger warning read off real
state. **Waiting on the user:** the visual check of both HUDs over a live Round.

**Twelve BLIP skins, done on tests** — the body is real art now (**ADR 0091**, the user's call on
2026-09-17). `BLIP_Skins_v1_Pack` brought twelve authored 2048² body textures and a re-export of the
rig (`BLIP_Character_Skins_v1.glb`, now served as `BLIP.glb`) that is the cosmetics-pack rig plus a
UV channel and a textured body material — same nodes, joints, `Hat_Tuck` and 51 clips, verified
against the GLB's own JSON chunk. The old texture-less rig cannot wear any of it. The placeholder
hue tint kept its meaning and lost the word it was borrowing: `bodySkin` is now `color` everywhere
(column renamed in place, `skin` arrives NULL), and a bean wears a Skin **or** a Colour, never a
blend. A skin is a hat for the body — the same Account column, the same level gate on
`PUT /auth/me/cosmetics`, the same Lobby roster, the same podium map, its own Character Select tab
(COLOR / SKIN / HAT / EMOTES). One writer owns the body material, `render/skins.ts`'s `SkinCloset`,
because two would race. **Waiting on the user:** every visual check — the twelve skins on the real
rig, in a Round and on the Screens.

**Jump, Dash and ice retuned, done on tests** — (**ADR 0092**, settled with the user on 2026-09-17
after playing the base race: "dash a jump mají feel jako cheating"). The jump apexes at ~1.3 m
instead of ~2.3 m; the Dash became a resource rather than a move — a 3 s burst, once every 15 s, at
12 u/s instead of 15 — and both Round HUDs grew a recharge meter bottom-right, since a 15 s wait a
Player can only discover by pressing the button is a worse move than a 1.5 s one. `dashEnvelope`
grew a ramp-in so a 3× longer burst *holds* full speed instead of spending three seconds
accelerating. Ice gained two per-Surface knobs in the shape `bounce` already established: a weak
take-off (`jumpMultiplier`) and a landing that may put you down (`landingKnockdown`, above 11 u/s, a
50% chance drawn deterministically per `(Character, Tick)` by `slipRoll` — `Math.random()` would
make every coin flip a mispredicted correction). `baseRace.test.ts` still walks the course, so the
seed stays completable. **Waiting on the user:** whether all three numbers actually play right.

**Hit, knockdown and Grab, done on tests** — (**ADR 0093**, the user's call on 2026-09-17 after playing
Survival). Nothing in the game let a Player actually put someone over the arena's edge: a Hit that
staggered moved nobody (the impulse was only ever consumed by `beginRagdoll`), a knockdown reached
only the ragdoll's chest and so travelled almost nowhere, and a Grab crawled at a tenth of walking
pace with no way to let go. Now a Hit shoves (a decaying knockback contributor, since the ADR 0035
pipeline erases anything written straight into `velocity`), a knockdown *another Player* caused
throws the whole body, and a Grab drags at full speed, latches onto a knocked-down Character and
releases on a second press. Two narrowings were found by failing tests, not foreseen: only a Hit
shoves (a Bump applies an Impact every tick of contact, so shoving on the first touch pushed the
target out of the harder contact that was coming — a Dash stopped knocking anyone down), and only
Hit/Bump throw (throwing on every cause made the base race uncompletable — its spinning squares threw
the walker off). **Waiting on the user:** how it all plays, and whether a three-second drag is too
long to be on the receiving end of.

**M15 planned, in progress** — What the Screens show is real (`docs/milestones/M15.md`, **ADR 0110**,
audit in `docs/research/ui-mock-audit-2026-09.md`). The user's ask on 2026-09-19: resolve every mocked
value on the Screens ("beans online" and the like). Settled in three question rounds the same day:
beans online counts signed-in Accounts by presence heartbeat; the Round number and rewards become the
server's; every avatar is the Player's own; BEST SURVIVAL and GRABS BROKEN get recorded; plus
Leaderboards (wins, per-Track Race times, Survival), emotes and a victory pose outside a Round, the Dash
meter as the mock's charge card, a pause menu with real screen shake and nameplates, private Lobby
setup (ROUNDS, FRIENDS / INVITE ONLY), matchmade public Lobbies with a real queue and a SURVIVAL queue,
parties, voice chat and drafts. The last four are settled with the user before their tickets are built.
Not now: password reset, the shop, the Ragdoll overlay, the Elimination card. Tickets 01–18 in
`.scratch/m15-real-screens/issues/`: 01–14, 16 and 17 are done on tests; 15 (matchmade public Lobbies)
and 18 (drafts) wait on their design questions.

**A Party follows its host, done on tests** — M15 ticket 16 (**ADR 0112**), settled with the user in
three question rounds on 2026-09-19 plus their own design drop (`ui/PartyStrip.tsx`, the `Party` and
`InviteFriends` mocks). Four Accounts; only the **Party host** moves the Party, and it follows
everywhere the host goes (Quick Match, PLAY AGAIN, a created private Lobby, a code, a friend's JOIN,
an accepted Lobby invite); PLAY waits for everyone to be back in the menus; the host leaving the
Party's Lobby takes the Party out, while a member entering a *different* Lobby leaves the Party.
Friends, recent players and anyone with the ten-minute **Party code** (SHARE LINK `/party/<code>`)
can join. It lives in the API's memory and lasts while its members are online.

Two mechanisms carry it, and both fix something older. **The Account socket**: one WebSocket per
signed-in client at `/account`, pushing the Party, Party and Lobby invites, `follow`, `left` and
`removed`, and taking back only where the client is (`menu` / `lobby` / `match`). It replaces the
client heartbeat — which four Screens each ran, so a Lobby invite handed to exactly one of them was
routinely thrown away — and `POST /friends/heartbeat` is gone. **Reservations**: the broker asks a
Lobby's Match server to hold every member's seat (all or none, `SEAT_RESERVATION_TTL_MS`), they count
in capacity and `/status`, a Lobby cannot start while one is live, and a Reservation holds a place in
line so the Party host is still the Lobby host when a member's socket lands first. Ticket 15's
auto-start must treat a held seat as a bean present but not ready; ticket 17 reads `PartiesService`
for voice PARTY.

Review found, and this ticket fixed, what tests had not: a member could take the Lobby host role from
the host who pressed "YOU HOST"; a re-grant refreshed a Reservation's deadline, so a client that never
connected could block any public Lobby's Start; an offline member held PLAY for the whole 90 s grace;
a second tab's takeover read as the host leaving the Lobby and pulled the members out of it; a
logged-out session kept its Account socket, its presence and its pushes. **Waiting on the user:**
everything visual and live — the strip and invite card on a real stage, the menu hero's four-bean
formation (every number a first guess), and the follow-into-a-Lobby flow in two browsers.

**Voice chat, done on tests** — M15 ticket 17 (**ADR 0111**), settled with the user in three question
rounds on 2026-09-19. Opus over our own WebSocket to a relay in a `worker_thread` of the API with a
port of its own, so no voice byte crosses the loop every Lobby Ticks on (nginx routes `/api/voice`
straight to it). OFF / PARTY / ALL, linked both ways by one pure rule in `packages/shared`;
push-to-talk on a rebindable `talk` (V) with an open-mic gate; a voice placed at its speaker's
Character and never silenced; Mutes on the Account; the cue on Avatars, nameplates and a HUD row;
the rows on Settings → AUDIO and in the pause sheet, which now opens on the Lobby and Standings too.
The client's session lives above the routes, so walking from `/lobby` to the podium never ends it.

What building it settled, and the ADR's "As built" records: a voice socket **can beat its own Lobby's
first roster** to the relay, so the two 4001 refusals had to be told apart by reason — one redials,
one is final; `VoicePeer.linked` became the link rule **alone**, because a Mute that removed a peer
from the list would have removed the only row that could unmute them; the jitter buffer holds no
audio at all, only the clock where a speaker's scheduled audio runs out; and capture takes its own
48 kHz `AudioContext`, since the page's shared one runs at whatever the hardware gives it.

Found by its own tests rather than by review: the CONTROLS pane was **crashing** (the `talk` action
had landed in shared without its row, and the pane's own sanity check fires on that mismatch), and
`loadMutes` trusted the response shape — a body without `muted` put `undefined` in the store and every
reader crashed on it.

**Waiting on the user:** all of it is unheard. Echo with speakers rather than headphones on each
browser; latency on a lossy link; the placed voice's falloff; the open-mic gate's threshold; a
Bluetooth headset with the microphone open; and how every cue looks.

**M16 planned** — Traps that act (`docs/milestones/M16.md`). Four authored GLBs arrived on
2026-09-21 and each asks for something the engine has never had. Settled with the user in three
question rounds the same day: **ADR 0116** — an Asset def may declare **Parts** (`still` / `moving` /
`gated`) and one placed Segment resolves into one body per Part, so the author places one thing and
the stored Track, the builder and the MCP tools learn nothing; **0117** — a trap door is a hole on a
clock, its floor existing only while shut, a Character over an opening leaf falling rather than
riding it; **0118** — a fragile floor has three states, every new arrival costs one, the third takes
the floor away and the author's delay brings it back (the first per-Segment state a Round changes
and the Snapshot carries); **0119** — a Shooter fires a ball along its barrel on its own period,
both sides deriving the shot from `(Segment, Tick)` with no message, hitting through the ordinary
Impact rule. None of the four loads as exported (the shared reader refuses a meshed node with no
`role`), so ticket 01 is a converter; the authored clips are read for their numbers and never
played. Tickets 01–05 are **done on tests** (2026-09-21); 06, playing all four in two real
browsers, is the user's. What building them settled, beyond the ADRs: the four GLBs' own
animation *curves* are lifted into the defs and replayed by the Tick, so the trap door falls
exactly as keyframed (the user's point — the clips are authored, they just cannot be
*played*, since the server has no three.js); a `moving` Part with no Motion is still, which
let the shooter keep its Parts until it could aim; a Ride had to be stopped explicitly on a
falling leaf, which was flinging Characters two metres along the arc; a fragile floor is a
body of its own because what is baked into the world cannot be switched off, and it keeps
what a client predicted since the last snapshot; and a Shooter's two aiming axes are its own
data rather than two Motions (the user's call — a Motion is one movement, and the axes must
be independent), with a Projectile a recycled Prop so the protocol never changed. Two more of the user's GLBs arrived mid-milestone and are designed but not built:
the conveyor belt (**ADR 0120** — a def may name a default for an Attachment its
Segments carry, so a placed belt already pushes) and the punching glove (**ADR 0121** —
a Part that slides on a clock or on a trigger, re-timed so the ordinary Impact rule knocks
down, its skin baked out at conversion). Both are now built: the belt conveys as placed, its 36 slats riding a loop described by four
numbers (the rollers' place and radius) that reproduce the export's own `belt_loop_length`
exactly, over a deck box the converter adds because the model's top run *is* the slats; the
glove punches on a clock, its skin dropped in one line (Blender already writes those
vertices in model space) and every piece of its authored motion kept, because the bone
scales turn out to be plain node scales about their own pivots. The glove's **triggered**
mode is deliberately not built: a punch that starts when somebody comes into reach has to
remember the Tick it started on, so its pose stops being a pure function of the Tick — it
wants the per-Segment replicated state ADR 0118 built, and is a piece of work of its own.
A seventh GLB, `DF_sweeper_3_arms` (2026-09-23), brought two more: **ADR 0123**, a
Motion may carry a **Ramp** (N times as fast, T seconds after the Round starts running,
off by default), counted from the **Motion Clock** the server replicates from the
Countdown on (`runningFromTick`), so a Ramp stays a pure function of the Tick; and
**ADR 0124**, `partMotions`, a Motion per moving Part, so each of the three arms has its
own speed, direction and Ramp. Tickets 09–11, done on tests. 08 is the live check. Numbers
that are first guesses and want playing: the trap door's 4 s period, the fragile floor's 6 s
return, and the Shooter's 24 u/s — that last one measured, because 18 only ever Staggered.

**An Asset category answers one question, done on tests** — **ADR 0122**, the user's report on
2026-09-21 ("trapdoor by měl být spíš platform jak obstacle a teď celkově to řazení nedává moc
smysl"). The six groups were cut on three axes at once: `platform` mixed 80 decks with 46 pillars
and barriers, `obstacle` was a leftovers bin of 55 (sweeping bars *and* `trapdoor` *and* loose
bombs), and `spring`/`fan` existed because one mechanic wanted to be findable. Now seven, on one
axis — what the piece is to a runner: **floor** 80 · **structure** 46 · **sweeper** 39 ·
**launcher** 6 · **gate** 7 · **prop** 14 · **scenery** 38, in that reading order in both the
builder's Assets tab and the MCP `list_categories`. A mechanic never moves a piece between groups,
so a spiked or breaking deck is a Floor wearing its own field (the tab already draws the hazard
dot); the two exceptions are the groups every member's def carries — Gate its opening, Launcher its
throw. An inserted Structure now stands on the last Floor instead of continuing the run (the user's
call). The converters' `CATEGORY_RULES` stay the only place a stem is categorized; the generated
defs were regenerated and the diff is `category:` lines only. Nothing stored or simulated changes —
a category has never been persisted on a Segment. **Waiting on the user:** whether `pipe_*` is
Structure or Floor, and whether the trap pack's big rotating rigs read as Floors you ride.

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
| **M15** | What the Screens show is real — no mock value on any Screen, plus the systems the design assumes: Leaderboards, emotes, pause, parties, voice chat, a real queue, drafts (ADR 0110). |
| **M16** | Traps that act — a sweeper, a trap door, a fragile floor and a shooter: an Asset may be several bodies (ADR 0116), and Projectile stops being deferred (ADR 0117/0118/0119). |
| **M17** | Bots — an input source on the authority, Race first with the fight in it, navmesh (`recast-navigation-js`) + behavior tree (`mistreevous`), filling Lobbies, training and Track tests (ADR 0129). |
| later | Accounts (mandatory Discord login) → XP/currency → Betting (dynamic pari-mutuel) → Friends (full presence) → Track discovery (browsing + filters) — scope decided in ADR 0052, one milestone each, build order TBD per milestone. Also: collapsing terrain, Power-ups, reconnection, level themes, the Skyfall final. |

## Working agreements

- Read `CONTEXT.md` before naming anything. If you need a term it lacks, propose
  adding it rather than inventing a synonym.
- Tuning values (jump height, dash cooldown, fall threshold, etc.) live as named
  constants in `packages/shared/src/tuning/`, in the file for their domain — not
  scattered magic numbers.
- Keep `CONTEXT.md` a glossary only — no implementation detail, no decisions.
  Decisions go in `docs/adr/`.
- When a change is hard to reverse, surprising without context, and the result of
  a real trade-off, add an ADR.
- `/code-review` at **medium** for scaffold/plumbing/small-feature tickets;
  **high** only for intricate logic (netcode, physics state machines, procedural
  generation).

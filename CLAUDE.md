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
MushroomKing character model swap. See ADRs 0006 / 0009 / 0010.

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

**Next:** multi-Round advancement — chaining Rounds now that two Round types exist to chain.

## Tech stack

- **Language:** TypeScript everywhere.
- **Client rendering:** Three.js, hand-written game loop. No full engine (Unity/Godot/PlayCanvas).
- **Physics:** Rapier (WASM). Same module on client and server.
- **Server (from M2):** Node. Authoritative. One instance spun up on-demand per Match.
- **Screens (from M4):** React + `react-router`, code-split from the game module. HUD is plain DOM, not React. (ADR 0008)
- **Monorepo:** pnpm workspaces.
- **Client bundler:** Vite.

## Repo structure

```
packages/shared/   Simulation step, domain types, tuning constants. Runs on BOTH client and server.
apps/client/       Three.js renderer, input, camera, prediction, interpolation.
apps/server/       Authoritative match server (M2+). Imports the sim step from shared.
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
5. **The HUD is plain DOM; Screens are React.** React owns the app shell and
   routing and mounts `<GameCanvas>`; the game loop never runs through React.
   The in-match HUD is drawn by the game. (ADR 0008)

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
| later | Multi-Round advancement, collapsing terrain, Power-ups, Grab, Betting/Spectator, level themes, the Skyfall final. |

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

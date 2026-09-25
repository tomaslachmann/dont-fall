# 05 — Jumps, Springs and launches

**What to build:** the links a navmesh cannot see. Where two walkable areas are a jump apart
(across a gap, up a tier) or joined by a Spring, a launch pad, a bounce deck or an updraft
Volume, an off-mesh link is added **only if a jump along it has been proven in the real
simulation**: a scratch `RapierSimulation` of the still Track, a capsule at the start, the
jump or launch played, landing where the link ends. A Bot follows a link with the input that
proved it.

**Blocked by:** 04

**Status:** done on tests (2026-09-24)

- [x] Candidates are navmesh border samples facing each other. The reach comes from a jump
      **played** off each Surface (`jumpEnvelope`), not from a formula
- [x] Springs, launch pads, bounce decks and updraft Volumes: the landing is found by playing it
- [x] Every link stores its recipe (`LinkRecipe`: run-up line, where jump is pressed, whether to
      steer in the air). The proof and the Bot run one controller, `LinkRun`, so a Bot takes a link
      with exactly the input that proved it
- [x] Cost measured. **Proving happens on a worker thread**, and there is a per-process cache (see
      below)
- [x] A Bot finishes Spin Cycle and Slip Stream at rest, through every arm of every fork, with
      zero Falls (`links.test.ts`)
- [x] A Bot finishes the base race at rest from the Start, with zero Falls

**As built:**

- **Links are Detour off-mesh connections** (one-way, `NAV_LINK_AREA`, cost `BOT_LINK_COST`),
  proven on the plain navmesh and then built into the one a Bot plans over. Recast's work runs
  once and only Detour's stage runs twice. `navCorners` tells a Bot which corner starts a link.
- **Kinds:** `jump`, `bounce`, `updraft`, `launch` and `slide`. The kind is only a label; the
  recipe alone decides how a link is followed.
- **Dash:** no link is proven with a Dash. A link only a ready Dash could take would strand every
  Bot whose Dash was spent (15 s, ADR 0092).
- **A clearance sweep before each play.** A query-only Rapier world sweeps a slightly smaller
  capsule along the measured jump and drops candidates that plainly can't pass (posts, railings).
  Measured at rest on Spin Cycle: 5,961 plays and 146 s without it, 817 plays and 1.8 s with it.
- **Recast's ledge filter is off.** With our one-voxel climb it refused every slope over 16°,
  including every authored ramp. Steepness is left to the triangle test (ADR 0037's threshold).
- **At rest**, the base race's legs 2–4 (the stepping stones, the moving rows, the spinning squares)
  are still bodies, so they are on the mesh and linked. With Motion running they are not, and
  crossing them is ticket 07's.

**Links and cost** (Apple M4; the first build in a process, and a repeat from the cache):

| Track | Links at rest | Links, Motion running | First build, running | Repeat |
|---|---|---|---|---|
| Base race | 119 | 37 | 0.24 s | 0.05 s |
| Spin Cycle | 178 | 41 | 0.35 s | 0.12 s |
| Slip Stream | 211 (bounce 17, updraft 35, launch 8) | 162 | 1.1 s | 0.16 s |

No `slide` link was proven on the authored Tracks. Their Races are finishable without one.

**Off the loop (taken over from the stalled agent, 2026-09-24).** Building on the Match loop
stalled every Lobby in the API's process (ADR 0054) for up to 1.1 s. What changed:

- **The heavy part is on a thread.** `BotDriver` asks `workerBotTrackBuilder`
  (`apps/server/src/match/botTracks.ts`), one `worker_thread` per process, bootstrapped through
  `tsx` like the voice relay (ADR 0111). The worker runs `buildBotTrackData`: Recast, the proofs,
  and `exportNavMesh`.
- **The loop does almost nothing.** It posts the still world with `packBotStillWorld`:
  - only the six fields the build reads (`BotStillWorld`);
  - trimeshes as transferred `Float64Array`/`Uint32Array`, since cloning the whole resolved Track
    cost 12–38 ms;
  - about 1 ms to pack.

  It then imports the reply (`botTrackFromData`, 0.1 ms).
- **The Round waits for it.** `MatchRuntime.allLoaded()` also waits for `bots.ready()`, so LOADING
  holds until the Bots' navmesh has arrived (ADR 0089).
- **A failed build never holds a Round forever.** The Bots stand still and it is logged.
- **Tests:**
  - `matchRuntime.bots.test.ts` proves the gate with a builder the test answers by hand;
  - the other server suites use the real worker;
  - `navMesh.test.ts` proves the packed, cloned round trip plans identically.

**Left open:**

- **The builder's NAVMESH overlay proves links on the browser's main thread**
  (`apps/track-builder/src/bot/buildBotNav.ts`). With the toggle on, each geometry change freezes
  the builder for 0.2–2 s, and a repeat is cached. It wants a Web Worker; it's a follow-up.
- **Ticket 04's Slip Stream ice/bumper Fall is gone at rest.** Bots still can't see Props while
  moving; that's tickets 06 and 07.

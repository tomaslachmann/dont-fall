# 06b — A Bot is never stranded

**What to build:** since ticket 06, a Bot that sees late plans round bounce decks, because it
cannot time a take-off from a deck that bounces it on every landing. On Slip Stream the bounce field
has no way round, so no EASY or NORMAL Bot finishes it, and most HARD Bots don't either (all 12
HARD Bots finished before 06). That is a regression on an authored Track. Fix it before ticket 07
builds on top (the user, 2026-09-24).

The direction ticket 06 recorded: a **bounce link proven from every phase of the hop**. The
proof plays the take-off from each point in the deck's hop cycle that a Bot can be in when it
arrives, and keeps the link only if every phase lands. Then a Bot that sees late can take it
without timing anything. If some phases can't land, the link records which ones, and a Bot waits
for a safe phase using what it can see (its own grounded state), never the future.

**Widened by the user (2026-09-24):** the Tracks are islands, not a continuous floor, so bouncing,
jumping and launching are often the *only* way on. The rule is general: **a Bot is never
stranded.** Avoiding a link is only a preference between routes that both exist. When a link
(bounce, jump, launch, slide, updraft) is the only way forward on a leg, a Bot at any level takes
it. It may wait for a safe hop phase or for its view to catch up, and EASY may take it late or
badly, but it takes it. This applies to everything 06 added that can stop a Bot: bounce-deck
avoidance, narrow-strip avoidance, and waiting at a link start.

**Blocked by:** 06

**Status:** done on tests (2026-09-24)

- [x] Bounce links proven across the hop's phases (`linkProof.ts`), cost measured on the worker
- [x] Never stranded: every avoidance or wait 06 added yields when it is the only way on
- [x] At rest, aggression 0, 12 Bots: **every Bot at EASY, NORMAL and HARD finishes all three
      Races** within the Time Limit (after 06: base race EASY 9/12, Slip Stream 0/0/0). Each Bot
      that did not finish is explained — met except Slip Stream EASY and NORMAL, where the cross
      belts carry Bots off: ticket 07c's by the user's call (the suite's `MAY_NOT_FINISH`)
- [x] Ticket 06's `neverStepsOff` suite still holds zero own Falls. A Bot that falls to crowding
      still finishes

## As built (2026-09-24)

Built across two sessions; nothing here is live-verified. Every number below was measured on the
real simulation (`neverStepsOff.test.ts`, the proof report, `bench:sim`), and every tuning value
named is read from `tuning/bots.ts`, never copied.

### Bounce links are proven from the phases of the hop

- A recipe whose start is on a bounce deck is played from phase 0 of the settled hop
  (`ProofWorld.play(recipe, start, 0)`); then `hopPhases()` measures that start's own hop cycle
  (`ProofWorld.hop`) and replays the recorded script from the start and from beside it
  (`besideToo`, the box a Bot stands in) at each phase. The link keeps `hop: { cycle, safe }`
  (`NavLink.hop`, `LinkHop`, `HopState` in `bot/links.ts`) and is kept only if its safe run is at
  least `BOT_HOP_SAFE_RUN_MIN` (derived from `BOT_LEVEL_SPREADS`: the widest stale spread any Bot
  has). Slip Stream: 16 bounce links at rest, 18 with Motion running, every one 8/17 safe phases
  in a row.
- **The phases are searched outward from phase 0, each way until the first failure**, and the
  rest are left unsafe unplayed (the second session's cut). The script was recorded at phase 0,
  so the safe run holds phase 0 whenever it holds anything — on every bounce link of the
  authored Tracks it did, and the cut changed no link and no safe run.
- **A Bot times the hop off its own late view** (`PathBot.ts` `startLink`): `HopReader`
  (links.ts) reads the phase of the view's state against the link's cycle (grounded, vy, height
  over the last seen floor; `null` until a whole cycle in a row has matched), and
  `hopStartable(hop, phase, stale.min, stale.max)` gates the start. `EdgeGuard.fresh(self,
  hopping)` skips the grounded check on a bounce deck.
- **Bounce-deck avoidance is gone**: `BOUNCE_FLAG` removed from `navMesh.ts`; `PathFollower.plan`
  keeps only the edge-strip preference, falling back to the default filter.

### Never stranded — each found by tracing one unfinished Bot

- A **committed approach to a link start** (`approach`, `COMMITTED_STAND`, `gripAllTheWay`): the
  guard's margin held a base-race link start and pushed an EASY Bot back for good.
- **Stall/unstall** (`noteStall`, `unstall`, `BOT_STALL_*`, `BOT_UNSTALL_TICKS`): two capsules
  pressed deep together (a Respawn onto someone) lock each other; the Bot heads straight apart
  with a jump, or a seeded direction when exactly on top (`PathFollower` takes the seed; `TreeBot`
  passes it).
- **The proof's settle** (`ProofWorld.standOn`, plain starts): a reconcile keeps the last Surface
  in the controller, so after a play ending on a bounce deck the first landing on plain floor
  rebounded and every link *onto* a bounce deck failed its replay. Standing is now feet down two
  Ticks running and not rising; a replay's stand-wait runs on until the feet have been down once.
- **Dash** (`wantsDash`): the run is longer by the Bot's stale walk and must be clear
  `BOT_DASH_SIDE_M` to either side (an EASY Dash grazed a still wrecking ball).
- **Ice**: `keepOffEdges` keeps corners `BOT_ICE_WALL_MARGIN_M` from any border on ice
  (`slickEdgesOf`), and the guard counts ice walls among the edges (`near`, when `slick`) — a Bot
  hugging the navmesh border past a bar's end on Spin Cycle's ice catwalk was knocked down by 1 cm.
- **Hazards**: `markVoidEdges` counts a border as an edge when the ray past it hits a hazard piece
  (`stillQueryWorld(world, hazards)`); a HARD Bot hugged a still spike ring on the base race.

### Measured

**Finish counts** at rest, 12 Bots, aggression 0 (`neverStepsOff.test.ts -t "every Motion
stopped"`); own Falls 0 everywhere, before and after:

| At rest | after 06 | after 06b (handoff) | after 06b (closing run) |
|---|---|---|---|
| base race EASY / NORMAL / HARD | 9 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| Spin Cycle EASY / NORMAL / HARD | 12 / 12 / 12 | 12 / 12 / 12 | 12 / 12 / 12 |
| Slip Stream EASY / NORMAL / HARD | 0 / 0 / 0 | 8 / 11–12 / 12 | 8 / 12 / 12 |

Falls that are not a Bot's own, at rest: base race contact 2 / Bump 1 / none; Spin Cycle none /
contact 2–3 / Bump 1; Slip Stream belt 43, Bump 5 / belt 2, Bump 4 / Bump 1. With Motion running
(the handoff's full run): no `step-off` anywhere; Slip Stream has 1–2 `link` Falls a level at the
bounce field, a moving sweeper or slider meeting a Bot mid-hop (ticket 07's).

**Proof cost**, Slip Stream, first Bot-track build in a fresh process (the worker's cost, which
delays the Round's LOADING), Motion running, `build` ms of the proof report:

| | plays | build, median | vs no hop proofs |
|---|---|---|---|
| no hop proofs (the baseline, hop branch disabled) | 1,397 | 1,977 ms (n=3, quiet) · 2,595 ms (n=5, interleaved, noisy) | — |
| every phase played (the handoff) | 2,224 | 2,630 ms (n=3, quiet) | +0.65 s |
| outward from phase 0 (as built) | 2,098 | 2,390 ms (n=3, quiet) · 2,414 ms (n=5, interleaved) | +0.41 s · −0.18 s (noise) |

On proof `ms` alone, interleaved n=5: 2,017 vs 1,986 ms. The cut takes 827 hop plays to 701;
the machine's run-to-run spread (2.2–3.3 s) is wider than what is left, so the target (≤ 0.4 s
over the baseline) is met within noise, not comfortably. At rest the handoff measured 4.3–5.4 s
against 2.8–3.1 s for every phase; the cut was not re-measured at rest. Base race 1.3–1.8 s and
Spin Cycle 3.3 s carry no bounce links and are unchanged.

**Think cost** (`bench-simulation.ts --players 12 --bots 11 --level <l> --ticks 6000`, moving
base race, 11 Bots, p50 / p95 ms): EASY 0.130 / 0.280 (n=3: 0.100/0.190, 0.130/0.280, 0.140/0.310), NORMAL 0.100 / 0.220 (n=1), HARD 0.090 / 0.190 (n=1) — one run costs 1:49 (the bench has no scenario filter), so nine did not fit the session. Every p95 is under the target's 0.35; EASY's median p50 is 0.01 ms over its 0.12, on a machine whose fresh-process proof baseline drifted from 1.98 to 3.25 s in the same hour. Not profiled: the two suspects (`EdgeGuard.guard` with ice walls in `near`, `markVoidEdges`' hazard edges) are open below. Ticket 06 recorded EASY 0.09 / 0.13, NORMAL
0.07 / 0.11, HARD 0.05 / 0.09 at 1,800 ticks. The handoff's 0.12–0.23 / 0.29–1.22 at EASY was
the machine, not the code: nothing was profiled or changed for it.

### Open questions, not this ticket's

- **Belts carry Bots off** (ticket 07c, the user's call): Slip Stream's cross belts (belt 4
  pushes toward the +x edge) carry EASY Bots off 7–17 times each; the guard does not model belts.
  That is every unfinished EASY and most unfinished NORMAL Bot on Slip Stream.
- **A ragdoll gets up inside a barrier's trimesh** (simulation): a NORMAL Bot heading back up the
  third fork's belt arm is run by the belt into the barrier standing there, knocked down, and its
  ragdoll gets up *inside* the barrier (`intersectionWithShape` hits it), stuck for good.
- **Deep capsule overlap after a Respawn locks two Characters** (simulation): measured in
  isolation, 0.3–0.55 m apart they barely move either way. The Bot's `unstall` is a workaround,
  not a fix.
- **Moving obstacles** meeting a Bot mid-hop or mid-link (ticket 07).
- **Think cost at EASY**, if it is real: profile `EdgeGuard.guard` on ice (the slick walls in
  `near` double the edges it plays against) and the hazard edges from `markVoidEdges` on a quiet
  machine, three runs a level.
- **Proof cost at rest** was not re-measured after the cut; if LOADING is still long on a Track
  with many bounce links, the next cut is the per-phase settle (each replay waits for a whole
  hop before its phase), not the phases.

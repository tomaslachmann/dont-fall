# 07h — Moving floors with a crowd, and the ride planner's cost

**What to build:** the 07b/07e half of what 07d's whole-Race run found (`07d-integration.md`,
"As built", sections 1a, 2 and 4; read them first, and this ticket carries their numbers so you need
not look them up again).

**Blocked by:** 07d. **Runs in parallel with 07g**, which owns `sweeperHold.ts`, the non-ride planning
in `PathBot.ts`, `forks.ts` and `difficulty.test.ts`.

**Status:** stopped at the budget (2026-09-24/25, Fable, 75 minutes): the step-off causes are traced and
fixed at their source and T3 NORMAL/EASY meet their passed targets, but the crowd rows and T2 are not met,
and the cost item was not reached — "As built" below, numbers first. **Wall clock: 75 minutes. Model:
Fable.** Stop rule: 3 failed attempts at one target, then record the numbers and the diagnosis and move to
the next item.

- [x] A `crowd` `playSection` case for base Cp 1 → 2 (`deckRider.test.ts`, seed `crowd:base:<level>`, 150 s
      cap so NORMAL/EASY record a time): asserts step-offs 0, stranded 0, the passed targets and HARD within 90 s
      — **HARD passed 9, step-offs 0, stranded 0, but the slowest pass is past 90 s; NORMAL 2 / EASY 1 red**
- [x] Step-offs traced Bot by Bot and fixed at their causes (three, below); **0 at HARD on both seeds**, 4 / 16
      at NORMAL / EASY on the crowd seed (1 / 8 on the `base` seed)
- [ ] T3: NORMAL ≥ 8 (**11**, met), EASY ≥ 4 (**9**, met), stranded 0 (**EASY 1**, not met), HARD ≥ 10 (**10**, holds)
- [ ] T2 NORMAL back to 12 (**11, 1 stranded**; and **HARD 12 → 8, 1 stranded**, a regression of mine, unread)
- [ ] Cost: not reached (no edit to the planner; the queue scan and `dijkstra` are as 07d left them)
- [x] No new tuning value was needed (the spot margin reads `BOT_PATH_EDGE_MARGIN_M`); no scratch file or
      debug toggle remains; typecheck clean in `packages/shared`, `apps/server`, `apps/track-builder`

## Findings this ticket starts from (07d, measured)

1. **The base race's moving rows are a wall with 12 Bots on them.** Whole Race, Motion running:
   HARD finished 1 of 12 (273 s of 300), NORMAL 0, EASY 0. Cp 1 → 2 Falls:
   - HARD: pushed 23, contact 10, **step-off 4**, Stagger 2, Bump 1;
   - NORMAL: pushed 89, contact 68, Bump 20, **step-off 10**, Stagger 9;
   - EASY: Bump 63, pushed 59, Stagger 51, contact 42, **step-off 27**.

   07b's section test with the same leg passes HARD 9 of 12, so the difference is the crowd arriving
   together from a whole Race. Step-offs break ADR 0129's "never steps off", and a Fall off a moving
   deck counts as the Bot's own unless another Character touched it.
2. **Spinning squares (T3, `transfers.test.ts`):** HARD 10 (met). NORMAL 5 and EASY 6 each have
   **1 stranded**. The trace:

   > all twelve plan `2→38T a1.6 w0.0`, the one cheapest entry; all twelve are `waitToBoard` there by
   > Tick 224; the first is aboard at Tick 498; one boards per window.

   07d added a queue cost at planning time, which helped HARD but not the rest. Its diagnosis: the
   boarding rule (`landingTaken` / `someoneAhead`) serialises twelve Bots at one end, and it has to
   **hand a waiting Bot to the next entry live**, not only at planning time. The stranded Bot is most
   likely a give-up wait (`BOT_RIDE_WAIT_MAX_TICKS` + `bestPass`, up to 21 s standing on a 343-Tick
   period) caught by the harness's 10 s window. It is unproven, so prove it or find the real cause.
3. **A regression from 07d:** carousels T2 at NORMAL went from 12 to 10, with 1 stranded. The queue
   cost re-planned a Bot to another entry. It wasn't read.
4. **Cost:** bots' think p95 is 0.42–0.52 ms per Tick for 11 Bots (target ≤ 0.40). The tail is the
   planning Ticks: a ride plan is a Dijkstra over 126 ends plus the queue scan (`ends × characters`),
   and a changed queue signature misses the plan cache. T3 think rose from 13 to 22 µs per Bot-Tick
   with the queue scan. Your share is the ride planning.
5. **Already done, keep it:** the ride table on the base race builds in 35–43 ms (≤ 50). The table isn't
   byte-identical after 07d's probe cache, by design.

## Targets

- **Moving rows with a crowd:** a new `playSection` case for base race Cp 1 → 2, with **12 Bots arriving
  together**, spawned on Checkpoint 1's deck at once, as a whole Race delivers them.
  - HARD ≥ 9 passed, NORMAL ≥ 6, EASY ≥ 3;
  - **step-offs 0** at every level, stranded 0;
  - finished within the leg's share of the Time Limit: 90 s at HARD, and record NORMAL and EASY.
- **T3:** NORMAL ≥ 8, EASY ≥ 4, **stranded 0** at every level. HARD ≥ 10 holds.
- **T2 regression gone:** NORMAL back to 12, stranded 0.
- **Cost:** ride planning's share keeps the whole bots' p95 ≤ 0.40 ms together with 07g's. Record your
  share: `pnpm bench:sim --players 12 --bots 11 --level <l> --ticks 6000`, instrumented for the ride hook.

## Files

**Yours:**
- `src/bot/deckRider.ts`, `src/bot/rideLinks.ts`;
- `src/bot/deckRider.test.ts`, `src/bot/transfers.test.ts`;
- a new "Rides with a crowd (07h)" block in `tuning/bots.ts`.

**Not yours:** `sweeperHold.ts`, the non-ride planning in `PathBot.ts`, `forks.ts` and
`difficulty.test.ts` (07g). 07g may read your ride state through `movingWorld`; if it asks for a
signal, a small read-only accessor is fine. Re-read `tuning/bots.ts`, `packages/shared/src/index.ts`
and ADR 0129 right before each edit, since 07g appends too.

## Measuring

- Use `playSection` on single legs, with `BOT_QUICK=1` for one seed while iterating.
- Don't run the whole-Race suite (`BOT_RACES=1`) until the very end, and then only once. 07g changes
  the holds at the same time. The main session runs the combined whole-Race check after both of you
  finish.

## Regression set at the end

- Every `src/bot/*.test.ts`: 07b's R1/R2 rows, base leg 2 HARD ≥ 9.
- `neverStepsOff -t "every Motion stopped"`: 0 own Falls, 12/12 on every Track and level.
- `apps/server` `matchRuntime.bots` and `matchRuntime.botFill`.
- Typecheck `packages/shared`, `apps/server` and `apps/track-builder`.
- Known reds that aren't yours: `trapHold` D/S wall-clock under load; the 14 standing failures in
  `src/simulation/RapierSimulation.test.ts`; `races.test.ts` and `difficulty.test.ts` (the main
  session's and 07g's).

## As built (2026-09-24/25, Fable, 75 minutes; numbers first)

Seeded (`rides:base:<level>`, `crowd:base:<level>`, `transfers:<track>:<level>`), 12 Bots, aggression 0.
Baseline is the tree as 07d left it, reproduced first: base leg 2 (`rides` seed) HARD 9 / step-off 2,
NORMAL 0 / 5, EASY 0 / 15; T3 10, 5 + 1 stranded, 6 + 1 stranded; T2 12, 10 + 1 stranded, 11. The
section harness reproduces the whole Race's step-offs on its own, so no whole-Race run was needed to trace them.

### The step-offs, traced (every one read as a Bot's own; three causes, each fixed where it starts)

Every step-off's `where` read at y 2.6–3.6 against a 4.9 deck: the rows are 1.5 m thick, so the Bot had
already slid down a row's side face — the recorded z pins the edge it left: the start deck's far edge, still
rows' far and side edges, still rows' *near* bevels. Traced with a temporary per-Bot log (deleted):

1. **The walk to the spread `boardSpot` was a committed, unguarded move steered live from a stale view**
   (`waitToBoard`). An EASY Bot with a 15-Tick-old view has walked 2.75 m past where it sees itself: bot-1
   walked 1.3 m to a spot on the start deck and off its far edge (−186.4); NORMAL bot-1's spot sat 0.2 m
   from the 4 × 4 row's side and it overshot west; NORMAL bot-10 overshot, turned back for a spot behind
   it and drifted off the side. **Fix:** the spot walk is a counted run from a fresh stand with one heading
   (`spotWalkUntil` / `spotHeading`, `walkTicks(away)` — the first cut used `runTicks`, whose 8-Tick floor
   made a 0.4 m walk a 1.4 m run off the beam's side), and `spreadStill` refuses a spot without
   `BOT_PATH_EDGE_MARGIN_M` of floor either way along the rim (`roomy`). Base `rides` seed after this
   alone: HARD 7 / step-off 2, NORMAL 0 / 3, EASY 0 / 2 (from 9 / 2, 0 / 5, 0 / 15).
2. **A jump off a slide row lands 1–3 m off along the slide's axis.** HARD bot-5 came down 1 m wide onto
   the beam's bevel, bot-4 0.95 m wide onto the 4 × 4 row's, NORMAL bot-9 3.9 m wide and short at a 45°
   aim; HARD bot-0 fell five times in one run the same way, counted `pushed` in the crowd. `score`'s carry
   margin probed the landing along the jump *line*; the carry is across it. **Fix:** the landing is probed
   ± `BOT_RIDE_CARRY_MARGIN × |carry| × flight` along the *carry*, as `transferScore` already did, plus
   ± the rim inset along the line. And a Bot down on a bevel beside its floor went to `landing` and STOOD
   while it slid off (bot-5 t1152, bot-4 t2108): `landing` now pushes for `exit.still` while the Bot's centre
   is off the navmesh, up to a stall's worth.
3. **The carry model itself was bent two ways** (07e's "kept less than `carry × flight` assumes", 0.8–2.6 m
   along the carry). `leaveRide` keeps the deck's full velocity in the air with no decay, so the model is
   right; the rider was not: (a) `jumpOff` marched the run-up in world space against the deck's pose
   `runTicks(t)` later, but a Bot running on a deck is carried with it, so the take-off was wrong by
   `carry × runTicks` (1.3 m on a 5 u/s slide) — it is marched in the deck frame now, the take-off being that
   local point as the deck brings it; (b) `LinkRun` steered the Bot back onto its world-space line on the deck
   and in the air, undoing part of the upstream aim — a jump off a deck is now **open-loop**
   (`jumpHeading`: one heading held from the stand to the landing, jump pressed by count, landed when seen
   grounded after the air, a bevel landing heading for the floor); boarding from still floor keeps `LinkRun`,
   having no carry.

### Results (one run of each suite, the two suites beside each other)

| Run | before (07d tree) | after | target |
|---|---|---|---|
| crowd HARD (`crowd` seed) | — | **9 passed, step-off 0, stranded 0**, slowest pass > 90 s (cap 150) | ≥ 9, 0, 0, ≤ 90 s — **met but for the time** |
| crowd NORMAL | — | 2, step-off 4, stranded 0 | ≥ 6, 0 — not met |
| crowd EASY | — | 1, step-off 16, stranded 0 | ≥ 3, 0 — not met |
| base HARD (`rides` seed) | 9, step-off 2 | **4**, step-off 0, own 2 | 07b's ≥ 8 — **red now** (see below) |
| base NORMAL / EASY | 0 / 0, step-off 5 / 15 | 1 / 0 (2 stranded), step-off 1 / 8 | 07b's known reds |
| R1 / R2 | 12 / 11 / 11, 12 / 12 / 12 | **12 / 12 / 12, 12 / 12 / 12** (R1 EASY own 1) | hold |
| T3 | 10, 5 + 1 str., 6 + 1 str. | **10, 11, 9** + 1 stranded at EASY | NORMAL ≥ 8 **met**, EASY ≥ 4 **met**, stranded 0 not |
| T2 | 12, 10 + 1 str., 11 | **8 + 1 str.**, 11 + 1 str., 10 | 12 / 0 — **HARD regressed**, mine |
| T1 | 12 / 12 / 12 | 12 / 12 / 12 | hold |
| `neverStepsOff -t "every Motion stopped"` | 9 / 9 green | **9 / 9 green**, 0 own Falls, 12/12 everywhere | hold |
| think, base HARD | 14 µs | 13–14 µs per Bot-Tick (T2 26–38 under the parallel load) | ≤ 40 |

**Read.** The two base seeds on one tree give HARD 9 and 4, so this leg's run-to-run spread on one seed is
at least that wide, and 07b's `base hard ≥ 8` row (green on its seed before, red on it now) sits inside it:
the honest A/B is the step-off column (2 → 0 on both seeds at HARD). What the passes lost is not read: an A/B
without the carry-axis margin gave HARD 5 (so not that); after fix 1 alone HARD read 7, after fix 2 3, after
fix 3 4 — the `pushed`/`contact` Falls (24 + 7 at HARD) are the crowd on the first row, which every version
has, and a Bot that now waits for a low-carry window on a narrow floor waits longer in it. **T2 HARD's
regression is fix 3's open-loop jump on a spin** (T2 is two carousels; the carry is tangential and the
deck frame turns during the run-up, which a held world heading does not follow): unread, three attempts spent.
The T3 EASY stranded Bot and the `base` EASY stranded 2 are the give-up wait 07d named (up to 21 s standing
on a 343-Tick period, caught by the harness's 10 s window); the live hand-off of a waiting Bot to the next
entry was designed here but not built (budget).

### What to build next (in order)

1. The open-loop jump-off on a **spin**: hold the heading in the deck frame (rotate it with the deck each
   Tick until take-off), or fall back to `LinkRun` when `platform` spins — this alone should return T2 HARD.
2. The live hand-off in `waitToBoard`: when `someoneAhead`/`landingTaken` holds a Bot, re-run `planAcross`
   with the current queue and, if its first ride's entry differs, `reset()` so the follower replans (its
   `plannedTick` is stale, so it does so at once) — the 07d diagnosis; and count a queued wait as not stranded.
3. Cost: adjacency lists per end (`walksFrom[u]`, `linksFrom[u]`) so `dijkstra` stops scanning 1784 links
   per node, and start-walks keyed by a 2 m cell of `from` so a changed queue signature reuses them.

### Files

`bot/deckRider.ts` (`spotWalkUntil`/`spotHeading`, `roomy` in `spreadStill`, the `landing` push, the carry-axis
landing probe in `score`, `jumpOff`'s deck-frame run-up, `jumpHeading` and the open-loop branch of
`boarding`/`alighting`), `bot/deckRider.test.ts` (the `crowd` case). `rideLinks.ts`, `transfers.test.ts` and
`tuning/bots.ts` unchanged. No scratch file or debug toggle remains.

## Round 2 (the main session, 2026-09-25)

**Wall clock: 75 minutes. Model: Fable.** Runs in parallel with 07i, which owns `sweeperHold.ts`,
`linkProof.ts`/`links.ts` and the non-ride planning. It starts from this ticket's own "As built" and
"What to build next", and from the combined whole-Race run in `07d-integration.md`'s last section.

In order:

1. **T2 HARD 12 → 8, your regression.** A held world heading doesn't follow a turning deck's frame
   during the run-up. Rotate the heading with the deck, or fall back to `LinkRun` on a spin. Target:
   T2 back to 12 / ≥ 11 / ≥ 10, stranded 0.
2. **Hand a waiting Bot to the next entry live**, not only at planning time, as designed in this
   ticket. Target: T3 and the crowd case with stranded 0 at every level, T3 staying at 10 / 11 / 9
   or better.
3. **Moving rows with a crowd at NORMAL and EASY.**
   - The whole Race's Cp 1 → 2 has 123 Falls at NORMAL (pushed 76, contact 18, Bump 14) and 203
     at EASY (contact 52, pushed 48, Bump 42), with EASY step-offs at 30.
   - The crowd case gives NORMAL 2 and EASY 1 passed, with step-offs 4 and 16.
   - Targets:
     - the crowd case at NORMAL ≥ 6 and EASY ≥ 3;
     - **step-offs 0** at every level;
     - HARD within 90 s where the seed allows. Record both seeds, since this leg's seed spread is
       9 against 4.
4. **Cost.** The ride planning's share of the bots' p95. The plan is in "What to build next":
   adjacency lists for `dijkstra`, and start-walks keyed by a 2 m cell. 07g's belt scan per sample is
   07i's to fix. Target: the whole bots' p95 ≤ 0.40 ms.

Don't run the whole-Race suite; the main session runs it after both parts finish. The regression set
is as above, and 07g's `difficulty.test.ts` reds are known.

## As built (Round 2, 2026-09-25, Fable, two sittings; numbers first)

The first sitting (stopped mid-work, its changes in commit `995e881d`) built all four items; the second
read that diff against the items, ran the suites, traced the one new red, and wrote this. Every run below
was beside 07i's suites on four cores (three vitest workers at 100%), so **every wall-clock number is
inflated** — think µs, table build ms and the bench — and the passed / stranded / step-off columns are
what the round answers for (the section harness is deterministic per seed; T1 NORMAL reproduced alone,
Tick for Tick).

| Run | Round 1 | Round 2 | target |
|---|---|---|---|
| T2 (two carousels) | 8 + 1 str. / 11 + 1 str. / 10 | **12 / 12 / 11**, stranded 0 | 12 / ≥ 11 / ≥ 10, 0 — **met** |
| T3 (spinning squares) | 10 / 11 / 9 + 1 str. | **11 / 10 / 11**, stranded 0 | ≥ 10 / ≥ 8 / ≥ 4, 0 — **met** |
| crowd HARD (`crowd` seed) | 9, step-off 0, > 90 s | **12**, step-off 0, stranded 0, slowest **56 s** (Tick 1678) | ≥ 9, 0, 0, ≤ 90 s — **met** |
| crowd NORMAL | 2, step-off 4 | **12**, step-off 0, stranded 0, slowest 110 s | ≥ 6, 0 — **met** |
| crowd EASY | 1, step-off 16 | **3**, step-off 0, stranded 0, slowest 143 s | ≥ 3, 0 — **met, on the line** |
| base HARD (`rides` seed) | 4, step-off 0 | **12**, step-off 0, own 0 | 07b's ≥ 8 / own ≤ 3 — **met** (red only on think ≤ 40 µs: 54 under load) |
| base NORMAL / EASY | 1 / 0 (2 str.), step-off 1 / 8 | **9** / 1, stranded 0, step-off **0 / 1** | 07b's ≥ 6 / ≥ 3 — NORMAL **met**, EASY known red; one step-off left at EASY (`bot-1` at (2.6, 4.7, −216.2), Tick 2488, unread) |
| R1 / R2 | 12 / 12 / 12, 12 / 12 / 12 | 12 / 12 / 11, 12 / 12 / 11 (both EASY: 1 slow, 0 stranded) | hold |
| T1 (two turntables) | 12 / 12 / 12 | 12 / **11 + 1 stranded** / 11 | **regressed at NORMAL** — a simulation wedge, below |
| `neverStepsOff -t "every Motion stopped"` | 9 / 9 green | **9 / 9 green**, 0 own Falls, 12/12 everywhere | hold |
| think, base HARD / T3 | 13–14 µs | 34–54 µs under the load (crowd 33–39) | ≤ 40 — read alone before trusting |

### What each item became

1. **T2, the held heading on a spin.** The jump-off's run-up is now a line in the *deck's frame*
   (`JumpOff.takeOffLocal`, `DeckRider.jumpLine`): before the press the Bot heads along that line as the
   deck has turned it each Tick, and from the press on it holds `jumpHeading`, which is that line's world
   heading at the take-off. `solveJumpOff` lays the line along the deck-frame direction that *is* the aim at
   the take-off (on a spin the frame turns during the run-up; laid at `at` it came off the rim 8° round).
   The fallback to `LinkRun` on a spinning deck was tried and measured worse (T2 10; T3 10 / 9 / 7 → 7 / 7 / 6),
   so the deck-frame line is followed on every deck.
2. **The live hand-off** (`handOff`, `BOT_RIDE_HANDOFF_TICKS`): a Bot held at a still entry by `someoneAhead`
   or `landingTaken` asks `planAcross` again every 30 Ticks with the queue as it stands (never sooner after the
   wait began than `BOT_REPLAN_TICKS`, since only then does `PathFollower` replan at once), and if the way it
   finds now starts at another entry, `reset()`s so the follower goes there. `handedOff` is counted, not
   asserted. "Count a queued wait as not stranded" was **not** built: with the hand-off, no queued wait
   reaches the harness's 10 s window on T3 or the crowd rows, and the one stranded Bot left (T1) is not queued.
3. **The crowd rows at NORMAL and EASY.** Two more causes, both read from the crowd seed at EASY:
   - a jump's landing was probed along the line and along the carry, never *across* — a Bot spread across the
     deck jumps at the still diagonally and came down 0.35 m wide, on a row's side. `roomyShift` moves the aim
     across the line by `BOT_PATH_EDGE_MARGIN_M` when the landing has floor on one side only;
   - the `landing` push for the still (Round 1's fix 2) fired on a Bot that had landed *on* the floor's top a
     hand's width inside its edge (the navmesh's own erosion reads null there), and steered live off a view 15
     Ticks late it walked an EASY Bot 2 m past the still and off the row's far side — eight of eleven crowd
     step-offs at EASY, at one spot. It now fires only when the Bot is *down* a face by more than
     `NAV_AGENT_CLIMB`.
4. **Cost.** `dijkstra` reads adjacency lists built once per ride table (`adjacencyOf`: `linksFrom[u]`,
   `linksOff[platform]`, `walksFrom[u]`, `endsOf[component]`) instead of scanning 1784 links per node, and
   the start-walks from the Bot's floor to every still end of its component are cached by a
   `BOT_RIDE_START_CELL_M` (2 m) cell (`startWalksFrom`), so a changed queue signature no longer pays every
   navmesh walk again. The bench logs the share (`ridePlanCost`, printed by `pnpm bench:sim`; that is the
   `scripts/bench-simulation.ts` edit): (filled below).

### The one new red: T1 NORMAL, a Character pinned inside a Moving Segment (the simulation's, not the rider's)

`transfers:T1:normal`, `bot-9`, traced Tick by Tick. It was `waitToAlight` on the second turntable, standing
still while the spin carried it (Ticks 429–495); at Tick 496 it was carried onto a seam between two of the
disc's eight pieces, sank 0.18 m into the groove (grounded, `platformUnder` null, so `waitToAlight` reset the
ride), and by Tick 500 it sat at y 4.45 — 0.4 m under the top, inside the outline — **never grounded again,
its position frozen to the centimetre for the remaining 1300 Ticks while `velocity.y` grew without bound
(−3.5 at Tick 500, −843 at Tick 1645)**. A push for the deck's middle and a jump pressed both ways (the same
remedy `aboard`'s lodged branch uses; built into `offLip` for the air case, run, and taken out again) changed
its horizontal velocity and nothing else: the capsule controller cannot move it, and jump cannot fire off the
ground. That is a simulation defect — a kinematic capsule wedged inside a moving body is neither pushed out nor
counted as fallen — and a human Player carried onto that seam would be stuck the same way. Left for the main
session (`simulation/character/`, outside this ticket's files). The Bot-side symptom is one stranded Bot on
T1 NORMAL, where Round 1 had none; the seam drift is the ride's chord-versus-arc carry over 67 still Ticks and
is not new, so which Round 2 change moved `bot-9` onto it is chaos, not read.

### Files

`bot/deckRider.ts` (`solveJumpOff`/`roomyShift`/`jumpLine`, `handOff`, the `landing` gate, `adjacencyOf`/
`startWalksFrom` and `dijkstra` on them, `ridePlanCost`), `tuning/bots.ts` ("Rides with a crowd (M17 ticket
07h, round 2)": `BOT_RIDE_HANDOFF_TICKS`, `BOT_RIDE_START_CELL_M`), `src/index.ts` (`ridePlanCost` export),
`scripts/bench-simulation.ts` (the ride planning's share printed per run), ADR 0129 "As built", this ticket.
`rideLinks.ts`, `deckRider.test.ts` and `transfers.test.ts` unchanged this round. No scratch file or debug
toggle remains; typecheck clean in `packages/shared`, `apps/server`, `apps/track-builder`.


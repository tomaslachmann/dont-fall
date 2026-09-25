# 07d — Integration: every Race with Motion running

**What to build:** 07a–07f together, on the real Races, with Motion running. The mixed legs no part
owns are proven here: Spin Cycle 0 (gates + carousels), 2 (turntables + hammers), 3 (the fork), 7
(the carousel with a bar on it); base race 3 (spinning squares with a spiked bar), 5 (belts under
sliding walls), 7 (hammer alley); Slip Stream 5 and 6 (belt against under wrecking balls; 06's
baseline had 7–9 of 12 stranded there, see 07c's diagnosis).

**Blocked by:** 07a, 07b, 07c, 07e, 07f

**Status:** in progress (Fable, started 2026-09-24). **Wall clock: 75 minutes.** Stop rule: 3 failed
attempts at one target, then record the numbers and the diagnosis, and move to the next item.

- [ ] A HARD Bot finishes every Race with Motion running (**red**: base race 1/12, Spin Cycle 0/12, Slip Stream 8/12); NORMAL and EASY finish counts recorded (below)
- [x] The level ordering measured again: finish time **and** obstacle Falls strictly EASY > NORMAL
      > HARD over enough seeds; `difficulty.test.ts`'s `it.todo`s become real assertions (**they are, and red: the order is inverted**, below)
- [ ] Every leg of the three Races through `sectionHarness.playSection`, 12 Bots, 3 levels, Falls by cause, in one table here (not run leg by leg: the whole-Race sections table below is the Falls by cause per leg, from the Start)
- [x] Falls counted per section (between Checkpoints) and by cause, in the shape ticket 11 reads (`playRace` → `RaceReport`, `sectionHarness.ts`)
- [ ] 12 Bots' think cost on the moving base race, via `pnpm bench:sim` (see "Cost" below)
- [ ] **NORMAL and EASY speed on the base race's moving rows** (moved from 07b by the user,
      2026-09-24). They pass leg 2 with 0 stranded but take longer than 90 s, because every ride
      costs a fresh stand, a window and a turn. Measure where the standing time goes, and judge it
      against the base race's 5-minute Time Limit (**judged: with 12 Bots from the Start, no NORMAL or
      EASY Bot gets past the rows inside 5 minutes**, below; where the standing goes was not reached)
- [x] 07a's strict level ordering on base leg 1 (moved here): measure it over several seeds on
      whole Races (settled by the whole-Race and Checkpoint 4 → finish numbers below: there is no strict
      order to read, the ordering is inverted by a cause named below)

## The brief (the main session, 2026-09-24)

What every part found that this ticket needs is here, so it is not found again. The numbers are the
parts' own measurements, 12 Bots and aggression 0 unless stated.

### Order

1. **07e's two leftovers**, first, because the base race's section 3 (spinning squares) depends on
   them:
   - **(a) The ride cost counts the wait at the exit.**
     - *Cause (07e, read, not fixed):* on a spinning square, the corner that meets the lane also meets
       the other square, so both ends of the ride sit on one vertex. The ride then costs
       `BOT_RIDE_COST_M + across` with `across = 0`. Every Bot waits half a turn on the tip it landed
       on, and `landingTaken` holds every boarder behind it: one Bot per 5.7 s, first pass at Tick 701.
     - *Before:* T3 in `src/bot/transfers.test.ts` gave HARD 7 passed (5 slow), NORMAL 6 (6 slow),
       EASY 6, own 1, stranded 1 (unproven; most likely a give-up wait caught by the harness's
       10 s window).
     - *Target:* T3 at HARD ≥ 10, NORMAL ≥ 8, EASY ≥ 4, own Falls ≤ 2, stranded 0.
   - **(b) Cache `navFloorWithin` by probe cell** in 07b's still-end scan (`rideLinks.ts`).
     - *Cause:* since 07e the base race's spinning squares are platforms (8 floors), and each one
       adds a 343-Tick still-end scan.
     - *Before:* the base race ride table took 66 ms alone and 141 ms under parallel load. 07e's
       transfer stage is 7 ms of that. Spin Cycle took 145 ms, of which transfers were 16–20 ms,
       and `RideTable.transferMs` is exposed.
     - *Target:* the base race table ≤ 50 ms (07b's own row, currently red). A/B it: the table
       must be identical.
2. **Whole Races, Motion running.** 12 Bots, EASY, NORMAL and HARD, on the base race, Spin Cycle and
   Slip Stream, from the Start with each Race's real Time Limit:
   - a HARD Bot finishes every Race, and NORMAL and EASY finish counts are recorded;
   - own Falls (step-offs) are 0 and stranded is 0;
   - Falls per section (between Checkpoints) and by cause, from **one exported function** that
     ticket 11 will call, not test-only code;
   - finish times per level against the Time Limit. On NORMAL and EASY on the base race's moving
     rows (from 07b), measure where the standing time goes. Finishing within the base race's
     5 minutes is a pass.
3. **Level ordering** (from 07a and 08), over enough seeds to beat run-to-run noise. Pick n from the
   measured variance and state it. Finish time **and** obstacle Falls must be strictly
   EASY > NORMAL > HARD.
   - Turn `difficulty.test.ts`'s `it.todo`s into real assertions, and settle 07a's red row.
   - If the order doesn't hold, find the profile field that fails to separate the levels, and
     fix that cause, not the thresholds.
   - *Known:*
     - with 07a's hold off, base leg 1 already passed 12/12/12 with obstacle Falls 1/0/0, so
       one seed on one leg cannot show an order (07a);
     - after 06, a lone Bot at rest ran a leg equally fast at every level; only look-ahead and
       timing error separate them (06);
     - 08's first measurement had HARD falling more than NORMAL, 3 vs 1 at n = 12.
4. **Cost.** `pnpm bench:sim --players 12 --bots 11 --level <l> --ticks 6000` on the moving base
   race, per level. *Target:* all Bots' think p50 ≤ 0.15 ms and p95 ≤ 0.40 ms per Tick. Also record
   the moving-world pose cache per Tick; the groundwork measured 24.6 µs for 32 bodies against
   20, with the cause in `movingSegmentPose`'s array spread.
   - *Before:* 06b had EASY 0.130/0.280 ms, NORMAL 0.100/0.220, HARD 0.090/0.190, before
     07a/b/c/e/f.
5. **Test runtime.** The whole-Race suite is heavy (12–20 s a Round). Gate it out of the package's
   default test run (an env gate, or the repo's convention if one exists), and write here how to
   run it.

### Where things are

- Harness: `src/bot/sectionHarness.ts` (`playSection`, `BOT_QUICK=1`, `ownFalls`, `obstacleFalls`).
  A Fall off a moving deck counts as the Bot's own unless another Character touched it (07b,
  second session).
- Hooks: `src/bot/hooks.ts` `defaultHooks` wires them in this order:
  - hold: 07a `SweeperHold`, then 07f's trap door, Shooter and fragile holds;
  - ride: 07b and 07e `DeckRider`;
  - push: 07c `BeltPush`.
- Respawns spread round a busy Checkpoint (`RapierSimulation.clearRespawn`, main session), so
  crowding no longer locks Bots. `unstall` stays as a backstop.

### Known reds that aren't this ticket's

- `trapHold` D under parallel load; it passes alone, since its think assertion is wall-clock.
- 14 standing failures in `src/simulation/RapierSimulation.test.ts`: identical with and without
  the Respawn fix.
- The fragile floor as the only way on (07f's F1) belongs to ticket 12.

### Regression set at the end

- Every `src/bot/*.test.ts`.
- `neverStepsOff -t "every Motion stopped"`: 0 own Falls, 12/12 on every Track and level.
- `apps/server` `matchRuntime.bots` and `matchRuntime.botFill`.
- Typecheck `packages/shared`, `apps/server` and `apps/track-builder`.


## As built (2026-09-24, Fable, 75 minutes; numbers first)

Everything here is seeded (`races:<track>:<level>`, `difficulty-suite:<level>:<n>`, `transfers:T3:<level>`),
12 Bots and aggression 0 unless stated, on one M4 with other suites running beside it (wall-clock µs are ±2×).

### 1a. The ride cost counts the wait at the exit (built; T3 HARD met, NORMAL/EASY not)

`RideEnd.openPhases` (the phases, in the platform's own period, at which a still end's sample met its
floor, or a transfer end's rim met the other rim — collected in the still-end scan by merge group and, for
transfers, by a second pass over the picked pairs only) and `RideLink.wait`: the mean over the entry's
open phases of the Ticks from arriving at the exit (a flight plus `across` at walking pace) to the exit's
next open phase, in metres of walk — **less the least any ride from that entry waits**. Priced absolutely
(the first attempt) the planner sent all twelve Bots to the one lane corner whose entry met the exits
soonest: T3 NORMAL 6 → 3, EASY 6 → 1, 16 contact Falls at x −5.2. Relative, the exit choice is right
(from the most-open corner end: the same tip `a0.7 w26.4`, a corner on `a7.6 w3.0`) but T3 was
**unchanged at 7 / 6 / 3** — because the trace showed the bottleneck was never the exit:

> all twelve plan `2→38T a1.6 w0.0`, the one cheapest entry; all twelve are `waitToBoard` there by Tick
> 224; the first is aboard at Tick 498; one boards per window.

So the third attempt prices the **queue at a still entry**: `dijkstra(…, queue)` adds, per Bot already
standing within `BOT_LINK_QUEUE_M` of an entry's still (read off `view.characters`), one turn of that
platform's period in metres of walk, and the plan cache key carries the queue's signature. Result:

| T3 | before (07e) | after | target |
|---|---|---|---|
| HARD | 7, 5 slow | **10**, 0 stranded, own 0, 2 slow | ≥ 10, own ≤ 2, stranded 0 — **met** |
| NORMAL | 6, 6 slow | 5, **1 stranded**, 6 slow | ≥ 8, stranded 0 — not met |
| EASY | 6, stranded 1 | 6, **1 stranded**, 5 slow | ≥ 4, stranded 0 — not met on stranded |

Three attempts, stopped. Think on T3 rose 13 → 22 µs per Bot-Tick (the queue scan is `ends ×
characters` per plan, and a changed signature is a plan-cache miss). The stranded Bot at NORMAL/EASY is,
as 07e guessed, most likely a give-up wait (`BOT_RIDE_WAIT_MAX_TICKS` + `bestPass`, up to 21 s standing on
a 343-Tick period) inside the harness's 10 s window; unproven here. **What the numbers say the real fix
is:** a still entry on a spinning square admits one Bot per pass of one corner, and the planner cannot
price a queue it only sees once it exists; the boarding rule itself (`landingTaken` / `someoneAhead`) is
what serialises twelve Bots at one end, and it needs to hand a waiting Bot to the *next* entry live,
not at planning time.

### 1b. `navFloorWithin` cached by probe cell (done; the table is not byte-identical, and cannot be)

Profiled first: 8 builds of the base race and Spin Cycle spent 652 of ~1035 ms in `navFloorWithin`
(1.09 M calls, 0.6 µs each; 136 k per base-race build), **404 ms of it in `runUpBack`'s marches**;
`navPath` 21 ms, `componentOf` 21 ms. An exact-key memo (1 mm) hit 16 % and cost more than it saved.
`cachedProbe` in `rideLinks.ts` keys a numeric cell of `BOT_RIDE_PROBE_CELL_M` (0.1 m, new in
`tuning/bots.ts`) and the box; the first probe in a cell answers for the cell.

| table | before | after | budget |
|---|---|---|---|
| base race | 63–76 ms alone (108–154 under load) | **35–43 ms** | ≤ 50 (07b's row, green again) |
| Spin Cycle | 174–221 ms | **85–94 ms** | (80 was 07e's for the transfer stage alone: 16–19 ms) |

A/B (the dumped tables, before vs after): 126 / 126 ends and 228 / 228 ends, `mirror` identical, but
**43 stills differ per Track** — 83 of them by ≤ 6 cm (the cell), and past the 1 m merge and the
spread picks a few ends are other rim points altogether (max 15 m), links 1782 → 1784 and 4356 → 4368.
A cell cache cannot keep a *thresholded* table byte-identical: the merge (≤ 1 m), the spread picks
(2 / 1 / 0 m) and `runUpBack`'s marches are all order- and centimetre-sensitive. The behavioural A/B is
the regression set below (deckRider's R1 / R2 / base HARD rows).

### 2. Whole Races, Motion running (`BOT_RACES=1 npx vitest run src/bot/races.test.ts`)

`playRace` in `sectionHarness.ts` (exported, `RaceReport` / `SectionFalls`: ticket 11's shape),
`playSection` gained `whole` (pass only at the finish) and `SectionOutcome.sections` (Falls by cause
keyed by `checkpointIndex + 1` at the Fall), and `where` now names every unpassed Bot's spot at the cap.

| Race (limit) | level | finished | stranded | own | obstacle | finish s |
|---|---|---|---|---|---|---|
| base race (300 s) | HARD | **1**/12 | 2 | 39 | 67 | 273 |
| | NORMAL | 0 | 1 | 23 | 102 | — |
| | EASY | 0 | 0 | 82 | 114 | — |
| Spin Cycle (360 s) | HARD | **0**/12 | 0 | 110 | 117 | — |
| | NORMAL | 0 | 0 | 84 | 94 | — |
| | EASY | 0 | 1 | 60 | 77 | — |
| Slip Stream (360 s) | HARD | **8**/12 | 1 | 21 | 21 | 184–280 |
| | NORMAL | 4 | 1 | 50 | 49 | 223–316 |
| | EASY | 1 | 1 | 109 | 106 | 322 |

"own" is the harness's `ownFalls` (everything but Bump / contact / pushed / belt), so it counts
`Stagger` and `Obstacle` too; the **step-offs** — the ADR 0129 rule — are: base race 4 / 10 / 27
(HARD / NORMAL / EASY), Spin Cycle 0 / 1 / 5, Slip Stream 0 / 0 / 0. Think 13–38 µs per Bot-Tick.

Falls by cause per section (only sections with a Fall):

| Race | level | section | Falls |
|---|---|---|---|
| base | HARD | Cp 0 → 1 (wrecking balls) | Bump 2, Stagger 1, Obstacle 1, WallImpact 1 |
| | | Cp 1 → 2 (moving rows) | pushed 23, contact 10, **step-off 4**, Stagger 2, Bump 1 |
| | | Cp 2 → 3 (spinning squares) | Obstacle 27, contact 11, pushed 9, Bump 3, Stagger 1 |
| | | Cp 4 → 5 (belt climb) | Stagger 2 |
| base | NORMAL | Cp 0 → 1 | Obstacle 3, Bump 1, WallImpact 1 |
| | | Cp 1 → 2 | pushed 89, contact 68, Bump 20, **step-off 10**, Stagger 9 |
| base | EASY | Cp 0 → 1 | Obstacle 2, Stagger 2, Bump 1 |
| | | Cp 1 → 2 | Bump 63, pushed 59, Stagger 51, contact 42, **step-off 27** |
| Spin | HARD | Start → Cp 0 (gates + carousels) | Stagger 6, pushed 5, contact 1 |
| | | Cp 0 → 1 | **Stagger 94**, Bump 1 |
| | | Cp 3 → 4 | Stagger 5 |
| | | Cp 5 → 6 | WallImpact 5, pushed 2 |
| Spin | NORMAL | Start → Cp 0 | Stagger 34, pushed 11, Bump 8, contact 1, step-off 1 |
| | | Cp 0 → 1 | Stagger 49, Bump 4, contact 1 |
| Spin | EASY | Start → Cp 0 | Stagger 42, pushed 22, Bump 19, contact 11, step-off 3 |
| | | Cp 0 → 1 | Stagger 13 |
| | | Cp 1 → 2 | step-off 2 |
| Slip | HARD | Cp 1 → 2 | Stagger 11, Obstacle 4 |
| | | Cp 4 → 5 | Stagger 6 |
| Slip | NORMAL | Cp 1 → 2 | Stagger 43, Bump 2, Obstacle 1, link 1 |
| | | Cp 4 → 5 | belt 6, Stagger 4, Bump 4, Obstacle 1 |
| Slip | EASY | Cp 1 → 2 | **Stagger 95**, Bump 24, contact 10, link 9, pushed 6 |
| | | Cp 4 → 5 | Stagger 5 |

Read: **the base race's moving rows (Cp 1 → 2) hold every level** — no NORMAL or EASY Bot is past them
in five minutes, and at HARD only one is; the crowd there (pushed / contact / Bump) is the Falls, and the
step-offs are there too. Spin Cycle stops everyone in its first two legs, on **Stagger** (a sweeper hit
that did not knock down — 94 at HARD on Cp 0 → 1, the carousel-with-bars leg the hold does not cover
because the bar rides a floor). Slip Stream is the one Race a HARD Bot finishes (8 of 12), losing Bots on
Cp 1 → 2 to Staggers. The 07b question ("where does NORMAL and EASY's standing time go on the rows")
was not reached: the whole-Race numbers say the rows are not a slow leg but a wall with 12 Bots on it.

### 3. Level ordering (`difficulty.test.ts`, real assertions, red — inverted)

One Bot a run (no crowd), Checkpoint 4 → finish on the base race with Motion running, 16 seeds a level,
150 s cap:

| level | finish s (sd) | obstacle Falls (sd) | unfinished |
|---|---|---|---|
| EASY | **86.6** (18.1) | 0.25 (0.58) | 1 / 16 |
| NORMAL | 132.6 (25.4) | 0.44 (0.63) | 10 / 16 |
| HARD | **144.2** (17.8) | 0.50 (0.89) | 14 / 16 |

The order is **inverted on both measures**, and no n makes an inverted order strict (the suite prints
the n the pooled variance asks for: `Infinity` for every pair). The cause, traced with one HARD Bot: it
**stands still at Checkpoint 4's deck** (z −395, `Controlled`, 0.4 m moved in 10 s) for the whole cap on
2 of 3 seeds; a NORMAL Bot does so on 1 of 3; an EASY Bot walks on. That is a hold that never clears —
HARD's longer `lookAheadTicks` finds the corridor onto the belt climb never free (the sliding walls or the
belt's neighbours; the 07a "stopped spiked sweeper holds until the cap" case is one candidate) while
EASY's short look sees a gap and goes. **The profile field that fails to separate the levels is
`lookAheadTicks` — not by failing to separate but by separating the wrong way on this leg**, because a hold
with a longer look-ahead has more to wait for and no cap that scales with it (`BOT_HOLD_GO_TICKS` is one
constant for every level). Not fixed here (budget); it is the first thing to fix, at `SweeperHold`'s give-up,
before any ordering can be read. `difficulty.test.ts`'s third assertion (finishes on almost every seed)
is red for the same reason (10 and 14 unfinished). 07a's red row (base leg 1, 2 / 1 / 1 Falls on one seed)
is settled by this: there is no strict order in the code today to measure, on any leg.

### 4. Cost (`pnpm bench:sim --players 12 --bots 11 --level <l> --ticks 6000`, run alone, last)

All eleven Bots' think per Tick, ms (target p50 ≤ 0.15, p95 ≤ 0.40); the 06b before-numbers in brackets:

| level | bots p50 | bots p95 | tick p50 | tick p95 | tick max | falls | met |
|---|---|---|---|---|---|---|---|
| HARD | 0.120 (0.090) | **0.520** (0.190) | 0.870 | 1.510 | 62.1 (4 ticks > 10 ms) | 75 | p50 yes, **p95 no** |
| NORMAL | 0.070 (0.100) | **0.440** (0.220) | 0.970 | 1.420 | 3.6 | 92 | p50 yes, **p95 no** |
| EASY | 0.070 (0.130) | **0.420** (0.280) | 0.880 | 1.410 | 2.1 | 104 | p50 yes, **p95 no** |

p50 is under the target at every level (and lower than 06b's at NORMAL/EASY); p95 is over it at every
level, 0.42–0.52 against 0.40 — the tail is the planning Ticks (a ride plan is a Dijkstra over 126 ends
plus the queue scan added here; a hold's corridor sample). HARD's 62 ms max on 4 Ticks is a one-off
(the same scenario's p99 is 2.0 ms); not chased. The **moving-world pose cache** was not instrumented
separately in the bench; the groundwork's measurement stands (24.6 µs per new Tick for the base race's
32 bodies, the cost in `movingSegmentPose`). The simulation's own Moving Segment column reads 0.007–0.009 ms.

### 5. Test runtime

`races.test.ts` is `describe.skipIf(!process.env.BOT_RACES)` (the repo's `BOT_QUICK` convention): the
package's default run skips it. `BOT_RACES=1 npx vitest run src/bot/races.test.ts`; `BOT_RACES_OUT=<file>`
writes the reports as JSON. Nine Rounds took ~4 min wall beside other suites. `difficulty.test.ts` (48
single-Bot runs) runs by default in ~30 s.

### Regression set (run beside the whole-Race suite; wall-clock numbers are inflated by it)

- `neverStepsOff -t "every Motion stopped"`: **9 / 9 green**, 0 own Falls, 12/12 on every Track and level.
- `deckRider`: R1 **12 / 11 / 11**, R2 **12 / 12 / 12**, base HARD **9, own 2** — 07b's rows hold (the same
  numbers as 07e's regression run). Base NORMAL / EASY 0 / 0 (07b's known reds, 1 / 0 before). Its table
  row read 103 ms *under the parallel load* (141 before) and 35–43 alone (above); the row asserts ≤ 50
  and was red under load.
- `transfers`: T1 **12 / 12 / 12**, T2 **12 / 10 / 11** — **T2 NORMAL has one stranded Bot now** (12,
  stranded 0 before): the one regression mine, from the queue cost (a Bot re-planned to another entry
  and waited there), unread in the budget. T3 as above.
- `sweeperHold`: green but for 07a's known ordering row. `trapHold`: D and **S** red on their wall-clock
  think assertions (141 and 38 µs against 30) under the load; both pass alone (the known class).
- `belts`, `sectionHarness`, `movingWorld`, `neverStranded`, `TreeBot`, `navMesh`, `links`, `fight`,
  `fightRace`, `edgeGuard`, `profile`, `perceptionDelay`: green. `difficulty` and `races`: red as
  designed above.
- `apps/server` `matchRuntime.bots` + `matchRuntime.botFill`: **12 / 12 green**.
- Typecheck: `packages/shared` clean but for the standing `bombHome.scratch.test.ts` unused import,
  `apps/server` clean, `apps/track-builder` clean.

### Files

`bot/rideLinks.ts` (`cachedProbe`, `RideEnd.openPhases`, `RideLink.wait`, `waitAt`, `transferPairs`'s
phases), `bot/deckRider.ts` (`planAcross`'s queue and its cache key, `dijkstra(…, queue)`),
`bot/sectionHarness.ts` (`whole`, `sections`, `playRace`, `RaceReport`, `SectionFalls`, the cap line in
`where`), `bot/races.test.ts` (new, gated), `bot/difficulty.test.ts` (rewritten on `playSection`),
`tuning/bots.ts` (`BOT_RIDE_PROBE_CELL_M`), this ticket, 07 and 07e's checklists, ADR 0129 "As built".
No scratch file or debug toggle remains.

## Combined whole-Race run after 07g and 07h (the main session, 2026-09-25)

`BOT_RACES=1 BOT_RACES_OUT=… npx vitest run src/bot/races.test.ts` (133 s). 12 Bots, aggression 0,
Motion running, real Time Limits. In brackets is 07d's own run.

| Race | level | finished | stranded | step-offs | obstacle Falls | where it hurts (section: Falls) |
|---|---|---|---|---|---|---|
| base race | HARD | **3** (1) | 0 (2) | **0** (4) | 74 | Cp 2→3: 38 (Obstacle 30, the spiked bar on the spinning squares); Cp 1→2: 36 (pushed 28) |
| | NORMAL | **1** (0) | 0 (1) | 6 (10) | 101 | Cp 1→2: 123 (pushed 76, contact 18, Bump 14) |
| | EASY | 0 (0) | 1 (0) | 30 (27) | 83 | Cp 1→2: 203 (contact 52, pushed 48, Bump 42) |
| Spin Cycle | HARD | 0 (0) | 0 | 0 | 60 | Start→Cp 0: 51 (Stagger 28, pushed 14); Cp 0→1: 17 (Stagger 17) |
| | NORMAL | 0 (0) | 0 | 0 | 100 | Cp 0→1: 50 (Stagger 48); Start→Cp 0: 47 (Stagger 32) |
| | EASY | 0 (0) | 0 | 0 | 116 | Start→Cp 0: 114 (Stagger 57, pushed 36); Cp 0→1: 23 (Stagger 22) |
| Slip Stream | HARD | **10** (8) | 0 (1) | 0 | 28 | Cp 1→2: 26 (Stagger 19) |
| | NORMAL | **10** (4) | 0 (1) | 0 | 39 | Cp 1→2: 45 (Stagger 35) |
| | EASY | 1 (1) | 1 | 0 | 113 | Cp 1→2: 151 (**Stagger 105**, Bump 28) |

What still blocks, and where it goes next:

- **Spinning crosses, in 07i.** Every Spin Cycle Bot stops in the first two legs, and Slip Stream EASY
  at Cp 1→2, on Staggers. This is 07g's finding: a cross has an arm past any point every 24 Ticks,
  and a walk through its swath takes 37, so no window ever opens.
- **The spiked bar on the base race's spinning squares (Obstacle 30 at HARD), in 07i.**
- **Moving rows with a crowd at NORMAL and EASY, in 07h round 2**, along with EASY's step-offs (30).


## Combined whole-Race run after 07h round 2 and 07i (the main session, 2026-09-25, afternoon)

Tree: `2ddc1f6a` (07h round 2 and 07i's second session). Same command. It took **394 s** on this
machine, which 07h measured at about 3.4× slower than the machine the 133 s run above was on. The file
is 9 / 9 red on `ownFalls === 0`, the ADR 0129 bar, as it was before. In brackets is the run above.

| Race | level | finished | stranded | step-offs | own / obstacle Falls | where it hurts (section: Falls) |
|---|---|---|---|---|---|---|
| base race | HARD | **4** (3) | 0 (0) | 0 (0) | 51 / 53 | Cp 2→3: Obstacle **48** (30), the spiked bar on the spinning squares |
| | NORMAL | **3** (1) | 0 (0) | **0** (6) | 37 / 42 | Obstacle 30; Cp 1→2 is no longer the wall (123 before) |
| | EASY | 0 (0) | **0** (1) | **3** (30) | 30 / 42 | Cp 1→2: pushed 14, contact 15, Stagger 13, Bump 11 |
| Spin Cycle | HARD | 0 (0) | **1** (0) | 1 | 52 / 57 | Start→Cp 0: Stagger 21; Cp 0→1: Stagger 25, Bump 19 |
| | NORMAL | 0 (0) | **2** (0) | 0 | 62 / 78 | Start→Cp 0: Stagger 40, pushed 14; Cp 0→1: Stagger 19 |
| | EASY | 0 (0) | **1** (0) | 0 | 44 / 83 | Start→Cp 0: pushed 36, Stagger 29; Cp 0→1: Stagger 13 |
| Slip Stream | HARD | **8** (10) | 0 (0) | 1 | 66 / 65 | Cp 1→2: Stagger 62, Bump 14 |
| | NORMAL | **7** (10) | **1** (0) | 0 | 60 / 58 | Cp 1→2: Stagger 48, `link` 2 |
| | EASY | 2 (1) | **2** (1) | 0 | 83 / 76 | Cp 1→2: Stagger 66, Bump 28, **`link` 13** |

What it says:

- **07h round 2 worked on the Race.** The base race's moving rows are no longer the wall: NORMAL
  step-offs 6 → 0, EASY 30 → 3, and NORMAL finishes 3.
- **07i did not open Spin Cycle.** Its second session made the hook faster and left the outcomes
  bit-identical. Its falls targets were not re-attempted (07i §4). The crosses' Staggers stand at about
  the same count, and there are now 1–2 stranded Bots per level, which were not there before.
- **Slip Stream regressed**, from 10/10 to 8/7 finished, with new stranded Bots and a new `link` Falls
  row (13 at EASY). 07i's report saw the same leg (Cp 1→2, HARD 8 passed / 1 stranded / 27 Falls) turn
  between two `deckRider.ts` versions. It is unattributed: an A/B of 07h round 2 against 07i on that
  leg is the first thing to run.
- **The spiked bar at base Cp 2→3 got worse** at HARD (Obstacle 30 → 48). 07i never reached it.
- **A simulation defect, found by 07h round 2.** A Character carried onto the seam between a
  turntable's pieces sinks into the groove and is pinned inside the moving body, with `velocity.y`
  growing without bound. A human would be caught the same way. It belongs in `simulation/character/`.

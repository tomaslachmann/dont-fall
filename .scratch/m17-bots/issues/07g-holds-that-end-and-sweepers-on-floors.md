# 07g — Holds that end, sweepers on moving floors, and the level order

**What to build:** the 07a half of what 07d's whole-Race run found (`07d-integration.md`, "As built",
tables 2–4; read them first, and this ticket carries their numbers so you need not look them up again).

**Blocked by:** 07d. **Runs in parallel with 07h**, which owns `deckRider.ts` and `rideLinks.ts`.

**Status:** done on tests for "holds end" (2026-09-25, Fable, 75 minutes); the level order and the
Staggers per section are measured, not met — the numbers, causes and the next fix are in "As built".
Stop rule: 3 failed attempts at one target, then record the numbers and the diagnosis and move to the
next item.

- [x] Holds end: the clock runs until the Bot gets nearer its corner, the cap scales with the look-ahead, a
      stopped body is never held for — `gaveUp` 0 → every HARD seed finishes (below)
- [ ] Level order strict in `difficulty.test.ts` — **red, but no longer inverted**: HARD is fastest, NORMAL
      slowest (2 unfinished), Falls flat; the cause named below
- [ ] Staggers per section ≤ 10 / 20 / 40 — measured on all three legs, none met; per-leg causes below
- [x] Cost recorded: bots p95 0.520 → 0.480 ms at HARD (target 0.40, not met); the hook's own share below
- [x] Regression set run; typecheck clean in `packages/shared`, `apps/server`, `apps/track-builder`

## Findings this ticket starts from (07d, measured)

1. **A hold that never ends, and why the level order is inverted.** One Bot, base race Checkpoint 4 →
   finish, Motion running, 16 seeds a level, 150 s cap (`difficulty.test.ts`, now real and red):
   EASY 86.6 s (1 unfinished), NORMAL 132.6 s (10), HARD 144.2 s (14); obstacle Falls 0.25 / 0.44 / 0.50.
   Traced: a HARD Bot **stands still on Checkpoint 4's deck** (z −395, `Controlled`, 0.4 m in 10 s) for
   the whole cap on 2 of 3 seeds, NORMAL on 1 of 3, EASY walks on. HARD's longer `lookAheadTicks` finds
   the corridor onto the belt climb never clear, and `BOT_HOLD_GO_TICKS` is one constant for every level,
   so the longer the look-ahead the more there is to wait for. A candidate is 07a's open question 2: a
   **stopped spiked** sweeper counts forever. This also breaks "never stranded" (ADR 0129).
2. **Staggers where the hold should protect** (Falls by cause per section, 12 Bots, whole Races):
   - Spin Cycle Cp 0 → 1: **Stagger 94** at HARD, 49 NORMAL, 13 EASY. The leg has hammers, trap balls
     and spin bars;
   - Slip Stream Cp 1 → 2: Stagger 11 HARD, 43 NORMAL, **95 EASY** (sliding walls, spin bars, spiked
     circles);
   - Spin Cycle Start → Cp 0 (gates and carousels): Stagger 6 / 34 / 42.

   A Stagger is a sweeper hit that did not knock the Bot down. Find out per leg whether the hold never
   saw the sweeper, saw it too late, or went anyway after a give-up.
3. **Sweepers that ride a moving floor:** the base race's spinning squares carry a spiked bar
   (Cp 2 → 3, **Obstacle 27** at HARD), and Spin Cycle's carousels carry bars. `SweeperHold` samples
   the corridor in world space. A sweeper on a deck the Bot is riding or boarding needs its occupancy
   read in that deck's frame (`movingWorld.platformUnder`, `toLocal`), or it is invisible or mis-timed.
   Read-only use of `movingWorld` and the ride state is fine; don't edit `deckRider.ts` or
   `rideLinks.ts`. If you need a signal from the rider, record it for 07h and use what the view
   already gives you.
4. **Cost:** bots' think p95 is 0.42–0.52 ms per Tick for 11 Bots (target ≤ 0.40), and the tail is the
   planning Ticks. Your share is the hold's corridor sampling. Measure it separately in the bench
   (`pnpm bench:sim --players 12 --bots 11 --level <l> --ticks 6000`), and bring it down if it is
   the tail.

## Targets

- **Holds end:** at every level, a hold gives up within a cap that scales with the Bot's look-ahead
  (never shorter than one sweeper period), and a stopped sweeper is not held for.
- **Level order strict** in `difficulty.test.ts`: finish time and obstacle Falls EASY > NORMAL > HARD,
  and all three levels finish on almost every seed. Pick n from the variance. If the order still
  doesn't hold once holds end, find the profile field that doesn't separate the levels and fix that
  cause, not the thresholds.
- **Staggers per section,** measured with `playSection` on the three legs above, 12 Bots per level.
  HARD's obstacle Falls (Stagger + Obstacle) are **≤ 10 per leg**, NORMAL's ≤ 20 and EASY's ≤ 40.
  Each is a first target; if one is out of reach, prove why with numbers.
- **Cost:** your share keeps the whole bots' p95 ≤ 0.40 ms together with 07h's. Record your share.

## Files

**Yours:**
- `src/bot/sweeperHold.ts` and its test;
- `src/bot/difficulty.test.ts`;
- the planning in `src/bot/PathBot.ts` that isn't the ride hook;
- `src/bot/forks.ts`;
- a new "Holds (07g)" block in `tuning/bots.ts`.

**Not yours:** `deckRider.ts` and `rideLinks.ts` (07h). Re-read `tuning/bots.ts`,
`packages/shared/src/index.ts` and ADR 0129 right before each edit, since 07h appends too.

## Measuring

- Use `playSection` on single legs, with `BOT_QUICK=1` for one seed while iterating.
- Don't run the whole-Race suite (`BOT_RACES=1`) until the very end, and then only once. 07h changes
  the rides at the same time, so whole-Race numbers mid-work are not yours alone. The main session
  runs the combined whole-Race check after both of you finish.

## Regression set at the end

- Every `src/bot/*.test.ts`.
- `neverStepsOff -t "every Motion stopped"`: 0 own Falls, 12/12 on every Track and level.
- `apps/server` `matchRuntime.bots` and `matchRuntime.botFill`.
- Typecheck `packages/shared`, `apps/server` and `apps/track-builder`.
- Known reds that aren't yours: `trapHold` D/S wall-clock under load; the 14 standing failures in
  `src/simulation/RapierSimulation.test.ts`; `races.test.ts` (07d's whole-Race targets, the main
  session's to re-run).

## As built (2026-09-25, Fable, 75 minutes; numbers first)

Everything seeded (`difficulty-suite:<level>:<n>`, `sweepers:<track>:<level>`, `holds:<track>:<leg>:<level>:0`),
aggression 0, Motion running, on one M4 with 07h's suites beside it (wall-clock µs are ±2×).

### 1. Holds end (target met: `gaveUp` was 0 because the hold never *reached* its cap)

Traced with one HARD Bot on Checkpoint 4 → finish (the trace is gone): every hold was for the belt climb's
pusher walls (Segments 94 / 95 / 98 / 99, `kaykit_barrier_4x1x2_blue`), the Bot at z −393 ↔ −396, `gaveUp` 0.
Four causes, each fixed where it starts:

- **The hold's clock reset on any displacement.** A stand on a belt against the Bot carried it back 3 m a hold,
  which read as "got somewhere" (`BOT_STALL_MOVE_M` from where the hold began), so the clock restarted and the
  cap was never reached. The clock now runs until the Bot is nearer its *corner* than when the hold began
  (`heldCorner`, `progressed`), and the cap is `max(BOT_HOLD_MAX_TICKS, lookAheadTicks × BOT_HOLD_MAX_TICKS_PER_LOOK)`
  (new, "Holds (07g)" in `tuning/bots.ts`): never under one longest authored cycle, longer the further a Bot looks.
- **One blocked sample anywhere in the look-ahead held the Bot where it stood.** A HARD Bot's 24-Tick look saw the
  second wall from before the first, and the pair is never clear together. Now a Bot holds only when the first blocked
  sample is within `BOT_HOLD_STOP_M` plus what it walks over `stale.max + BOT_HOLD_DECIDE_TICKS`, and walks on toward it
  otherwise — two walls five metres apart are timed one at a time.
- **A stand on a belt was carried off.** `BeltPush.compensate` turns a zero move on a belt into the flow reversed, as
  much of a walk as the flow is (the sim reads a move's length as a share of the walk), so a held, queued or arrived
  Bot holds its ground; its unit test now asserts that. `corridorAhead` counts the belt under each sample (a walk against
  a slow belt arrives a third later) and stops at a ride's start as at a link's.
- **A body that never moves** (poses at Ticks 0 / 7 / 61 / 233 identical, cached per world) is scenery and is never held
  for, spiked or not — 07a's open question 2. **A Bot standing on a moving deck** (`platformUnder`) reads each sample
  carried to the Tick it reaches it (`toLocal` at `tick`, `toWorld` at the arrival), read-only on `movingWorld`.

`difficulty.test.ts`, one Bot, Checkpoint 4 → finish, 16 seeds a level, 150 s cap (before → after):

| level | finish s | sd | obstacle Falls | unfinished |
|---|---|---|---|---|
| EASY | 86.6 → **94.1** | 21.3 | 0.25 → 0.63 | 1 → **0** |
| NORMAL | 132.6 → **106.2** | 24.2 | 0.44 → 0.56 | 10 → **2** |
| HARD | 144.2 → **91.6** | 16.0 | 0.50 → 0.56 | 14 → **0** |

### 2. Level order (not met; the inversion is gone, the order is not yet strict)

The suite is red on all three assertions: time EASY 94.1 < NORMAL 106.2 (n the variance asks for: ∞), Falls
0.63 / 0.56 / 0.56 (n ≥ 1478), unfinished 2 at NORMAL. **Why the levels do not separate here:** on this leg every
level Falls ~0.6 times a run — the walls and hammers *shove*, and a shove costs a Stagger, not a Fall, so foresight buys
almost no Falls to be measured. On time, what separates the levels is how long each *holds*: HARD 300–460 hold Ticks a
run (10–15 s), EASY 130–240 (traced per blocking body, base race seeds 0–1), against a ~60 s clean run; so HARD is
now fastest by not being shoved, but only by 2.5 s over EASY, and NORMAL's two unfinished runs (one at Checkpoint 6's
hammer alley, `Stagger`, 28 m moved in the last 10 s: a Bot shoved back and forth, not standing) put NORMAL last. The
field that does not separate is not a profile field: **`lookAheadTicks` buys time only where a Stagger costs a Fall**, and
this leg has no such sweeper. Not fixed here (budget). Two things to try next, in order: run the ordering on a leg whose
sweepers knock down (Spin Cycle Cp 0 → 1, below: 45 / 19 / 32 Staggers), and price a Stagger in the harness as time lost.

### 3. Staggers per section (measured, none met; 12 Bots, one seed, 120 s cap)

| leg | HARD passed / obstacle Falls (Stagger) | NORMAL | EASY | target |
|---|---|---|---|---|
| Spin Cycle Start → Cp 0 (gates) | 2 / 18 (11), gaveUp 32 | 1 / 19 (13), gaveUp 33 | 0 / 29 (15), gaveUp 16 | ≤ 10 / 20 / 40 |
| Spin Cycle Cp 0 → 1 | 4 / 45 (45), gaveUp 1 | 4 / 21 (19), gaveUp 19 | 6 / 32 (32), gaveUp 20 | ≤ 10 / 20 / 40 |
| Slip Stream Cp 1 → 2 | 8 / 19 (18), gaveUp 3 | 9 / 20 (20), gaveUp 4 | 4 / 26 (24), gaveUp 10 | ≤ 10 / 20 / 40 |

Where the hold Ticks go (traced per blocking body, then the trace removed): on the gates leg, **Segments 33 and 34**
— two 5.6 m bars crossed on one pivot at x 0, z −60, −2 rad/s — took 300–380 hold Ticks *per Bot*; on Cp 0 → 1,
**Segment 119** (a 6.4 m bar at x 6.5, z −192) 270 per Bot; on Slip Stream, **Segment 97** (an 8 m bar at x 2.5,
z −261) 220–300 per Bot. So the hold *sees* every one of them and holds; the Staggers are the give-ups (a spinning cross
has an arm past any point every 24 Ticks and a walk through its 6.9 m swath takes 37, so no window ever opens and
every Bot goes on the cap) and the crossings a shorter look under-checks. **What was tried and reverted** (one attempt,
numbers unchanged on legs 1 and 2, mixed on the gates: HARD 18 → 13 Falls but NORMAL's mean 61 → 95 s): flagging the
floor a sweeper passes over (`occupies` sampled over a cycle) so the *first* plan keeps off it as it keeps off an edge
strip — on these three lanes the bar reaches within a capsule's width of the lane's edge, so there is no floor beside
it and the second plan is the same route. **The right fix is not a hold at all:** a spinning bar on a lane it fills is
passed by walking *with* its rotation or jumping it (a 1.4 m bar is above the jump's apex; the 1.0 m ones are not), which
is a link the planner would have to prove, and belongs to a ticket of its own.

### 4. Cost (`pnpm bench:sim --players 12 --bots 11 --level hard --ticks 6000`, beside other suites)

bots p50 **0.100** ms (07d 0.120; target ≤ 0.15), p95 **0.480** ms (07d 0.520; target ≤ 0.40, **not met**). The
hook's own share, from `sweeperHold.test.ts`'s wrapper: 9.7 µs a call on A HARD (07a: 5.3–14.9), 11.0 on base leg 1 HARD,
15.9 on base leg 0 HARD (2.1–6.3 on B/C and every NORMAL/EASY row), whole think 19–65 µs/Bot-Tick — the rise on the
base race is the belt scan in `corridorAhead` (16 samples × the Track's belts) plus `platformUnder` per decision; a
per-Track spatial index for `beltUnder` would take it back, not done in the budget.

### Regression set

`sweeperHold`: A / B / C **12 / 12 / 12 at every level, stranded 0** (A HARD 0 obstacle Falls in 6.2 s, was 9.0 s),
base leg 0 HARD 12 in 26.9 s (≤ 37.2), base leg 1 12 / 12 / 12 with 07a's known strict-order row still red (2 / 1 / 1).
`belts`: 15 / 15 (the stand-on-a-belt unit test re-asserted, above). `neverStepsOff -t "every Motion stopped"`: **9 / 9**, 0
own Falls, 12/12 everywhere. `trapHold`, `sectionHarness`, `TreeBot`, `neverStranded`, `movingWorld`, `edgeGuard`,
`links`, `profile`, `perceptionDelay`: green but `trapHold` D's wall-clock row (142 µs vs 30, the known class under load).
`apps/server` `matchRuntime.bots` + `botFill`: **12 / 12**. Typecheck clean in `packages/shared`, `apps/server`,
`apps/track-builder`. No scratch file or trace remains.

### Files

`bot/sweeperHold.ts` (progress clock, look-scaled cap, near-stop rule, stopped bodies, deck frame), `bot/hooks.ts`
(`corridorAhead`: belts, stops at a ride corner), `bot/belts.ts` (`BeltPush`: a stand holds its ground) and its test,
`tuning/bots.ts` ("Holds (M17 ticket 07g)": `BOT_HOLD_STOP_M`, `BOT_HOLD_MAX_TICKS_PER_LOOK`), this ticket, ADR 0129
"As built". `PathBot.ts`, `forks.ts`, `difficulty.test.ts`, `deckRider.ts`, `rideLinks.ts`: untouched.

# 07i — Getting past spinning crosses

**What to build:** a Bot gets past a spinning bar or cross it cannot wait out. 07g measured why the
hold fails there: a cross has an arm past any point of its swath every **24 Ticks**, while a walk
through the swath takes **37**, so no window ever opens. The hold holds for 220–380 Ticks per Bot at
three mid-lane spin bars on Spin Cycle (Segments 33/34, 119 and 97) and then gives up into a Stagger.
Keeping swept floor off the first plan was tried and reverted, because the bars reach the lane's edge
and the second plan is the same route.

**Blocked by:** 07g. **Runs in parallel with 07h round 2**, which owns `deckRider.ts` and
`rideLinks.ts`.

**Status:** done on tests, targets on Falls not met (recorded in "As built"). **Wall clock: 75 minutes,
plus a second session of 60. Model: Fable.** Stop rule: 3 failed attempts at one target, then record the
numbers and the diagnosis, and move on.

## Findings this ticket starts from (the combined whole-Race run, `07d-integration.md`, last section)

- **Spin Cycle:** 0 of 12 finish at any level. Staggers:
  - Start → Cp 0 (gates and carousels): 28 at HARD, 32 at NORMAL, 57 at EASY;
  - Cp 0 → 1: 17 at HARD, 48 at NORMAL, 22 at EASY.
- **Slip Stream Cp 1 → 2** (sliding walls, spin bars, spiked circles): Stagger 19 at HARD, 35 at
  NORMAL, **105 at EASY**. Only 1 EASY Bot finishes.
- **Base race Cp 2 → 3:** the spinning squares carry a spiked bar, Obstacle 30 at HARD. 07g made a
  Bot standing on a moving deck read samples in the deck's frame, but boarding and riding are 07h's
  `DeckRider`, so find out which side misses the bar.

## The approach, decided

Two ways past, chosen per sweeper by what its geometry allows:

1. **Walk with the rotation.** Enter the swath right behind an arm and walk the arc the arm's gap
   covers, not the straight corridor. It's a hold strategy in `sweeperHold.ts`: when a straight
   window never opens within one period, compute the gap arc (from `movingWorld` poses over one
   period) and steer along it.
2. **Jump the bar** where it's low enough: a proven link over the swath, timed to the arm's phase. It
   is proven in the link proof with the bar *moving* (the proof plays the Motion by Tick), and only
   kept if it lands.

Use (1) wherever an arc exists, and (2) for bars low enough to clear. A Bot that can't do either
still takes the old give-up (never stranded, ADR 0129).

## Targets

Use `playSection` with 12 Bots per level:
- **Spin Cycle Start → Cp 0 and Cp 0 → 1:** HARD obstacle Falls ≤ 10 per leg, NORMAL ≤ 20,
  EASY ≤ 40; passed HARD ≥ 10, NORMAL ≥ 8, EASY ≥ 5; stranded 0.
- **Slip Stream Cp 1 → 2:** the same thresholds.
- **Base race Cp 2 → 3 (spiked bar on the squares):** HARD Obstacle ≤ 10. If the miss is in the
  rider, record it for 07h instead.
- **Cost:** the arc computation is cached per sweeper per period (precomputed on the Bot track, or
  lazily once), and the hook's share stays ≤ 15 µs per call.

## Files

**Yours:**
- `src/bot/sweeperHold.ts` and its test;
- `src/bot/linkProof.ts` and `src/bot/links.ts`, for bar-jump links;
- the non-ride planning in `src/bot/PathBot.ts`;
- a new "Spinning crosses (07i)" block in `tuning/bots.ts`.

**Not yours:** `deckRider.ts` and `rideLinks.ts` (07h). Re-read `tuning/bots.ts`,
`packages/shared/src/index.ts` and ADR 0129 right before each edit.

## Measuring

- Use `playSection` per leg, with `BOT_QUICK=1` while iterating.
- Don't run the whole-Race suite; the main session runs it after 07i and 07h both finish.

## Regression set at the end

- Every `src/bot/*.test.ts`.
- `neverStepsOff -t "every Motion stopped"`: 0 own Falls, 12/12 everywhere.
- `apps/server` `matchRuntime.bots` and `matchRuntime.botFill`.
- Typecheck `packages/shared`, `apps/server` and `apps/track-builder`.
- Known reds that aren't yours:
  - `trapHold` D wall-clock under load;
  - the 14 standing failures in `src/simulation/RapierSimulation.test.ts`;
  - `difficulty.test.ts` (07g recorded why);
  - `races.test.ts`.

## As built (2026-09-25, Fable, 75 minutes + a second session of 60; numbers first)

Everything seeded (`holds:<leg>:<level>:0`), aggression 0, Motion running, 12 Bots, 120 s cap, on one machine
beside 07h's suites (wall-clock µs are ±2×). 07g's row is the "before". The first session was stopped
mid-work after §1–§4 below and the arc's own-frame occupancy half-written; the second session verified it,
measured the cost properly (§3), and fixed what the measurement named. It did not attempt the Falls
targets again: §4's next fixes are unchanged and still the next thing.

### 1. The three legs (HARD, one seed; targets: obstacle Falls ≤ 10, passed ≥ 10, stranded 0)

| leg | 07g: passed / obstacle Falls (Stagger), gaveUp | 07i: passed / obstacle Falls (Stagger), gaveUp, arcs | target met |
|---|---|---|---|
| Spin Cycle Start → Cp 0 (the cross 33/34, the pair 36/37) | 2 / 18 (11), 32 | **1 / 21 (12), 3, 28 arcs (0 dropped)** — see §3 for the rerun | no |
| Spin Cycle Cp 0 → 1 (the catwalk bars 118/119) | 4 / 45 (45), 1 | **5 / 15 (14), 20, 0 arcs** | Falls no (15), passed no (5, slow, stranded 0) |
| Slip Stream Cp 1 → 2 (bar 97, walls, spiked circles) | 8 / 19 (18), 3 | **10 / 17 (17), 3, 0 arcs** | Falls no (17), passed **yes** (10) |

None of the three targets is met on Falls; two of three are met on passed; stranded is 0 on the three (a
first run of the arc left one Bot stranded in a Stagger loop inside the cross, gone after the fixes
below). What moved and what did not, per leg:

- **The cross (33/34).** The arc is what the ticket asked for and it is walked: 28 arcs planned in 120 s,
  none dropped for straying, and the give-ups at the cross fell from 32 to 3 — the hold no longer times
  out into the cross. But the leg's Falls did not fall, because they were never mostly at the cross: the
  Staggers on this leg are at the **staggered pair 36/37** (7.2 m bars at x ±3, the base race's own deck,
  Falls at x 6.4 — the lane's very edge, where a Bot squeezed past a bar's tip gets shoved off) and the
  "pushed" Falls are on the carousels (z −90 … −131, 07h's rides). 07g's "300–380 hold Ticks per Bot at
  33/34" were the *time* cost; the *Falls* are elsewhere on the leg.
- **The catwalk (119).** Zero arcs, because a 6.4 m single bar at 1.9 rad/s *has* a window (gap 50 Ticks,
  crossing 34) — the cross is the only true "no window" bar of the three. Its 40 Staggers at (7.5, −191)
  had one cause, found by tracing: **the hold's "too slow to Stagger" rule read the bar's speed alone.**
  `BOT_HOLD_MIN_SPEED` is 3.3 u/s, but a Moving Segment staggers at a *closing* speed of 6.7, and a Bot
  walking into a bar brings 5.5 of that itself, so a hub turning at 2.7 u/s was walked into and
  staggered every Bot off the catwalk, once per Respawn (bot-1: Ticks 867, 1361, 1857, 2353). With
  `BOT_HOLD_MIN_SPEED_WALKING` (the closing speed less the walk, 1.2 u/s) the Staggers went 40 → 14 and
  obstacle Falls 41 → 15; Bumps rose 6 → 27 (twelve Bots now hold on a narrow catwalk and shove each
  other off; a Bump is not an obstacle Fall). Passed 5 is a queue, not a strand.
- **Slip Stream (97).** The bar is passed now (2 Staggers left at it, z −257/−259); the leg's other 15
  are on the sliding walls and spiked circles further down (z −286 … −339), which are 07f/07h's.

### 2. What was built (`bot/sweeperHold.ts`; `tuning/bots.ts` "Spinning crosses (07i)")

- **An arc round the pivot, with the rotation** (`planArc`, `playWalk`, `followArc`). When a decision
  is "hold" and the Bot stands (seen), and the blocking body turns flat about a fixed pivot (yaw from
  its poses at `tick` and `tick + 1`, its origin the same a quarter turn on), and **no straight window
  opens within one turn** (every start Tick over the period, the corridor through the swath), the
  Bot's walk is *played* — `accelerate`, the guard's own model of the Character, from a stand along a
  polyline: straight in to the arc's radius, round to the path's exit angle, out to the first corridor
  sample past the swath — for every radius share in `BOT_ARC_RADIUS_SHARES` (0.85, 0.75, 0.9, 0.65,
  0.55 of the swept radius; the outer ones first, since the gap between a cross's arms is widest there
  and a walk keeps pace at up to walk speed / ω), both ways round (with the rotation first), and every
  Tick of it must find floor (`navFloorWithin`). Then the earliest start Tick over one turn
  (`BOT_ARC_DELAY_STEP_TICKS`) that some played arc is clear of every near sweeper at every Tick, the
  wait until it safe where it stands, wins; the profile's `timingErrorTicks` jitters the start. The arc
  is then a count from the stand, like a link's script: the plan's own direction at where the Bot should
  be by now, bent toward the plan by how far its view puts it off it; through at `BOT_CORNER_REACHED_M`
  of the exit, dropped at `BOT_ARC_OFF_M` off it. The guard vets every move (never steps off); nothing
  found leaves 07g's hold and give-up in place (never stranded), and is not tried again at that bar for
  `BOT_ARC_RETRY_TICKS`.
- **A noticed swath is checked all the way through.** The look-ahead is how far off a Bot notices a
  sweeper; before, it was also how far *into* the swath the corridor was checked, and no level's look
  (HARD 12–24 Ticks) covers a 34–46 Tick crossing, so a single bar with a perfectly good window still
  hit every level mid-swath. Now a sample inside a near body's swept radius that arrives within the look
  extends the check to the sample that leaves the swath. EASY still notices a bar only at its edge.
- **`BOT_HOLD_MIN_SPEED_WALKING`**, above.
- **A spinning body's occupancy is asked in its own frame** (second session): `spinAbout` reads a body
  turning flat about a fixed pivot off its poses at `tick` and `tick + 1` (and its origin a quarter turn on);
  `turnedBack` turns a point back about that pivot by the body's turn over `d` Ticks, so "occupied at
  `tick + d`" is `occupies` at `tick` — the ring cache's pose — and a start Tick costs a sine, tabled once per
  search for every offset it asks (`spinTable`). A test holds `turnedBack` to the poses themselves on 6,804
  points (4 bars × 3 Ticks × 7 offsets × an 81-point grid): the turned-back point equals the point taken
  into the body's frame at `tick + d` and out at `tick`, to 1e-6, and the occupancy answers agree at every
  one. The wait-until-start check is incremental (a Tick the bar reaches the stand rules out every later
  start, so it breaks); `inSwath` reads the near bodies' positions once a decision.
- **`near` keeps a stray bound per body** (`movingWorld.ts`, the one file outside the ticket's list touched;
  it is nobody's in 07h's split, and the edit is additive). See §3 for why: it was the whole cost.

### 3. Cost (met on one leg, within noise on another, not on the cross's)

First session: the hook's share was **34–59 µs a call** on these legs (target ≤ 15; 07g: 2–16), and the
diagnosis was the arc search (poses outside the ring cache) and the through-the-swath scan.

Second session, **profiled before anything was changed** (`BOT_PROFILE_HOOK=1` in the quick loop wraps
`decide` / `planArc` / `followArc` / `stand` / `retreat`; a further split of `decide` was temporary), Spin
Cycle Cp 0 → 1 at HARD, the same seed:

| part | calls | ms in all | per hook call |
|---|---|---|---|
| `decide` | 10,981 | 1,523 | 45.4 µs |
| — of which `moving.near` | 5,967 scans | **1,180** | 35 µs |
| — `corridorAhead` | | 209 | 6 µs |
| — the swath scan (`inSwath`, `occupies`, `counts`) | | 100 | 3 µs |
| `planArc` | 495 | 16 | 0.5 µs |
| `stand` + `retreat` | 8,442 | 16 | 0.5 µs |

So the first session's diagnosis was wrong on both counts: the arc search is half a microsecond a call,
and the swath scan three. **The cost was `near`**: it walked every sweeper's origin over the look window
every decision, and Spin Cycle has 68 sweepers (20 swinging or sliding, whose origins move) against the
base race's 24 that 07g's 2–16 µs were measured on. Fixed in `movingWorld.ts` (additive, nobody's file in
the 07h split): `near` keeps per body where its origin rests and the furthest it ever strays (one cycle
at pace 1 sampled at build, plus a Tick's step for the phases a Ramp lands between samples; exact for a
body posed by one Motion of its own — no bound, so the old walk, for a chain of Motions, a trap door or
a glove) and rejects a far body with one hypot. `movingWorld.test.ts` holds it to the old walk on 800
seeded asks over Spin Cycle, on a clock and off, to the same list.

The three legs at HARD, the same seed, three runs on one machine (07h's suites running beside):

| leg | hook µs/call: WIP as committed → own frame + `inSwath` cached → + `near` bound | target ≤ 15 | outcome |
|---|---|---|---|
| Spin Cycle Start → Cp 0 (44 arc searches) | 62.0 → 54.0 → **24.2** | no | identical in all three |
| Spin Cycle Cp 0 → 1 | 51.3 → 45.9 → **16.6** | within noise (±2×) | identical |
| Slip Stream Cp 1 → 2 | 30.8 → 32.5 → **19.6** | no (but 07g's 2–16 was the base race) | identical |

The outcome of every leg (passed, stranded, obstacle Falls by cause, give-ups, arcs, mean pass) is
bit-identical across the three runs, which is what both changes promise: the frame trick is exact, and
the bound never drops a body. What is left above 15 is `decide` itself on a leg with many sweepers near
(`corridorAhead` and the scan, ~9 µs a hook call, since a decision happens every third Tick), and the
cross's arc searches on the first leg.

**A number that does not match the first session's §1:** Slip Stream Cp 1 → 2 at HARD now reads
**passed 8, stranded 1, obstacle Falls 27 (Stagger 26), gave up 19** — identical across all three of
this session's runs, so not from anything here; §1's row (10 / 17 / 3, stranded 0) was measured earlier
in the day against a different `deckRider.ts` (07h round 2 is in the working tree, uncommitted, and that
leg's walls and spiked circles are its rides). The main session should re-measure after 07h lands.

### 4. Not built, and what to build next

- **Jumping a bar (approach 2)** — not started. The 1.4 m bars of the cross are above the jump's apex
  (~1.3 m, ADR 0092) anyway; the 1.0 m ones would need `linkProof` to play the Motion by Tick in its
  proof world, which holds only the still world today (`BotStillWorld`), so it is a ticket of its own.
- **The cross's arc is thin.** At 0.85 of a 2.8 m swept radius the free sector between a cross's arms
  is ~0.5 rad once the capsule and `BOT_ARC_MARGIN_M` are taken off the arm's 0.7 m half-width, and a
  walk at 5.5 u/s outruns the arm (2 rad/s × 2.4 m) by only 0.33 rad/s — the plan fits by a few Ticks,
  which is why the arcs are found late (up to a turn of waiting each) and the leg is slow. The lane is
  12 m wide, the bars reach 2.8 m: the room is *beside* the swath at |x| > 3.4, which 07g's reverted
  "keep swept floor off the first plan" would have used had the bars not reached the lane's edge on
  the other two legs. A per-body variant (keep off only a *cross's* swath, never a single bar's) is
  the next thing to try on this leg, before the arc.
- **The staggered pair (36/37) and the catwalk queue** are where this leg's and Cp 0 → 1's Falls are
  now. The pair is the base race's own deck (07a's Track B passes it 12/12 at HARD); what differs here
  is twelve Bots arriving together and the lane edge at x ±6: the Bots squeezed to x 6.4 are the ones
  shoved off. A hold that keeps a Bot off the edge strip while it waits (stand at the lane's middle,
  not where the corridor happened to put it) is the next fix there.
- **Bumps on the catwalk (27 at HARD)** are the same crowd-at-a-hold problem as 07h's crowd rows: a
  queue rule for holds (as links and rides have) would take them.

### Regression set (second session, run once at the end, 07h's uncommitted `deckRider.ts` in the tree)

Run as the ticket asks: every `src/bot/*.test.ts` (17 files in parallel, `difficulty` and `races` excluded
as known reds), then the four outcome reds again one at a time off parallel load, `apps/server`'s
`matchRuntime.bots` + `matchRuntime.botFill`, and the three typechecks.

| item | result |
|---|---|
| `neverStepsOff -t "every Motion stopped"` | **9 / 9 green**, 0 own Falls, 12/12 on every Track and level (sequential) |
| `apps/server` `matchRuntime.bots`, `matchRuntime.botFill` | **2 files, 12 tests green** |
| typecheck `packages/shared`, `apps/server`, `apps/track-builder` | **green** (`bombHome.scratch.test.ts`'s unused `RAPIER` is a scratch file, not this ticket's) |
| `sweeperHold.test.ts` — the two new unit tests, the 07a acceptance A / B / C and base0 | green |
| `movingWorld.test.ts` (with the new `near` bound test), `fight`, `fightRace`, `TreeBot`, `belts`, `links`, `neverStranded`, `edgeGuard`, `navMesh`, `profile`, `perceptionDelay`, `sectionHarness` | green |
| `trapHold` D and S | wall-clock under load (known red) |
| `transfers` table build and T1/T2/T3 think µs; `deckRider` "finds the platforms" ms and base HARD think | wall-clock under load (07h's suites, their As built says the same) |

**Four outcome reds, rerun sequentially and still red — none attributable here, all recorded for the
main session:**

- **`neverStepsOff` "Motion running", base race at EASY (step-off 2) and NORMAL (step-off 1).** HARD, and
  Spin Cycle and Slip Stream at every level, are green. The three step-offs are at (3.3, 4.6, −197.3),
  (0.9, 4.5, −211.6) and (−1.4, 4.5, −214.2): y 4.5–4.6 against a 4.9 deck, z −197 … −214 — the moving
  rows, exactly the place and reading 07h's As built traces ("y 2.6–3.6 … the rows are 1.5 m thick", "one
  step-off left at EASY at (2.6, 4.7, −216.2)"). 07h round 2 is in the tree uncommitted and records base
  EASY as a known red with one step-off; NORMAL's one is new against its table. Nothing in this ticket
  touches a ride, and both of this session's changes are proven exact, so the A/B that would tell 07h's
  round-2 `deckRider.ts` from the first session's hold changes (`BOT_HOLD_MIN_SPEED_WALKING`, the
  through-the-swath scan, the arc) is the main session's to run once 07h is committed.
- **`sweeperHold` "the base race's wrecking-ball leg … strictly EASY > NORMAL > HARD"**: passed 12 / 12 / 12,
  obstacle Falls HARD 1, NORMAL 1, **EASY 0** (one Bump). The leg is near-perfect at every level now, so
  the strict ordering fails on noise of one Fall. Most likely the first session's hold changes (a bar's
  window checked all the way through helps EASY most, since its look only ever reached the swath's
  edge); an assert that wants EASY to fall more than NORMAL on a leg both pass 12/12 with ≤ 1 Fall is
  asking for a difference the leg no longer has. Not changed here: the main session decides whether the
  assert or the play is right.
- **`transfers` T1 at NORMAL, stranded 1** and **`deckRider` base at EASY, passed 1 (≥ 3)**: 07h's (the
  latter its documented known red).

## Round 3 (the main session, 2026-09-25)

**Wall clock: 75 minutes. Model: Fable.** Stop rule: 3 failed attempts at one target, then record the
numbers and move on to the next item. Runs in parallel with 07l (the spiked bar), which owns
`deckRider.ts` and only reads `sweeperHold.ts`. You own `sweeperHold.ts`, `movingWorld.ts`, `links.ts`,
`linkProof.ts` and the non-ride planning in `PathBot.ts`. Shared files (`tuning/bots.ts`, `index.ts`,
ADR 0129): re-read before editing, additive only. Never commit, stash or revert.

What round 2 left, measured by 07j (`07j-slip-stream-regression-ab.md`, As built):
the arc costs Slip Stream. On the Slip Stream Cp 1→2 leg (seed `holds:slip2:<level>:0`) without the arc
it read HARD 10/0, NORMAL 7/0, EASY 4/1 (passed/stranded); with it, 8/1, 5/0, 0/0. The cause is
`planArc`'s exit choice. It takes the first corridor sample clear of the swath, so a Bot comes out about
2 m sideways of the line the rest of the leg's proofs assumed, and later Falls mid-link (`bot-2`, Tick 341).

In order:
1. **The arc rejoins its route.** Pick the exit nearest the pre-arc corridor's line, or re-plan from the
   arc's actual landing point before handing back. Target: the slip2 leg at least as good as without the
   arc (≥ 10/0, ≥ 7/0, ≥ 4 with stranded ≤ 1) on both seeds 0 and 1, and Spin Cycle's two legs no worse
   than round 2's §1 table. If no version of the arc beats "no arc" on Slip Stream, gate the arc to
   crosses only (a sweeper whose free window is shorter than the walk through its swath, the 24-versus-37
   finding) and record it.
2. **Crosses, §4's next thing:** keep only a *cross's* swath off the first plan, never a single bar's.
   The 12 m lane has room beside it at |x| > 3.4. Target: Spin Cycle Start→Cp 0 and Cp 0→1 obstacle
   Falls ≤ 10 at HARD, passed ≥ 10, stranded 0 (the ticket's original targets).
3. **If budget remains:** the staggered pair (36/37) hold stands at the lane's middle, not at the edge
   strip.

Regression set: as in the ticket, plus the slip2 leg on both seeds at all three levels.

### As built (round 3, 2026-09-25, Fable, 75 minutes; numbers first)

Everything as in §1: seeded `holds:<leg>:<level>:<seed>`, aggression 0, Motion running, 12 Bots, 120 s cap, 4 cores
shared with 07l's and 07k's suites. **07k's simulation fix (`MovementController`/`SurfaceController`) and 07l's
`deckRider.ts` both landed in HEAD during this round**; the before column was measured before 07l's commit, the after
column after it, and the one pair run on both sides of it (Slip Stream at every level and seed, Spin Cycle Cp 0 → 1 at
HARD, with this round's first rule) came out **bit-identical**, so the columns compare.

| leg, HARD unless said (passed / stranded, obstacle Falls, gave up, arcs) | round 2's HEAD (this morning) | round 3 | target |
|---|---|---|---|
| Slip Stream Cp 1 → 2, seed 0 | 9 / 0, 22, 15, 0 | **9 / 0, 21, 7, 0** | ≥ 10 / 0: **no** (9) |
| … seed 1 | 9 / 0, 21, 12, 0 | **9 / 0, 26, 9, 1** | no (9) |
| … NORMAL seed 0 / 1 | 3 / 1, 37, 34 · 7 / 0, 23, 24 | **7 / 0, 27, 14 · 8 / 0, 19, 11** | ≥ 7 / 0: **yes, both** |
| … EASY seed 0 / 1 | 0 / 1, 27, 85 · 1 / 2, 35, 76 | **2 / 0, 32, 53 · 3 / 0, 22, 63** | ≥ 4, stranded ≤ 1: no on passed (2, 3), stranded met |
| Spin Cycle Start → Cp 0, seed 0 / 1 | 1 / 2, 17, 24, 40 · 2 / 0, 19, 33, 50 | **2 / 0, 18, 26, 39 · 4 / 0, 19, 21, 31** | ≤ 10 Falls, ≥ 10 passed: no; stranded 0: **yes** (was 2) |
| Spin Cycle Cp 0 → 1, seed 0 / 1 | 5 / 0, 15, 20, 0 · (not run) | **8 / 0, 12, 14, 0 · 7 / 0, 14, 12, 0** | ≤ 10 Falls: no (12, 14); ≥ 10 passed: no; stranded 0 |

Stranded is 0 on every leg, level and seed now (round 2's HEAD had 1–2 on four of them). Passed rose on every leg
but Slip Stream HARD, which stays at 9 on both seeds; Falls fell on the two Spin Cycle legs and on Slip Stream NORMAL
and EASY. No Falls target is met, the same as rounds 1 and 2.

**1. The Slip Stream regression was not the arc.** 07j named `planArc`'s exit, but the arc never fires on that leg:
`arcs` is **0** at every level and seed, before and after (07j's trace inferred an arc from a sidestep). The three
07i changes toggled one at a time on seed 0 (HARD / NORMAL / EASY, passed / stranded, Falls):

| variant | HARD | NORMAL | EASY |
|---|---|---|---|
| HEAD (all three) | 9 / 0, 22 | 3 / 1, 37 | 0 / 1, 27 |
| 07a's speed rule back (`BOT_HOLD_MIN_SPEED` alone) | **12 / 0, 12** | 6 / 0, 34 | 0 / 3, 47 |
| the through-the-swath scan off | 9 / 0, 22 (identical) | 3 / 1, 44 | 4 / 1, 34 |
| both off | 12 / 0, 12 | 7 / 0, 27 | 1 / 0, 35 |

It was **`BOT_HOLD_MIN_SPEED_WALKING`**: `min(3.3, 1.2)` on the body's speed *alone* counted every body over 1.2 u/s
whichever way it moved, so the holds ran to their cap four times as often (gave up 4 → 15 at HARD, 19 → 85 at EASY)
and a give-up walks into the bar. Traced on HARD seed 0: 2,666 hold decisions at bar 97, **812 of them on a body under
3.3 u/s** that only the new rule counted. But the old rule is what staggered every Bot off the catwalk (round 2, 40 in
120 s), and it still does: put back, Spin Cycle Cp 0 → 1 reads 5 / 0 with **41** Falls.

**Built:** `counts` reads the simulation's own rule. `resolveMovingSegmentContacts` staggers on the closing speed
`(v_segment − v_character) · push`, so a body counts when its speed alone is over `BOT_HOLD_MIN_SPEED` (07a, unchanged)
**or** its velocity relative to the walk the Bot brings to that sample (`walkAt`: the corridor's direction and pace
there; along the arc, the played points' own step) is over `MOVING_SEGMENT_STAGGER_SPEED` (6.7 u/s). Head-on a body
counts from 1.2 u/s as before; moving away or across, it does not. `BOT_HOLD_MIN_SPEED_WALKING` is no longer read here
(07l's `deckRider.ts` reads it, so it stays). Also tried and not kept: the closing speed **along the body's own
motion** (`|v| − walk · v̂`, closer to one face's push): Slip Stream HARD 10 / 0 and 10 / 0 (the target), but NORMAL
7 / 6, EASY 1 / 0, 200 Falls over the six runs against the bound's 147, and the catwalk 17 Falls against 12. The bound
was kept for fewer Falls everywhere but one number.

**2. A cross's swath off the first plan** (§4's next thing). Three attempts:
- A navmesh flag under the swath (`markGatedPolys`'s pattern, excluded by the first plan's filter): a no-op. Recast's
  polygons under the cross span the whole 12 m lane, so excluding by polygon centre leaves no first plan at all (the
  test's route ended 10.6 m short), and the second plan is the old route.
- **A via point** beside the swath instead (`besideCrosses`, `PathBot.ts`): when a stretch of the first plan passes
  within a cross's swath (its radius, the capsule, `BOT_HOLD_MARGIN_M`, `BOT_CROSS_BESIDE_M`), the plan is re-run through
  a point that far from the pivot, square to the stretch, on the side it already leans to first, and taken when the
  floor holds the point and both halves join. No floor beside (a catwalk) keeps the plan: the hold and the arc are for
  that. Only the first plan; the never-stranded second plan never detours. On Spin Cycle Start → Cp 0 this changed
  **nothing**, because the leg's plan is the ride planner's (`planAcross`) — the navmesh alone never joins the goal
  past the carousels — and it replaced the detoured plan whole.
- The same via before the first ride, the rest re-planned across from it (`onward`, the ride hook's own
  `planAcross`): seed 0 / 1 went 1 / 1, 13 Falls · 3 / 0, 14 → **2 / 0, 18 · 4 / 0, 19**. Stranded 0, passed +1, and
  five more Staggers — all at the **staggered pair 36 / 37** (z −74 … −78, x 5.6–6.4, the lane's edge, §4's finding),
  none at the cross. Kept for "never stranded"; the pair is item 3, not built.

**What is a cross** (`MovingWorld.crosses`, `movingWorld.ts`): two or more sweepers on one axle (`axisLineKey` and
speed), spinning about a fixed origin, whose longest gap between arms over one turn, at the best of eight points on a
ring at `BOT_CROSS_PROBE_RADIUS_SHARE` of the swept radius, is shorter than a walk across the swath — the 24-versus-37
finding, asked of the poses once per world. On Spin Cycle: **28+29 and 33+34**, held by `movingWorld.test.ts`, which
also holds the via to keeping the straight-through route's plan out of 33/34's swath. **A single bar is never one**,
measured: with the gap test alone, 23 axles on Spin Cycle were "crosses" (36, 37, the catwalk's 118–121, Slip Stream's
97 …), and routed beside them Spin Cycle Cp 0 → 1 read 7 / 0, 5 Falls · **4 / 0**, 5 Falls — the Falls target met, but
eight Bots jammed at (8, −213) on the catwalk's edge, 16 Bumps — while Slip Stream HARD read **10 / 0, 14 · 10 / 0, 8**
(both targets), NORMAL 5 / 0 · 9 / 0, EASY 2 / 0 · 1 / 0. So a via beside bar 97 is what Slip Stream HARD wants and a
via beside the catwalk bars is what the catwalk cannot afford: **a via that checks the room beside it** (floor to the
side of the via, not just under it) is the next thing to try, before the pair.

**3. Not built:** the staggered pair's hold at the lane's middle. It is now where Spin Cycle Start → Cp 0's Staggers
are (10 of 15 on seed 0, all at x 5.6–6.4).

**Cost** (`BOT_QUICK` on `sweeperHold.test.ts`, the three legs at HARD seed 0, under the regression suites' load):
hook 23.3 / 19.4 / 23.8 µs a call (round 2: 24.2 / 16.6 / 19.6); target ≤ 15 not met, unchanged within noise. The
cross test is once per world; a via costs one extra plan on the plans that meet a cross.

**Files:** `bot/sweeperHold.ts` (the rule, `walkAt`, `walkAlong`; the arc's clear check turns the walk back with the
point), `bot/movingWorld.ts` (`Cross`, `crosses`, `occupies` hoisted), `bot/PathBot.ts` (`besideCrosses`, both plan
paths), `bot/movingWorld.test.ts` (the cross test), `tuning/bots.ts` (`BOT_CROSS_PROBE_RADIUS_SHARE`,
`BOT_CROSS_BESIDE_M`, additive). `hooks.ts` and `navMesh.ts` were touched and put back. Two WIP snapshots of this tree
were committed by the main session mid-round (`1224f39d` and before); one carried a scratch test (`r3.scratch.test.ts`,
since deleted) and the flag version of `movingWorld.ts`/`navMesh.ts`, both superseded in the working tree.

### Regression set (round 3, run once at the end; 07l's and 07k's suites beside it, load average 1.1–1.9)

Every `src/bot/*.test.ts` but `difficulty` and `races` (17 files in parallel), then the five red files again one at
a time, `apps/server`'s two Bot suites alone, and the three typechecks.

| item | result |
|---|---|
| `neverStepsOff -t "every Motion stopped"` | green (in the parallel run) |
| `apps/server` `matchRuntime.bots`, `matchRuntime.botFill` | **2 files, 12 tests green** alone (both timed out at 5 s under the parallel bot suites) |
| typecheck `packages/shared`, `apps/server`, `apps/track-builder` | green (`bombHome.scratch.test.ts`'s unused `RAPIER`, not this round's) |
| `movingWorld.test.ts` (with the cross test), `belts`, `TreeBot`, `neverStranded`, `sectionHarness`, `navMesh`, `links`, `fight`, `profile`, `perceptionDelay`, `edgeGuard` | green |
| `sweeperHold.test.ts`: `turnedBack`, `spinAbout`, A / B / C, base0 | green; the base1 "strictly EASY > NORMAL > HARD" red as in round 2 (EASY 0 obstacle Falls, NORMAL 1) |
| `trapHold` D and S | wall-clock under load (known) |
| `transfers` T1/T2/T3 think µs ≤ 40 (77–102 measured) | **not this round's**: 100 µs with the old speed rule too (A/B'd on T1 at HARD); the table-build ms likewise |
| `deckRider` "finds the platforms" ms, base HARD think µs, base EASY passed, moving rows with a crowd at EASY (2 step-offs) | 07l's file (`deckRider.ts` changed in HEAD this round); base EASY is its documented known red |
| **`fightRace` "every Fall the Fight drove had a cause": `fight-self` 1 in Race B** | **this round's, by A/B**: green with 07a's speed rule alone, red with the relative-speed rule, twice each, sequentially. One Fall of two seeded twelve-Bot base-race Rounds, inside `FIGHT_BLAME_TICKS` of a Fight's walk with nothing else credited. Whether the Fight walked it off or a hold changed the pack is for a per-Bot trace (`fightRace.test.ts`'s own classifier); not done here. |

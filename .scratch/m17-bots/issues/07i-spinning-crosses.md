# 07i — Getting past spinning crosses

**What to build:** a Bot gets past a spinning bar or cross it cannot wait out. 07g measured why the
hold fails there: a cross has an arm past any point of its swath every **24 Ticks**, while a walk
through the swath takes **37**, so no window ever opens. The hold holds for 220–380 Ticks per Bot at
three mid-lane spin bars on Spin Cycle (Segments 33/34, 119 and 97) and then gives up into a Stagger.
Keeping swept floor off the first plan was tried and reverted, because the bars reach the lane's edge
and the second plan is the same route.

**Blocked by:** 07g. **Runs in parallel with 07h round 2**, which owns `deckRider.ts` and
`rideLinks.ts`.

**Status:** planned. **Wall clock: 75 minutes. Model: Fable.** Stop rule: 3 failed attempts at one
target, then record the numbers and the diagnosis, and move on.

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

## As built (2026-09-25, Fable, 75 minutes; numbers first)

Everything seeded (`holds:<leg>:<level>:0`), aggression 0, Motion running, 12 Bots, 120 s cap, on one machine
beside 07h's suites (wall-clock µs are ±2×). 07g's row is the "before".

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

### 3. Cost (met on two legs, within noise on the third)

The hook's share is **34–59 µs a call** on these legs (target ≤ 15; 07g: 2–16). Two costs, both mine:
the arc search itself (up to 47 start Ticks × 10 played arcs × ~60 Ticks × near bodies of `occupies`,
each a pose outside the 26-Tick ring cache — ~10 ms a search, once per Bot per bar, amortised over
~2000 calls) and, larger, the through-the-swath horizon and `inSwath` per sample per decision on every
leg with a sweeper. Not brought down in the budget. The cheap fix is to test an arc in the bar's *own*
frame (a spin about a fixed pivot: occupancy at `tick + d` is occupancy of the point turned back by
`ω·d` at `tick`), which makes every start Tick a rotation instead of a pose, and to cache `inSwath` per
decision.

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

### Regression set

Below, filled from the runs beside this section.

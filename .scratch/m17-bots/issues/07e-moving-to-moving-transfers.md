# 07e — Moving-to-moving transfers

**What to build:** a Bot goes from one moving floor to another: Spin Cycle's three carousels
(16 m discs, a metre of air between them), its turntables (8 m discs, two metres apart), the
base race's spinning squares (corners meeting every quarter turn), Spin Cycle's sliding
stepping stones. Cut out of 07b by the lead (2026-09-24): 07b's rides start and end on still
floor; here both ends move, so a transfer is a jump whose start *and* target are predicted.

**Blocked by:** 07b (its ride table, planner and `DeckRider` state machine are what this
generalises).

**Status:** done on tests for T1 and T2 at every level (2026-09-24, one acceptance run of the four allowed, 60 minutes); T3, the spinning squares, is slow, not falling and not (at HARD/NORMAL) stranded — the cause is read and recorded below, unfixed. **Wall clock: 45 minutes.** Model: Opus.

## The algorithm, decided

- `RideEnd.still` becomes `RideEnd.to: { still: Vec3 } | { platform: number; local: Vec3 }`.
  The table gains **transfer ends**: for platforms P, Q with rest footprints within
  `BOT_RIDE_JUMP_REACH_M + 2` of each other, sample both rims over the two periods' phases on a
  common Tick grid (`BOT_RIDE_PHASE_STEP_TICKS`, over `lcm`-ish: cap at `BOT_TRANSFER_SCAN_TICKS`,
  600) and keep rim pairs whose world distance falls under `BOT_RIDE_JUMP_REACH_M` at some Tick,
  merged as in 07b. The planner's graph gets `P.exit → Q.entry` edges at `BOT_RIDE_COST_M`.
- `waitToAlight` for a transfer: contact = `dist(toWorld(P, τ, x.local), toWorld(Q, τ + flight,
  q.local)) ≤ BOT_RIDE_JUMP_REACH_M` for `τ = tick + j`, with the jump's recipe `direction` aimed
  at `toWorld(Q, tick + flightTicks, q.local)` and the Bot's kept Ride velocity (the simulation
  adds it on leaving, ADR 0061) **subtracted** from the aim: measure the landing error on the
  carousel Track first and record it. Never stranded as in 07b.
- Spinning squares: a corner-to-corner transfer is the same rule with the hull's vertices as
  rim points (07b's table already includes them).

## Files

`bot/rideLinks.ts` and `bot/deckRider.ts` (07b's, taken over: 07b is done when this starts),
`bot/transfers.test.ts`, constants `BOT_TRANSFER_SCAN_TICKS` in 07b's block.

## Test Tracks

- **T1, two turntables**: `disc(0, TOP, 20, 4, { motion: spin(0.8) })` and `disc(1.5, TOP, 30, 4, { motion: spin(−0.9) })`, 2 m apart, a still lane before and after; arch; finish.
- **T2, two carousels**: two `disc(0, TOP, s, 8, …)` (radius 8) with 1 m between, `spin(0.45)` and `spin(−0.5)`, lanes before and after.
- **T3, spinning squares**: two `onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 1.5, rotation: π/4, motion: spin(±0.55) })` with corners meeting, lanes before and after (no bars: the spiked bar is 07a's, on 07d's leg).

## Acceptance (chosen; no baseline exists: every such leg is 0 / 12 today)

T1–T3, 12 Bots, 60 s: HARD passed ≥ 10, own Falls ≤ 2; NORMAL ≥ 8; EASY ≥ 4; stranded 0 at
every level. Think total ≤ 40 µs per Bot per Tick; table build ≤ 80 ms for Spin Cycle. Suite
≤ 60 s. Race legs (Spin Cycle 0, 2, 3; base race 3) are 07d's: each has a sweeper class on it.

## Out of scope, stop rule

As 07b's. Three misses → record and report.

## Checklist

- [x] `RideEnd` gains a transfer target; the table finds rim pairs of two platforms within jump reach over their shared cycle, mirrored, capped and spread
- [x] The planner crosses a transfer (`X → mirror(X)` at `BOT_RIDE_COST_M`) and the composed path carries no walk between two decks
- [x] `waitToAlight` for a transfer: the jump aimed at the other deck's middle as it will be at the landing, the kept Ride velocity subtracted, landed by `platformUnder`; never stranded as in 07b
- [x] Spinning squares as corner-to-corner transfers (the hull's vertices are rim points already) — and they are floors now (below)
- [x] The landing error measured on the carousel Track and recorded
- [x] Suite `bot/transfers.test.ts`: T1 and T2 at every level; **T3 red on passed at HARD/NORMAL and on one stranded at EASY** (numbers below)
- [x] Build and think cost measured and recorded
- [x] **(07d, 2026-09-24) The ride cost counts the wait at the exit** (`RideEnd.openPhases`,
      `RideLink.wait`, relative to the entry's best exit, plus a queue cost per Bot already waiting
      at a still entry in `dijkstra`): T3 HARD 7 → **10** (met); NORMAL 5 and EASY 6 each with one
      stranded (not met; three attempts, the boarding rule serialises a still entry — 07d's "As built" §1a)
- [x] **(07d) `navFloorWithin` cached by probe cell** in the still-end scan (`cachedProbe`,
      `BOT_RIDE_PROBE_CELL_M`): the base race's table 66 → 35–43 ms alone (07b's ≤ 50 row green again),
      Spin Cycle 174–221 → 85–94 ms; **not byte-identical** — 43 of 126 stills move, 83 by ≤ 6 cm and the
      rest by the merge/spread picks re-choosing — so the A/B is behavioural (deckRider's rows hold)

## As built (2026-09-24, one session)

### Deviations from the brief, following the code as 07b left it

- `RideEnd.still` was not replaced by a union `to`. 07b's third session wrote a dozen readers of `still`
  (`spreadStill`, `compose`, `dijkstra`'s walks, `exitFrom`, `someoneAhead`'s destination, `score`), so a
  transfer end **adds** `to: { platform, local } | null` and keeps `still` as the world point its own rim
  point rests at — for the path's corners only; nothing walks to it. Its `component` is
  `TRANSFER_COMPONENT` (−1), so no navmesh walk ever joins it, and `RideTable.mirror[i]` is the index of
  the end it meets on the other platform.
- The transfer's live target is **not** the paired rim point `q.local` but the other deck's **middle** as
  it will be at the landing Tick (`transferAim`): a disc's rims meet along the line between the centres at
  every phase, but *which* local point sits there changes with two incommensurate speeds, so a fixed
  `(x, q)` pair recurs only at their least common multiple. Aiming at the middle makes the contact a
  property of `x` alone (open whenever `x` faces the other deck), and the landing is checked inside that
  deck's outline by `BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M` at the landing and three Ticks after, either
  way along the carry by `BOT_RIDE_CARRY_MARGIN` of it, plus the boarding rule's shove test on the rim
  nearest the landing (`transferScore`). The paired `q.local` is only the graph's mirror end.
- After a transfer the Bot is aboard the next platform with no still corner to reach, so it goes the way
  a Bot knocked onto a deck already went: `landing` → `off` → `platformUnder` → `exitFrom` → `aboard`,
  a Dijkstra from aboard. One fix on that path: `off` with a ride corner whose entry platform is under
  the Bot begins `aboard`, never `waitToBoard`, and a transfer entry is never begun from still floor.
- `fresh`'s relative-velocity fallback covers `landing` too, read against the deck landed on
  (`arrive(boarding, tick, landedOn)`).

### Groundwork changed (`bot/movingWorld.ts`, needed for the brief's scope)

- **Near a floor is near floor.** The role rule asked "near *still* floor"; the middle carousel of three a
  metre apart and three of Spin Cycle's five turntables have none within 3 m and were sweepers. Nearness now
  spreads from the still floor across decks at one level (footprint circle to footprint circle, plus
  `BOT_RIDE_NEAR_FLOOR_M`) until nothing new is reached; the level test still keeps a bar over a deck a
  sweeper. Spin Cycle: **11 platforms** (was 7: the 3 carousels, 5 turntables, 2 stones, the last carousel).
- **A turned square reaches its corners.** The near-floor probe's box was `max(hx, hz)`; a 9 m deck turned
  45° (T3, the base race's three spinning squares) is 7.5 m from the lane by its side and 6.4 by its tip,
  and missed. The box is the hitbox's half-diagonal now. Base race: **8 floors** (was 5: the squares are
  floors), so base leg 3 (07d's) now has platforms at all.
- `movingWorld.test.ts` green (its role test asserts shapes, not counts).

### Measured

- **Landing error** (T2, two carousels, HARD, 12 transfers, the brief's ask): predicted landing vs the
  Bot's grounded position, 0.8–2.6 m, mean ≈ 1.7 m, **consistently along the carry** (carry 2.5–3.4 u/s,
  the Character kept less of it than `carry × flight` assumes, or lost it in the air). That is inside the
  `BOT_RIDE_CARRY_MARGIN × carry × flight` provision (≈ 1.5 m at 3.3 u/s), which is why the landings
  held; the model itself is not corrected here, since `jumpOff` is 07b's and R1/R2 must not move.
- **Build**: Spin Cycle **145 ms total, of which the transfer scan 16–20 ms** and rides 2 ms; 228 ends
  (144 transfer), 4356 rides. The 80 ms target is missed by 07b's still-end scan alone (145 ms before any
  transfer end existed; 07b measured only the base race). `RideTable.transferMs` carries the stage and the
  suite holds *it* under 80. T1 33–45 ms, T2 78–92 ms, T3 37–39 ms.
- **Think**: 9–27 µs per Bot per Tick on every row (target ≤ 40). **Suite**: 11.9 s (≤ 60).

### Acceptance (one run; seed `transfers:<track>:<level>`, 12 Bots, 60 s)

| Run | Target | Result |
|---|---|---|
| T1 HARD | ≥ 10, own ≤ 2, stranded 0 | **12, own 0 (pass)** |
| T1 NORMAL | ≥ 8, stranded 0 | **12 (pass)** |
| T1 EASY | ≥ 4, stranded 0 | **10 (pass)** |
| T2 HARD | ≥ 10, own ≤ 2, stranded 0 | **12, own 0 (pass)** |
| T2 NORMAL | ≥ 8, stranded 0 | **12 (pass)** |
| T2 EASY | ≥ 4, stranded 0 | **9, own 1 (pass)** |
| T3 HARD | ≥ 10, own ≤ 2, stranded 0 | 7, own 0, stranded 0, 5 slow (FAIL on passed) |
| T3 NORMAL | ≥ 8, stranded 0 | 6, own 0, stranded 0, 6 slow (FAIL on passed) |
| T3 EASY | ≥ 4, stranded 0 | 6, own 1, **stranded 1**, 5 slow (FAIL on stranded) |

Every Fall on T1/T2 but two is `Bump`/`contact`/`pushed` (shoves at the lane's end and the first rim).
T3's are the same kinds, at the first square's tip (z −35…−36.7) and the lane's end (−24.2).

### T3, read

On a square the corner that meets the lane is the corner that meets the other square half a turn later,
and the table has both a still jump end and a transfer end on that same vertex. The planner's ride cost is
`BOT_RIDE_COST_M + across`, and `across` between them is 0, so every Bot rides to **the tip it landed on**
and waits there for half a turn (5.7 s at 0.55 rad/s). Its waiting spot is the landing spot
(`aboardTarget`'s spread has no room at a tip), so `landingTaken` holds every boarder behind it: **one Bot
per half turn**, twelve need about 68 s, and the first pass comes at Tick 701. The pass rate after that
(one per 3–4 s) says a 90 s cap would meet the rows; the brief's is 60. The fix is a ride cost that knows
the **wait** at its exit (for a spin: the phase from the entry's meeting to the exit's, which a corner
three quarters round would make short) — a planner change 07b's spec cost did not foresee, not a
threshold to lower. The EASY stranded Bot is unproven: most likely a give-up wait (`BOT_RIDE_WAIT_MAX_TICKS`
plus `bestPass`, up to 21 s standing on a 343-Tick period) caught by the harness's 10 s window at the cap,
the case 07b's third session met on R2 EASY.

### Files

`bot/rideLinks.ts` (`RideEnd.to`, `TRANSFER_COMPONENT`, `RideTable.mirror`/`transferMs`, `transferPairs`),
`bot/deckRider.ts` (`transferAim`, `jumpOffEnd`, `transferScore`, the `off`/`landing`/`arrive` changes,
the transfer edge in `dijkstra`, `compose` without a walk after a transfer), `bot/movingWorld.ts` (the two
role changes), `bot/transfers.test.ts` (new), `tuning/bots.ts` (`BOT_TRANSFER_SCAN_TICKS`), ADR 0129
"As built" (one entry). No scratch file or debug toggle remains.

### Regression set (from `packages/shared`, one vitest invocation for the eight suites, `neverStepsOff` after)

`neverStepsOff -t "every Motion stopped"`: 0 own Falls, 12/12 on the base race, Spin Cycle and Slip Stream at
every level. `deckRider`: **R1 12/12/11, R2 12/12/11, base HARD 9 (own 2)** — 07b's rows hold; base
NORMAL/EASY are 07b's known reds (1, 0). `sweeperHold`: green but for 07a's known ordering row. `trapHold`:
D red under the parallel load (known; passes alone). `belts`, `sectionHarness`, `movingWorld`,
`neverStranded`, `TreeBot`: green. Typecheck clean in `packages/shared`, `apps/server`, `apps/track-builder`
(ignoring `*.scratch.test.ts`).

**One regression, mine, left red on purpose:** 07b's "base race ride table ≤ 50 ms" reads **66 ms alone
(transfer stage 7.4 ms) and 141 ms under the suite's parallel load**, against 21 ms before. The base race
has 8 platforms now, not 5: its three spinning squares are floors (the groundwork change above, which the
brief's own scope — "the base race's spinning squares" — requires), and each costs 07b's still-end scan a
343-Tick period (114 phases × ~36 rim points × walk/jump probes and the run-up march). The 50 ms was set
on a five-platform Track. Two honest answers, the lead's call: raise the budget to the Track as it is, or
cache `navFloorWithin` in the still-end scan by probe cell (rim points at many phases probe the same
world cells) — the second is the right fix and needs an A/B against R1/R2/base HARD that did not fit here.
The 07b threshold was not touched.

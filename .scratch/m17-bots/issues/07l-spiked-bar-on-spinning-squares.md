# 07l — The spiked bar on the base race's spinning squares

**What to fix:** base race Cp 2 → 3 (the three spinning squares, one of which carries a spiked bar) is
where HARD Bots now fall most. The combined run (`07d-integration.md`, last section) reads **Obstacle 48 at
HARD**, against 30 in the run before and 27 in 07d's own run. A Bot riding a spinning square is hit by
the bar that rides with it.

**Runs in parallel with 07i round 3**, which owns `sweeperHold.ts`, `movingWorld.ts`, `links.ts`,
`linkProof.ts` and PathBot's non-ride planning. You own `deckRider.ts` and `rideLinks.ts`, and may
*read* `sweeperHold.ts` but not edit it. If the fix belongs in `sweeperHold.ts`, write it down in As
built for the main session rather than build it. Shared files (`tuning/bots.ts`, `index.ts`, ADR 0129):
re-read before editing, additive only. Never commit, stash or revert.

**Wall clock: 60 minutes. Model: Fable.** Stop rule: 3 failed attempts at one fix, then record the
numbers and the diagnosis and stop.

## What is known

- 07e made the three spinning squares floors, so riding them is `DeckRider`'s. 07g made a Bot standing
  on a moving deck read sweeper samples in the deck's frame. 07i's original brief asked "find out which
  side misses the bar" and never got to it.
- The bar spins *with* the square it sits on, so in the deck's frame it may be still, or it may have its
  own Motion on top of the deck's. First read the Track data (`packages/shared/src/track/baseRace.ts`)
  to see which it is.

## How

1. Measure the leg alone with the section harness (`playSection`, base race leg Cp 2 → 3) at all three
   levels on two seeds. Record passed, stranded and Falls by kind. This is the "before".
2. Read one Obstacle Fall Tick by Tick (07h round 2's `bot-9` trace and 07j's `bot-2` trace show how).
   Answer: does the rider board or wait in the bar's reach, or does the hold never see the bar as a
   sweeper in the deck's frame?
3. Fix it where it starts. Target at HARD: Obstacle Falls on the leg ≤ 10, passed ≥ 10, stranded 0, and
   no step-offs. NORMAL and EASY no worse.

## Regression set

`deckRider.test.ts`, `transfers.test.ts` (T1–T3), `neverStepsOff -t "every Motion stopped"`,
`neverStranded`, and `apps/server` `matchRuntime.bots` and `botFill`. Typecheck `packages/shared` and
`apps/server`. Known reds that are not yours: the 14 in `RapierSimulation.test.ts`, the trapHold D/S
wall-clock asserts, `difficulty.test.ts`, and `races.test.ts`'s `ownFalls === 0`. Also, 07k (in
parallel) may be changing `simulation/character/`, so if T1's stranded count changes, that is theirs.

## Done when

The leg's before/after table and the traced cause are in "As built" below, numbers first.

## As built (2026-09-25, Fable, 60 minutes; numbers first)

Base race leg Cp 2 → 3 (`playSection`, leg 3, 12 Bots, aggression 0, cap 90 s, seeds `07l:<level>:a` / `:b`),
before and after back to back on one tree. Obstacle = Obstacle + Stagger + pushed. Every run was beside
07i round 3's and 07k's suites on four cores, so think µs are inflated and not read.

| Run | before: passed / stranded / Obstacle Falls (of which `Obstacle`) | after | target |
|---|---|---|---|
| HARD a | 5 / 0 / 18 (**17**) | 5 / 0 / **0** (0) | Obstacle ≤ 10 **met**; passed ≥ 10 **not met** (5, as before) |
| HARD b | 3 / 0 / 20 (**18**) | 3 / 0 / **3** (1) | Obstacle **met**; passed not met (3, as before) |
| NORMAL a | 1 / 1 / 22 (21) | 2 / 1 / 14 (**2**) | `Obstacle` 21 → 2, passed +1 |
| NORMAL b | 0 / 1 / 25 (22) | 2 / 1 / 9 (**0**) | `Obstacle` 22 → 0, passed +2 |
| EASY a | 0 / 1 / 18 (15) | 0 / 0 / 32 (**0**) | `Obstacle` 15 → 0, stranded 1 → 0; **`pushed` 2 → 26** |
| EASY b | 0 / 0 / 13 (10) | 0 / 0 / 34 (**1**) | `Obstacle` 10 → 1; **`pushed` 3 → 26** |

Step-offs: 0 at HARD before and after (one at NORMAL a and EASY a after, none before). The bar's own
knockdowns (`Obstacle`) are gone at every level: 17 / 18 / 21 / 22 / 15 / 10 → 0 / 1 / 2 / 0 / 0 / 1. What
replaced them is the crowd: `contact` at HARD 1 / 3 → 7 / 10, and at EASY `pushed` 2 / 3 → **26 / 26** (a
`pushed` Fall counts as an obstacle Fall in the harness's sum, which is why EASY's total reads higher) —
twelve Bots that used to be knocked down one at a time by the bar now all stand on the square, outside a
3.7 m swath on a deck whose inscribed radius is 4.5 m, in a ring 0.8 m wide, and shove each other off it.
Passed moved by 0 / 0 / +1 / +2 / 0 / 0: the leg's throughput is 07e's finding (a transfer between corners
that meet every quarter turn, one Bot per window), which this ticket did not touch.

### The traced cause

The bars are **separate Segments with a Motion of their own** (`spin(±1.4 … 1.8)` on a square spinning at
∓0.55), so in the deck's frame each sweeps a disc about the deck's centre at 1.95–2.35 rad/s. `bot-1` on
`07l:hard:a`, Tick by Tick: boards the first square at Tick 100, rides to its transfer spot, jumps at 142
and lands **on the spiked square at Tick 168 at 3.72 m from the pivot** — a transfer is aimed at the other
deck's *middle* (`transferAim`), which on these decks is the bar's pivot, and the fixed jump reach (4.9 m plus
the carry) brings it down inside the bar's sweep — skids on its carry to 3.36 m (the spikes reach 3.04 + a
0.35 capsule), goes to `landing`, **stands still** (`fresh` waits for a quiet view), and is knocked down at
Tick 175 by the bar coming round. Every Obstacle Fall on the leg reads within 3 m of a square's centre.

So it is neither "boards in the bar's reach" nor "the hold misses the bar in the deck's frame": **the hold
never runs aboard at all.** Every `DeckRider` Steering is `committed`, and `SweeperHold.hold` returns a
committed Steering untouched (its first line), so nothing aboard a deck — the walk to the waiting spot, the
wait, the landing — is ever vetted against a sweeper. 07g's deck-frame reading in `decide` only ever sees a
Bot *walking a path* on a deck, which a rider never is.

### The fix (all in `deckRider.ts`; `sweeperHold.ts` untouched)

A **riding sweeper** is read per platform and Tick (`swathsOn`, cached per table): a `sweeper` body whose
origin lies inside the deck's outline within `BOT_RIDE_SWATH_LEVEL_M` of its top **in the platform frame**
(the first cut compared a world height with the deck's local one and found nothing — bit-identical
outcomes, caught by a debug print), is at the same local point a quarter period on, and moves against the
deck faster than `BOT_HOLD_MIN_SPEED_WALKING` (or is spiked). Its **swath** is the body's swept radius plus
the capsule plus `BOT_RIDE_SWATH_MARGIN_M`. Then:

1. **The waiting spot** (`aboardTarget`) is pushed radially out of any swath.
2. **The walk across the deck** (`aboard`) goes *round* a swath, on a circle hugging it the shorter way
   toward the target, kept inside the outline (`aroundSwaths`). A tangent from the Bot's own point was tried
   first and measured 0 / 1 passed at HARD: it led out to the rim, the rim push led back into the swath, and
   the Bot walked to and fro at the mid-edge, where the ring between the two is a hand wide. On a deck a
   sweeper rides the rim push keeps only `BOT_EDGE_MARGIN_M`, not the ride inset too.
3. **Standing** (`holdAboard`, and `landing` after a transfer) inside a swath walks radially out instead —
   the Tick-175 knockdown above was a Bot standing still on its landing.
4. **A transfer's timing** (`transferScore`) refuses a landing Tick at which a riding sweeper occupies the
   landing point through `BOT_RIDE_SWATH_SKID_TICKS` of skid, or the walk out of the swath from there Tick
   by Tick (`landingClearOfSwaths`). On the spiked square the two-armed bar passes any point every 22 Ticks
   and the landing plus its walk out takes about 10, so windows exist, and they are read from exact poses.

Four constants in `tuning/bots.ts` ("A sweeper riding a moving deck"). No new export from `index.ts`.

### What is left, for the main session

- **Passed stays 5 / 3 at HARD** — the leg's own throughput, not the bar: it is 07e's "one Bot per
  window" at the corner transfers, now with the landing window narrowed further by the bar. Meeting
  "passed ≥ 10" is a planner change (a ride cost that knows the wait at its exit, 07e's own diagnosis),
  outside this ticket's hour.
- **Nothing here belongs in `sweeperHold.ts`.** The one thing worth knowing there: `hold` skips every
  committed Steering, which is by design (a ride owns the Bot), so a sweeper on a deck is the rider's to
  read, as it now is.
- **The crowd on the square** (`contact` at HARD 7 / 10, `pushed` at EASY 26 / 26): twelve Bots outside
  the swath share a ring 0.8 m wide. `aboardTarget`'s spread (`BOT_RIDE_SPREAD_M`) was made for a straight
  rim; on a swath deck the spread wants to go *round* the ring, not across and back from the exit. Not built
  (budget). At EASY it is the whole leg now.

### Regression set

Run on the final code beside 07i round 3's and 07k's suites (three workers at 100%), and once more on
the first cut, which found no swath and was bit-identical to the tree before, so that run is the baseline:
**every outcome row is identical between the two** — passed, stranded, slow and every Fall count on R1, R2,
base leg 2, the crowd case, T1, T2 and T3 at every level (`deckRider.test.ts` and `transfers.test.ts` print
them). No deck in those cases carries a sweeper, so `swathsOn` finds nothing there, as designed.

- `deckRider`: R1 12 / 12 / 11, R2 12 / 12 / 11, base 12 / 10 / 3 (EASY stranded 1, 07b's known red),
  crowd 12 / 12 / 3 (EASY step-off 2 — the same on the baseline run, so not mine; 07h round 2 recorded 0,
  and 07k is changing the simulation under both). Red only on wall clock: think 55–84 µs against 40, the
  table 195 ms against 50 (07e's known red), under the load.
- `transfers`: T1 12 / 12 / 12, T2 12 / 11 / 12, T3 12 / 9 / 11, stranded 0 everywhere (T1 NORMAL's
  wedge is gone on this tree, 07k's). Red only on wall clock: think 42–141 µs against 40, Spin Cycle's
  transfer stage 198 ms against 80, under the load.
- `neverStranded`: 5 / 5 green. `neverStepsOff -t "every Motion stopped"`: 9 / 9 green.
- `apps/server` `matchRuntime.bots` + `botFill`: 12 / 12 green. Typecheck `packages/shared` and
  `apps/server`: clean.

### Files

`bot/deckRider.ts` (`Swath`, `swathsOn`, `swathAt`, `swathAcross`, `outOfSwaths`, `aroundSwaths`,
`swathOccupied`, `landingClearOfSwaths`; `transferScore`, `aboardTarget`, `aboard`, `outOfSwath`,
`holdAboard`, the `landing` case), `tuning/bots.ts` (`BOT_RIDE_SWATH_MARGIN_M`, `BOT_RIDE_SWATH_LEVEL_M`,
`BOT_RIDE_SWATH_SKID_TICKS`, `BOT_RIDE_SWATH_LEAD_RAD`), ADR 0129 "As built", this ticket. `rideLinks.ts`,
`sweeperHold.ts`, `index.ts` unchanged. No scratch file or debug toggle remains.

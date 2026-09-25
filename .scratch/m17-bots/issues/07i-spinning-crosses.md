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

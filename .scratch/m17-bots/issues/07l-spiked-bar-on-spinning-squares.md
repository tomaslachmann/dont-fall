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

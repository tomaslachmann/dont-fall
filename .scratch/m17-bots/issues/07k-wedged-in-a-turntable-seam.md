# 07k — A Character wedged in a moving body's seam is stuck forever

**What to fix:** a simulation defect found by the bots, which a human Player hits the same way. A
Character carried by a turntable onto the seam between two of its pieces sinks into the groove. It ends
up inside the moving body and is never grounded or pushed out again. It is never counted as fallen
either, so it stays stuck for the rest of the Round. This is a `simulation/character/` ticket, not a bot
one.

**Found by:** 07h round 2 (`07h-moving-rows-with-a-crowd.md`, "As built (Round 2)", the `bot-9` trace).
**Runs in parallel with 07j**, which touches no simulation file.

**Wall clock: 75 minutes. Model: Fable.** Stop rule: 3 failed attempts at one fix, then record the
numbers and the diagnosis and stop.

## The trace (07h round 2, measured)

`transfers:T1:normal` (`packages/shared/src/bot/transfers.test.ts`, Track T1: two turntables), `bot-9`:

- Ticks 429–495: the Bot stands still on the second turntable (`waitToAlight`) while the spin carries it.
- Tick 496: the spin carries it onto a seam between two of the disc's **eight pieces**. It sinks 0.18 m
  into the groove, still grounded, with `platformUnder` null.
- By Tick 500 it sits at y 4.45, 0.4 m under the deck top and inside the outline. It is **never grounded
  again**. Its position stays frozen to the centimetre for the remaining 1300 Ticks, while `velocity.y`
  grows without bound: −3.5 at Tick 500, **−843 at Tick 1645**.
- A horizontal push plus a jump in either direction changed only its horizontal velocity. The capsule
  controller cannot move it, and a jump cannot fire because it is not on the ground.

Two things are wrong, and each wants its own answer:
1. **Why the seam swallows a capsule.** It could be a gap or step between the pieces' colliders, the
   ride carry (chord versus arc over still Ticks), or the kinematic character controller's
   depenetration against a moving kinematic body. Find which one before fixing anything.
2. **Why a wedged Character never recovers or falls.** Nothing pushes it out, and `velocity.y` piles up
   with no effect. At minimum a Character must never stay stuck: either it is freed, or its growing
   gravity must stop accumulating unseen.

## How

1. Reproduce it deterministically: run the `transfers` T1 NORMAL case alone and confirm bot-9's trace.
   Then build a minimal repro with no Bot: one Character placed where bot-9 was at Tick 496, on the same
   Track at the same Tick. Make that repro the regression test (`simulation/character/*.test.ts` or next
   to `CharacterController`).
2. Read the turntable's collider layout at the seam: the piece outlines, any gap, the heights.
3. Fix it where it starts, in `simulation/character/` (`MovementController` / `Capsule`) or in how the
   ride carry is applied. It must stay deterministic and shared by client and server (ADR 0003/0005),
   and the Character stays a kinematic capsule (ADR 0006). If the fix changes feel or replication, stop
   and write it down rather than build it: that needs an ADR and the user.
4. Any new constant goes in `packages/shared/src/tuning/` (`character.ts` or `movement.ts`).

## File ownership

- Yours: `packages/shared/src/simulation/character/*`, `CharacterController.ts`, and a new test beside
  them.
- Not yours: anything in `packages/shared/src/bot/`, where 07j is reading, and `tuning/bots.ts`.

## Rules

- NEVER commit, stash, reset or revert.
- Run only the suites your change touches, plus the regression set below.
- Known reds that are not yours: the 14 standing failures in `RapierSimulation.test.ts` (compare their
  count before and after, and they must stay 14), the trapHold D/S wall-clock asserts, and
  `difficulty.test.ts`.

## Regression set

- `simulation/character/*.test.ts` and `simulation/**/*.test.ts`: the same failures as before, no new ones;
- `packages/shared/src/track/baseRace.test.ts` and the authored Tracks' walks (`walkTrack`);
- `packages/shared/src/bot/transfers.test.ts` (T1 NORMAL stranded should now be 0);
- `packages/shared/src/bot/neverStepsOff.test.ts -t "every Motion stopped"`;
- typecheck `packages/shared`, `apps/server` and `apps/client`.

## Done when

The minimal repro is a test that is red before the fix and green after, T1 NORMAL has 0 stranded, and
the regression set holds. Write "As built" below with the numbers first, the cause as found, and whether
an ADR is needed.

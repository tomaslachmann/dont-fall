# 14 — A local motion planner between the path and the input

**Design:** ADR 0130, read it first. **Evidence:** `07m-bodies-that-move-as-one.md`, "The log".
**Status:** planned (2026-09-25). This replaces 07m's proposals 1 and 2. They are this ticket's phases
1 and 2, built as the planner, not as more handlers.

## The measuring tool (use it first, and every phase)

`/tmp/claude-0/-home-user-dont-fall/1f9d0a11-d77f-5a3c-8e1e-75269777c133/scratchpad/staggerLog.scratch.test.ts`
is the 07m log.
- **What it does:** it patches the prototypes of `RapierSimulation.resolveMovingSegmentContacts`,
  `CharacterController.applyImpact`, `DeckRider.steer` and `SweeperHold.decide`. For every Impact
  ≥ 4 on a Controlled or Sliding Character, it logs the Segment, the closing speed, `vseg` and `vbot`,
  the rider state and the hold's last decision.
- **How to run it:** copy it into `packages/shared/src/bot/` to run it, then move it back out. Never
  commit it.
- **Once the planner exists:** it must also log the planner's chosen candidate at impact. Turn it into
  a small committed instrument (`sectionHarness` option `impactLog`) if that is cleaner, but only if it
  is.
- **The before-numbers:** 07m's table (seed `holds:07m:<leg>:<level>:0`, 120 s, 12 Bots, legs Spin
  Cycle 0 and 1, Slip Stream 2).

## Phases (each measured before the next; stop rule: 3 failed attempts at a phase's target, then record and stop)

1. **The planner core, replacing `retreat` and `stand`.**
   - Build `bot/localMotion.ts` with the candidates, the rollout through `accelerate` and the score
     (ADR 0130).
   - Model moving bodies only in this phase: `MovingWorld.occupies`, and the closing speed from
     `velocityAt` and the candidate's own velocity, as `counts` does it.
   - Wire it where `SweeperHold` returns `stand`/`retreat`: the hold says "not forward", and the planner
     picks among stand and the sideways/back candidates.
   - Targets on the three legs at HARD and NORMAL, same seeds:
     - spin-bar impacts during a retreat-or-planner move → ≤ 10% of 07m's count;
     - Stagger Falls halved;
     - passed no worse;
     - step-offs 0, stranded 0.
2. **Braking.** The stand candidate brakes to zero on every floor: a push against its own velocity
   until it is under `BOT_BRAKE_MIN_SPEED`.
   - Target: at EASY, impacts with the hold standing and `vbot` > 0.5 go below 10% of 07m's 113.
3. **Crowd.**
   - Other Characters join the rollout. Their positions come from `others`, and each velocity is the
     difference between the Bot's last two views of that Character, extrapolated at constant velocity.
   - Every non-committed Steering goes through the planner, not only a held one.
   - Targets:
     - base race NORMAL and EASY: `contact` + `pushed` on Cp 1→2 and Cp 2→3 halved against the evening
       whole-Race run in `07d`;
     - HARD base finish ≥ 11 held;
     - think µs within ticket 08's budget.
4. **Swept regions for slides** (07m B-1).
   - `MovingWorld` keeps one swept hull per body, computed off the clock over one cycle.
   - The planner's and `SweeperHold`'s "still in the swath" ask it instead of the disc.
   - Target: at EASY, Slip Stream's "unchecked" impacts go to 0.

Later, not in this ticket: moving `SweeperHold`'s go/hold decision into the planner (ADR 0130, point
3), and difficulty re-expressed as in ADR 0130, point 5.

## Files

- **New:** `bot/localMotion.ts` and `bot/localMotion.test.ts`.
- **Changed:** `PathBot.ts` (the wiring), `sweeperHold.ts` (`stand` and `retreat` hand over to the
  planner), `tuning/bots.ts` (the horizon, the candidate angles, the weights), and `movingWorld.ts`
  (phase 4).
- **Left alone:** `deckRider.ts`, `rideLinks.ts`, `links.ts` and `linkProof.ts`.

## Regression set (each phase end)

- `neverStepsOff -t "every Motion stopped"` must be 9/9;
- `neverStranded`;
- `sweeperHold.test.ts`, `trapHold`, `belts`, `edgeGuard`, `TreeBot`, `fight` and `fightRace`;
- `deckRider` and `transfers`, which must hold;
- `apps/server` `matchRuntime.bots` and `botFill`;
- typecheck `packages/shared` and `apps/server`;
- at the end, the whole-Race run (`BOT_RACES=1 … races.test.ts`), compared with the evening table in
  `07d`.

Known reds that are not yours: the 14 in `RapierSimulation.test.ts`, the trapHold D/S wall-clock
asserts, `difficulty.test.ts`, and the `races.test.ts` `ownFalls === 0` check.

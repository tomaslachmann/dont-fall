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

## As built (phases 1–2, 2026-09-25)

**Status: phases 1 and 2 built and measured; phase 1's targets met at HARD but for Stagger Falls by
one and a half, missed at NORMAL; three attempts, stopped by the rule.** Phases 3 and 4 not started.

The numbers first. Same tool, same seeds (`holds:07m:<leg>:<level>:0`), 120 s, 12 Bots. "Before" is
07m's log re-run on the untouched tree (bit-identical to 07m's table). "During a move" counts a
spin-bar impact whose last hook output, within 3 Ticks, was a retreat (before) or a planner move
(after); the hook's output per Tick is the tool's new column, since 07m's "last decision" column
counted decisions up to 800 Ticks stale (a ride or a link in between).

| leg | level | passed | Stagger Falls | spin-bar impacts, all | during a retreat → a planner move | standing, `vbot` > 0.5 |
|---|---|---|---|---|---|---|
| Spin Cycle Start→Cp 0 | HARD | 3 → **4** | 12 → **10** | 129 → 63 | 96 → 4 | — |
| | NORMAL | 2 → **4** | 16 → 15 | 138 → 40 | 90 → 5 | — |
| | EASY | 1 → 2 | 13 → 17 | 76 → 86 | 0 → 9 | 40 → 0 |
| Spin Cycle Cp 0→1 | HARD | 7 → **12** | 15 → **4** | 88 → 15 | 82 → 9 | — |
| | NORMAL | 8 → **10** | 11 → 11 | 50 → 26 | 25 → 10 | — |
| | EASY | 6 → 9 | 18 → 17 | 39 → 49 | 0 → 17 | 39 → 0 |
| Slip Stream Cp 1→2 | HARD | 11 → **12** | 10 → **6** | 56 → 11 | 52 → 1 | — |
| | NORMAL | 8 → **10** | 21 → **13** | 73 → 15 | 71 → 5 | — |
| | EASY | 1 → 2 | 35 → 43 | 94 → 72 | 0 → 11 | 34 → 0 |

Against the targets:

- **spin-bar impacts during a retreat-or-planner move ≤ 10 % of 07m's:** HARD 230 → 14 (**6 %, met**);
  NORMAL 186 → 20 (11 %, missed by one). A further 26 / 7 impacts had a planner move as the hook's
  last output more than 3 Ticks earlier (a ride or Recover had taken the Bot since).
- **Stagger Falls halved:** HARD 37 → 20 (−46 %, missed by 1.5); NORMAL 48 → 39 (−19 %, missed).
  EASY, not a phase-1 target, 66 → 77.
- **passed no worse:** HARD 21 → 28, NORMAL 18 → 24, EASY 8 → 13 (met everywhere).
- **step-offs 0, stranded 0:** met on all nine runs (attempt 1 stranded 3, attempt 2 stepped off 1).
- **Phase 2, EASY, hit "standing" with `vbot` > 0.5: 113 → 0** (met; the 5 left at Start→Cp 0 are
  stands that were the hook's last output 4+ Ticks before a ride took the Bot).
- **Spin-bar impacts of every kind fell by two thirds at HARD and NORMAL** (273 → 89, 261 → 81) and
  not at EASY (209 → 207).

**Think:** 76–122 µs per Bot-Tick at HARD, 77–108 at NORMAL, 82–111 at EASY on these legs, measured
under a loaded CPU (the regression set ran alongside). The planner is not what costs: on Spin Cycle
Start→Cp 0 at HARD with `choose` replaced by a bare stand the same run thinks at 140.6 µs, and the
planner's own share is 116–292 µs a choice over 645–2,646 choices a run, which is 2–10 µs per
Bot-Tick. That leg's cost is the hold's `decide` and the rest of the think, as before this ticket.

**The three attempts, and what each found:**

1. *The planner as designed* (candidates, the rollout through `accelerate`, the score; the stand
   braking against the seen velocity on every floor). Retreat impacts fell to 3–5 %, but every Bot
   hit "standing" at HARD had `vbot` 5.5 — and the guard's log showed it was *asked* a walk. The brake
   pushed against the **seen** velocity, 2–8 Ticks stale, on a floor whose grip had already stopped the
   body: a walk backwards at full speed, the retreat by another name. (A standing Character is only
   ever pushed by these bars, traced: carried 2.6 m in 16 Ticks, velocity 0, no Stagger.)
2. *The brake made grip-aware* (`LocalMotionPlanner.brake(self, grip)`: a zero move where grip stops the
   body in the Tick, the push against the velocity only on a slick floor). Standing impacts went to 0;
   the ±60° candidates were now hit instead, each on the first Tick of the move after 15 Ticks of
   standing. The scores of those decisions showed a boxed Bot: the stand carried over the lane's edge
   (`E`, 15–19 Ticks of contact), every move against the arm Staggered, every move *out* of the swath
   scored as a Fall because the rollout held the push for the whole horizon and walked over the inner
   line — which `EdgeGuard` never lets happen.
3. *The rollout models the guard*: a walk that would cross an edge's inner line (or leave the deck)
   stops there and stands for the rest of the horizon; only a **push** across it is a Fall. And the
   one-Tick offset fixed: the step for Tick `at` is resolved against the poses at `at`
   (`RapierSimulation.tick`), so the position after step `k` is checked against `tick + k − 1`. This is
   the tree as left.

**What remains, diagnosed:** the hold stops **inside** a spinner's swath. 07g's walk-up-to-what-blocks-it
holds 1–1.9 m short of the first blocked *sample*, which for a bar is well inside its disc, and when the
arm comes round the Bot is boxed (the scores above). The planner then takes the least bad: a Stagger
(20) over being carried off (30). Every remaining planner-move impact at HARD and NORMAL is that
shape. The fix is upstream of this ticket: hold at the swath's edge, or move the go/hold decision into
the planner (ADR 0130, point 3). The other buckets are `go` (a decided go that was wrong: timing
error, a window that closed) and `go-gaveup` (a hold at its cap walking through regardless: 21 at
EASY on Spin Cycle Cp 0→1).

**Built:**

- `bot/localMotion.ts`, `LocalMotionPlanner`: `choose(ask)` scores a stand and the turns of the asked
  move (`BOT_PLAN_TURN_DEGREES`; with `forwardRefused`, only those of `BOT_PLAN_HELD_MIN_TURN_DEG` or
  more) by a rollout of `BOT_PLAN_HORIZON_TICKS + stale.max` Ticks: progress toward the corridor's
  point `BOT_PLAN_LOOK_M` along the path, less a Stagger (spiked, or the relative speed to the body ≥
  `MOVING_SEGMENT_STAGGER_SPEED`, the simulation's own rule with the candidate's velocity), less each
  Tick of contact (the rollout is carried with the body), less a push off the floor, less the turn
  (`1 − cos`), plus a keep bonus for last time's candidate. `steer` sends the candidate; `stand` /
  `brake` as above. Every candidate's score is in the `Choice` for a suite or a log. Deterministic: no
  draw.
- `sweeperHold.ts`: `Decision` is `go | hold`; `Blocked` carries `deck` and `standHit` (the old
  "retreat" test); the arc is still tried first where the stand is quiet and off a deck; otherwise
  `choose` at every decision and `steer` between. `stand` and `retreat` are gone; the arc's wait is the
  planner's stand.
- `edgeGuard.ts`: `VoidEdge`, `voidEdgesNear` and `crossesOut` exported for the rollout — the same edges
  and inner lines the guard vets against.
- `tuning/bots.ts`: the `BOT_PLAN_*` block, nine constants, each a first guess.
- `bot/localMotion.test.ts`: five questions on a lane with one bar.
- The measuring tool grew the hook-output column, the guard's and the belt's outputs, each Bot's last
  choice with every candidate's score, `LEGS=` and `PLAN_OFF=1`; it stays out of the repo.

**The whole-Race run** (`BOT_RACES=1 … races.test.ts`, against 07d's evening table, in brackets):

| Race | level | finished | stranded | step-offs | own / obstacle | where |
|---|---|---|---|---|---|---|
| base race | HARD | 10 (11) | 0 (0) | **1** (0) | 9 (14) / 12 (16) | Cp 4→5: Stagger 8; Cp 1→2: contact 2, **step-off 1** |
| | NORMAL | **5** (2) | 0 (0) | **1** (0) | 10 (8) / 39 (30) | Cp 2→3: pushed 27, contact 10, step-off 1 |
| | EASY | 0 (0) | 2 (0) | 1 (5) | 22 (23) / 78 (72) | Cp 2→3: pushed 44, contact 30 |
| Spin Cycle | HARD | 0 (0) | 0 (0) | 0 (0) | **31** (26) / 50 (38) | Start→Cp 0: Stagger 14, pushed 16, contact 9; Cp 0→1: Stagger 8; Cp 5→6: WallImpact 6 |
| | NORMAL | 0 (0) | 0 (0) | 0 (0) | **57** (80) / 87 (108) | Start→Cp 0: Stagger 30, pushed 25, Bump 11; Cp 0→1: Stagger 21 |
| | EASY | 0 (0) | 1 (1) | 3 (2) | 57 (46) / 113 (95) | Start→Cp 0: pushed 57, Stagger 47, Bump 26 |
| Slip Stream | HARD | **11** (8) | 0 (0) | 0 (0) | **21** (44) / 21 (44) | Cp 1→2: Stagger 13, Obstacle 4 |
| | NORMAL | **9** (7) | 0 (0) | 0 (0) | **35** (48) / 31 (46) | Cp 1→2: Stagger 16, link 4; Cp 4→5: Stagger 10 |
| | EASY | **4** (1) | 2 (1) | 0 (1) | 69 (80) / 57 (73) | Cp 1→2: Stagger 47, `link` 14 |

Finished 33 → 39 of 108, the Stagger legs halved at HARD (Slip Stream's own Falls 44 → 21), Spin Cycle
still finishes nobody, and the crowd legs (base race Cp 2→3, Spin Cycle's start) are unchanged or worse
— phase 3's. Think 63–105 µs per Bot-Tick with the CPU shared by the regression set; 07d's evening run
is not comparable on that column. The file is still 9 / 9 red on `ownFalls === 0` (known).

**A step-off each at HARD and NORMAL on the base race, where the evening run had none.** Both are on
ride legs (the moving rows, the spinning squares), where every Steering is committed and the planner
is never asked; the harness names a Fall a step-off only when no touch, push, link, belt or contact
is within its windows, so this may be a reclassified shove among a crowd that now arrives together,
or a real one. **It needs a Bot-by-Bot trace before this lands** (the rule is ADR 0129's), which this
session did not have the budget for.

**Regression set:** `neverStepsOff -t "every Motion stopped"` 9 / 9, `neverStranded` 5 / 5,
`localMotion` 5 / 5, `sweeperHold` / `trapHold` / `belts` / `edgeGuard` / `TreeBot` / `fight` /
`fightRace` 60 passed, 3 red; `deckRider` + `transfers` 9 passed, 14 red; `apps/server`
`matchRuntime.bots` + `botFill` 12 / 12; both typechecks clean. **Every red is one the tree had before
this ticket, on the same assert** (the main session's sequential logs of the same suites, 10:55):
the trapHold D / S wall-clock asserts, `sweeperHold` base1's EASY > NORMAL obstacle-Falls ordering
(0 > 1 before, 1 > 1 now), `deckRider`'s ride-table build time, base HARD think ≤ 40 µs, base EASY's
and the crowd rows' EASY step-off (1 and 2, as before), and `transfers`' nine `think ≤ 40 µs` asserts
(44–101 µs before, 43–107 now, the CPU shared both times).

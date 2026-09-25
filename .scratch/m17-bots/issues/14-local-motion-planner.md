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
3. **Crowd** (rewritten 2026-09-25 after phases 1–2). The written version, "every non-committed
   Steering through the planner", would miss most of the crowd Falls. They happen on rides, where
   `DeckRider` is committed and the planner is never asked:
   - the squares' ring on base race Cp 2→3 (pushed 27 / 44 at NORMAL / EASY);
   - waiting and boarding on Spin Cycle Start→Cp 0 (pushed 16–57);
   - the moving rows on base race Cp 1→2.

   In order:
   0. **First, trace the two new step-offs** (base race HARD and NORMAL, the whole-Race run in the As
      built below) Bot by Bot, as ADR 0129 requires. If one is the planner's, fix that before anything
      else.
   1. **Two kinds of committed.** A *script* stays untouchable: a link's run, a transfer's run-up and
      jump, an arc. *Positioning* goes through the planner, in the deck's frame when the Bot is on one:
      `DeckRider`'s waiting spot, its walk across a deck, standing aboard, waiting to alight. Mark this on
      the Steering (for example `committed: "script" | "position"`, or a separate flag), so that
      `EdgeGuard` and the other hooks keep treating both as they do today.
   2. **Characters with velocity.** Take `view.characters` (id → `CharacterSnapshot`, which has
      `velocity`) as the Bot sees them, not the position-only `others`. Extrapolate each at constant
      velocity over the rollout, and consider only those within a few metres. `queueFor` and `unstall`
      keep their input.
   3. **Risk by the simulation's rules.** Contact on its own is not a Fall. Score:
      - a **Bump that would Stagger**: a relative closing speed ≥ `MOVING_SEGMENT_STAGGER_SPEED` at a
        predicted overlap, which is the same threshold through `BUMP_IMPULSE_SCALE`. Two Bots walking at
        each other close at 11 u/s;
      - a **contact near an edge**, weighted by how close the rollout point is to the nearest void
        edge (`voidEdgesNear`), because a `pushed` Fall is a shove at an edge.
   4. **No dance.** Twelve planners alike all dodge the same way and oscillate. Each Bot gets a
      deterministic preferred side (`botDraw(seed, …)`), a small bias in the score, and the existing
      keep bonus holds its choice.
   5. **Spread the waiting.** Bots waiting for a sweeper's window or to board stand at one point. Their
      waiting spots are spread across the lane's width, or round a deck's ring (07l's finding). A queue
      order like `queueFor`'s is used where there is one way through.
   6. **The fight is exempt.** A Character the behaviour tree is fighting (aggression > 0) is left out of
      the crowd risk. `fightRace` must stay green.
   7. **Measure** with the log extended to Character impacts and pushes: who pushed whom, the
      Bot's `DeckRider` state, and the distance to the nearest edge. Legs: base race Cp 1→2 and Cp 2→3,
      Spin Cycle Start→Cp 0, all three levels, seeds as before.
   - Targets:
     - base race NORMAL and EASY: `contact` + `pushed` on Cp 1→2 and Cp 2→3 halved against the
       evening whole-Race run in `07d`;
     - Spin Cycle Start→Cp 0: `pushed` halved;
     - base race HARD finish ≥ 11 held, step-offs 0 (the two above explained or gone), stranded 0;
     - phases 1–2's numbers no worse;
     - think µs reported (the planner's own share, as phases 1–2 measured it).
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

## As built (phase 3, 2026-09-25)

### Item 0: the two step-offs, traced Bot by Bot (before anything was changed)

Both reproduced bit-identically on the untouched tree (`playSection` with the whole-Race seeds
`races:base race:<level>`, a scratch tracer recording every Tick's true position, the rider's state,
`PathFollower`'s output, the hold's and the guard's). **Neither is the planner's**: on both, every
Steering in the last 120 Ticks was a `DeckRider` script (`committed`), the hold and the guard were
never asked, and the planner never ran.

- **HARD, bot-0, Cp 1→2 (the moving rows), Tick 1589.** An `alighting` jump off a sliding row, with
  bot-1 0.8–1.2 m beside it through the whole run-up and flight (t1526–1569). It came down at
  (−0.57, 4.67, −195.7): grounded but `Sliding`, 0.2 m under the still floor's level — on a bevel beside
  the floor it aimed at. The rider's "down again but not on the floor it aimed for: for that floor" push
  (`deckRider.ts`, the `jumpHeading` branch) then walked it +x, and the ground under it fell 4.65 → 2.8
  over 15 Ticks (a 45° face) until it dropped. The harness names it a step-off because bot-1's last
  touch (t1569) was 20 Ticks before the last ground Tick and nothing else was within its windows; it
  is a landing beside the still with a neighbour alongside, not a move the Bot chose toward a drop. The
  fix is the rider's (a landing that reads `Sliding` should not push for the still along the face), not
  this phase's.
- **NORMAL, bot-8, Cp 2→3 (the spinning squares), Tick 7348.** Landed from a transfer, went `landing`
  → `off` → `aboard` (its next corner was a ride from the deck it stood on), then walked the deck for
  its `aboardTarget` with a view 3–8 Ticks late: the headings flip between the target (+z) and the
  rim push (−x) every few Ticks, the classic to-and-fro at the rim, and from t7337 it walked +z for
  7 Ticks straight while its seen position lagged 1.0 m behind its real one; at t7344 it was past the
  rim in the air with its own rim check reading it 0.65 m inside. **This is exactly item 1's case** —
  a positioning walk aboard, committed and unvetted, steered live off a late view — and it is why the
  planner's rollout on a deck now stops at the outline less `BOT_EDGE_MARGIN_M` plus what the Bot
  walks while its view lags (`deckMargin`), as the rider's own target inset does.

### The numbers (items 1–7): three attempts, none met a target, the crowd pass is built but off

**Status: built and measured; stopped by the rule after three attempts.** The crowd scoring, the
positioning mark, `neighboursOf` and the two new planner questions are in the tree and green; the two
call sites are behind `BOT_PLAN_CROWD_RIDES` / `BOT_PLAN_CROWD_HOLDS`, **both `false`**, so the shipped
behaviour is phases 1–2's (one model change stays on: a hold's ask aboard a deck reads the deck's
outline less `BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M` instead of the bare outline).

The measuring tool grew item 7's columns: every Character-to-Character Bump (`resolveBump` patched:
mover, bumped, closing speed, the bumped's rider state, its distance to the nearest void edge, the
hook's last output) and every crowd Fall joined to the rider state. Same seeds (`holds:07m:<leg>:<level>:0`),
120 s, 12 Bots, legs base race Cp 1→2 and Cp 2→3 and Spin Cycle Start→Cp 0. `c+p` is `contact` +
`pushed`; "Bumps ≥ 4" is Bumps at Stagger magnitude.

| leg | level | passed: before → 1 → 2 → 3 | c+p: before → 1 → 2 → 3 | step-offs: 1 / 2 / 3 | Bumps ≥ 4: before → 3 | think µs: before → 3 |
|---|---|---|---|---|---|---|
| base Cp 1→2 | HARD | 12 → 3 → 1 → **3** | 6 → 9 → 4 → 9 | 3 / 0 / 0 | 196 → 398 | 67 → 197 |
| | NORMAL | 11 → 4 → 2 → 9 | 17 → 23 → 13 → 14 | 5 / 0 / 0 | 108 → 132 | 41 → 106 |
| | EASY | 4 → 0 → 3 → 4 | 28 → 66 → 29 → 21 | 20 / 1 / 0 | 323 → 183 | 35 → 116 |
| base Cp 2→3 | HARD | 11 → 4 → 2 → 10 | 11 → 23 → 4 → 6 | 2 / 0 / 0 | 285 → 512 | 67 → 113 |
| | NORMAL | 6 → 1 → 2 → 5 | 26 → 48 → 12 → 37 | 20 / 0 / 1 | 286 → 330 | 61 → 101 |
| | EASY | 0 → 0 → 0 → 0 | 51 → 75 → 54 → 59 | 22 / 0 / 0 | 428 → 305 | 56 → 115 |
| Spin Start→Cp 0 (pushed) | HARD | 4 → 1 → 2 → 1 | 14 → 11 → 6 → 14 | 15 / 0 / 0 | 189 → 298 | 115 → 177 |
| | NORMAL | 4 → 0 → 0 → 0 | 15 → 11 → 11 → 15 | 13 / 0 / 0 | 373 → 329 | 104 → 147 |
| | EASY | 2 → 0 → 0 → 0 | 9 → 10 → 15 → 22 | 15 / 0 / 0 | 247 → 110 | 111 → 138 |

Against the targets: **`contact` + `pushed` halved on base Cp 1→2 and Cp 2→3 at NORMAL and EASY: not
met** (best, attempt 2, −25 % and −54 % at NORMAL, +4 % and +6 % at EASY, with `passed` collapsed);
**Spin Cycle `pushed` halved: not met** (attempt 2 halved it at HARD alone, with 1 passed of 4);
**step-offs 0: met by attempts 2 and 3** at HARD and NORMAL (attempt 1 had 13–22 a leg); **phases
1–2's numbers no worse: not met by any attempt** (Spin Cycle Start→Cp 0 passed 4 / 4 / 2 → 1 / 0 / 0);
**think: the planner's share** rose from 2–10 µs per Bot-Tick to 30–90 (4,500–12,700 choices a run at
270–660 µs a choice, against 800–1,500 at 160–340 before), because a Bot in a queue has a neighbour
within reach every Tick. With both switches off the planner is asked exactly as in phases 1–2.

**The three attempts, and what each found:**

1. *As designed, plus the plain walk.* Every non-committed corner walk went through the crowd too,
   the rides' positioning committed and unvetted, an overlap displacing the rollout by the whole
   overlap, contact weighted ×6 near an edge. Two thirds of all choices were turns (`0` 3,105 of
   9,052 at Spin HARD): in a 3 m lane every Tick beside a neighbour cost about 1, twenty of them more
   than the horizon's whole progress, so packs scattered and 180° turns walked Bots back into the
   pack behind them; and a positioning walk the rollout had *stopped at the margin* (because the
   guard would) was sent as a committed heading for three Ticks with no guard to stop it — 13–22
   step-offs a leg, at HARD too. Staggering Bumps went up (189 → 483 at Spin HARD): the dodging made
   the crossings.
2. *Rides and holds only, stops sent as stands, still-floor turns uncommitted (the guard vets them),
   half the overlap each, edge weight ×2, the deck's margin = `BOT_EDGE_MARGIN_M` + the lag walk +
   the decide interval.* Step-offs 0 at HARD and NORMAL, crowd Falls down on every base leg but EASY,
   and **`passed` collapsed** (rows 12 → 1 at HARD): the margin was 1.1 m at HARD and 2.2 m at
   NORMAL, which covers a 4 × 4 row and most of a square, so every walk aboard was `stopped` on its
   first step and sent as a stand (`stand` 7,924 of 12,711 choices). Think doubled: `near` and the
   bodies were two thirds of a 632 µs choice.
3. *The rider's own rim margin (`BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M`), a stand only for a stop
   within the lag plus the decide interval (`Scored.stoppedAt`), no moving body in a positioning ask,
   reach 4 m.* Throughput came back on the squares (10 / 5 / 0) and NORMAL's rows (9), not HARD's rows
   (3 of 12): the crowd's shoves aboard a sliding row keep every rollout displaced, and a Bot that
   turns off its `aboardTarget` walk for a neighbour is turned back by the rider's rim push the next
   Tick — the to-and-fro item 0 traced, now between two planners. Staggering Bumps rose at HARD on
   both base legs (196 → 398, 285 → 512).

**Diagnosis.** The crowd term does what it says in isolation (the two new planner questions), and it
is not what the rides need. A ride's positioning is a *count from a fresh stand* (07h): its walks are
short, aimed, and already spread (`across`, `spreadStill`); a planner that turns one of them for a
neighbour breaks the count, the rider re-aims, and the two fight. What the crowd Falls on a row need
is not a better direction but **fewer Bots on the same rim point at the same Tick** — a queue order
for boarding and alighting spots, as `queueFor` gives a link's start (item 5's second half, not
built), and a shove model in the rider's own `contact`/`score` (a landing next to a waiter). The
Bump-that-Staggers term is right but rarely the Fall: staggering Bumps are 1–3 % of Bumps, and the
`pushed` Falls come from ordinary shoves at a rim, which the displacement term sees only once the two
already overlap in a view that is late for both. Items 5 (the ring, the queue) and 6 (the exemption
is wired: `Fighter.targetId` is passed and left out; `fightRace` is green with both switches) are
where the next attempt should start, in `deckRider.ts`, which this ticket said to leave alone.

**Built (all green, `localMotion` 7 / 7):**

- `localMotion.ts`: `Neighbour`, `PlanAsk.others` / `holdHere`, `Scored.bumped` / `crowd` /
  `stoppedAt`, `Candidate.turn`; the rollout extrapolates each neighbour at its velocity (in the deck's
  frame when it rides the same deck), a closing speed ≥ `MOVING_SEGMENT_STAGGER_SPEED` at a predicted
  overlap is a Bump that Staggers (costed as a Stagger), an overlap displaces the rollout half the
  overlap away (over a drop, a Fall) and costs `BOT_PLAN_CROWD_CONTACT_COST` weighted by the nearest
  edge (`voidEdgeDistance`, new in `edgeGuard.ts`); a preferred side per Bot (`botDraw(seed, "crowd
  side")`, `BOT_PLAN_SIDE_BIAS`, only with a crowd); `neighboursOf` (reach, same floor, the Fight's
  target left out); on a deck the floor is the outline less `BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M`.
- `PathBot.ts`: `Steering.positioning`; `follow(view, route, others, fighting)`; `throughCrowd` /
  `crowdSteer` (decide every `BOT_PLAN_CROWD_DECIDE_TICKS`, a chosen asked move is the fresh one, a
  stop within the lag is a stand, a still-floor turn is sent uncommitted), behind `BOT_PLAN_CROWD_RIDES`.
- `deckRider.ts`: `positioning: true` on the spot walk, the waits to board, `holdAboard`'s stand and
  the walk across the deck — a mark only; the guard and the hooks read `committed` as before.
- `sweeperHold.ts`: the hold's ask carries `neighboursOf` behind `BOT_PLAN_CROWD_HOLDS`.
- `fight.ts`: `Fighter.targetId`. `TreeBot.ts` passes it.
- `tuning/bots.ts`: the `BOT_PLAN_CROWD_*` block (nine constants) and `BOT_PLAN_SIDE_BIAS`.
- Two questions in `localMotion.test.ts`: two walkers closing at 11 u/s (the asked move is `bumped`
  and never chosen; alone it is chosen), and a spot held beside the lane's edge with a neighbour
  pressed against it (the stand is shoved over the edge, a move in is chosen).

**Regression set** (CPU shared with the whole-Race run): `neverStepsOff -t "every Motion stopped"`
9 / 9, `neverStranded` / `localMotion` / `belts` / `edgeGuard` / `TreeBot` / `fight` / `fightRace`
green, `sweeperHold` and `trapHold` red on the three known asserts (base1's ordering, D and S's
wall clock); `deckRider` + `transfers` 9 passed, 14 red on exactly phases 1–2's asserts (nine
`transfers` and base HARD `think ≤ 40` at 44–99 µs under the load, the two table-build times, base
EASY's 1 and the crowd rows' 2 EASY step-offs); `apps/server` `matchRuntime.bots` + `botFill` 12 / 12;
both typechecks clean.

**The whole-Race run** (`BOT_RACES=1 … races.test.ts`, 392 s, both switches off; in brackets phases
1–2's run above, the CPU shared with the regression set both times):

| Race | level | finished | stranded | step-offs | own / obstacle | where |
|---|---|---|---|---|---|---|
| base race | HARD | 10 (10) | 0 (0) | 1 (1) | 9 (9) / 12 (12) | Cp 4→5: Stagger 8; Cp 1→2: contact 2, step-off 1 (item 0's, unchanged) |
| | NORMAL | 5 (5) | 0 (0) | **0** (1) | 9 (10) / 39 (39) | Cp 2→3: pushed 27, contact 9 |
| | EASY | 0 (0) | 2 (2) | 1 (1) | 22 (22) / 78 (78) | Cp 2→3: pushed 44, contact 30 |
| Spin Cycle | HARD | 0 (0) | 0 (0) | 0 (0) | 33 (31) / 56 (50) | Start→Cp 0: pushed 19, Stagger 18; Cp 5→6: WallImpact 8 |
| | NORMAL | 0 (0) | 0 (0) | 0 (0) | 49 (57) / 76 (87) | Start→Cp 0: Stagger 27, pushed 25; Cp 0→1: Stagger 15 |
| | EASY | 0 (0) | 2 (1) | **0** (3) | 56 (57) / 114 (113) | Start→Cp 0: pushed 55, Stagger 54, Bump 27 |
| Slip Stream | HARD | 11 (11) | 0 (0) | 0 (0) | 21 (21) / 21 (21) | Cp 1→2: Stagger 13, Obstacle 4 |
| | NORMAL | 9 (9) | 0 (0) | 0 (0) | 35 (35) / 31 (31) | Cp 1→2: Stagger 16, link 4; Cp 4→5: Stagger 10 |
| | EASY | 4 (4) | 2 (2) | 0 (0) | 69 (69) / 57 (57) | Cp 1→2: Stagger 47, link 14 |

Finished 39 of 108, as phases 1–2 left it; the base race and Slip Stream are unchanged to the Fall,
the one model change that stays on (the hold's deck-frame ask reading the outline less the rider's
margin) moved Spin Cycle by a few Falls either way and took the base race NORMAL and Spin Cycle EASY
step-offs to 0 (Spin EASY's stranded 1 → 2, one give-up wait inside the harness's window by the look
of it, not traced). Think 65–106 µs per Bot-Tick, the CPU shared. The file is still 9 / 9 red on
`ownFalls === 0` (known). The item-0 HARD step-off is unchanged and is the rider's (above).

**Not built:** item 5's queue order for boarding and alighting spots, and the ring spread (07l); both
are `deckRider.ts`'s, which this ticket said to leave alone, and are where the diagnosis points.

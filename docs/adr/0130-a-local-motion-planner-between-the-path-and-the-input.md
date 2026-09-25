# 0130 — A local motion planner between the path and the input

**Status:** accepted (2026-09-25, the user's review of M17's bot AI after the 07m stagger log).

## Context

Recast and the path are not what stops the Bots. The base race at HARD finishes 11 of 12 (07d, the
evening run), and every path is found. What fails is how a Bot moves over the next second:

- **The retreat Staggers its own Bot.** Over 697 spin-bar impacts, the bar alone reached the Stagger
  closing speed (6.67 u/s) 6 times, and not once was the Bot standing. At HARD 229 of 252 impacts came
  during `SweeperHold`'s `retreat`, and at NORMAL 184 of 248. `retreat()` walks back toward the previous
  corner, which is not away from the arm, and adds up to 5.5 u/s of closing speed. Standing still would
  only have been pushed. (07m, "The log".)
- **A hold does not stop.** `stand()` brakes actively only on a slick floor. Elsewhere it returns a zero
  move while the Bot still carries speed: at EASY, 113 spin-bar impacts came during "hold", every one
  with the Bot's own speed above 0.5.
- **There is no crowd avoidance.** `PathFollower.steer` heads straight for the corner, so twelve Bots
  head for the same point. `others` (positions only) is read by `queueFor` (a link's start) and
  `unstall` (after a stall), which both fire only once the Bots are already pressed together. The
  Falls show it: base race NORMAL Cp 2→3 pushed 19, contact 18; EASY Cp 2→3 pushed 39, Cp 1→2
  contact 25.
- **Every dynamic problem so far got its own handler** (`SweeperHold` with its arc, `TrapHold`,
  `DeckRider`, `BeltPush`, `EdgeGuard`, crosses, ride links). Each one changes the move after the one
  before it, and none of them looks at the same future. So a fix on one Track regresses another (07j).

## Decision

1. **A `LocalMotionPlanner` sits between `PathFollower` (with its hooks) and `EdgeGuard`.**
   - **Input:** the move the path asks for, the Bot's own position and velocity as it sees them, the
     Characters near it (positions, plus velocities taken from the Bot's own consecutive views), the
     moving bodies near it (`MovingWorld`), the floor and edges (the navmesh and `EdgeGuard`'s edges),
     and its profile.
   - **Candidates:** stand (braking to zero on every floor), the asked move, the asked move turned by
     ±15°, ±30°, ±60° and ±90°, and back, back-left, back-right.
   - **Rollout:** each candidate is played for a short horizon (`BOT_PLAN_HORIZON_TICKS`, on the order of
     20) through `accelerate`, the model of the Character that `EdgeGuard` already uses.
   - **Score:** progress toward the path's look-ahead point, less the risk of each of these (the weights
     live in `tuning/bots.ts`):
     - **Stagger:** a moving body occupying the capsule at a closing speed ≥
       `MOVING_SEGMENT_STAGGER_SPEED`, counting the candidate's own velocity — the simulation's own rule;
     - **contact:** any occupancy at all;
     - **edge:** a rollout point off the floor;
     - **crowd:** another Character's extrapolated capsule overlapping;
     - **deviation** from the path.
   - **Output:** a move direction. Jump and dash stay the path's call, and the planner may only take the
     dash away.
2. **A committed Steering passes through untouched**: a link's script, a ride, an arc. Proven jumps,
   rides and belts stay their own systems (`LinkReplay`, `DeckRider`, `BeltPush`). The behaviour tree
   still decides the fight and the route.
3. **`SweeperHold` keeps saying whether the way ahead is blocked**, and it stops choosing what to do
   about it. Its `stand` and `retreat` are replaced by the planner's choice. Moving the go/hold
   decision into the planner is a later step, taken only when it is measured to be as good.
4. **ADR 0129's rules hold as before.** A Bot never steps off on its own, because `EdgeGuard` still vets
   every move the planner outputs. A Bot is never stranded, because a hold keeps its cap.
5. **The direction for difficulty (not built here):** the planner's view of danger is the same at every
   level, and difficulty is expressed as aggression, route choice, Dash use, how long a Bot waits for
   the best window, how hard it fights, and small execution noise. Today EASY's timing error (4–10
   Ticks, which is 1.5–3.7 m of an 11 u/s wall) makes some obstacles unsolvable rather than harder.
   Revisiting ticket 08's profile ranges is its own piece of work, after the planner.

## Consequences

- Handlers stop multiplying. A new moving hazard is a new term in the rollout's risk, not a new hook.
- The cost is rollouts per Bot per decision: about 15 candidates × 20 Ticks × the bodies and
  Characters near. It is bounded by deciding every `BOT_HOLD_DECIDE_TICKS` and by `MovingWorld.near`'s
  cheap rejection. The think budget per Bot-Tick stays as ticket 08 set it.
- The first measure is the 07m stagger log's columns (impacts during retreat and during hold, and the
  Bot's own speed at impact) and the Falls by cause on the same legs and seeds.

## As built

**Ticket 14, phases 1 and 2 (2026-09-25).** `bot/localMotion.ts` is the planner as decided, wired where
`SweeperHold` used to `stand` or `retreat`; the hold still says go or hold, and the arc is still tried
first. Two things building it settled. **A stand's brake is a push only on a slick floor**: the
velocity a Bot sees is as stale as its view, and a push against it on a floor whose grip has already
stopped the body is a walk backwards at full speed — every Bot hit "standing" at HARD in the first
attempt was doing exactly that. **The rollout models the guard**: a walk that would cross an edge's
inner line stops there and stands, since `EdgeGuard` never sends that step, and only a push across it
is scored as a Fall; without this every way out of a swath toward a lane's edge read as a Fall and a
boxed Bot took a Stagger instead. The step for Tick `t` is resolved against the poses at `t`, so the
rollout's step `k` is checked against `tick + k − 1`. Measured on 07m's three legs and seeds: spin-bar
impacts during a retreat-or-planner move 230 → 14 at HARD and 186 → 20 at NORMAL, Stagger Falls 37 → 20
and 48 → 39, passed 21 → 28 and 18 → 24, no step-off and nobody stranded, the standing-but-moving
impacts at EASY 113 → 0; the planner's own cost is 2–10 µs per Bot-Tick. What is left is the hold
stopping *inside* a spinner's swath (07g's walk-up rule), where every candidate is bad — point 3's
territory, not the planner's.

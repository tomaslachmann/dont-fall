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

**Ticket 14, phase 3, the crowd (2026-09-25).** The planner now scores the Characters near, played
forward at their own velocity: a Bump that would Stagger (a closing speed of
`MOVING_SEGMENT_STAGGER_SPEED` at a predicted overlap, the simulation's own rule through
`BUMP_IMPULSE_SCALE`) is costed as a Stagger; an overlap displaces the rollout half the overlap away,
as two capsules resolve, so a shove beside a drop is a Fall and every contact costs more the nearer
the edge; each Bot favours one side, drawn once from its seed; the Fight's target is left out. A ride's
positioning (a waiting spot, a walk across a deck, a stand aboard) is marked `positioning` beside
`committed` and can be asked in the deck's frame, where the floor is the outline less the rider's rim
margin. **Both call sites are off** (`BOT_PLAN_CROWD_RIDES`, `BOT_PLAN_CROWD_HOLDS`): three attempts,
each measured on the crowd legs, and none met a target — the plain walk through the planner scattered
every pack (two thirds of the choices turns) and stepped off, the deck margin sized for the Bot's lag
covered whole rows and stopped every walk aboard, and the last attempt still halved the rows' passes
at HARD and doubled think. What the measurement says: a ride's positioning is a count from a fresh
stand, and a second planner turning it fights the rider's own re-aim; the `pushed` Falls are
ordinary shoves at a rim between Bots arriving on one point together, which want a queue order for
boarding and alighting spots in the rider (as `queueFor` orders a link's start), not a better
direction. The two step-offs the whole-Race run had found were traced first, and neither was the
planner's: an alighting jump that came down on a bevel beside its still, and a walk aboard a spinning
square steered live off a view a metre late.

## Amendment (2026-09-25, evening): a crowd is coordination plus velocity avoidance, not the hazard planner

**Why.** Ticket 14's phase 3 put the crowd into the hazard planner's rollout, and all three attempts
failed (ticket 14, "As built (phase 3)"):
- throughput collapsed (HARD moving rows 12 → 3 passed);
- two thirds of all choices were turns;
- Bumps at Stagger strength doubled at HARD;
- think went from 2–10 µs to 30–90 µs.

Two outside reviews followed, an audit and a rebuttal of it, and the user accepted their shared
conclusions. These decisions replace point 1's "crowd" risk term and ticket 14's phase 3 design.

1. **Hazards and the crowd are two solvers.**
   - The hazard planner (phases 1–2) stays as it is: an exact, deterministic `MovingWorld`, and
     rollouts of a few headings.
   - The crowd works on observed, late, autonomous Characters. It gets its own velocity solver, with
     its own candidates, horizon and costs. `BOT_PLAN_CROWD_RIDES` and `BOT_PLAN_CROWD_HOLDS` stay off,
     and the code they switch is retired once the solver lands (ticket 17).
2. **Layers, one authority per layer.**
   - Order of authority: a script (a link's run, a transfer run-up and jump, an arc), then the edge and
     committed-safety invariants, then a reservation or slot, then local avoidance, then the preferred
     velocity.
   - A route or ride controller emits a preferred velocity. The local solver moves it to the nearest
     safe velocity, and locomotion carries it out.
   - Two controllers of the same layer must never adjust the same heading in turn. That is what broke
     attempt 3, where `DeckRider` and the planner fought.
3. **Rides are scheduled, not dodged.**
   - The `pushed` Falls on the rides are an occupancy problem: too many Bots want one rim point at one
     Tick.
   - A reservation controller per ride link hands out time-windowed slots: approach, board, the space
     aboard, and exit.
   - Each slot has a lease and a timeout. The timeout is ADR 0129's "never stranded", with its own test.
   - Alighting goes before boarding, because it frees space.
   - Only Bots reserve. A human is a non-cooperative occupant: an observed occupancy voids a slot, and
     the Bot yields or replans.
4. **Open floor: a velocity-space solver.**
   - Candidates are velocities, not unit headings: magnitudes 0, 0.25, 0.5, 0.75 and 1 of the local top
     speed, around the preferred and the current velocity. `walkWish` scales the walk linearly by
     `|moveDirection|` (`MovementController.ts`), so half speed needs no simulation change.
   - **Hard constraints reject a candidate:** a predicted step-off, leaving a deck's hull, an
     acceleration outside the envelope, or breaking a script.
   - **A continuous cost ranks the rest:** distance to the preferred velocity, change against the
     current and the last chosen velocity, inverse time-to-collision, corridor lateral error, and a
     comfort spacing.
   - Turns of 135–180° exist only in an explicit **recover** state, entered on a detected deadlock.
5. **Pair-stable passing.** The side of passing is fixed per pair of Characters, never drawn per Bot:
   - head-on: one convention in the path tangent's frame;
   - same way: by a stable priority;
   - crossing: by a key hashed from the pair.

   The choice is held with hysteresis until the pair has passed. This adds to the velocity solver and
   does not replace its constraints.
6. **Late perception stays and becomes uncertainty.**
   - `perceptionDelay` is part of difficulty and fairness, and the policy never reads true state.
   - The solver widens a neighbour's envelope with the age of the view and the neighbour's reachable
     acceleration. When uncertainty is high, it slows rather than dodges.
   - That widening applies on open floor only. Aboard a deck, safety comes from the slots: a large
     margin on a small deck is what froze attempt 2.
   - Toward a human the Bot takes almost the whole correction on itself.
   - Bot–bot pairs may share only an old, declared reservation or slot intent, never a fresh one.
7. **Difficulty is style above a fixed safety layer.** Patience, gap acceptance, willingness to
   yield, occasional legal cutting in, aggression and bounded execution noise can vary. The edge and
   committed-safety invariants never do. This refines point 5.
8. **Measure so the hypothesis can fail.**
   - Report what each change should move, broken down by controller: passes and throughput per ride
     link, wait p50/p95, starvation count, `pushed`/Stagger/self step-off separately, the number of
     sign changes of lateral velocity per encounter, reversals over 90° in cruise, minimum TTC, corridor
     deviation, and think µs per decision.
   - A whole-Race aggregate alone does not count as evidence.

**Order (tickets 15–21):**
1. Fix the rider's two self-falls, with an invariant test (15).
2. The Spin Cycle 2 × 2 ablation of the hold boundary against the crowd (16).
3. Retire the crowd from rides (17).
4. Ride reservations between Bots (18).
5. The open-floor velocity solver (19).
6. Pair stability (20).
7. Difficulty as style (21).

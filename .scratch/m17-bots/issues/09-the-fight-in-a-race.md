# 09 — The fight in a Race

**What to build:** the `Fight` branch. It is part of the Race, not an extra (the user,
2026-09-24). A Bot takes its chance on whoever is at hand, human or Bot alike (ADR 0129).

**Blocked by:** 08

**Status:** done on tests (2026-09-24)

- [x] **Hit:** charge and release at someone in reach and in front; knock down when the charge
      allows (ADR 0093/M6.1)
- [x] **Grab:** catch someone close; carry, **Spin** and **Hurl** toward an edge or a hazard
      when there is one near, otherwise drop and run on (ADR 0104)
- [x] **Held:** Struggle, wiggling A/D at its profile's rate to fill the escape meter
- [x] **Props:** pick up a Prop in its path when there is a target, **Toss** or Hurl it;
      respect `PROP_CARRY_MASS_MAX` (ADR 0125/0128)
- [x] **Bombs:** a lit Bomb is thrown at a group or away from itself, never held to the end;
      a Shooter's bomb may be caught and returned at HARD (ADR 0126/0127)
- [x] Aggression from the profile sets how often the Fight branch interrupts the run; a Bot
      that is far behind fights less and runs more
- [x] Target choice by exposure and distance only; a test proves a human and a Bot in the same
      spot are equally likely targets
- [x] Suite: 12 Bots on the base race at NORMAL, with Motion running. Some finish, Falls are caused
      by knockdowns and Hurls (logged by cause), and zero come from the rule in 06
      — measured below. None finish yet: the base race's legs 2–4 are ticket 05's jumps, so
      the pack stops at Checkpoint 1. The rule in 06 isn't built; what this suite holds is
      that no Fall comes from the **Fight** walking a Bot off (`fight-self`: 0)

## As built

**Where it lives.** `packages/shared/src/bot/fight.ts` (`Fighter`, the plan it keeps between
Ticks) and `bot/fightSense.ts` (pure reads of the view and the navmesh: candidates, exposure,
voids, the Bomb group spot, what is liftable). `TreeBot`'s `Fight` slot is now `SeesAFight` →
`Fight`, and its `Recover` slot gained `IsStruggling` → `Struggle` ahead of the wait. Every
number is a named constant in `tuning/bots.ts` (the fight section); the verbs' own reaches and
timings are read off `tuning/fight.ts`, never copied.

- **One plan at a time**, kept by the `Fighter` and asked again every Tick, so Recover still
  pre-empts it and a knockdown ends it (`reset`). Plans: strike, catch, lift, carry, spin,
  throw, drop, brace. A plan the view contradicts is adopted from the view: a reach at a Prop
  that caught a Character is a carry. After letting go, the Bot stands until its late view
  shows empty hands (its reaction plus its worst stumble), so it never re-presses on stale news.
- **Hit:** chosen when nobody exposed is worth a Grab. Charges while closing, stands off at
  `BOT_FIGHT_STANDOFF_M` plus what its own lateness can carry it (`staleReach`), and lets go
  only once the charge crosses `IMPACT_RAGDOLL_MIN` (derived from the Hit's tuning).
- **Grab:** chosen for an exposed target by `chanceTaking` (always for one already down). Once
  holding: the nearest void within `BOT_EDGE_SEARCH_M` decides. Within the Hurl band → Spin;
  a little farther → carry toward it on a navmesh-clear run for up to `BOT_CARRY_LOOK_TICKS`;
  none, or any void nearer than `BOT_HURL_EDGE_MIN_M` → drop and run on.
- **The Spin is timed from the Bot's own count**: a Spin is a pure function of its Ticks
  (`spin.ts`), so any Tick of it the late view shows gives where it started, and the Bot lets
  go on the Tick the tangent points along its aim. It sends **no move input on the release
  Tick**, so the Hurl leaves along the tangent itself and the release moves nobody but the one
  thrown (the aim-snap is unused on purpose: it would have taken a move toward the edge).
- **Held:** A and D in turn; the rate comes from `clumsiness`, between
  `BOT_STRUGGLE_WIGGLES_PER_S_STEADY` and `…_CLUMSY`, so no new profile field was drawn.
- **Props:** a liftable Prop (`canLiftProp`, not a Shooter's ball, not carried or flying)
  within `BOT_PROP_SEEK_M` ahead, with someone within `BOT_THROW_RANGE_M` to throw it at, is
  Lifted; the Bot stands through the Lift (ADR 0128) and only turns and taps once the view
  shows the Lift over. Toss within `BOT_TOSS_RANGE_M`, Spin and Hurl beyond.
- **Bombs:** picked up only with a group (`BOT_BOMB_GROUP_MIN` within a blast's knockdown reach,
  never nearer the Bot than that reach); thrown at the group, back along a caught shot's line,
  or away, and **always Tossed**, never Spun: a Spin's wind-up is over a second of holding a lit
  fuse. Under `BOT_BOMB_LAST_THROW_S` left, it is Tossed wherever the Bot faces.
- **HARD's catch:** a Shooter's Bomb flying at a Bot is braced for and reached at only with
  `reactionTicks ≤ BOT_CATCH_REACTION_TICKS_MAX`, which is HARD's own maximum read off the
  table, and once per shot by `chanceTaking`.
- **Aggression:** an idle Bot looks every `BOT_FIGHT_DECIDE_TICKS` and takes a chance with
  probability `aggression`, times `BOT_BEHIND_FIGHT_SCALE` when it is
  `BOT_BEHIND_CHECKPOINTS` behind the leader; after a fight it rests `BOT_FIGHT_REST_TICKS`.
- **Target choice** (`fightCandidates` / `pickFightTarget`): distance and exposure (a void
  behind the target along the push) only. A tie is broken by a seeded draw, never by id or
  order. A candidate is in the front half of the heading, on the same floor, with a
  navmesh-clear straight run to it over full-grip floor.
- **Never suicidal.** The Fight only walks a straight run `navStraightRun` holds all the way,
  over floor with full grip and nothing that slips, bounces or crashes (no fight on ice or mud),
  and stops short by its own `staleReach`. A Bot riding something that moves is off the navmesh,
  so it never starts a fight there. It Spins standing still, never within `BOT_HURL_EDGE_MIN_M`
  of a void (a dizzy fall could roll it off), and releases with no move input.
- **Perception:** `BotWorldView` gained `props` and `bombs` (optional, plain Snapshot rows; a
  Prop's mass and whether it is a Bomb come from `track.resolved.props`, index-aligned).
  `withPerceptionDelay` delays both with `self`/`characters`; neither holds a WASM handle.
  `BotDriver.inputsFor` passes `state.props` and `state.bombs`.
- **TreeBot** also turns a carrier's body at the carry's own rate (`GRAB_TURN_SPEED_MULTIPLIER`,
  `propCarryTurn`), as a client does, and never Dashes while the Fight drives.

**Measured** (Apple M4). `bot/fightRace.test.ts`: 12 NORMAL Bots seeded as `BotDriver` seats
them, from the base race's Start, Motion running, 180 s, two Matches (`fight-race-a` / `-b`):

| | a | b | same, aggression 0 (a / b) |
|---|---|---|---|
| Swings let go (all charged to knock down) | 101 | 120 | 0 |
| Knockdowns by Hit | 64 | 58 | 0 |
| Grabs at a Character / Hurls / drops | 12 / 3 / 4 | 16 / 5 / 9 | 0 |
| Knockdowns by a Hurl, by a Grab let go | 4, 4 | 3, 2 | 0 |
| Knockdowns by a wall Impact | 53 | 51 | 54 / 41 |
| Falls: knockdown / stagger / Hurl / obstacle | 3 / 3 / 2 / 4 | 6 / 9 / 1 / 5 | — |
| Falls the Fight walked (`fight-self`) | **0** | **0** | — |
| Falls the Race goal walked (`run`) | 0 | 10 | 8 / 0 |
| Furthest Checkpoint | 1 | 1 | 1 |
| Every Bot's `think`, per Tick | 0.15 ms | 0.19 ms | 0.11 / 0.09 ms |

- A Fall is put down to the last thing that touched the Bot within `ELIMINATION_CREDIT_TICKS`.
  One nothing touched is the Fight's if the Fight drove the Bot within 5 Ticks of its last Tick
  on the ground. At 15 Ticks the suite once blamed the Fight for a Bot the goal had walked 2 m
  forward and off the end of its path, 13 Ticks after its Fight had moved it the other way.
- **Every `run` Fall** is a Bot the Race goal walked off where the base race's path ends, around
  −186 m (ticket 04's "stands at −185.6 m", now ticket 05's links, in progress). None of them was
  the Fight's.
- **The wall Impacts are the run's, not the Fight's**: they are as many with aggression 0.
- No Bomb, Prop or Shooter is on the base race. Those are proven one at a time on a small
  flat Track in `bot/fight.test.ts`.

**Tests:** `bot/fight.test.ts` (15). Target choice:
- a human and a Bot in the same spot, 400 seeded draws, each picked 40–60%;
- swapping two Characters swaps the choice;
- a void at the back beats open deck at the same distance;
- nobody past an edge is a candidate;
- far behind fights less.

Real simulation:
- a charged Hit knocks down;
- a catch 3.5 m from an edge is Spun and Hurled off, and the Bot never comes within 2 m of the
  edge;
- with no edge in reach it drops;
- a Held Bot Struggles free inside the window;
- a cone in the path is Lifted and Tossed at the target;
- a Bomb is picked up for a group and thrown before its fuse ends, and left lying with no group.

Shooter's Bomb, perception delay:
- a Shooter's Bomb is reached for at HARD and not at NORMAL;
- Props and Bombs are delayed exactly as Characters are.

`bot/fightRace.test.ts` (3), above. Server: `matchRuntime.bots.test.ts` and `.botFill.test.ts`
pass. Typecheck: `packages/shared` and `apps/server` clean, apart from ticket 05's in-progress
`linkProof.ts`.

**Standing failures, not this ticket's:** `TreeBot.test.ts`'s "runs until the navmesh runs out
and stands there" and `difficulty.test.ts`'s ordering test both fail with ticket 05's links in the
tree. Both are single-Bot runs with no Prop, where the `Fighter` never gives an order, and
`TreeBot`'s input is unchanged there.

## Open questions (conservative choices made)

1. **Hazards.** A Hurl aims only at voids. Moving Segments are not aimed at as hazards: their
   rest pose says nothing about where they sweep, and many are floors a Bot rides.
2. **The Fight can start on a link's run-up.** `PathFollower`'s link state is private to ticket
   05's file. The Fight starts only grounded and Controlled and walks only navmesh-clear runs,
   and the gap in `follow` calls ends the link. Ticket 05 could expose "on a link" so the Fight
   holds off.
3. **A thick wall can read as a void** (no navmesh 1 m past the edge). The cost is a wasted Hurl
   into a wall, never a Bot's Fall.
4. **How much fighting.** About 60 Hit knockdowns per 180 s Round among 12 NORMAL Bots. This is
   the user's to judge live (`BOT_FIGHT_DECIDE_TICKS`, the `aggression` spreads,
   `BOT_FIGHT_REST_TICKS`).
5. **Bombs are only Tossed**, never Spun and Hurled. A Toss reaches less far than a Hurl, but a
   Bot never holds a lit fuse through a wind-up. A Bot does not yet run from a lit Bomb lying
   near it.
6. **The Struggle's rate is read off `clumsiness`**, not a profile field of its own. That keeps
   ticket 08's draw untouched.

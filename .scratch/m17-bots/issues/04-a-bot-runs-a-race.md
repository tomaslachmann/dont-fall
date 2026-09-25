# 04 — A Bot runs a Race

**What to build:** the Race goal as the first `mistreevous` tree. The Bot runs Checkpoint to
Checkpoint to the Finish Zone over the navmesh, gets up and carries on after a Ragdoll, and
starts again from its respawn after a Fall. Forks are chosen per Bot, by a seeded
preference, so a Lobby's Bots spread across the arms. Surfaces are area costs: mud is
avoided when there is a way round, and ice is taken carefully.

**Blocked by:** 03

**Status:** done on tests (2026-09-24). The full finish of the base race at rest moves to ticket 05 (see below).

- [x] Tree structure shared by Round types: a `Recover` branch (down, Held, respawning), a
      `Fight` slot (empty here, ticket 09), and the Round's goal (Race here, Survival in 12)
- [x] Goal = the next Checkpoint's trigger, then the Finish Zone (ADR 0039); after a respawn
      the path is re-planned from the Checkpoint
- [x] Path following: string-pulled corridor → move direction, re-planned when the Bot is
      pushed off its corridor
- [x] Dash used on long straight corridor runs, as a resource (ADR 0092), never into a gap
- [x] Surface costs from the Surface tuning values (mud's top speed, ice's), not new numbers
- [x] Forks chosen per Bot by a seeded preference, so a Lobby's Bots spread across the arms
- [ ] ~~Test: a Bot finishes the base race with every Motion stopped, like `walkTrack` does~~
      **Moved to ticket 05.** At rest the navmesh does not join three of the base race's eight
      legs (they are jumps). What 04 owns is proven instead: every leg the navmesh joins is run
      end to end, Checkpoints in order, with no Fall; the Bot gets up after a knockdown and
      carries on; after a Fall it runs the leg again from its respawn

## As built

**The one Bot is `TreeBot`** (`packages/shared/src/bot/TreeBot.ts`). The server's `BotDriver`
seats nothing else, and `pnpm bench:sim` runs it too. `PathBot` is gone: what it did is the
tree's path-following leaf, `PathFollower`, which still lives in `bot/PathBot.ts`, because the
package index is shared with other work and a rename there is not append-only.

- **The tree** (`mistreevous` MDSL, stepped once a Tick, given the Bot's seeded `random` and a
  Tick-long `getDeltaTime`): `selector { Recover, Fight, Goal }`.
  - `Recover`: down (Ragdoll, GettingUp), Held, or fallen and not yet respawned. The Bot stands.
    Ticket 09 adds the Struggle.
  - `Fight`: a condition that never holds (ticket 09).
  - `Goal`: a `BotGoal` value, `{ tree, leaves }`. The Race's is `RACE_GOAL` (`bot/raceGoal.ts`).
    Ticket 12 adds Survival as another value. `TreeBot` takes the goal as an option and defaults
    to the Race.
  - Every leaf finishes within its Tick, so each step starts again at the root and `Recover` is
    asked first every Tick. A leaf that has to span Ticks (ticket 09) runs under a `while` guard.
  - A test holds that, once built, a Bot calls neither `Math.random` nor the clock.
    (`mistreevous` does call `Math.random` while it *builds* a tree, to name its nodes. That
    decides nothing.)
- **The Race goal.** The next Checkpoint, then the nearest Finish Zone. A gate is aimed
  `BOT_GATE_THROUGH_M` past, on the far side from the Bot, at the opening's lowest edge: a gate
  counts when it is crossed (ADR 0068), and a Bot aimed at its centre would stop in front of it.
  The route's key is `leg : respawnCount : recoveries`, so a new Checkpoint, a Respawn or getting
  up plans the leg again at once from where the Bot is.
- **Path following** (`PathFollower`):
  - `navPath` (Detour's string-pulled corridor) is followed corner to corner.
  - It plans again on a new route key, when the Bot is more than `BOT_OFF_CORRIDOR_M` off the
    stretch it was running (across, or below it), and every `BOT_REPLAN_TICKS`.
  - On a floor with less than full grip it steers what the velocity lacks and never brakes
    speed along the path. Braking made a Bot arriving onto ice faster than ice's top speed push
    back off it, run on again, and never cross. Where the path runs out on ice it pushes against
    its drift, down to `BOT_BRAKE_MIN_SPEED`.
- **Dash.** Only when it is ready, the Bot is Controlled and on the ground, and the straight run
  to the next corner is longer than `dashReach()` + `BOT_DASH_MARGIN_M`. `dashReach()` is the
  Dash's own envelope over the walk it rides on. The run must also be on the navmesh all the way
  (Detour's raycast) and over floors a Dash may start on and keeps its grip on.
- **Surfaces as area costs.**
  - Each triangle is rasterised with its Surface's area id, so no polygon straddles two floors.
  - `navAreaCost` is `1 / topSpeedMultiplier`, read from `SURFACES`.
  - This needs `recast-navigation`'s solo generator copied step for step into `buildTrackNav`,
    because it has no hook for per-triangle areas. Marking polygons after the build cannot work:
    a mud deck butted against a plain one is one region.
  - `TrackNav` gains `surfaces`. The query's default filter carries the costs, so `navPath` (and
    ticket 02's builder route) plans by cost with no change at the call site.
- **Forks** (`bot/forks.ts`, `forkArms`):
  - The cheapest way is planned first. Then it is planned again with every way found so far made
    `BOT_FORK_PENALTY` times as dear.
  - A new way is an arm when its real cost is within `BOT_FORK_COST_SLACK` of the cheapest and
    it runs `BOT_FORK_SEPARATION_M` from every arm already found.
  - Each arm is a via point in its middle. A Bot picks one per leg by `botDraw(seed, leg)` and
    runs through it.
  - Only joined legs are searched. Arms are found once per leg per `BotTrack`.
  - A mud arm beside a plain one of the same length is not an arm, so every Bot goes round.

**Found: the navmesh cracked at deck seams.**

- KayKit decks have a 45° bevel along their top edges, 0.075–0.1 tall. Two butted decks make a
  V-groove.
- Wherever the voxel grid put a whole column inside it, Recast's slope test (35°) saw a strip of
  unwalkable floor. Erosion then widened it to a 0.8 m crack across the lane. On a straight lane
  of seven decks, one seam in four cracked, depending only on where the grid fell.
- **Ticket 01's "paths end at the edge of what moves" (the base race stopping at −65 m) was this
  crack**, at the first sweeper deck. The sweepers are bars over still decks, and the base race
  is joined from the Start to its first Checkpoint even with every Motion running.
- **The lip rule** fixes it: a face too steep to walk counts as floor if it
  - faces up,
  - is no taller than `NAV_AGENT_CLIMB`, and
  - shares a corner with a walkable triangle.
- The last condition keeps a finely tessellated curve (a quarter pipe) off the mesh: only its top
  row touches a floor.
- `navMesh.test.ts` holds the seam at four grid offsets. Ticket 01's test of the −65 m stop was
  repaired to say what is true.

**Measured** (Apple M4). Checkpoints are counted from 0, as `checkpointIndex` counts them, and
a leg is numbered by the Checkpoint it runs to (the last leg runs to the finish).

| At rest | Legs the navmesh joins | What a Bot does |
|---|---|---|
| Base race (8 legs) | 0, 1, 5, 6, 7 | From the Start: Checkpoint 0 at 21.6 s, Checkpoint 1 at 32.9 s, then stands at −185.6 m (of 569) with no Fall. From Checkpoint 4 to 5 in 35.8 s, with one Dash. From 5: Checkpoint 6 at 10.6 s, the finish at 24.2 s. |
| Spin Cycle | 3, 4, 6 | From Checkpoint 2 to 3 to 4 (a two-arm fork on leg 3), and 5 to 6. No Fall. |
| Slip Stream | 1, 3, 4, 6, 7 | From Checkpoint 2 to 3, 3 to 4, and 5 to 6 to the finish, no Fall. **Leg 1 Falls twice** (open question 3). |

- **Legs 2–4 of the base race are jumps:**
  - the wrecking-ball bridge is stepping stones 2 m apart;
  - the moving rows are over the void;
  - the spinning squares only touch at their corners.
- **Moving tracks join the same legs**, because what moves on them is over still floor or is
  itself a gap.
- **Think cost:**
  - one Bot averages 3–13 µs a Tick;
  - the Tick a leg's forks are first searched costs up to 5.2 ms, once per leg per Round;
  - `pnpm bench:sim --players 12` with 11 `TreeBot`s on the moving base race:

    | | p50 | p95 |
    |---|---|---|
    | every Bot's `think`, per tick | 0.040 ms | 0.110 ms |
    | the tick | 0.79 ms | 1.90 ms |

    (`PathBot`: 0.010 / 0.040 and 0.63 / 1.50.) The run had 4 Falls, whose cause is ticket 06's
    to find.
- **Navmesh build**, solo, Node, with the lip pass and per-Surface areas: base race 49 ms,
  Spin Cycle 105 ms, Slip Stream 126 ms (ticket 01: 42 / 86 / 96).

**Open questions (conservative choice made):**

1. **The seed is the Bot's seat id.** ADR 0129 says the seed comes from the Match and the seat;
   ticket 08 adds the Match.
2. **How a Round picks its goal.** `TreeBot` defaults to `RACE_GOAL`, and the server passes
   nothing. Ticket 12 decides which field of the Round's rules picks Survival's (ADR 0043: a
   field, never the mode).
3. **Props are invisible to a Bot.** They are not on the navmesh (they move) and not in
   `BotWorldView`.
   - On Slip Stream's first fork, the ice arm's corridor hugs the inner edge, straight through
     the line of bumper balls.
   - The Bot crashes into one on ice (ADR 0102), is knocked down and slides off: two Falls in 40 s.
   - Seeing Props belongs with tickets 06/07 (and 09 reads them for the Fight), so the view was
     not widened here.
4. **A corridor hugs corners by the capsule's radius.** That is Detour's string pulling. Keeping
   a margin from an edge is ticket 06's rule.
5. **Fork arms around a post.** `BOT_FORK_SEPARATION_M` lets two ways 3.3 m apart count as arms
   (the base race's legs 1 and 6, Slip Stream's leg 6). Spreading Bots round a post is harmless,
   but the number wants a look once the user has seen Bots spread.

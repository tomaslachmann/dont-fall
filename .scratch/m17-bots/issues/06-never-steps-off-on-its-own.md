# 06 — A Bot never steps off on its own

**What to build:** the rule ADR 0129 holds at every difficulty. Before a Bot commits to a
move, it checks that the move keeps it on something to stand on. A jump is taken only along
a proven link (05). A Bot pushed toward an edge steers back instead of carrying on. Any
clumsiness a difficulty adds (ticket 08) can make a Bot slow, late or badly aimed, but it
never aims the Bot at the void.

**Blocked by:** 05

**Status:** done on tests (2026-09-24)

- [x] A short look-ahead on the move direction against the navmesh, plus a ground probe for
      what the navmesh does not hold (fragile floors, trap doors: ticket 07 extends it)
- [x] Edge recovery: off the corridor near a border → steer to the nearest walkable point
- [x] Suite: the authored **Races** (the base race, Spin Cycle, Slip Stream), 12 Bots, every Motion
      stopped, no Hit or Grab: **zero Falls a Bot stepped into**. Cog Arena and Sky Rings are left
      out (the user, 2026-09-24): they have no finish, and a Bot on an arena needs the Survival goal,
      which is ticket 12's. **The user's call on the zero (2026-09-24):** a Fall to another
      Character's Bump or crowding is a cause (ADR 0129 names a shove), so it is counted and not
      failed; a belt's is ticket 07's. Only a Bot's own step fails the suite
- [x] **The suite runs at every level, EASY included** (the user's question, 2026-09-24). Ticket 08
      measured 11 Falls at EASY on Checkpoint 4 → finish, against 1 at NORMAL. Clumsiness delays
      what a Bot sees, so an EASY Bot can overshoot a corner on a path that hugs an edge, which
      would be a Bot stepping off on its own. Find the cause of each of those Falls, and hold the
      rule at EASY with clumsiness at its maximum
- [x] A jump only along a proven link (05), now taken from a stand and played by the script that
      proved it
- [x] A margin kept from edges where the path allows (ticket 04's open question 4)
- [x] Props: not steered into where there is room round; on ice nothing is run into
- [x] Falls logged by cause with Motion running, and none of them a Bot walking off

## As built

### The cause of ticket 08's EASY Falls (measured before anything changed)

- **Re-run of ticket 08's own scenario** (Checkpoint 4 to the finish, Motion running, 12 EASY
  seeds), now with ticket 05's links in: 9 Falls, not 11.
  - 7 were the hammers of hammer alley knocking the Bot off (`Obstacle`): ticket 07's.
  - 1 was a Dash into a swinging hammer, the ragdoll then flung off by it (ticket 07's).
  - 1 was the Bot's own: on the ice slide, its view of itself 1.2–2.4 m behind, on a path
    squeezed between a bumper and the lane's edge. It stepped over.
- **At rest, twelve Bots**, the new suite before the fix: Spin Cycle at EASY Fell 232 times at
  one link, NORMAL 146. The Bot saw itself 1.8–2.8 m behind where it was. It reached the link's
  start only in its view, after its body had walked on past it and off the edge.
- **The cause.** `withPerceptionDelay` hands a Bot its own Character up to `reactionTicks +
  floor(clumsiness × BOT_STUMBLE_EXTRA_TICKS_MAX)` Ticks old: half a second at EASY's worst,
  about 2.7 m at a walk. `PathFollower` steered from that position and `LinkRun` pressed jump by
  it. Ticket 08 argued a stumble "never changes a move direction", which is true, but a Bot
  steering from where it was overshoots every corner by what it walked since. Beside an edge,
  that is the void.
- **Found on the way:**
  - Detour's `findNearestPoly` gathers polygons by their bounds and returns the nearest point on
    any of them, up to a metre outside the query box. `navStandsOn` and the Fight's `voidAlong`
    both trusted it, so a capsule a metre past a rim "stood on the navmesh" and a void read as
    floor. Both now use `navFloorWithin`, which checks the point.
  - A drop told by the navmesh alone reads the hole cut round a still bumper as a pit. It stopped
    every Bot beside the base race's ice-slide bumpers.

### What was built

- **`EdgeGuard` (`bot/edgeGuard.ts`)**, one per `TreeBot`, applied to every move the goal or the
  Fight asks for. A link's own input is the only one exempt. The Bot knows its reflexes (its
  profile's `staleWindow`) and its own last pushes, so it plays them forward from what it sees, once
  for each staleness it may have. It sends a move only if, from every one of those places, a Tick of
  it and then stopping crosses no edge's inner line (`BOT_EDGE_MARGIN_M` in from the navmesh's own
  rim).
  - "Stopping" means letting go on grip. On ice it means braking along one straight line
    (`brakingRun`).
  - On a slick floor the move is asked twice: once as the floor is, and once as if this push found
    grip and the braking did not. At a seam between ice and grip the capsule's floor flickers
    Tick to Tick. Measured on Spin Cycle's ice arm, a push that reversed the Bot at once was then
    carried at ice's grip.
  - Otherwise it takes the nearest turn of the move (±30°, 60°, 90°), then a move back in, then
    braking or standing.
  - The movement model is the simulation's own `accelerateVelocity`, copied without allocations
    (`accelerate`; a test holds them equal).
- **Edge recovery.** A place past an edge, or inside its margin, allows only a move back in or
  along it, so a Bot shoved or drifted there heads for the floor.
- **The ground probe (`markVoidEdges`)**, run where the navmesh is built (the Bot track worker)
  and carried with it (`TrackNav.voidEdges`). Past every navmesh border, a ray goes down against
  the still geometry (`stillQueryWorld`, shared with the jump proof's clearance sweep). Something
  there no lower than a step (floor, wall, post, bumper) means no drop.
  - The probe is still geometry only, as the brief asks. Fragile floors and trap doors are ticket
    07's.
  - The guard indexes the edges in a grid (`navEdgesOf`, numeric keys, no allocation per lookup).
  - It counts an edge only if it is on the Bot's own floor. Standing beside the foot of a tier is
    not standing past the tier's edge (`BOT_EDGE_PAST_HEIGHT_M`).
- **Links from a stand (`LinkReplay`).** Each proof now records its script, every input it sent.
  A Bot:
  1. stops short of the link's start by as far as its view can lag;
  2. waits until its view has caught up (`EdgeGuard.fresh`);
  3. steps up to the start a measured number of Ticks at a time;
  4. plays the script;
  5. stands until its view shows where it landed.

  The proof replays the script from the start, 0.3 m either side and 0.1 m either way along it
  (`besideToo`, `BOT_LINK_START_SIDE_M`/`_ALONG_M`), then stands for the slowest view's lag
  (`BOT_STALE_TICKS_MAX`).
- **A link's start is taken in turn** (`BOT_LINK_QUEUE_M`). Found with twelve Bots all stepping
  for the box at Slip Stream's middle Spring: they shoved each other round it for good.
- **Margin from edges.**
  - Path corners are pushed `BOT_PATH_EDGE_MARGIN_M` in from any drop they hug where there is
    floor to push them to (`keepOffEdges`). A link's start never moves.
  - Polygons narrower than `BOT_EDGE_STRIP_M` beside a drop are flagged. A path keeps off them
    unless the leg cannot be run round (`EDGE_STRIP_FLAG`, a second plan without the filter). This
    was the base race's ice-slide strip between bumper and edge, where Bots met and crashed.
- **Props.** The guard keeps clear of every lying Prop's solid parts, placed as the Prop lies now.
  - It takes a turn round a Prop where there is one, and on grip pushes it if there is none.
  - On ice it never closes on a Prop or a Character at more than `BOT_CRASH_SPEED_SHARE` of ice's
    crash speed (ADR 0102). A lean is fine; a boxed-in Bot on the greasy mile still edges past.
  - The Fight, which walks up to a Prop to Lift it, is exempt.
- **Bounce decks.** A Bot whose view lags plans round bounce decks and bounce links
  (`BOUNCE_FLAG`, `navFilterFor`). A bounce deck hops whoever stands on it at every landing, so a
  take-off must be pressed within a few Ticks of a landing, which a late view cannot place. The
  proof's stand-start is one such a Bot never has there. (Open question 2.)
- **`TreeBot` without a profile** is not wrapped, so it sees itself as it is: stale window 0. A
  profile given is the one `BotDriver.add` wraps it with.

### Falls by cause, twelve Bots, aggression 0 (EASY at its worst reactions and clumsiness)

Before: ticket 05's tree with this suite's first classifier, each Round to its Track's clock.
After: the final classifier. `own` is every cause but another Character's `Bump` or `contact`, a
`belt` or a `pushed` (see the suite's header).

| At rest | before (all Falls) | after | finished before → after |
|---|---|---|---|
| base race EASY | 14 (link 7, Stagger 6, step-off 1) | own 0 (Bump 1, contact 1) | 0 → 9 |
| base race NORMAL | 10 (link 5, Stagger 4, step-off 1) | 0 | 2 → 12 |
| base race HARD | 1 (Stagger 1) | own 0 (Bump 1) | 1 → 12 |
| Spin Cycle EASY | 246 (link 232, Stagger 10, step-off 4) | own 0 (contact 1) | 0 → 12 |
| Spin Cycle NORMAL | 151 (link 146, Stagger 3, step-off 2) | 0 | 6 → 12 |
| Spin Cycle HARD | 7 (step-off 4, Stagger 3) | own 0 (Bump 2) | 12 → 12 |
| Slip Stream EASY | 69 (step-off 69) | own 0 (belt 10, Bump 1) | 0 → 0 |
| Slip Stream NORMAL | 75 (link 52, step-off 9, Stagger 7, WallImpact 7) | own 0 (belt 2, Bump 1) | 0 → 0 |
| Slip Stream HARD | 15 (WallImpact 14, step-off 1) | 0 | 12 → 0 |

The `belt` Falls are Slip Stream's cross belts carrying a Bot over the side. They are **moved to
ticket 07** (belts are a cost or a gift along their direction). The guard does not model belts.

With Motion running, after, 120 s Rounds (before ran each Track's full clock). Every Fall is a
moving obstacle's (`Obstacle`, `WallImpact` into a bar or hammer, `Stagger` with nobody near), a
push by one (`pushed`), a crowd (`Bump`, `contact`) or a belt. There are **no `step-off`s**, where
before there were 19/3/6 on the base race, 67/79/38 on Spin Cycle and 58/23/1 on Slip Stream:

| Motion running, after | EASY | NORMAL | HARD |
|---|---|---|---|
| base race | WallImpact 7, Bump 15, contact 3 | WallImpact 1, Obstacle 1, Stagger 1, Bump 5, contact 3 | WallImpact 7, Bump 2 |
| Spin Cycle | Obstacle 4, Stagger 9, pushed 1, Bump 23, contact 1 | Obstacle 1, Bump 21, contact 1 | Obstacle 1, WallImpact 1, Bump 17 |
| Slip Stream | Stagger 3, belt 15, Bump 2 | Stagger 6, belt 1, Bump 1, contact 2 | Stagger 1, Bump 1 |

`fightRace.test.ts` (twelve NORMAL Bots, fighting, Motion running): `run` Falls 0/1 (before 0/10),
`fight-self` 0/0. The pack now crosses the stepping stones, so it fights on narrow ground: more
Falls by knockdown and Hurl. The Fight's void probe now finds real voids, so it Hurls more.

### Cost

- **Think**, every Bot, per Tick, 11 Bots on the moving base race (`pnpm bench:sim --players 12
  --bots 11`, Apple M4): p50/p95 0.090/0.130 ms at EASY, 0.070/0.110 at NORMAL, 0.050/0.090 at
  HARD. Ticket 04 measured 0.040/0.110.
  - Per Bot that is 5–10 µs at NORMAL and HARD, and 12–18 µs at EASY (ticket 04: 3–13 µs).
  - The guard itself costs 2–5 µs at NORMAL/HARD and 9–16 µs at EASY near edges. EASY plays
    forward six stalenesses; most Ticks a lookup or two end it.
  - The edge grid is built on the loop once per Round, 0.2–0.5 ms.
- **Build**, on the worker:
  - `markVoidEdges` costs 7–110 ms (its query world dominates).
  - Proofs replay each script five times where they played twice. First build at rest: base race
    1.34 s (was 1.0), Spin Cycle 3.1 s (1.9), Slip Stream 2.2 s (1.9). With Motion running: 0.33 s
    (0.24), 0.42 s (0.35), 1.48 s (1.1).
  - Links at rest: 119/173/208 (were 119/178/211).

### Tests

- `bot/neverStepsOff.test.ts` (18), the suite above.
- `bot/edgeGuard.test.ts` (7):
  - the guard's copy of the movement model;
  - `navFloorWithin` past a rim;
  - a bumper's hole is no drop and a rim is;
  - `keepOffEdges`;
  - an EASY-worst Bot stops on the deck where its path ends at an edge (6 Falls with the guard off);
  - it takes a proven jump from a stand;
  - two take one link in turn.
- Repaired, because the behaviour they read changed:
  - `links.test.ts` spies on `LinkReplay`;
  - `fightRace.test.ts` counts a Moving Segment's push as `obstacle` (a wrecking ball shoved a Bot
    off mid-catch and it read as the Fight's);
  - `difficulty.test.ts`'s two ordering assertions are `it.todo` for ticket 07 (open question 4).
- Pass: `TreeBot`, `links`, `navMesh`, `fight`, `fightRace`, `difficulty`, `perceptionDelay`,
  `profile`, and the server's `matchRuntime.bots` and `.botFill`.
- Typecheck is clean in `packages/shared` (apart from the standing `bombHome.scratch.test.ts`),
  `apps/server` and `apps/track-builder`.

## Open questions (conservative choice made)

1. **Crowding is left out of the zero.** A Fall to another Bot's Bump or contact is counted, not
   asserted: ADR 0129 names a shove as a cause, and with no Fight these are Bots jostling. The
   worst is the base race's stepping stones and Spin Cycle's first obstacles with Motion running.
   Examples are 15–23 per 120 s at EASY, and a Bump into someone on ice counts as a Bump. A Bot
   does queue for a link's start. It does not keep its distance from others otherwise, except on
   ice.
2. **Slip Stream's bounce field has no way round, so a Bot whose view lags never crosses it.**
   Every EASY and NORMAL Bot, and HARD ones with any reaction time, stop on solid floor before
   it: Slip Stream at rest finished 0 at every level (HARD had finished 12). That was the
   conservative choice over Bots hopping over the side. The fix is a bounce link proven from every
   phase of the hop, with a Bot that counts its hop from its own view. That wants its own ticket
   (or ticket 07's).
3. **Belts are ticket 07's.** The guard does not model a belt's drag. Slip Stream's cross belts
   carried 10 EASY Bots off at rest.
4. **Ticket 08's level ordering no longer holds** (`difficulty.test.ts`, now two `it.todo`s).
   EASY Fell more, and so finished later, because of its own step-offs, which this ticket
   removes. A lone Bot at rest now runs Checkpoint 4 to the finish in the same time at every level
   (EASY 1816, NORMAL 1828, HARD 1797 Ticks). With Motion running only the hammers separate them,
   and no level foresees those yet. Re-establishing the order is ticket 07's item.
5. **A Bot that sees itself late is slower near edges and links.** It stops short, waits up to
   half a second for its view to catch up, and steps up to a link's start. This is the "slow,
   late" the brief allows. Whether EASY now feels too hesitant is the user's to judge live.
6. **New numbers**, first guesses, all in `tuning/bots.ts`:
   - `BOT_EDGE_MARGIN_M`, `BOT_PATH_EDGE_MARGIN_M`, `BOT_EDGE_STRIP_M`;
   - `BOT_PROP_CLEARANCE_M`, `BOT_CRASH_SPEED_SHARE`;
   - `BOT_LINK_QUEUE_M`, `BOT_LINK_START_ALONG_M`;
   - `BOT_EDGE_PAST_HEIGHT_M`, `BOT_GROUND_PROBE_ABOVE_M`.
7. **The track builder's NAVMESH overlay** builds without the still geometry at hand. Its guard
   falls back to reading drops off the navmesh alone, so a still bumper's hole reads as a pit
   there. The builder runs no Bot, so nothing follows from it.
8. **The ice-slide strip beside a bumper is kept off, not removed.** Where a leg can only be run
   through a strip narrower than `BOT_EDGE_STRIP_M`, the path still goes through it and the guard
   holds the Bot in the middle. No authored Race needs one.

**The user's calls on the open questions (2026-09-24):**
1. Crowding stays out of the zero, as built.
2. Slip Stream's bounce field is fixed **before 07**, as ticket 06b.
3. EASY's hesitation stays as tuned; the user judges it live.

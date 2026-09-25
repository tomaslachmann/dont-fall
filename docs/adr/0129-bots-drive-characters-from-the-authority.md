# 0129 — Bots drive Characters from the authority

## Context

The user, on 2026-09-24: "teď se vrhneme na vytváření AI protihráčů … nejlíp
využít nějaký framework, ať to nepíšeme od nuly". Settled in three question
rounds the same day.

Nothing in the game has ever played it except a human, and one scripted
walker: `walkTrack.ts` steers in a straight line at hand-written waypoints over
a Track with every Motion stopped. It proves geometry, not play. It has no path
finding and makes no decisions.

What makes a Bot cheap here is that the simulation already asks a Character for
exactly one thing per Tick: `SimInputs` (a move direction, jump, dash, Hit, Grab
and a facing). Whatever produces that record can drive a Character.

## Decision

### A Bot is an input source on the authority

A **Bot** (new in `CONTEXT.md`) produces a Character's `SimInputs` each Tick,
beside the input router that feeds Players' inputs. It runs wherever the
authority runs:

- on the Match server;
- in a local, server-free practice session (as `?freeroam=1` does), for
  training from the menu;
- in headless suites, where Bots replace `walkTrack`'s hand-written waypoints
  when proving a Track.

Its code lives in `packages/shared`, so all three places run the same Bot. A
client never runs one and never predicts one. A Bot's Character is a remote
Character like any other, interpolated from Snapshots. **The protocol does not
change**, and ADR 0002/0003 hold: clients send inputs, and the authority adds
inputs of its own.

### What a Bot is for

All three, from the start:

1. **Filling a Lobby.** A Lobby's host decides. In a private Lobby the host
   picks how many Bots join and at what difficulty. A public Lobby still has a
   host, who ticks whether Bots are allowed and sets a maximum. In both, Bots
   are added **when the Round starts**, up to that number, and never beyond
   the Lobby's capacity.
2. **Training.** A menu choice to play against Bots, with the Track and the
   difficulty picked. It is **one Round**, not a Match: a server-free Match
   would mean moving the Match loop into `packages/shared`, which was
   declined.
3. **Testing Tracks.** Bots walk a Track in the suites and report where they
   fall and whether they finish.

### Race first, with the fight in it

Race is built first. The Hit, Grab (with its Spin and Hurl), a Prop's carry and
Toss, and a Bomb are part of the game's mechanics, **Race included**, so a
Race Bot fights too. Survival follows on the same parts. Nothing Race-only
goes where Survival would need to replace it: navigation, perception and the
fight are shared, and only the Round's goal is per Round type.

### Chaotic, never suicidal

Bots behave like people: they misjudge, fall and shove. Every Fall has a cause
the game can name: an obstacle, a shove, a jump taken badly or too late.
**A Bot never steps off the Track of its own accord.** That rule holds at every
difficulty.

**Nor is a Bot ever stranded** (the user, 2026-09-24). A Track is islands, not a
continuous floor, so a jump, a bounce or a launch is often the only way on. Avoiding
a link is a preference between routes that both exist. When a link is the only way
forward, a Bot at every level takes it, late or badly perhaps, but it takes it. The
two rules together: never step off, never stop.

### Difficulty is the host's, spread per Bot

The host picks one level (EASY / NORMAL / HARD). Each Bot draws its own spread
around it, including reaction time, accuracy, aggression and clumsiness, so no
two Bots in a Lobby play alike. The draw is seeded, so a suite's Bot plays the
same every run.

**Moving obstacles are foreseen by difficulty.** On the authority every Motion
is a pure function of the Tick (ADR 0061/0123), so a Bot *could* know the
future exactly. EASY reacts late and often misjudges, while HARD looks ahead
and times its move, but not perfectly.

### Targets are whoever is at hand

A Bot takes its chance on whoever is near and exposed, such as someone at an
edge or in front of it. It never prefers humans over Bots, or the other way
round.

### A Bot is a full participant that keeps nothing

A Bot takes placements and Qualification places, and scores in a Match. It can
win. It has no Account, so it earns no XP or coins and makes no Leaderboard,
Personal Best, career or Betting row. Players' rewards are unaffected.

### A Bot looks like a Player

A Bot has a generated nickname and a random Colour or Skin, and a Hat. No
Screen marks it as a Bot. (The code always knows. Presence, Friends,
invites, voice and Mutes simply have no Account to point at.)

### Frameworks

- **Navigation: `recast-navigation-js`** (Recast/Detour compiled to WASM, runs
  in Node and in the browser). A navmesh is generated from the Track's still
  colliders, so any Track can have Bots, including a new one from the builder
  or MCP. The author adds nothing. The links a navmesh cannot see are the
  jumps across gaps, Springs, launch pads and the moving Segments. They are
  computed and proven against the real simulation.
- **Decisions: `mistreevous`**, a TypeScript behavior tree. A sequence such as
  approach → Grab → Spin → Hurl is natural in it, branches are shared between
  Round types, and the difficulty spread is data on its nodes.

Declined: Yuka (it has steering, FSM, goals and a navmesh in one, but has had
no release since 2020); a hand-rolled utility AI (it suits opportunism but makes
sequences more code of our own); an author-drawn route on every Track (more
reliable, but it makes every Track more work).

## Consequences

- A Lobby's capacity and seats count Bots. Reservations (ADR 0112) and a Bot
  added at the start compete for the same places, and a held Reservation wins.
- The result paths (`matchResults`, `personalBests`, `career`, `betting`,
  `trackPlays`) must skip a participant with no Account rather than assume one.
- `walkTrack`'s waypoint lists become redundant once Bots walk the Tracks. They
  stay until a Bot suite proves the same Tracks.
- Both libraries are installed in `packages/shared` (`recast-navigation`
  0.43.1, `mistreevous` 4.3.1).

## As built

**Ticket 01, the spike (2026-09-24).**

- Both libraries run in Node and in the browser through Vite.
- The navmesh is built from `statics` and `staticTrimeshes` only.
  Anything that moves is read at the Tick instead.
- A solo navmesh takes 42–96 ms on the three authored Races, so it is built
  at Round load, with no cache.
- Recast's default detail sampling is kept. Sampling at 1 m cost 20× the
  whole build, and a Bot never reads a path's height.
- A walking capsule gets over a 0.15 ledge (measured), which is
  `NAV_AGENT_CLIMB`.
- Sliding ramps are left off the mesh, so sliding down one has to be a link
  (ticket 05).
- **Every `mistreevous` tree must be given `random` and `getDeltaTime`.**
  Without them it reads `Math.random()` and the wall clock, and a Bot would
  stop being seeded.

**Ticket 03, the seam (2026-09-24).**

- The body turn a client sends as `facing` (`nextModelYaw` and its conversions, ADR 0085) moved to
  `packages/shared/src/input/bodyFacing.ts`. A Bot turns by the same function, one Tick at a time.
- A Bot reads the `SimState` the Match loop built after the last Tick. It never reads the
  simulation. The navmesh is built only on a Match that has a Bot, and freed with each world,
  because Recast's memory is outside the JS heap.
- A Bot's seat counts wherever a connection's or a Reservation's does, `/status.playerCount`
  included. The API reaps a Lobby only at a count of 0, so **Bots leave with the last connection**.
- The Snapshot lists every Bot as `loaded` and `standingsReady`. That is not a flag: a Bot has
  nothing to load and is Ready by definition, and the Round loader counts `loaded` against the
  roster.

**Ticket 10, filling a Lobby (2026-09-24).**

- The fill runs when the host's `start` is accepted, still in LOBBY: `min(max, capacity − seats taken)`
  Bots, each with the next join order. The start rule and `canContinueMatch` count them, so a host
  alone plays a whole Match against Bots.
- **A Bot is never host.** The host is resolved over the human rows only (`MatchRuntime.hostId`),
  whatever a Bot's join order.
- A Bot's identity (nickname, Colour or Skin, Hat) is drawn from `${matchId}:${tick}` by a seeded
  PRNG and kept for the Match. Bots leave at every return to LOBBY; the host's settings stay.
- **Betting:** a Bot is a runner one can bet on, never a bettor. That is this ADR's conservative
  reading: a full participant that looks like a Player, with no Account to stake.

**Ticket 04, the Race goal (2026-09-24).**

- **One Bot kind, `TreeBot`:** a `mistreevous` tree of `Recover` → `Fight` → `Goal`, stepped once a
  Tick. The Round's goal is a value (`BotGoal`, the Race's is `RACE_GOAL`), never a branch on the
  mode (ADR 0043). Ticket 03's `PathBot` is its path-following leaf, `PathFollower`.
- **Surfaces are area costs**, `1 / topSpeedMultiplier` from `SURFACES`. That meant copying
  `recast-navigation`'s solo generator into `buildTrackNav`: it has no hook for per-triangle areas,
  and marking polygons afterwards would leave one polygon straddling mud and plain floor.
- **Forks are found on the navmesh** (`forkArms`: re-plan with the found ways made dearer), so an
  author adds nothing. Each Bot takes one arm per leg by a seeded draw.
- **The navmesh cracked at deck seams.** The bevels on two butted decks make a groove, and at some
  grid offsets Recast eroded a capsule-wide crack across the lane. A *lip* is a face too steep to
  walk but no taller than `NAV_AGENT_CLIMB`, facing up and touching a floor, and it now counts as
  floor. **Ticket 01's "paths end at the edge of what moves" was this crack:** the base race is
  joined from the Start to its first Checkpoint even with every Motion running.

**Ticket 08, difficulty and the per-Bot spread (2026-09-24).**

- **`BotProfile` (`bot/profile.ts`):** seven fields drawn from `(level, seed)`, uniform per field
  over `BOT_LEVEL_SPREADS` (`tuning/bots.ts`). `reactionTicks`'s and `clumsiness`'s ranges never
  overlap between levels, so EASY ≥ NORMAL ≥ HARD holds on every seed, not just a lucky draw.
  `lookAheadTicks`/`timingErrorTicks` (ticket 07) and `aimError`/`aggression`/`chanceTaking`
  (ticket 09) are drawn here too, seeded and ready, but read by nothing yet.
- **The seed is the Match and the seat, closing ticket 04's open question 1:** `BotDriver.add(id,
  matchId, level)` seeds `` `${matchId}:${id}` ``.
- **Reaction time is a wrapper, `withPerceptionDelay`, not an edit to `TreeBot`.** It implements
  `Bot` over another `Bot`, and delays only `BotWorldView.self`/`.characters` (a FIFO, read back
  `reactionTicks` Ticks, ramping up from 0) — never `view.tick`, `.track` or `.rules`. Clumsiness
  draws an extra stumble on top, fresh every Tick: `reactionTicks + floor(clumsiness ×
  BOT_STUMBLE_EXTRA_TICKS_MAX × draw())`. A stumble only ever widens staleness, never touches a
  move direction, so by construction it cannot aim a Bot at the void (this ADR's "never
  suicidal") — and planning/steering from a stale `self.position` produces exactly ticket 08's
  "a late reaction, an overshoot" as a side effect, with no edit to `PathBot.ts`.
- **Found and fixed before it shipped: delaying the whole view, `track` included, crashed a
  second Round.** `BotDriver.worldChanged` disposes a Round's navmesh; a Tick still queued in the
  delay buffer from before the transition could hand `PathFollower` a disposed navmesh a few
  Ticks into the next Round — a WASM "memory access out of bounds" in
  `NavMeshQuery.findNearestPoly`, caught by `matchRuntime.botFill.test.ts`'s "every Round of the
  Match" test. Delaying only `self`/`characters` fixes it outright, and reads truer to the ADR
  besides: a Bot perceives other Characters late, not the Track's own geometry.
- **Measured, Checkpoint 4 to the finish, Motion running, 12 seeds a level:** EASY 65.4 s / 11
  Falls, NORMAL 63.2 s / 1 Fall, HARD 59.1 s / 3 Falls. EASY separates clearly on both; NORMAL vs.
  HARD's own gap is close to this leg's run-to-run physics noise at this sample size.
- **Found, left for ticket 07:** driven from the literal Start with Motion running, a Bot at any
  level has close to even odds of getting permanently stuck short of Checkpoint 0 — a live moving
  Segment physically in the way that `BotWorldView` gives no Bot any way to foresee or route
  around. The navmesh itself joins the same legs whether Motion runs or not (checked directly),
  so this is a live-physics gap, not a navmesh one, and it swamped any difficulty signal outright
  in that stretch (HARD got stuck as often as EASY) — which is why the measurement above runs
  Checkpoint 4 onward instead, where the same failure is rarer (1 of 36 runs) but not absent.

**Ticket 09, the fight in a Race (2026-09-24).**

- **The Fight is a `Fighter` in `TreeBot`'s `Fight` slot** (`bot/fight.ts`, reads in
  `bot/fightSense.ts`). It keeps one plan between Ticks and is asked again every Tick, so
  Recover still pre-empts it. The Struggle is a leaf of Recover. Each fight is one seeded draw
  against `aggression`, taken every `BOT_FIGHT_DECIDE_TICKS`, and scaled down far behind the
  leader.
- **Targets are chosen by distance and exposure only.** Exposure is a void behind the target
  along the push. A tie is a seeded draw, never an id, so a human and a Bot in one spot are
  equally likely (proven).
- **"Never suicidal", as built.** The Fight walks only a straight run the navmesh holds, over
  full-grip floor, and stops short by its own perception lateness (`staleReach`). It Spins
  standing still, never within `BOT_HURL_EDGE_MIN_M` of a void. It times the Hurl from its own
  count of Spin Ticks and sends no move input on the release Tick, so the throw moves only the
  one thrown. Measured over two 12-Bot base-race Rounds: no Fall the Fight walked.
- **`BotWorldView` gained `props` and `bombs`**, the Snapshot's own rows. They are delayed with
  `self`/`characters`; neither holds a WASM handle.
- **HARD's Shooter-Bomb catch is gated on reflexes, not a level flag.** The gate is
  `reactionTicks ≤` HARD's own maximum, read off `BOT_LEVEL_SPREADS`.

**Ticket 05, jumps and the worker (2026-09-24).**

- Every link a Bot takes is played in the real simulation first, and followed with the input
  that proved it.
- A Bot's navmesh is built on a `worker_thread` of the Match server (the voice relay's pattern,
  ADR 0111). Proving links costs up to 1.1 s the first time a process sees a Track, and the Match
  loop Ticks every Lobby in the process.
- Only the still world is posted, packed into transferred buffers, and the loop's share is about
  1 ms.
- The Round's LOADING phase (ADR 0089) waits for the Bots' navmesh as it waits for each client.
  A build that fails leaves the Bots standing rather than holding the Round.


**Ticket 06, never stepping off (2026-09-24).**

- **The cause was when a Bot sees, not where it aims.** A Bot's view of itself is up to
  `reactionTicks + floor(clumsiness × BOT_STUMBLE_EXTRA_TICKS_MAX)` Ticks old. It steered from that
  spot, so it overshot every corner and link start beside an edge by whatever it had walked since.
  That was ticket 08's EASY Falls, and 232 Falls at one Spin Cycle link with twelve EASY Bots.
- **An `EdgeGuard` on every move but a proven link's own.** The Bot plays its own last pushes
  forward from what it sees, once for each staleness its profile allows. It sends a move only if a
  Tick of it, and then stopping, stays inside a margin of every drop from all of those places. Past
  the margin, it may only head back in.
- **Drops are told from walls by a ground probe on the still geometry** (`markVoidEdges`, run on the
  worker, carried as `TrackNav.voidEdges`), never by the navmesh alone. A still bumper's hole is no
  pit.
- **Detour's `findNearestPoly` answers outside its box.** It returns the nearest point of any polygon
  whose bounds overlap the box. Floor is only floor once `navFloorWithin` has checked the point.
- **A link is taken from a stand, by the script its proof recorded.** The Bot takes a link's start
  in turn, and stands until its view shows the landing. Proofs replay the script from the box a Bot
  stands in.
- **A Bot whose view lags plans round bounce decks.** They hop whoever stands on them, and it cannot
  place a take-off. On Slip Stream that stops it before the bounce field.
- **Paths keep a margin from drops where the floor allows.** Strips narrower than it beside a drop
  are kept off unless the leg needs them.
- **Props are steered round.** On ice, nothing is run into at a crash's speed.
- **The rule held by the suite is "no Fall of a Bot's own".** A Bump, or contact with another Bot, is
  a shove this ADR already names. It is counted, not ruled out.

**Ticket 06b, never stranded (2026-09-24).**

- **A link that is the only way on is taken at every level.** A bounce link is proven from the
  phases of the deck's hop, searched outward from the phase its script was recorded at, and a Bot
  times its take-off off the hop it sees late (`HopReader`, `hopStartable`); the bounce-deck
  avoidance is gone, and every wait or margin ticket 06 added yields where it would strand a Bot.
  What is still unfinished on Slip Stream is the belts' (ticket 07c), never a Bot's own Fall.

**Ticket 07b, riding moving floors (2026-09-24, unfinished).**

- **What moves as one is one floor.** A moving body is a floor or a sweeper by the pieces sharing its
  Motion: the pieces at the level of the one nearest still floor are the deck, a bar above them is not.
  A deck's outline is its own geometry's, simplified to a quarter metre inward, never its hitboxes'
  square. A Fall off a deck is the Bot's own unless someone touched it: the deck's carry is not a push.
- **Only HARD rides a sliding row cleanly so far** (R1 12/12, one own Fall). NORMAL and EASY, the
  turntable and the base race's second leg stay below their targets; the ticket records the numbers,
  the causes measured and the one outside this part (Characters respawned onto one Checkpoint lock
  each other in a Stagger loop for good).
- **A ride's jump is a count, and an end is taken in turn** (third session, the same day). A jump on or
  off a deck starts from a fresh stand, so jump is pressed by Ticks counted from it, as a link's
  replay is, never by where a late view puts the Bot; a run-up starts `BOT_LINK_RUNUP_M` back from
  the floor's border, on the floor; a walk end exists only where the walk can open. At an end Bots go
  one after another by the links' queue rule, and the one behind waits while the way, the rim or the
  landing is taken, but a wait that gave up goes regardless, so nobody is stranded. With that, R1 and R2
  meet every row and base leg 2 meets HARD; base leg 2 at NORMAL and EASY is slow, not stranded.

**Ticket 07e, moving-to-moving transfers (2026-09-24).**

- **A ride's end may meet another platform.** A transfer end names the deck its rim meets within jump
  reach at some Tick of the two cycles; the planner crosses it at a jump's cost, and the Bot alights by a
  jump aimed at the other deck's *middle* as it will be at the landing — never at a paired rim point,
  since two spins at different speeds bring one pair together only at their least common multiple. It
  lands on the deck as it lands on any, and plans on from aboard as a Bot knocked onto a deck does.
- **Near a floor is near floor.** A deck whose only neighbours move (the middle carousel, a turntable
  between turntables) is a floor by them; a turned square reaches still floor by its corners. Measured:
  the kept Ride velocity puts a landing 0.8–2.6 m off the model along the carry, inside the margin kept.
- Two turntables and two carousels are crossed at every level with no Fall of a Bot's own; two spinning
  squares are slow, because a corner is a one-lane gate the planner's cost does not yet see (the ticket).
- **Measured on whole Races, Motion running (M17 ticket 07d).** `playRace` reports a Race's Falls per
  section and by cause; with twelve Bots from the Start, a HARD Bot finishes the base race 1/12, Spin
  Cycle 0/12 and Slip Stream 8/12 inside the Time Limit, and the level ordering is inverted (an EASY Bot
  finishes the base race's last three legs in 87 s, a HARD Bot mostly never, standing in a hold its longer
  look-ahead never clears). A ride's planner now prices the wait at its exit and the Bots already queued
  at its entry, and the ride table's probes are cached by cell. The rule ("never stranded", "never steps
  off") is not yet met with Motion running: the numbers are in the ticket, and no target was lowered.

**Ticket 07h, moving floors with a crowd (2026-09-25).**

- **A ride's every move on and off a deck is a count from a fresh stand, and a jump off a deck is one
  heading held.** The walk to a boarding spot steered live off a late view had EASY Bots 2.75 m past
  where they saw themselves and off the deck, and a Bot down on a row's bevel stood while it slid off;
  both were every step-off on the base race's moving rows, traced Bot by Bot. A jump off a deck lands
  where the carry the Character keeps puts it, so its run-up is marched in the deck's frame and its heading
  is never corrected back onto a world line — the "kept less of the carry than modelled" 07e measured was
  the correction. HARD's step-offs on the rows are 0 on both seeds and the spinning squares meet NORMAL and
  EASY on passed; the crowd rows' passes, a give-up wait the harness counts as stranded, and the held
  heading on a spinning deck (T2) are recorded in the ticket, and no target was lowered.

**Ticket 07g, holds that end (2026-09-25).**

- **A hold ends, and a Bot walks up to what blocks it.** 07d's inverted level order had one cause: a
  HARD Bot stood at the base race's Checkpoint 4 for the whole run because its hold never gave up — a
  belt against it carried the held Bot back and forth, which read as "got somewhere" and reset the hold's
  clock every time. The clock now runs until the Bot is *nearer its corner* than when the hold began, its
  cap scales with the look-ahead (`BOT_HOLD_MAX_TICKS_PER_LOOK`, never under one longest cycle), a Bot
  holds only within `BOT_HOLD_STOP_M` of the first blocked sample and walks on toward it otherwise (two
  walls five metres apart are timed one at a time), a body that never moves is never held for, a stand
  on a belt holds its ground (`BeltPush`), a corridor's arrival Ticks count the belt under it and stop at
  a ride's start, and a Bot standing on a moving deck reads its corridor in the deck's frame. One Bot,
  Checkpoint 4 to the finish, 16 seeds a level: unfinished 1 / 10 / 14 → **0 / 2 / 0** (EASY / NORMAL /
  HARD), finish 86.6 / 132.6 / 144.2 s → 94.1 / 106.2 / 91.6 s. HARD is fastest now; the order is not yet
  strict (NORMAL's two unfinished runs, and obstacle Falls flat at ~0.6 a run at every level on that leg),
  and the ticket records where the levels do not separate and why.

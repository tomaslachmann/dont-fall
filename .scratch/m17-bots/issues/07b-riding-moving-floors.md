# 07b — Riding a moving floor, from still floor and back

**What to build:** a Bot crosses on what moves under it, where the ride starts on still floor
and ends on still floor: the base race's sliding rows (a jump on, a ride, a jump off), a
turntable butted against a deck (a walk on, a jump off), Spin Cycle's last carousel. A moving
deck is a link whose ends move: the Bot boards when the deck's rim meets the floor it stands
on, steers in the deck's frame while aboard, and gets off when the rim meets its next floor.
Boarding is timed from exact poses (`movingWorld`) with the profile's look-ahead and timing
error; a misjudged boarding is a late jump or a wait, never a step into the void (06), and a
Bot is never left waiting for good (06b).

**Moving-to-moving transfers are not this part** (the carousels' 1 m gaps, turntable to
turntable, spinning square to spinning square, sliding stepping stones): they are **07e**, built
on this part's table and hook. Design both ends here so 07e only generalises `RideEnd`.

**Blocked by:** the groundwork in `07-moving-segments-and-traps.md` (§2 `movingWorld` with
`platforms`, `platformUnder`, `toLocal`/`toWorld`; §4 the ride hook and `NavCorner.ride`; §6
the harness). Read that section first.

**Status:** done on tests (2026-09-24), with base leg 2 NORMAL/EASY speed moved to 07d (the user)

## The algorithm, decided

### The ride table (`bot/rideLinks.ts`, built once per `BotTrack`, kept in a `WeakMap<BotTrack, RideLink[]>`)

```ts
export interface RideEnd {
  readonly platform: number;          // index into moving.platforms
  readonly local: Vec3;               // a rim point in the platform frame, inset BOT_RIDE_RIM_INSET_M (0.5) from the hull
  readonly still: Vec3;               // the navmesh floor point this end meets (a still point; 07e makes it a platform point too)
  readonly jump: boolean;             // false: the rim comes within BOT_RIDE_WALK_GAP_M (0.6) of `still`; true: within jump reach, with `still` BOT_LINK_RUNUP_M back from its border
}
export interface RideLink { readonly entry: RideEnd; readonly exit: RideEnd; }
```

For each platform, rim points = hull vertices plus points every `BOT_RIDE_RIM_STEP_M` (1) along
the hull's edges, inset. For each phase `φ` in `0 … periodTicks` step `BOT_RIDE_PHASE_STEP_TICKS`
(3), for each rim point `r`: `w = toWorld(P, φ, null, r)`, `o` = the hull's outward normal at `r`
in world. A **walk end** is `navFloorWithin(nav, w + o · (BOT_RIDE_WALK_GAP_M + 0.5), { x: 0.6, y:
BOT_RIDE_TOP_TOLERANCE_M, z: 0.6 })`; failing that, a **jump end** is `navFloorWithin(nav, w + o ·
(BOT_RIDE_JUMP_REACH_M / 2 + BOT_LINK_RUNUP_M), { x: BOT_RIDE_JUMP_REACH_M / 2, y: …, z: … })`.
Ends are merged when both `local` and `still` are within 1 m of an existing one. Rides are every
ordered pair `(e, x)` of one platform's ends whose `still`s are not joined by a navmesh walk
shorter than `BOT_LINK_MIN_SAVING_M`. Cap ends per platform at `BOT_RIDE_ENDS_MAX` (12).

`BOT_RIDE_JUMP_REACH_M` and `BOT_RIDE_JUMP_FLIGHT_TICKS` are **measured in your first ten minutes**
with a scratch test: a capsule on a flat deck, `jumpHeld` for `JUMP_HOLD_MAX_TICKS` while walking
at `WALK_SPEED`, Ticks until grounded again and metres covered. Record both numbers in the
constants' comments. (`linkProof.ts` has a private `jumpEnvelope` that does this per Surface;
do not export it, that file is 06b's.)

### Planning across (`RideHook.planAcross`)

Called by `PathFollower` only when the navmesh plan does not join the goal. Nodes: `from`,
`goal`, every end's `still`. Edges: navmesh (`navPath` length, `null` = no edge; cached per
pair per `BotTrack`) and rides (`entry → exit`, cost `BOT_RIDE_COST_M` (12) + the hull distance
between the two locals). If `from` is aboard (`platformUnder(from) !== null`), the start edges
are that platform's exits at cost 0. Dijkstra; at most `BOT_RIDE_CHAIN_MAX` (8) rides in one
path (the base race's leg 2 has five). Output: `navCorners(from → e.still)` + `{ point:
e.still, ride: k }` + `{ point: x.still }` + … + `navCorners(x.still → goal)`, without repeating
join points. Cache the result per (nearest node, goal) so a replan every `BOT_REPLAN_TICKS`
costs a lookup, not a Dijkstra.

### Steering (`bot/deckRider.ts`, `DeckRider implements RideHook`, a small state machine per Bot: `off → waitToBoard → boarding → aboard → waitToAlight → alighting → off`)

- **off**: `steer` returns null unless `ctx.path[ctx.corner].ride !== undefined` and the Bot is
  within `settleReach` of it (the links' rule: `(stale.max + 1) · WALK_SPEED · TICK_DT +
  BOT_CORNER_REACHED_M`) → `waitToBoard`. Aboard with no plan (knocked onto a deck): `aboard`,
  and the next plan is `planAcross` from aboard.
- **waitToBoard**: stand (committed) until (a) the Bot's view is fresh (still for ≥ `stale.max`
  Ticks, grounded, slow: count it in the hook, `EdgeGuard.fresh`'s rule) and (b) **contact**:
  for every `k` in `0 … boardTicks`, `dist(toWorld(P, tick + j + k, e.local), e.still) ≤ gap`,
  where `j = round((2 · botDraw(seed, "ride " + tick) − 1) · timingErrorTicks)` is the timing
  error, `gap` is `BOT_RIDE_WALK_GAP_M` or `BOT_RIDE_JUMP_REACH_M`, and `boardTicks` is the walk's
  Ticks over the distance or `BOT_RIDE_JUMP_FLIGHT_TICKS`. Also require the rim's speed toward
  the Bot, `velocityAt · o`, below `BOT_RIDE_BOARD_SPEED` (2): a deck arriving at 4 u/s is a
  shove. The contact is checked live from poses, so a Ramp is right by construction.
- **boarding**: a walk end → a committed move toward `toWorld(P, tick, e.local)` inset by
  `BOT_RIDE_EXIT_INSET_M` (1) for `boardTicks`; a jump end → a live `LinkRun` with recipe `{ from:
  self.position, direction: unit(toWorld(P, tick + flightTicks, e.local) − self.position), jumpAt:
  BOT_LINK_RUNUP_M − BOT_LINK_START_ALONG_M, steerInAir: true, dash: false }`, stepped with
  `onNavmesh = false` until it reports done or failed. Done → `aboard`; failed → `off` and plan
  again (never stranded: the next `waitToBoard` starts over).
- **aboard** (`platformUnder(self)` is the ride's platform): target = `exit.local` inset by
  `BOT_RIDE_EXIT_INSET_M + stale.max · WALK_SPEED · TICK_DT` toward the hull's centroid (so a late
  view cannot overshoot the rim), moved to world at `tick`; a committed move toward it; within
  `BOT_CORNER_REACHED_M` → `waitToAlight`. Edge safety aboard: if the Bot's seen local position
  is outside the hull inset by `BOT_EDGE_MARGIN_M`, move toward the centroid instead. The Ride
  carries the Bot with the deck, so a world-space move toward a deck-fixed point is right Tick
  by Tick.
- **waitToAlight**: as `waitToBoard`, against `exit`.
- **alighting**: as `boarding`, toward `exit.still` (a fixed world point). Done → `off`, and
  `PathFollower` plans afresh (return a steering with `committed: true` and let the next Tick's
  replan run: set a flag the follower reads, `landed`, exactly as `landing` is used for links —
  if that needs a `PathFollower` change, it is one line: ask, do not edit).
- **Never stranded**: a wait longer than `BOT_RIDE_WAIT_MAX_TICKS` (2 × `periodTicks`, at most
  300) boards or alights at the next phase where the distance is at its minimum, whatever the
  gap. Count it (`DeckRider.gaveUp`).
- Out of control (Recover) → `off` next Tick (a gap in `tick`, as `PathFollower` does for links).

## Files (owned by this part)

- `packages/shared/src/bot/rideLinks.ts`, `packages/shared/src/bot/deckRider.ts`,
  `packages/shared/src/bot/deckRider.test.ts`.
- `packages/shared/src/bot/hooks.ts` — one line: `ride: new DeckRider(profile, seed)`.
- `packages/shared/src/tuning/bots.ts` — a block "Riding moving floors (M17 ticket 07b)":
  `BOT_RIDE_RIM_INSET_M`, `BOT_RIDE_RIM_STEP_M`, `BOT_RIDE_PHASE_STEP_TICKS`, `BOT_RIDE_WALK_GAP_M`,
  `BOT_RIDE_JUMP_REACH_M` (measured), `BOT_RIDE_JUMP_FLIGHT_TICKS` (measured), `BOT_RIDE_ENDS_MAX`,
  `BOT_RIDE_COST_M`, `BOT_RIDE_CHAIN_MAX`, `BOT_RIDE_BOARD_SPEED`, `BOT_RIDE_EXIT_INSET_M`,
  `BOT_RIDE_WAIT_MAX_TICKS`.

Not touched: `PathBot.ts`, `edgeGuard.ts`, `TreeBot.ts`, `navMesh.ts`, `links.ts`, `linkProof.ts`,
`movingWorld.ts`, `sectionHarness.ts`. `LinkRun` is used, not changed.

## Test Tracks (`TOP = 4`; a lane is `onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2 })`)

- **R1, a sliding row**: start deck, lane ending at s 24; 2 m gap; `onTop("kaykit_platform_4x4x1_yellow", −4, TOP, 29, { scale: 1.5, motion: slide({ x: 8, s: 0 }, 1.5, 4) })` (the base race's first moving row: 6 × 6 m sliding 8 m across in 4 s); 2 m gap; lane from s 34; arch; finish. Jump on, jump off.
- **R2, a turntable**: start deck, lane ending at s 24 butted against `disc(0, TOP, 28, 4, { motion: spin(0.8) })` (radius 4: eight pieces, one platform); 2 m gap; lane from s 34; arch; finish. Walk on, jump off.

12 Bots, aggression 0, 60 s cap, seed `rides:<track>:<level>`. Leg 0 for the harness.

## Acceptance (baselines in brackets; targets chosen)

| Run | HARD | NORMAL | EASY | all levels |
|---|---|---|---|---|
| R1 slide row | passed ≥ 11, own Falls ≤ 1 | passed ≥ 10, ≤ 2 | passed ≥ 6, ≤ 6 | stranded 0 |
| R2 turntable | passed ≥ 11, ≤ 1 | passed ≥ 10, ≤ 2 | passed ≥ 6, ≤ 6 | stranded 0 |
| base race leg 2, 90 s [0 / 0 / 0 passed; stranded 7 / 7 / 2] | passed ≥ 8, own Falls ≤ 3 | passed ≥ 6 | passed ≥ 3 | stranded 0 |

"Own Falls" is the harness's `ownFalls` (a Fall in `boarding`/`alighting` is the Bot's own; a
`pushed` Fall by a deck that shoved it is not). `gaveUp` is logged, not asserted.

- **Build budget**: the ride table for the base race ≤ 50 ms on the loop (log it; it is built on
  the Match loop, not the worker, because it needs the moving bodies).
- **Think budget**: total `thinkUsPerBotTick` on base race leg 2 at HARD ≤ 40 µs [28]; a
  `planAcross` ≤ 2 ms and at most once per (nearest node, goal) per Bot.
- **Suite runtime**: `npx vitest run src/bot/deckRider.test.ts` ≤ 60 s.

## Quick loop

`BOT_QUICK=1 BOT_LEG=R1 BOT_LEVEL=hard npx vitest run src/bot/deckRider.test.ts -t quick`: one
Track, one level, the outcome and every Fall's `where`, plus the ride table's ends for that
Track. Iterate there; run the acceptance `describe` at most three times.

## Out of scope

Moving-to-moving transfers (07e), sweepers on a deck you ride (the bar on Spin Cycle's
carousels: 07d, with 07a in), belts (07c), traps (07f), the Fight, any Race leg but base race
leg 2, Dash on a deck, a ride whose deck changes height (none is authored), any change to how
links are proven or replayed, the guard's model.

## Stop rule

After **three** acceptance runs that miss a threshold, stop. Record the numbers reached, the
Falls' `where` and your reading of the cause under "Open questions" here, and report. Do not
lower a threshold; do not widen the scope; do not touch another part's files.

## Checklist

- [x] Which moving bodies are floors and their deck hull come from `movingWorld` (groundwork); the ride table from them, as above
- [x] `planAcross`: the planner reaches the far side through a platform when no still route exists, chained
- [x] Boarding and alighting timed from poses with the profile's error; riding steered in the deck frame; edge safety aboard
- [x] `BOT_RIDE_JUMP_REACH_M` / `BOT_RIDE_JUMP_FLIGHT_TICKS` measured and recorded
- [ ] Suite: R1, R2 and base race leg 2 at the thresholds above — **R1 and R2 at every level, base HARD** (third session, 2026-09-24); base NORMAL and EASY red
- [x] Build and think cost measured and recorded here under "As built" (second session, below)

## Handoff (2026-09-24)

Stopped at the coordinator's request after **two** acceptance runs (the stop rule allows three).
Status stays **planned**: nothing meets the whole acceptance table.

### Measured

- **Jump** (a scratch run, since deleted: flat static deck, `jumpHeld` for `JUMP_HOLD_MAX_TICKS` at
  `WALK_SPEED`): **4.95 m take-off to landing, 27 Ticks**. From a stand, the 1.4 m run-up takes 8 Ticks
  and reaches full walk speed, so it lands 6.42 m from the stand. Recorded as `BOT_RIDE_JUMP_REACH_M =
  4.9` and `BOT_RIDE_JUMP_FLIGHT_TICKS = 27`.
- **Build**: the base race's ride table takes 9.5–11.4 ms (58 ends, 332 rides; target ≤ 50). R1 takes
  11 ms. **R2 takes 75–98 ms**, because the disc outline has about 200 vertices over a 236-Tick period.
  Only the base race is asserted.
- **Think**: base race HARD 9–27 µs per Bot per Tick (target ≤ 40). R2 runs at 68–106 µs, from the rim
  probes against the ~200-vertex outline in `score`/`contact` every waiting Tick. That is unoptimised.
- **Suite runtime**: 16.6–19 s (target ≤ 60).

| Run | Target | Acceptance 1 | Acceptance 2 |
|---|---|---|---|
| R1 HARD | ≥ 11, own ≤ 1 | 9 passed (FAIL) | 6, stranded 2 (FAIL) |
| R1 NORMAL | ≥ 10, ≤ 2 | 11 (pass) | 9, stranded 1 (FAIL) |
| R1 EASY | ≥ 6, ≤ 6 | 9 (pass) | 8 (pass) |
| R2 HARD | ≥ 11, ≤ 1 | 11 (pass) | 8 (FAIL) |
| R2 NORMAL | ≥ 10, ≤ 2 | 10, stranded 1 (FAIL) | 9, stranded 1 (FAIL) |
| R2 EASY | ≥ 6, ≤ 6 | 8, stranded 2 (FAIL) | 8, stranded 2 (FAIL) |
| base leg 2 HARD | ≥ 8, own ≤ 3 | 5, stranded 2 (FAIL) | 4, stranded 1 (FAIL) |
| base leg 2 NORMAL | ≥ 6 | 0 (FAIL) | 0 (FAIL) |
| base leg 2 EASY | ≥ 3 | 0 (FAIL) | 0 (FAIL) |

Before either run, R2 HARD reached **12/12 with 0 Falls** in the quick loop (with jump boarding
forbidden). Base race HARD reached 6/12 in an early quick run, against a baseline of 0. Run-to-run
movement is large. Other parts' hooks (`trapHold.ts`, `sweeperHold.ts`, `belts.ts`) changed on disk
while I worked, and they run on the same Bots, so numbers taken minutes apart are not comparable.
"Own Falls" were 0–2 in every run. Nearly every Fall is `contact`, `pushed` or `Bump`: the harness
counts any Fall off a moving deck as `pushed`, because the deck moves the Bot further than its own
velocity does.

### What was tried, and what it did

1. **Spec algorithm as written** (`LinkRun`, `jumpAt = RUNUP − START_ALONG`, fresh by absolute speed).
   R1 HARD 10/12, 0 own Falls. R2 0/12 (4 stranded): every Bot boarded, then waited to alight for good.
   A riding Character's `velocity` does not reliably read slow on a deck, so `fresh` never held.
   **Fix kept:** `fresh` accepts either the absolute speed or the speed relative to the deck
   (`velocityAt`). R2 went to 9/12.
2. **Pins on the turntable.** Two Bots froze: a commanded 5.5 u/s with the position unchanged for 1500
   Ticks, one with `vy` −1217 accumulating. The capsule is wedged in the disc's pieces, which are 48
   thin box solids each, and the character controller never resolves it. Both had **jumped** onto the
   disc near the lane seam. **Fixes kept:** the table drops a still floor's jump ends for a platform
   when that floor has a walk end to it (`rideLinks.ts`, before the cap). R2 HARD went to 12/12 with 0
   Falls. Also a pin escape aboard (`DeckRider.unpinned`, the follower's stall rule: jump after
   `BOT_STALL_TICKS` without moving), and steering toward the deck's centre when ungrounded aboard.
   Neither was measured to help; the walk-over-jump rule did the work.
3. **Planner cost.** The spec's cost (`12 + hull distance between locals`) picks a jump end on a
   turntable, because a jump end's rim point can sit next to the exit's. I tried adding a jump penalty
   (`BOT_RIDE_JUMP_REACH_M` per jump end), and it was not enough. Removed; the spec cost stands, and
   item 2's table rule is used instead.
4. **Stale view in the run-up.** Falls sat right at a row's far rim. `LinkRun` reads a `self` up to
   `stale.max` Ticks late, so it pressed jump late and ran off the edge. **Fix kept:** `jumpAt` is
   shortened by `stale.max · WALK_SPEED · TICK_DT` (`DeckRider.depart`). R1 HARD 8 → 9, base HARD 2 → 5.
5. **Deck capacity** (a `BOT_RIDE_DECK_M2_PER_BOT = 9` wait before boarding). Worse: R1 HARD 9 → 7,
   base HARD 5 → 4. **Reverted**, with its constant.
6. **The deck's carry in a jump-off.** An airborne Character keeps its Ride's velocity
   (`MovementController.leaveRide` / `keptRideVelocity`). **Kept:** `jumpOff()` aims upstream by
   `carry · flight`, and the alight `score` checks the take-off on the deck and the landing (and 0.5 m
   short of it) over still floor. Acceptance 2, which added only this, is worse than acceptance 1 on
   6 of 9 runs, though this is within noise. **Suspect; the next agent should A/B it first.**
7. **`BOT_RIDE_EXIT_INSET_M` = 2**, to wait further from the rim. No better (base NORMAL still 0/12,
   R1 NORMAL 9). Reverted to 1.

### Done and working

- `rideLinks.ts`: `rideTableOf` (a `WeakMap` per `BotTrack`) builds `deckOf` (the real outline from the
  bodies' top geometry, since `movingWorld`'s hull makes a disc a square), rim points, ends by phase with
  walk and jump probes, merging, still-floor components (`componentOf`, `walk` cached per pair), the
  capped round-robin pick, and rides. Also `hullDistance`, `nearestRim`, `insetToward`.
- `deckRider.ts`: `planAcross` runs `dijkstra` over the ends (cached per component or platform and goal,
  chain ≤ `BOT_RIDE_CHAIN_MAX`, aboard start edges at cost 0) and `compose`s corners with `ride` set.
  `steer` is the state machine `off / waitToBoard / boarding / aboard / waitToAlight / alighting /
  landing`, with contact (`score`/`contact`), give-up (`bestPass`, `gaveUp`), walk and `LinkRun`
  boarding, the aboard target with edge safety, and the knocked-onto-a-deck exit (`exitFrom`).
- `hooks.ts` registers the rider. The suite and the quick loop work.

### Half-done or wrong

- **Debug code left in `deckRider.ts` (remove it):** `DBG` (`RIDE_DEBUG`/`RIDE_FROM`/`RIDE_TO`), `OFF`
  (`OFF_DEBUG`), `ARRIVE`/`DEPART` (`RIDE_DEBUG`), and two toggles, `NOPIN` (in `unpinned`) and
  `OLDFRESH` (in `fresh` and in the ungrounded-aboard branch of `aboard`).
- `RideTable.componentOf` is documented as returning −1 and never does: it adds a new representative.
- `Across.first` is computed and unused. `exitFrom` has an unused `ctx` (`void ctx`).
- In `step`, the `boarding`/`alighting` walk branch has a no-op `const now = boarding ? self.position :
  self.position`.
- R2's think cost is too high (the outline has too many vertices); simplify `deckOf` hulls (e.g.
  Douglas–Peucker to ~0.25 m) before judging it.
- After alighting, the follower still points at the ride corner. It replans on the first non-null Tick
  only because `plannedTick` is stale. **Open question, not changed:** the one-line `landed` flag in
  `PathFollower`.

### Files

- `packages/shared/src/bot/rideLinks.ts` (new): the ride table, ends, rides and deck geometry helpers.
- `packages/shared/src/bot/deckRider.ts` (new): `DeckRider` (`planAcross` + `steer`), `dijkstra`,
  `compose`, `score`/`contact`/`bestPass`, `jumpOff`.
- `packages/shared/src/bot/deckRider.test.ts` (new): R1/R2 Tracks, a table test, the 9-run acceptance
  and the `BOT_QUICK` loop (it also prints each end's component, walk from the start and links).
- `packages/shared/src/bot/hooks.ts`: one import and `ride: new DeckRider(profile, seed)` in
  `defaultHooks`.
- `packages/shared/src/tuning/bots.ts`: the block "Riding moving floors (M17 ticket 07b)"
  (`BOT_RIDE_*`, the two measured numbers commented).
- Not touched: `index.ts` (nothing new exported).

### Reproduce (from `packages/shared`)

- Acceptance: `npx vitest run src/bot/deckRider.test.ts`, about 17–19 s. Outputs are in the scratchpad as
  `acc1.txt` and `acc2.txt`.
- Quick: `BOT_QUICK=1 BOT_LEG=R1|R2|base BOT_LEVEL=hard|normal|easy npx vitest run
  src/bot/deckRider.test.ts -t quick`, 1–12 s.
- Trace: add `RIDE_DEBUG=:bot-6 RIDE_FROM=600 RIDE_TO=700` (or `RIDE_DEBUG=all`) or `OFF_DEBUG=:bot-3`.

### Diagnosis of what remains

- **Base race leg 2** (0/12 at NORMAL and EASY):
  - (a) Bots aboard crowd the exit rim while waiting to alight and shove each other off (Falls cluster
    at z −192/−193 on the first row's far rim, and at −208, −240).
  - (b) Jump-offs overshoot the still rows between sliding rows, which are about 5 m deep (a Bot left
    from −192.3 and came down past −201). `steerInAir: true` plus the kept Ride velocity add to the
    4.95 m.
  - (c) A Bot can end up on a lower lip of a sliding row (y 4.4 against 4.9). `platformUnder` doesn't
    count it as aboard (height outside `NAV_AGENT_CLIMB`), the follower plans off-navmesh to 0
    corners, and it stands there being carried until it falls.
- **R1/R2:** mostly `contact`/`Bump` Falls from boarding together, and R2's physics pins when a jump
  lands on the disc. Crowding varies between seeds.

### Next three steps

1. A/B the carry-aware `jumpOff` against plain `unit(self, still)`. For alighting onto a narrow still
   floor, use `steerInAir: false` or let go once past the border, and check where the jump lands against
   the far edge of the still floor too, not only that it is over floor.
2. Aboard, wait at the deck's middle and walk out to the exit rim only when contact is about to open (a
   longer run-up from the middle). This changes the spec's aboard target, so it wants the user's or the
   lead's say. Also treat "under a platform's hull within 1 m below its top" as aboard, for the lower-lip
   case (c).
3. Turn-taking at an end (the links' `queueFor` rule, using `view.characters`), then cut R2's outline
   vertices for the think cost.

### Scratch files still present

- `packages/shared/src/bot/zzScratchR2.test.ts`: delete it.
- `acc1.txt` and `acc2.txt` in the session scratchpad (not in the repo).

### Groundwork changes I think are needed (not made)

- `movingWorldOf`'s role rule makes 2 of the 8 disc pieces (the inner quarter circles) `sweeper`s:
  their footprint is more than `BOT_RIDE_NEAR_FLOOR_M` from still floor. R2 is therefore one platform of
  6 bodies. The rule should group by Motion before the near-floor test.
- A disc's `Platform.deck.hull` is a square: quarter-curve trimeshes become AABBs, and `platformUnder`
  counts corners over the void. `rideLinks.deckOf` works around it.
- `PathFollower`: the one-line `landed` flag after a ride.
- Harness: a Fall off a moving deck is classified `pushed` (not the Bot's own) because the deck carries
  the Bot. That hides ride Falls from `ownFalls`.

## Second session (2026-09-24, Fable, as lead; 60 minutes, two acceptance runs of the four allowed)

Nothing else ran, and the runs are seeded: acceptance 1 of this session reproduced the handoff's
acceptance 2 **exactly**, so the earlier "run-to-run movement" was the other parts' hooks changing
on disk, not noise. Every number below is comparable.

### Done first

- The debug code and toggles listed in the handoff are gone (`DBG`, `OFF`, `ARRIVE`, `DEPART`,
  `NOPIN`, `OLDFRESH`, the no-op line, `Across.first`, `exitFrom`'s unused `ctx`, `componentOf`'s
  wrong doc); `zzScratchR2.test.ts` deleted. The `fresh` relative-velocity fallback stays: harmless,
  and `velocity` is the Character's own (the ride's is `rideVelocity`, so the handoff's item 1
  diagnosis was something else — probably `grounded` flickering aboard).

### Groundwork changed (the lead's say; regression set re-run, see below)

- **`movingWorldOf` groups by Motion before the near-floor test** and asks the group: the pieces
  whose rest top is within `BOT_RIDE_TOP_TOLERANCE_M` of the top of the piece nearest still floor
  are the deck (a bar above them stays a sweeper), and the group's area meets
  `BOT_RIDE_DECK_MIN_M2`. R2 is one platform of **8** bodies now (was 6); Spin Cycle's five carousels
  are 8 each (was 2, 2, 2, 2, 4), base race unchanged (5 × 1). The first cut without the level test
  made the carousels' bars floors (11 per carousel) — that is why the level test exists.
- **A real deck outline**, in `movingWorld`: `deckOutline` takes the body's own geometry points
  within `NAV_AGENT_CLIMB` of its top (box corners, solids, trimesh vertices) and `simplifyHull`s
  the convex hull by `BOT_RIDE_HULL_SIMPLIFY_M` (0.25: vertices whose deviation from the chord of
  their neighbours is under it are dropped, smallest first, so a convex outline only shrinks).
  `Platform.deck.hull` is simplified too; `platformUnder` therefore stops counting a disc's
  corners over the void. `rideLinks.deckOf` is now a one-liner over `platform.deck`. **R2's think
  cost fell from 61–78 to 8–15 µs per Bot per Tick** (target ≤ 40) and its build from 75–98 to
  11 ms; the base race builds in 8–9 ms (target ≤ 50), 59 ends, 336 rides.
- **`platformUnder(p, tick, clock, below = NAV_AGENT_CLIMB)`**: feet up to `below` under the top
  still count, for the lower-lip case (`BOT_RIDE_LIP_M` = 1).
- **Harness**: a Fall off a moving deck is no longer `pushed` because the deck carried the Bot —
  `ownRun` adds the deck's `velocityAt` under `before.position` (found with
  `BOT_RIDE_TOP_TOLERANCE_M` below the top). Such a Fall is `step-off`, the Bot's own, unless a
  Character touched it. This is the honest count the acceptance's "own Falls" column asks for; it
  raised base HARD's own Falls from 1 to 16 (below), which were always there.
- Not changed: `PathFollower`'s `landed` flag (the `landing` state's stand-until-fresh does the
  job; the follower replans on the first non-null Tick because `plannedTick` is stale — noted, not
  wrong).

### The rider changed

- **Aboard, every Bot waits at its own spot** (`aboardTarget`): the exit's inset point moved by
  the Bot's place `across` the rim (−1 … 1 × `BOT_RIDE_SPREAD_M`, drawn per ride) and back from it
  (0 … 1 ×), clamped inside the outline by the edge margin. On the still side it waits at
  `spreadStill`: the entry's still point moved across by the same place as far as the navmesh has
  floor. It aims its boarding jump at the rim point moved across by the same place (`boardAim`), so
  twelve Bots cross side by side rather than converging on one point.
- **A jump off a deck runs from the Bot's spot to the rim** (`jumpOff`): the run-up is marched
  along the line in quarter metres to where it leaves the outline (as the deck will be when it
  gets there), at least `JUMP_AT` and at most `BOT_RIDE_RUNUP_MAX_M` (4), so a spot in the middle
  is a longer run, not a shorter jump; the carry is read at the take-off and the line aimed
  upstream by it, twice over. `LinkRun` gets that `runUp` less the stale allowance.
- **Contact is asked `timingErrorTicks` either side too** (`contact`): the score must be ≤ 0 at
  `at − e`, `at`, `at + e`. Measured cause: at NORMAL a Bot alighting a sliding row jumped as the
  row *reversed*, its kept carry flipping sign inside its own error, and landed 2 m short on the
  still row's bevel (bot-10, base leg 2, tick 555–585: aim −0.74/−0.68, down at y 2.5).
- **A jump-off whose line turns more than 45° from the straight way is not open** (`AIM_COS_MIN`):
  aiming upstream by the full carry (5.4 m at a slide's 6 u/s) had Bots running *sideways* along
  a 6 m deck and off its side (bot-10, ticks 450–480 and 1650–1695).
- **The landing needs floor `BOT_RIDE_RIM_INSET_M + BOT_RIDE_CARRY_MARGIN × |carry| × flight`
  either way along the line**, not only at the point and half a metre short: the overshoot case (b).
- **A grounded Bot inside a deck's outline under its top hops for the middle** (`offLip`), the
  lower-lip case (c). Not seen to fire in the traces taken; kept, it is the "never stranded" answer
  to a case the handoff measured.

### Tried and reverted this session

- **A boarding run-up to the still floor's edge** (`floorRun` along the navmesh with a 0.2 m box,
  the boarding spot backed so a full `JUMP_AT` fits, the boarding score's reach scaled by a short
  run-up). It answered base HARD's eleven `step-off`s at z −202.2 / −215.1 / −233.3 / −249.2 — the
  far edges of the still rows, where the table's jump-end `still` sits ~0.8 m from the edge (0.4
  from the navmesh's), so `JUMP_AT`'s 1.2 m run-up leaves the floor before jump is pressed — but
  R1 HARD fell 12 → 9 and base HARD 4 → 0 with it, in one quick loop each. Reverted whole, no
  time to learn why (suspect: `navFloorWithin`'s 0.2 m box answers a point past the navmesh edge
  from the *next* row across a 2 m gap, so the march never stops). **This is the next thing to
  build, correctly**: the table should place a jump end's `still` `BOT_LINK_RUNUP_M` back from
  the border, as the spec says and the code never did.

### Acceptance, this session (own Falls after the harness change; the baseline column is
acceptance 1 = the handoff's acceptance 2, reproduced)

| Run | Target | Baseline | Acceptance 2 |
|---|---|---|---|
| R1 HARD | ≥ 11, own ≤ 1 | 6, stranded 2 | **12, own 1 (pass)** |
| R1 NORMAL | ≥ 10, ≤ 2 | 9, stranded 1 | 7, stranded 3 |
| R1 EASY | ≥ 6, ≤ 6 | 8 | 3, stranded 1 |
| R2 HARD | ≥ 11, ≤ 1 | 8 | 7, stranded 2 |
| R2 NORMAL | ≥ 10, ≤ 2 | 9, stranded 1 | 6, stranded 3 |
| R2 EASY | ≥ 6, ≤ 6 | 8, stranded 2 | 0, stranded 3 (51 contact) |
| base leg 2 HARD | ≥ 8, own ≤ 3 | 4, stranded 1 | 4, own 16 (11 step-off, 5 Stagger) |
| base leg 2 NORMAL | ≥ 6 | 0 | 1, stranded 6 |
| base leg 2 EASY | ≥ 3 | 0 | 0, stranded 10 |

Think on base HARD 9.4 µs (≤ 40); R2 8–15. Suite 16–18 s (≤ 60). Build 8.1 ms (≤ 50).
Quick-loop states between the two runs: R1 HARD 12/12 with 0 own Falls (before the ± error and
the aim cap), R2 HARD 9, base HARD 4.

### Reading, and what is next (in order)

1. **NORMAL and EASY got worse from the `±e` robustness**, not better: a Bot with a large
   `timingErrorTicks` now waits for a window open over 2e Ticks, so more Bots crowd the wait,
   and the crowd shoves (R2 EASY: 51 `contact` Falls at the lane's end, x 2.5–3.8, z −24.4 — the
   right corner where the disc's rim is 1.35 m from the lane). Make the robustness the *Bot's*
   size (`e` scaled down, or only one-sided toward "later"), and take turns at a boarding end:
   the links' `queueFor` rule, allowing `n` abreast (the spread already places them).
2. **Respawn pile (outside 07b, blocks base NORMAL/EASY).** Bots that Fall within seconds of each
   other respawn onto the Checkpoint's one point, inside each other, and Bump-Stagger each other
   every second for the rest of the run (11 of 12 at (0, 4.9, −180.3) at the cap, input held,
   position unchanged; `S` trace in the session). `PathFollower.unstall` never gets 45 continuous
   Ticks because each Stagger takes the tree to Recover. Either the simulation spreads or
   immunises Respawns, or `unstall` counts across Recover gaps. A human respawning onto a human
   would lock the same way; that is a game bug worth an issue of its own.
3. **Base HARD's own Falls are the jump end's `still` at the floor's edge** (above); fix in the
   table.
4. R2's Falls are all at the lane's right corner beside the disc: boarding Bots spread across
   the rim walk to where the rim is 1.35 m off. `spreadStill` should refuse a spot whose straight
   run to the rim leaves the navmesh (the reverted `floorRun`, kept to the *walk* case).

### Regression set after the groundwork change (all from `packages/shared`)

`neverStepsOff -t "every Motion stopped"`: 0 own Falls, base race 12/12/12, Spin Cycle 12/12/12,
Slip Stream **12/12/12** (was ≥ 8/12/12). `sweeperHold`, `belts`, `trapHold`, `sectionHarness`,
`movingWorld`, `neverStranded`, `TreeBot`: green but for 07a's known row (the strict level
ordering on base leg 1, 07d's). `trapHold` D and S went red once when run beside seven other
suites and `neverStepsOff` at once — think-time budgets — and pass alone (D 12/12/12, S
12/12/12). Typecheck clean in `packages/shared`, `apps/server`, `apps/track-builder`.

### Files this session

`bot/movingWorld.ts` (roles by group, `geometryPoints`, `deckOutline`, `simplifyHull`,
`platformUnder(below)`), `bot/rideLinks.ts` (`deckOf` over `platform.deck`), `bot/deckRider.ts`
(everything under "The rider changed"), `bot/sectionHarness.ts` (the carry in `pushed`),
`tuning/bots.ts` (`BOT_RIDE_HULL_SIMPLIFY_M`, `BOT_RIDE_SPREAD_M`, `BOT_RIDE_RUNUP_MAX_M`,
`BOT_RIDE_LIP_M`, `BOT_RIDE_CARRY_MARGIN`), ADR 0129 "As built" (one entry). No scratch files
remain in the repo.


### Respawn fixed in the main session (2026-09-24)

The second session's cause 2 was a real simulation bug, and it is fixed at its source:
`RapierSimulation.clearRespawn` puts a Respawn on the Checkpoint's point only when nobody stands there
or is landing there this tick. Otherwise it takes the first clear spot, with floor under it, on rings
of `RESPAWN_SPREAD_STEP` (`tuning/character.ts`). The test is `simulation/respawnClear.test.ts`; it
fails with the fix disabled.

The regression set holds: `neverStepsOff` at rest has 0 own Falls, and every Track and level finishes
12/12, Slip Stream EASY included. `RapierSimulation.test.ts` has the same 14 standing failures with
and without the fix. Bots' `unstall` stays as a backstop.

## Third session (2026-09-24, Fable; 60 minutes, three acceptance runs of the four allowed)

Nothing else ran; every number is seeded and comparable. The baseline (acceptance 1) is the tree
after the Respawn fix: R1 12 / 7 / 2, R2 7 / 6 / 2, base **0** / 1 / 0, the respawn spread having
moved base HARD from 4 to 0 (all twelve "slow", none stranded). Every change below was made after
tracing a Bot to its Fall, in the order the Falls were counted.

### Fixed, each at its source

1. **A jump end's `still` is the run-up's start** (`rideLinks.runUpBack`, the second session's cause 3):
   from the probe's floor point, the border is the last floor toward the rim, and the still is
   `BOT_LINK_RUNUP_M` back from it, as far as the floor goes, marched a quarter metre at a time along
   the navmesh. Base HARD's step-offs at the still rows' far edges: **10 → 0**.
2. **A jump is pressed by count from a fresh stand**, never by where a stale view puts the Bot
   (`depart`: `LinkRun` with `jumpAt: null`, `pressAt = tick + runTicks(runUp)`): the old
   `runUp − stale.max · WALK_SPEED · TICK_DT` pressed a NORMAL Bot a metre early from a near-stand, or
   late over the edge, which is what R1 NORMAL/EASY's Falls at the lane's end (y 2.6, slid down its
   face) were. `LinkRun` still steers the line and lands it; a run with no air seen `stale.max + 2`
   Ticks after the hold ends fails and plans again.
3. **A landed Bot that is not on the floor it aimed for heads for it** rather than running on along
   the line (bot-1, base HARD, t265–300: aimed at x −2.7 on a row whose navmesh ends at −2.6, came
   down at −3.2 on the bevel, `navStandsOn` false, ran 35 Ticks along the bevel and off its end).
   And the table gives a still **shoulder room**: where one side has floor within the rim inset and
   the other has not, the still moves in; a floor narrow both sides (the beam) keeps its middle.
4. **A walk end only where the walk can open** (`hullDistance(still) ≤ BOT_RIDE_WALK_GAP_M` in the
   table) and **a spread spot only where some phase brings the rim within the gap** (`spreadStill`):
   R2's walk stills sat at x ±2.4 where the disc is 1.2 m off the lane, and the spread reached x 4.4
   where there is no disc, so those Bots waited, gave up and walked off the corner (every R2 Fall).
5. **Turn-taking** (`someoneAhead`, the links' `queueFor` rule with `view.characters`): a Bot goes only
   when nobody is nearer the point its run heads for (the rim boarding, the still alighting) within
   `BOT_LINK_QUEUE_M`, and nobody is ahead on the way within a queue's width — every run to one end
   converges on it, so three Bots setting out a metre apart within three Ticks Bumped at the take-off
   (bots 1–3, base HARD, t90–99). Boarding also waits while the **landing spot** on the deck is taken
   (`landingTaken`): the waiters stood where the landings came down. A wait that gave up ignores both.
6. **The `±e` robustness is one-sided**, `[at, at + e]`: a Bot only ever executes late.
7. **The walk to a spread spot rests and retries** instead of pushing at a taken spot for good (never
   fresh, blocking those behind) or giving up for good (standing a metre short of where a walk-on can
   open until the wait ran out — R2 EASY's "stranded", which the harness's 10 s window counted before
   the give-up plus `bestPass` could fire).
8. A Bot lodged ungrounded in a deck's seam works the other way every stall with jump held (the
   handoff's turntable pin). Not seen to fire after fix 4 removed the corner boardings.

### Acceptance, this session

| Run | Target | Acceptance 1 (baseline) | Acceptance 2 | **Acceptance 3 (final)** |
|---|---|---|---|---|
| R1 HARD | ≥ 11, own ≤ 1 | 12, own 1 | 12, own 1 | **12, own 1 (pass)** |
| R1 NORMAL | ≥ 10, ≤ 2 | 7, stranded 3 | 12, own 3 | **12, own 0 (pass)** |
| R1 EASY | ≥ 6, ≤ 6 | 2, stranded 1 | 11, own 2 | **11, own 0 (pass)** |
| R2 HARD | ≥ 11, ≤ 1 | 7, stranded 2 | 12, own 0 | **12, no Fall (pass)** |
| R2 NORMAL | ≥ 10, ≤ 2 | 6, stranded 3 | 12, own 1 | **12, own 0 (pass)** |
| R2 EASY | ≥ 6, ≤ 6 | 2, stranded 1 | 8, stranded 2 | **11, own 0 (pass)** |
| base leg 2 HARD | ≥ 8, own ≤ 3 | 0 (12 slow) | 6, own 2 | **9, own 2 (pass)** |
| base leg 2 NORMAL | ≥ 6 | 1, stranded 4 | 1, stranded 1 | **1**, stranded 0, 11 slow (FAIL) |
| base leg 2 EASY | ≥ 3 | 0, stranded 5 | 0 | **0**, stranded 0, 12 slow (FAIL) |

Stranded 0 on every row. Think on base HARD 7.9 µs (≤ 40), R2 10–14. Build: base 21 ms (≤ 50; was
9, the run-up march probes more), R1 9, R2 12–25. Suite 9.6–13 s (≤ 60). Between runs 2 and 3
only fix 7 and the debug line's removal changed.

### The two red rows, read

Base NORMAL and EASY are **slow, not stranded**: every Bot moves, one finishes. The leg is five rides,
and each now costs a fresh stand (`quiet > stale.max`, which at EASY is ten Ticks and its stumbles
before every departure), one window, and a turn. Acceptance 3's Falls at NORMAL are still the
first row's: 13 `pushed`/`contact` at z −190…−192 (aboard, near the south rim) and 8 at −186 (the
boarding edge), all shoves in the crowd twelve Bots make on a 6 × 6 m deck and a 6 m wide edge. What I
would measure next: how long a NORMAL Bot stands per ride (fresh + window + turn) against the 90 s
cap, and whether `holdAboard`'s rim nudges reset `quiet` so often that a NORMAL Bot is never fresh
while the window is open. Neither was reached in the budget.

### Regression set (from `packages/shared`)

`neverStepsOff -t "every Motion stopped"`: 0 own Falls, 12/12 on base race, Spin Cycle and Slip Stream
at every level. `sectionHarness`, `movingWorld`, `neverStranded`, `TreeBot`, `belts`: green.
`sweeperHold`: green but for 07a's known base-leg-1 row (07d's). `trapHold`: D went red once run
beside seven other suites at once (the second session's think-time case) and is green alone
(D, S, G all pass). Typecheck clean in `packages/shared`, `apps/server`, `apps/track-builder`. No
debug toggle or scratch file remains.

### Files this session

`bot/rideLinks.ts` (`RUNUP_STEP_M` exported, `runUpBack`, the walk-end hull check),
`bot/deckRider.ts` (fixes 2–8), this ticket, ADR 0129 "As built" (one entry). No tuning value moved.

**Closed by the user (2026-09-24).** Base race leg 2 at NORMAL and EASY is slow, not stranded and
not falling: five rides in a row don't fit the 90 s section cap. Whether that matters is judged
against the whole Race's Time Limit in 07d, not here.

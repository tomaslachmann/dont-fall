# 07f — Traps on test Tracks

**What to build (the user's call, 2026-09-24, cut out of 07c by the lead the same day):** no
authored Race has a trap, so each is proven on a small Track:
- a **trap door** crossed only while shut (open is a hole, ADR 0117);
- a **fragile floor** not stepped on at its last crack, and re-planned round when broken, from the
  view's fragile state (ADR 0118);
- a **Shooter's lane** crossed between shots (ADR 0119);
- a **glove's reach** crossed while it is in (ADR 0121).

**Blocked by:** the groundwork in `07-moving-segments-and-traps.md` — §3 (gated floors on the
navmesh, `GATED_FLAG`, `BROKEN_FLAG`, `LAST_CRACK_FLAG`, `syncFragile`), §4 (the hold hook and
`planFilterFlags`), §5 (`corridorAhead`), §6 (the harness) — and, for the glove, 07a's
`SweeperHold` (a glove is a `sweeper` body whose `solidAt` gates it; this part only tests it).

**Status:** done on tests (2026-09-24) (see Open questions). **Wall clock: 45 minutes** (took ~75). Model: Opus. Runs beside a–c if wanted: its
files are disjoint.

## The algorithm, decided

`bot/trapHold.ts`, two hooks registered by one line each in `defaultHooks`:

- **`TrapDoorHold implements HoldHook`**: the sweeper hold's shape (decide every
  `BOT_HOLD_DECIDE_TICKS`, `corridorAhead`, one timing draw), over `moving.gates`: a sample is
  **blocked** when it lies inside a leaf's hitbox (`occupies` at the leaf's *rest* pose, grown by
  `CAPSULE_RADIUS`) and `!solidAt(leaf, arriveTick + jitter)` for any Tick from arrival until the
  Bot is past the leaf (`hitbox depth / walk speed`). Hold on the still floor before it; never
  retreat (a hole does not come to you); the cap `BOT_HOLD_MAX_TICKS` applies (a door's period is
  4 s authored, shut for most of it: measure the shut fraction from `trapDoorShut` and record it).
- **`ShooterLaneHold implements HoldHook`**: from `view.track.resolved.shooters`, for each
  Shooter whose muzzle is within `BOT_SHOOTER_WATCH_M` (30) of the Bot: the shots fired at Ticks
  `t0 ≤ arriveTick` with `shooterShotAt(def, t0) !== null` and `arriveTick − t0 < lifeTicks`, each
  flying from `shooterMuzzleAt(aim, t0)` along its direction at `def.speed` with `GRAVITY_Y` on
  y (a Prop is a dynamic body); a sample is blocked when a shot's predicted position at
  `arriveTick + jitter` is within `def.radius + CAPSULE_RADIUS + BOT_HOLD_MARGIN_M` of it. Hold on
  the near side of the lane; the cap applies (a period is 2 s authored).
- **Fragile**: no hook of its own. The groundwork's `syncFragile` flags a broken block's polygons
  `BROKEN_FLAG` (excluded by every filter: re-planning round is automatic, and when the floor
  returns the flag clears and the next `BOT_REPLAN_TICKS` plan joins again) and a last-crack
  block `LAST_CRACK_FLAG`. This part supplies `planFilterFlags: () => LAST_CRACK_FLAG` in
  `defaultHooks`, so the first plan keeps off a last-crack block and the never-stranded second
  plan (`PathFollower.plan`'s existing fallback) still crosses it when it is the only way.
  **Note the arrival rule** (`FragileFloors.onGround`): every new arrival costs a state, so on a
  block that is the only way, two Bots cross, the third would break it: a Bot at a last-crack
  block that is the only way *waits* (stand) until it returns intact or `BOT_FRAGILE_WAIT_MAX_TICKS`
  (the block's `returnSeconds` in Ticks + 30) has passed, then goes. That wait is a third hold,
  `FragileHold`, over `moving.fragile` with `view.fragile`'s hits.
- **Glove**: nothing built; a test only.

## Files

`bot/trapHold.ts`, `bot/trapHold.test.ts`, two/three lines in `bot/hooks.ts`, a tuning block
"Traps (M17 ticket 07f)": `BOT_SHOOTER_WATCH_M`, `BOT_FRAGILE_WAIT_MAX_TICKS`.

## Test Tracks (`TOP = 4`; the DF Assets: `trapdoor`, `fragile_block`, `shooter`, `punching_glove`; place with `at`, sizes from `track/dfAssetDefs.ts`; see `track/TrapDoor.test.ts`, `Fragile.test.ts`, `Shooter.test.ts`, `Punch.test.ts` for placements that resolve)

- **D, trap door**: lane, `trapdoor` bridging a gap the width of its leaves (5.3 × 3.9 m bounds) between two lanes, arch, finish. A second copy of D with a lane beside the door (a way round) is **not** wanted: the door must be crossed.
- **F1, fragile, only way**: lane, one `fragile_block` bridging a gap, lane, arch, finish. **F2, fragile, way round**: as F1 with a still lane beside the block.
- **S, Shooter lane**: a `shooter` on a raised deck firing across a 12 m lane the Bots cross (yaw and pitch held still: `shooter: { yawDegrees: 0, pitchDegrees: 0 }` on the Segment), arch, finish.
- **G, glove**: a `punching_glove` in a wall beside a lane so its fist crosses the Bots' line, arch, finish.

12 Bots, aggression 0, 60 s cap (F1: 90 s), seeds `traps:<track>:<level>`. Leg 0.

## Acceptance (chosen; every such Track is unreachable today: the door and the block are holes in the navmesh)

| Run | HARD | NORMAL | EASY | all levels |
|---|---|---|---|---|
| D door | passed 12, Falls ≤ 1 | passed ≥ 10, ≤ 3 | passed ≥ 6 | stranded 0 |
| F1 fragile, only way (90 s) | passed ≥ 10, Falls through the block ≤ 1 | passed ≥ 10, ≤ 2 | passed ≥ 8 | stranded 0; the block breaks at most once |
| F2 fragile, way round | no Bot steps on the block once it is at its last crack; passed 12 | | | |
| S Shooter | passed 12, Falls ≤ 1 | passed ≥ 10 | passed ≥ 6 | stranded 0 |
| G glove | passed 12, Falls ≤ 1 | passed ≥ 10 | passed ≥ 6 | stranded 0 |

Think total ≤ 30 µs per Bot per Tick on D and S. Suite ≤ 60 s.

## Out of scope

Sweepers (07a), rides (07b/07e), belts (07c), the triggered glove (ADR 0121: not built in the
game either), a Shooter that fires Bombs (ADR 0127: the Fight's catch is ticket 09's), reading
`view.props` for balls already in the air (predicted instead), the Fight.

## Stop rule

Three acceptance runs that miss a threshold → record the numbers, the `where`s and your
reading of the cause under "Open questions", and report. Do not lower a threshold or widen the
scope.

## Checklist

- [x] `TrapDoorHold`: a leaf crossed only while shut from arrival until past it; a stand on the still floor before it, never a retreat; the cap
- [x] `ShooterLaneHold`: every shot predicted from `(Segment, Tick)`, a sample blocked while a ball will be at it; the cap
- [x] `FragileHold` + `planFilterFlags: () => LAST_CRACK_FLAG`: the first plan keeps off a last-crack block; a stale plan onto one stands; the only way waits for it, never forever
- [x] Registered in `defaultHooks` (appended to the `hold` array, one `planFilterFlags` line)
- [x] Tuning block "Traps (M17 ticket 07f)": `BOT_SHOOTER_WATCH_M`, `BOT_FRAGILE_WAIT_MAX_TICKS`
- [x] Suite: D, F2, S, G at their thresholds; the trap door's shut fraction measured
- [ ] F1 at its thresholds — cannot be met as written (Open questions)

## As built (2026-09-24)

**Files.** `packages/shared/src/bot/trapHold.ts` (`TrapDoorHold`, `ShooterLaneHold`, `FragileHold`,
`trapHolds`, `trapPlanFilterFlags`), `bot/trapHold.test.ts`; `bot/hooks.ts` (one import line;
`...trapHolds(profile, seed)` appended inside 07a's `hold: [...]` line, since the array is shared;
`planFilterFlags: trapPlanFilterFlags`); `tuning/bots.ts` (the block). Nothing else touched; no export
added to the package index.

**What building it settled.**
- The two timed holds share 07a's shape through one small base class (`TimedHold`: decide every
  `BOT_HOLD_DECIDE_TICKS`, one `botDraw` jitter per decision, `BOT_HOLD_MAX_TICKS` cap then
  `BOT_HOLD_GO_TICKS` of going; `TimedHold.gaveUp` counts). A stand brakes on a slick floor.
- **How far ahead a trap is asked about**: `lookAheadTicks + stale.max + BOT_HOLD_DECIDE_TICKS`. With
  `lookAheadTicks` alone an EASY Bot (0–5) would reach the leaf before deciding; the rest is what it
  needs to stop in time given how late it sees itself.
- **Trap door**: the leaves' footprints at rest (not `occupies`, whose y test mixes a sample's floor
  height with a capsule centre); entry = first corridor sample over a leaf grown by `CAPSULE_RADIUS`,
  exit = the sample after the last; blocked if `!solidAt` at any Tick in
  `[entry − stale.max + jitter, exit + jitter]`. A Bot already over a leaf goes on.
  **Shut fraction** (`trapDoorShut`, the authored 4 s): **69 of 120 Ticks (58%), one run of 69 Ticks** a
  cycle; a crossing (3.93 m + a capsule) takes ~25.
- **Shooter**: horizontal distance to the predicted ball per Tick the Bot is at a sample
  (`[arrive, next sample's arrive]`, `− stale.max` past the first sample), a ball above the capsule's
  head skipped (GRAVITY_Y), a ball below the floor taken as rolling on. Muzzles cached per decision
  (`shooterMuzzleAt` poses the aim chain; the cache took EASY's hold from 26 µs a call to ~3.7). A Bot
  whose own spot is in the line goes rather than stands in it.
- **Fragile**: a last-crack block ahead within the horizon (from `view.fragile`, so late as the view
  is) → if a plan without `LAST_CRACK_FLAG` from here joins the path's end, stand (the next replan goes
  round); else wait up to `returnSeconds` in Ticks + `BOT_FRAGILE_WAIT_MAX_TICKS`, then go
  (`FragileHold.gaveUp`).
- **Test Tracks** (placed with `at` where a piece stands on a deck: `onTop` sank the glove and the
  Shooter by their own height — the first S and G runs had nobody hit at all). S's Shooter stands on a
  deck 2.25 m up so its 10° barrel puts a ball at chest height over the lane's middle. G's lane is a
  4 m strip with the glove in its left wall, phased (`punch.phase` 0.4) so its punch meets the pack:
  with every hold off, of three phases measured 0.4 met the most Bots.
- A test-only `BOT_NO_TRAPS=1` in the quick loop switches off the three holds **and** 07a's, for a
  control.

**Numbers** (12 Bots, aggression 0, seeds `traps:<track>:<level>`, M4, suite alone ~8 s):

| Run | HARD | NORMAL | EASY | target met |
|---|---|---|---|---|
| D door | 12 passed, 0 Falls, 6.3 s mean | 12, 0 | 12, 0 | yes; stranded 0 |
| D, no holds (control) | 8 passed, 4 slow; Stagger 76, Bump 6, contact 12 Falls | | | — |
| F1 fragile, only way (90 s) | 11 passed; 63 Falls through the block; 9 breaks | 11 (1 stranded); 65; 8 | 11; 107; 9 | **no** (passed rows yes; Falls-through, breaks, NORMAL stranded no) |
| F2 way round | 12 passed, 0 last-crack arrivals, 0 breaks | | | yes |
| S Shooter | 12, 0 Falls (2 knockdowns) | 12, 2 contact Falls | 12, 0 | yes; stranded 0 |
| S, no holds (control, HARD) | 12, 0 Falls, 1 knockdown | | | — |
| G glove (07a's hold) | 12, 0 Falls | 12, 0 | 12, 3 Obstacle | yes; stranded 0 |
| G, no holds (control, HARD) | 12, 1 Obstacle Fall, 1 knockdown, 3 Staggers | | | — |

Think, whole Bot, per Bot per Tick: D 18–24 / 13–16 / 15–23 µs (H/N/E), S 16 / 26 / 18 µs — within
30 run alone; the trap holds' own cost 1.5–3.7 µs a call (up to three calls a Bot-Tick), 0.1–0.3 µs a
call on a Track with no trap. The first `playSection` in a cold process measured 73 µs once, and run
beside another suite file D's think went past 30: the assertion is wall-clock and is meant for the file
alone.

**Tests and typecheck.** `npx vitest run src/bot/trapHold.test.ts`: 6 passed, F1 skipped (with its
reason), quick skipped; `sectionHarness.test.ts` green. `tsc --noEmit` in `packages/shared`: clean for
these files (one error elsewhere, `simulation/bombHome.scratch.test.ts`, not this ticket's).

## Open questions

1. **F1's "Falls through the block ≤ 1 / ≤ 2" and "the block breaks at most once" cannot be met with
   "passed ≥ 10".** `FragileFloors.onGround` charges every arrival, hits never decay, and a block only
   comes back intact by breaking and returning (`FRAGILE_BLOCK_LOOKS` = 3, `returnSeconds` 6). So one
   intact block carries two Bots and the third breaks it: ten crossings need at least four breaks,
   and with at most one break at most four Bots cross — unless a Bot jumps the gap, which no link
   offers (the block's own polygons join the lanes, so no jump is proven over it). One acceptance
   run, stopped there rather than spending two more on a threshold no hold can reach. Measured: 11
   passed at every level, 8–9 breaks. The lead's call: whether F1's rows become "breaks ≤ ⌈passed/2⌉"
   or the like, or a Bot learns to jump a last-crack block (a link over a gated floor), or the
   arrival rule is what should change.
2. **Most of F1's Falls are not breaks** (63–107 Falls through vs 8–9 breaks, classified Bump /
   contact / Stagger): while the block is broken, `BROKEN_FLAG` ends every path at the lane's edge
   beside the hole, so the whole queue stands pressed against it and shoves itself in. Where a Bot
   waits for a broken (or last-crack, only-way) block — back from the edge, spaced like a link's
   queue — is not decided by this brief; the hold as written stands wherever the path runs out.
3. **S and G are mild on these Tracks.** With every hold off, S costs one knockdown and G one Fall a
   HARD run: 12 Bots cross a Shooter's 2 s period and a glove's 0.6-in-3 s punch mostly between
   shots anyway, so S's and G's thresholds pass with or without the holds. They prove the holds do not
   strand or slow anybody (mean pass S 6.8 s vs 5.4–5.9 s without), not that they save Falls; a
   sharper test Track (a narrow lane under the Shooter, several gloves) is the lead's call.
4. `hooks.ts`: 07f's holds went **inside 07a's `hold: [...]` line** (`...trapHolds(profile, seed)`),
   since both parts fill one array; order is SweeperHold first, then trap door, Shooter, fragile.

**F1 moved to ticket 12 (the user, 2026-09-24):** a fragile floor as the only way on is a Survival
piece, never a Race one, so it is not 07f's to solve. The skipped F1 test and its finding
(an intact block carries two Bots and the third breaks it; the queue presses against the hole) go
with it.

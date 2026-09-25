# 07a — Timing the sweepers

**What to build:** a Bot gets past what hits it: spin bars, hammers and trap balls, slide
walls, spiked circles. Every one is a pure function of the Tick (and the Motion Clock, for a
Ramp), so "is this stretch of my corridor clear from now until I am through it" has an answer.
How far ahead a Bot asks is its profile's `lookAheadTicks`, how wrong it may be its
`timingErrorTicks` (08). EASY misjudges by design; a misjudgement is never "step into the void"
(06: the guard still vets every move this part outputs) and a Bot is never stranded waiting
(06b: a hold has a cap).

**Blocked by:** the groundwork in `07-moving-segments-and-traps.md` (§2 `movingWorld`, §4 the
hold hook, §5 `corridorAhead`, §6 the harness). Read that section first; it is the contract.

**Status:** done on tests (2026-09-24), one acceptance row red (see Open questions). **Wall clock: 45 minutes.** Model: Opus.

## The algorithm, decided

One class, `SweeperHold implements HoldHook`, one instance per Bot, registered by the one line
`hold: [new SweeperHold(profile, seed)]` in `defaultHooks` (`bot/hooks.ts`).

Every `BOT_HOLD_DECIDE_TICKS` (3) Ticks, and on the first Tick after a hold ends, it decides;
between decisions it repeats the last decision. A decision:

1. `near = view.track.moving.near(self.position, BOT_HOLD_LOOK_M, tick, L, clock, ["sweeper"])`
   with `L = profile.lookAheadTicks`. None near: **go** (this is most Ticks and costs one loop over
   the bodies).
2. `samples = corridorAhead(ctx, BOT_HOLD_LOOK_M (8), BOT_HOLD_SAMPLE_M (0.5))`: points along the
   next stretch of path with the Tick the Bot reaches each.
3. `jitter = round((2 · botDraw(seed, "hold " + tick) − 1) · profile.timingErrorTicks)`, one draw a
   decision, so EASY's error is a wrong *time*, not a wrong place.
4. A body counts at a sample only if `solidAt` there and its `velocityAt` the sample exceeds
   `BOT_HOLD_MIN_SPEED` (half `MOVING_SEGMENT_STAGGER_SPEED`, read not copied), or it is spiked: a
   bar too slow to Stagger only shoves, and holding for it is time lost.
5. **blocked** = some sample with `arriveTick − tick ≤ L` is `occupies(body, arriveTick + jitter, p,
   CAPSULE_RADIUS + BOT_HOLD_MARGIN_M (0.3))` for a counting body.
6. **hereHit** = some counting body `occupies(body, τ, self.position, …)` for τ from
   `tick + stale.max` to `tick + min(L, BOT_HOLD_HERE_TICKS (20))`, every second Tick.
7. Not blocked → **go** (the steering is returned as given). Blocked and not hereHit → **hold**: a
   stand (`brake` on a slick floor: return the move against `self.velocity`, as `PathFollower.brake`
   does). Blocked and hereHit → **retreat**: a unit move toward the previous corner (the path's
   direction reversed at corner 0), which the guard still vets.
8. **Never forever.** A hold that has lasted `BOT_HOLD_MAX_TICKS` (150: the longest authored
   cycle is a 4 s slide, and a spin bar passes twice a turn) ends: go, and hold nothing again
   before `tick + BOT_HOLD_GO_TICKS` (45). Record every such give-up in a counter a test can read
   (`SweeperHold.gaveUp`).

A hold never sets `committed`. It reads `ctx.path`/`ctx.corner` and never writes them. The
Fight, links and rides are not this hook's: a committed steering is returned untouched (the
`PathFollower` already skips hooks for those).

Why this shape: the Bot knows where every body will be exactly; only *its own* position is
late (`ctx.stale`). So the arrival Ticks are computed from where it sees itself, and `hereHit`
looks from `tick + stale.max` on, because a Bot cannot be hit at a Tick it has already lived.

## Files (owned by this part; nothing else is edited)

- `packages/shared/src/bot/sweeperHold.ts` — `SweeperHold`.
- `packages/shared/src/bot/sweeperHold.test.ts` — the suite below.
- `packages/shared/src/bot/hooks.ts` — one line in `defaultHooks`.
- `packages/shared/src/tuning/bots.ts` — a block "Timing sweepers (M17 ticket 07a)":
  `BOT_HOLD_DECIDE_TICKS`, `BOT_HOLD_LOOK_M`, `BOT_HOLD_SAMPLE_M`, `BOT_HOLD_MARGIN_M`,
  `BOT_HOLD_HERE_TICKS`, `BOT_HOLD_MAX_TICKS`, `BOT_HOLD_GO_TICKS`, `BOT_HOLD_MIN_SPEED`. First
  guesses, named in tests, never copied into them.

Not touched: `PathBot.ts`, `edgeGuard.ts`, `TreeBot.ts`, `navMesh.ts`, `links.ts`, `linkProof.ts`,
`movingWorld.ts`, `sectionHarness.ts`. If one of them needs a change, stop and report it.

## Test Tracks (authored in the suite with `track/authoring.ts`, `TOP = 4`, a 12 m lane is `onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2 })`)

- **A, one wrecking ball**: start deck (`start: true`), lane at s 18, `wreckingBall({ x: 0, deckTop: TOP, s: 30, period: 3.4 })` with its `gantry`, over a lane at s 30, lane at 42, arch (`checkpoint: { order: 1 }`) at 46, finish at 52. The ball sweeps the whole lane twice a period; it is off the lane for about 28 Ticks each side, and a crossing takes about 17.
- **B, spin bars**: the base race's sweeper deck twice (a lane with two `kaykit_barrier_4x1x1` bars at x ±3, `spin(2.7)` and `spin(−2.7, π/2)`, staggered 2.8 m), then arch and finish.
- **C, a slide wall**: a lane with `kaykit_barrier_2x1x2_red` at x 5 sliding `slide({ offset: { x: −10 }, scale: 1.5, period: 3.8 })` across it (the sweeper gauntlet's wall), then arch and finish.

Each is leg 0 for the harness (Start → the arch). 12 Bots, aggression 0, 45 s cap, seed
`sweepers:<track>:<level>`.

## Acceptance (measured baselines in brackets, from `07-…md`; targets are chosen)

| Run | HARD | NORMAL | EASY | all levels |
|---|---|---|---|---|
| A ball | passed 12, obstacle Falls ≤ 1 | passed ≥ 10, ≤ 4 | passed ≥ 6 | stranded 0; obstacle Falls EASY > NORMAL ≥ HARD |
| B bars | passed 12, ≤ 1 | passed ≥ 10, ≤ 3 | passed ≥ 8 | stranded 0 |
| C wall | passed 12, ≤ 1 | passed ≥ 10 | passed ≥ 8 | stranded 0 |
| base race leg 1, 60 s [3 / 4 / 2 passed; obstacle Falls 66 / 70 / 51] | passed ≥ 9, obstacle Falls ≤ 10 | passed ≥ 6, ≤ 30 | passed ≥ 3 | stranded 0; obstacle Falls strictly EASY > NORMAL > HARD |

"Obstacle Falls" is the harness's `obstacleFalls` (Obstacle + WallImpact + Stagger + pushed).
`gaveUp` is logged, not asserted. Also assert, on **base race leg 0** at HARD (a leg that already
passes 11/12): passed ≥ 11 and mean pass time not more than 20% over the baseline's 31 s, so the
hook does not turn a passable deck into a queue.

- **Think budget**: total `thinkUsPerBotTick` on base race leg 1 at NORMAL ≤ 30 µs [16.6 without
  the hook]; the hook's own share ≤ 8 µs amortized. Log both.
- **Suite runtime**: `npx vitest run src/bot/sweeperHold.test.ts` ≤ 60 s on the dev Mac.

## Quick loop

`BOT_QUICK=1 BOT_LEG=A BOT_LEVEL=hard npx vitest run src/bot/sweeperHold.test.ts -t quick` runs
one Track at one level and prints the outcome and every Fall's `where`. Iterate there; run the
acceptance `describe` at most three times.

## Out of scope

Floors you ride (07b), belts (07c), moving-to-moving transfers (07e), trap doors, fragile
floors, Shooter lanes and the glove's own test (07f: the glove is a `sweeper` body whose
`solidAt` this hook already consults, so nothing here is glove-specific), the Fight, the mixed
Race legs (07d), the level ordering across whole Races (07d), any change to how a link is
proven or replayed, any constant outside the block above.

## Stop rule

After **three** acceptance runs that miss a threshold, stop. Record the numbers reached, the
Falls' `where`, and what you believe the cause is, under "Open questions" here, and report.
Do not lower a threshold; do not widen the scope; do not touch another part's files.

## Checklist

- [x] `SweeperHold` as above, registered in `defaultHooks`
- [x] `lookAheadTicks` and `timingErrorTicks` read, so HARD's look-ahead is actually used
- [x] Never held forever: the cap, and `gaveUp` counted
- [ ] Suite: Tracks A, B, C and base race leg 1 at the thresholds above; base race leg 0 not slower — all green but base race leg 1's strict EASY > NORMAL > HARD (2 / 1 / 1)
- [x] Think cost measured and recorded here under "As built"

## As built (2026-09-24)

Files: `bot/sweeperHold.ts` (`SweeperHold`), `bot/sweeperHold.test.ts`, one line in `bot/hooks.ts`
(`hold: [new SweeperHold(profile, seed)]`, beside 07c's `push`), the "Timing sweepers (M17 ticket 07a)"
block in `tuning/bots.ts` (plus two imports at its top: `IMPACT_STAGGER_MIN`, `MOVING_SEGMENT_IMPACT_SCALE`,
so `BOT_HOLD_MIN_SPEED` is `MOVING_SEGMENT_STAGGER_SPEED`'s own rule halved without importing Rapier into
tuning). The algorithm is the one above, with `ctx.clock` passed to `near`/`occupies`/`velocityAt`.

What building it settled, beyond the spec:
- **A hold's clock runs until the Bot gets somewhere.** A "go" between holds does not reset it; only
  moving more than `BOT_STALL_MOVE_M` from where the hold began does. Found on Track A at HARD: a Bot
  holding for the ball was run into by the one behind, the two capsules pressed together (0.43 m apart),
  and every "go" (≈35 Ticks while the ball was away) pushed nowhere. The hold/go rhythm was shorter than
  the stall detector's 45 Ticks, so `PathFollower`'s unstall never fired and both were stranded.
- **`BOT_HOLD_GO_TICKS` = `BOT_STALL_TICKS + BOT_UNSTALL_TICKS`**, not 45: the go after a give-up must
  outlast the stall detector, or the next hold resets it (45 was exactly one Tick short).
- **No Dash with a sweeper near.** The corridor's arrival Ticks are a walk's; a Dash arrives when the timing
  did not look. Measured: spin bars (Track B) at HARD went from 11 passed / 6 obstacle Falls (5 WallImpact)
  / 25.7 s to 12 / 0 / 15.5 s, and base race leg 0 at HARD from 9 passed / 38.8 s to 12 / 29.0 s.
- The test Tracks put the finish sign on a lane of its own (`lane(54)`, the base race's finish section):
  with the sign over the void, Bots through the arch (2 m before the lane's end) ran off it and were
  counted as `pushed` obstacle Falls.
- `SweeperHold.gaveUp` is a static counter over all Bots; the suite logs the per-run difference.
- Quick loop extras: `BOT_LEG` also takes `base0` / `base1`; `BOT_NOHOLD=1` runs the same section with the
  hook passing every move through (a baseline).

Measured (acceptance run 2, seed `sweepers:<track>:<level>`, 12 Bots, aggression 0; passed / stranded /
obstacle Falls / mean pass / gave up):

| Run | HARD | NORMAL | EASY | Target met |
|---|---|---|---|---|
| A ball | 12 / 0 / 0 / 9.0 s / 2 | 12 / 0 / 0 / 6.3 s / 0 | 12 / 0 / 6 / 9.6 s / 0 | yes (6 > 0 ≥ 0) |
| B bars | 12 / 0 / 0 / 15.5 s / 2 | 12 / 0 / 1 / 14.3 s / 0 | 12 / 0 / 0 / 11.0 s / 0 | yes |
| C wall | 12 / 0 / 0 / 7.8 s / 0 | 12 / 0 / 2 / 6.9 s / 0 | 12 / 0 / 1 / 5.6 s / 0 | yes |
| base race leg 1, 60 s | 12 / 0 / 1 / 11.1 s / 0 | 12 / 0 / 1 / 11.7 s / 0 | 12 / 0 / 2 / 12.2 s / 0 | all but strict order (2 > 1 **=** 1) |
| base race leg 0, HARD | 12 / 0 / 0 / 29.0 s / 1 | | | yes (≥ 11, 29.0 ≤ 37.2 s) |

Think cost (base race leg 1, NORMAL): whole think **19.9 µs / Bot-Tick** (budget 30), the hook **6.9 µs per
call** (budget 8; per call bounds per Bot-Tick, since it is called only on uncommitted Ticks). Wall-clock µs
here moved 2–4× between runs with three other agents' suites on the same CPU (A HARD read 5.3 and 14.9
µs/call on identical runs), so the suite logs them and does not assert them. Suite runtime ≈ 12 s.

No-hook baselines measured the same day (`BOT_NOHOLD=1`): base race leg 1 is **12 / 12 / 12 passed with
1 / 0 / 0 obstacle Falls** (HARD / NORMAL / EASY), not the 3 / 4 / 2 and 66 / 70 / 51 the groundwork note
recorded; base race leg 0 at HARD 9 passed, 4 obstacle Falls, 32.4 s (not 11/12, 31 s); Track B at HARD
12 / 2 Falls / 10.4 s.

Regression: `sectionHarness`, `neverStranded`, `TreeBot` green; `tsc --noEmit` in `packages/shared` clean
but for an unrelated `simulation/bombHome.scratch.test.ts` unused import.

## Open questions

- **Base race leg 1's strict EASY > NORMAL > HARD in obstacle Falls is red (2 / 1 / 1),** after two
  acceptance runs (stopped there rather than tune toward noise). The target was set against a baseline of
  66 / 70 / 51 Falls; today, without the hook, that leg already runs 1 / 0 / 0 and passes 12/12/12, so the
  levels differ by one Fall in twelve Bots and no strict order can be read off one seed. Either the leg's
  baseline moved (something between the groundwork measurement and now: 07b/07c/07f landing, or the harness)
  or the note's numbers were from another setup; the ordering wants several seeds or a harder leg to be
  measurable. Not lowered.
- A stopped **spiked** sweeper (Motion stopped, e.g. `atRest`) still counts (spiked always does), so a Bot
  whose path crosses one holds until the cap. Not seen on any Track here; flagged for 07d's mixed legs.
- The corridor's arrival Ticks assume the Bot already walks at full speed; a Bot starting from a hold
  accelerates, so it arrives later than timed. Fixing that is `corridorAhead`'s (groundwork), not done here.

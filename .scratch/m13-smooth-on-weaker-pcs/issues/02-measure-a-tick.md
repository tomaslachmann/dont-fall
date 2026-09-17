# 02 — Measure a tick: the base-race simulation benchmark and the server tick log

**What to build:** numbers for what one simulation tick costs on the base
race, without a browser, and a way to see the real Match server's tick time.

**Decided (user, 2026-09-17):** measure first. Physics distance activation
waits for these numbers ("Až podle měření").

**Blocked by:** —

**Status:** done (2026-09-17). Tests and typecheck pass; the benchmark ran here (ticket 03 has the numbers). The server log has not run under a real Match yet.

## How it behaves after

- One command (e.g. `pnpm --filter @dont-fall/shared bench:sim`) builds the
  base race from the real GLBs, adds 1, 4 and 12 Characters, and runs a few
  thousand RUNNING ticks. It prints, per Character count:
  - tick time p50 / p95 / p99 and the ticks over 2 ms and over 10 ms,
  - Rapier's own split: `timingStep`, `timingCollisionDetection`,
    `timingBroadPhase` / `timingNarrowPhase`, `timingSolver`, and the other
    timings 0.20 exposes,
  - the time spent outside `world.step()` in the tick: the per-tick Moving
    Segment switching (`holdForSweeps` + `MovingSegment.tick`), measured on
    its own,
  - the same run with the Moving Segments not ticked (a benchmark-only
    variant), so their share reads directly,
  - one client-shaped cost: a 6-tick `replayLocalCharacter`.
- The Characters run scripted inputs down the course (forward, periodic jump
  and dash) so they meet the Track's pieces. Standing at the spawn only would
  measure the spawn.
- The Match server, started with `DONTFALL_PERF=1`, logs every 10 s while a
  Round runs:
  - tick duration p50 / p99 and the ticks over 33 ms,
  - `JSON.stringify` time per snapshot send,
  - event-loop delay (`perf_hooks.monitorEventLoopDelay`).
  Without the flag nothing is sampled.

## What to change

- [x] A read-only timings accessor on `RapierSimulation`
      (`world.profilerEnabled` behind an option, off by default). The profiler
      doesn't change results, so the shared step stays deterministic.
- [x] The benchmark script under `packages/shared` (not part of `pnpm test`),
      reading the GLBs the way `baseRace.test.ts` does
- [x] Scripted inputs: a small pure helper, reusable by 07
- [x] `matchLoop.ts`: tick timing and snapshot-serialisation timing behind the
      flag; one tested stats helper, shared with 01's if it fits both
      packages' rules
- [x] No behaviour change with the flags off (existing suites unchanged)

## Notes

- Research: "Findings §3 Physics", "Measurement plan → Server metrics",
  "Budgets": one client `tick()` ≤ 2 ms p95, server tick p99 ≤ 10 ms with 12
  Players.
- No bots exist, so the benchmark stands in for "1, 4 and 12 bots". A real
  12-Player Match adds networking on top. The server log covers that when
  someone runs one.
- Run on the dev Mac, and note the machine and commit next to the numbers
  (ticket 03).

## As built

- **The simulation's own timings.** `SimulationConfig.profileClock` is a millisecond clock
  (`performance.now`), injected because `packages/shared` has no DOM or Node types. With it:
  - `world.profilerEnabled` is on,
  - the tick times three of its own loops: the Moving Segment switching, every Character's
    `beginTick` ("character sweeps") and the post-step Character loop ("character updates"),
  - `RapierSimulation.lastTickTimings()` returns those three plus Rapier's step, collision,
    broad/narrow phase, solver, CCD and user-changes timings.

  A test runs a profiled and a plain world side by side and gets identical snapshots.
  `emptySimulationTimings()` is the zero record that sums start from.
- **The benchmark.** It lives in `scripts/bench-simulation.ts`, not `packages/shared`: `scripts/` is
  where the repo's tsx tools already live, and shared has no tsx or Node types. Run it with
  `pnpm bench:sim [--players 1,4,12] [--ticks 1800] [--json]`.
  - **Server runs.** Every Character count runs in two layouts: `start` (the spawn grid) and
    `spread` (one per Checkpoint Respawn). Each layout runs `moving` (the real base race) and
    `still` (every Motion removed, so the pieces stay as static colliders). A tick also pays the
    snapshot build and one `JSON.stringify` per client.
  - **Client run.** One predicted Character plus 11 mirrors, with a 6-tick
    `syncTick` + `replayLocalCharacter` replay every 15 ticks.
  - **Scripted inputs.** The bots run forward along the Start, steer back to their own line, and
    jump and dash on a staggered beat. The helper lives inside the script, and ticket 07 reuses it
    by running the script. The bots fall and ragdoll a lot, which is load too; the table reports the
    down share.
- **The server log.** `apps/server/src/match/tickPerf.ts` `TickPerf`, created by `startServer` only
  under `DONTFALL_PERF=1`. `MatchConfig.profileClock` goes to every simulation the Match builds.
  `startMatchLoop` wraps its tick body only when perf is on, and times the snapshot send loop.
  Every 10 s with a COUNTDOWN/RUNNING tick in the window, it logs one line (prefix `DON'T FALL
  perf`, then the matchId) with:
  - tick p50/p99/max and the ticks over 33.3 ms,
  - send p50/p99,
  - mean physics timings,
  - event-loop delay (`monitorEventLoopDelay`, 10 ms resolution subtracted).

  Idle phases are not counted.

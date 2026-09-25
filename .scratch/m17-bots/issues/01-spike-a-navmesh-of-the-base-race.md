# 01 — Spike: a navmesh of the base race

**What to build:** prove the two libraries ADR 0129 picked before anything is built on them.
`recast-navigation` (0.43.1) and `mistreevous` (4.3.1) are installed in `packages/shared`,
their WASM/JS initialises in Node (vitest, the Match server) and in the browser (Vite), and a
navmesh is generated from the base race's **still** colliders as `resolveTrack` gives them
(boxes, trimeshes, Asset parts, ADR 0065/0116). A throwaway Bot runs a three-node tree in
`mistreevous` so its API is known too.

**Blocked by:** —

**Status:** done (2026-09-24)

- [x] Installed (the global store this time, see `node_modules/.modules.yaml`). `initNavigation()` in
      `bot/navMesh.ts`, once per process. **Node:** vitest. **Browser:** a scratch page on the builder's
      Vite server loaded the WASM in 27 ms and found a path. The page is deleted
- [x] `trackNavInput(resolved)` (`bot/navInput.ts`): `statics` as box triangles plus
      `staticTrimeshes`. `movingSegments` (which carry trap doors and fragile floors), Props and
      Spinners are left out. A test holds it
- [x] Recast config from `tuning/bots.ts`, every agent size read from the capsule's constants
- [x] **Generation, solo, Node:** base race 42 ms, Spin Cycle 86 ms, Slip Stream 96 ms. It is a
      boot cost at Round load, so there is **no per-Revision cache**. Tiled works too (57–181 ms)
      and is not needed
- [x] **Path query:** 0.02–0.16 ms per Checkpoint-to-Checkpoint query
- [x] **No dump.** The builder generates the navmesh itself, in the browser, from the same code
      (proven above), so ticket 02 needs no file
- [x] Findings recorded in ADR 0129's "As built"

**What it found:**

- **`detailSampleDist` was the whole cost.** Sampling the detail mesh every 1 m took 1.8 s on the
  base race, most of it on the ball field at 400–500 m (1.27 s for that slice alone). Recast's
  defaults (6 m, error 1) bring it to 42 ms. A Bot never reads a path's height, since its capsule
  finds the floor itself. `0` **crashes the WASM build** (out-of-bounds memory access).
- **The climb is measured.** In the real simulation, a walk gets over a 0.15 ledge and stops at
  0.18, so `NAV_AGENT_CLIMB = 0.15`. Recast rounds it down to one voxel (0.1), which only ever
  turns a lip into a jump.
- **The meshes look right.** Top-down renders of all three Races over their geometry show:
  - decks are covered and eroded round posts and arch legs;
  - the holes are where moving rows are;
  - 45° ramps are left out. They are Sliding ramps (ADR 0037), and **sliding down one is a route**,
    so ticket 05 adds it as a link;
  - pole tops form tiny unreachable islands, which are harmless.
- **Paths end at the edge of what moves.** Spawn → first Checkpoint on the base race stops at
  −65 m, the edge before the moving rows. That is tickets 05 and 07.
- **`mistreevous` is deterministic only with both options.** Without `random` and `getDeltaTime`
  it calls `Math.random()` and `new Date()`. Every Bot tree must pass both. It is a CommonJS
  package and imports fine from ESM.
- **End to end:** a three-node tree (`selector { sequence { IsDown Wait } RunToGoal }`) steering
  along `navPath` ran the base race's first 55 m in 315 Ticks with no Fall. It cost 0.09 ms a
  Tick including the simulation.

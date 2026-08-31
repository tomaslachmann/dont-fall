# 01 — Scaffold: monorepo + fixed 30 Hz sim + interpolated render

**What to build:** The architectural spine for M1. A pnpm workspace with
`packages/shared`, `apps/client`, and an empty `apps/server`. `packages/shared`
holds a fixed 30 Hz simulation step shaped as `(state, inputs) -> state` plus a
module of named tuning constants. `apps/client` (Vite + Three.js) runs a render
loop at the display refresh rate that interpolates between the two most recent
simulation states. A demo entity (a cube) is advanced only by the shared sim and
renders smoothly on a flat ground plane.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `pnpm-workspace.yaml` with `packages/shared`, `apps/client`, `apps/server`
- [x] `apps/server` exists as a stub (`stepHeadless`, one test proving the shared sim import)
- [x] `packages/shared` exports a pure `step(state, inputs)` advanced at a fixed 30 Hz accumulator (`advanceFixed`)
- [x] `packages/shared` exports a tuning-constants module (`TICK_RATE_HZ`, `TICK_DT`, `TICK_MS`, `MAX_STEPS_PER_FRAME`)
- [x] `apps/client` renders with Three.js; render loop decoupled from sim, interpolates via `previousState`/`state` from `advanceFixed`
- [x] A demo cube moves via the sim only — **manual smoothness check pending** (needs `pnpm dev`, browser extension was offline)
- [x] Client and server both import the sim step from `packages/shared`
- [x] Respects ADR 0004 (fixed 30 Hz, render interpolates), 0005 (shared sim layout; Rapier deferred to ticket 02), 0007 (monorepo layout)

**Note:** scaffold uses a placeholder Euler integrator, not Rapier. `SimInputs` is
wired through the seam but only ever idle this ticket — real input is ticket 02+.

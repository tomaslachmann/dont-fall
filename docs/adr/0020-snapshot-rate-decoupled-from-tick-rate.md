# 0020 — Snapshot rate is decoupled from tick rate; interpolation delay is a function of snapshot rate

ADR 0004 fixes the simulation at 30 Hz. The server has broadcast one snapshot per sim tick
since ticket 02, and ADR 0017 hardcoded `INTERP_DELAY_MS = 1.5 × TICK_MS`. Valve's Source
convention (and L4D/L4D2's shipping config — 30-tick sim, 20 `cl_updaterate`, ~30 command)
treats simulation tick, snapshot rate, and command rate as three independent numbers.

## Decision

- The three rates are independent (model doc §1). Snapshot rate is decoupled **in code from
  M2** — a snapshot accumulator in the server tick loop, so the send rate is a config value
  — but **M2 ships at 30 Hz snapshots** (30 / 30 / 30). 20 Hz is the target for the
  12-player path, adopted **after** binary encoding lands (binary saves far more bandwidth
  with zero latency cost, so it comes first).
- `state.tick` already makes sparse snapshots work: `SnapshotInterpolator` keys its buffer
  by `tick · TICK_MS`, so snapshots for ticks 0, 3, 6 … bracket the render target correctly
  with no code change. Reconciliation keys off `lastInputTick` and is indifferent to
  snapshot rate.
- `INTERP_DELAY_MS` becomes a function of **snapshot rate**, using Valve's formula:

  ```
  INTERP_DELAY_MS = clamp( INTERP_RATIO / snapshotHz * 1000,  minimum,  250 )
  ```

  `INTERP_RATIO = 2` (Valve `cl_interp_ratio` default; the near-universal
  smoothness-vs-hitbox-accuracy compromise, confirmed across four independent Source
  community sources). At 30 Hz → 66.7 ms; at 20 Hz → 100 ms. The 250 ms cap is a real Valve
  constant.

## Consequences

- Lowering the snapshot rate later costs `+33 ms` of latency on every non-predicted entity
  (bigger playout buffer) — an explicit trade recorded in model doc §9, not a silent one.
- No protocol change is needed to go sparse; only the `INTERP_DELAY_MS` formula and the
  server's send accumulator.
- ADR 0017's fixed `1.5 × TICK_MS` (≈ 50 ms, ≈ ratio 1.5 — thin) is superseded by the
  formula above.

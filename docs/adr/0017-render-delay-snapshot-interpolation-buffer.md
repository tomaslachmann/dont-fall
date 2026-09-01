# 0017 — Non-predicted world is rendered through a render-delay interpolation buffer

ADR 0003 says the client renders every entity it doesn't predict "by interpolating between
received snapshots" and accepts that they're "shown slightly in the past". The first
implementation (ticket 03) lerped between the last two *received* snapshots with
`alpha = (now - arrivedAt) / TICK_MS` — which assumes each snapshot arrives exactly one
tick after the previous one. 2026-09 playtesting: a box pushed at a constant speed on the
server was visibly jerky on the client. A Node `setInterval` fires a few ms late and
unevenly, and encode + socket + parse add variable delay, so consecutive arrivals are
rarely a clean `TICK_MS` apart — when they're closer the box was drawn moving too fast then
snapped, when they're further apart it froze until the next arrival. Diagnosed with a
feedback loop (`apps/client/src/snapshotInterpolation.test.ts`): constant-speed input +
realistic arrival jitter → the old interpolation's rendered per-frame speed swings ~68%
around the mean; a buffer holds it under 10%.

## Decision

`apps/client/src/snapshotInterpolation.ts` — `SnapshotInterpolator`. Buffer received
snapshots keyed by their **server** time (`tick * TICK_MS` — perfectly spaced, immune to
arrival jitter). Anchor the local clock to the server clock on the first snapshot (then
ease it slowly for drift). Each frame, render the non-predicted world where it was
`INTERP_DELAY_MS` of server time ago, lerping (via the existing `interpolateState`) between
the two buffered snapshots that bracket that moment. The render target advances by real
elapsed wall-clock, so output speed is constant regardless of how unevenly snapshots land.
This is the standard snapshot-interpolation buffer (Fiedler; Valve `cl_interp`).

`INTERP_DELAY_MS = 1.5 × TICK_MS` (~50 ms): enough headroom that the bracketing snapshots
have essentially always arrived. On a buffer underrun (a snapshot later than that) the
interpolator holds the latest pose — never extrapolates, never jumps backward.

## Consequences

- The non-predicted world (Props, other players, this player's own ragdoll while down,
  Spinner phase, and the Prop/mirror obstacles fed into local prediction) is now shown a
  fixed ~50 ms in the past instead of ~33 ms + jitter. Marginally more latency, dramatically
  smoother — and ADR 0003 already prices in "shown slightly in the past". The **predicted**
  local Character is unaffected (still rendered at the live prediction tick).
- `main.ts` no longer tracks `serverPreviousSnapshot` / `latestServerSnapshotReceivedAt` /
  `alphaSince`; it feeds every snapshot to the interpolator and samples it each frame.
  `latestServerSnapshot` is kept only for `reconcile` (which needs the raw, tick-aligned
  snapshot, not a smoothed one).
- Clock-drift correction is a slow ease (`OFFSET_EASE = 0.02`); a large step change (a real
  connection stall) rides through as a brief hold, not a snap. Fine for M2; if long matches
  show drift artifacts, the lever is a proper time-sync handshake.


---

## Amended by ADR 0019 / 0020 (2026-09)

- The clock input is no longer a first-snapshot anchor + `OFFSET_EASE` slow ease. ADR 0019
  replaces it with an NTP-style `ping`/`pong` handshake (lowest-RTT sample, clamped slew,
  `serverTimeMs` on every snapshot) — the "proper time-sync handshake" this ADR flagged as
  the lever for drift artifacts.
- `INTERP_DELAY_MS` is no longer `1.5 × TICK_MS`. ADR 0020 makes it a function of the
  *snapshot* rate: `clamp(INTERP_RATIO / snapshotHz * 1000, min, 250)` with `INTERP_RATIO = 2`
  (Valve `cl_interp_ratio`). At 30 Hz snapshots → 66.7 ms.
- The buffer mechanism (tick-keyed, render-delay, hold-latest on underrun) is unchanged.

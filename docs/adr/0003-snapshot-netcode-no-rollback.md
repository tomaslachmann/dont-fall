# 0003 — Snapshot netcode: server broadcast, predict own Character, interpolate the rest, no rollback

The server simulates the whole Match and broadcasts state snapshots. Each client
runs client-side prediction for **its own Character only** and renders every other
entity by interpolating between received snapshots. There is no rollback and no
lockstep determinism requirement across machines.

Rollback/GGPO-style netcode over a 16-body physics simulation is extremely hard,
and Rapier is not reliably deterministic across platforms, so lockstep is off the
table. Predicting all entities on every client causes desync exactly where it
hurts most — Character-to-Character collisions. Snapshot + local-only prediction +
entity interpolation is the well-trodden approach for this genre and is
achievable solo.

## Consequences

- Remote Characters are shown slightly in the past (interpolation delay). Acceptable
  for a forgiving party game.
- The shared simulation step (ADR 0005) must be structured as `(state, inputs) ->
  state` so the client can re-run it for prediction and reconciliation.
- Snapshot size and send rate need attention as Character count grows; not a
  concern at M2's 2-player scope.

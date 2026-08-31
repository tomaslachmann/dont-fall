# 0005 — Rapier physics via a shared simulation package

Physics uses Rapier (WASM). The simulation step — advancing physics plus game
rules for one 30 Hz tick — lives in `packages/shared` and is imported by both the
client (for prediction) and the server (as the authority).

Rapier runs as the same WASM module in the browser and in Node, so client and
server step identical physics code. It ships a kinematic character controller
(for the capsule half of ADR 0006) and joints (for the ragdoll half), and
performs well for the dozens of bodies a Match needs. Jolt has a stronger solver
but a heavier, worse JS API; Cannon-es is pure JS but too slow for 16 ragdolls.
Putting the step in a shared package is what makes the snapshot netcode (ADR
0003) possible.

## Consequences

- `packages/shared` owns tuning constants and the `(state, inputs) -> state` step;
  `apps/client` and `apps/server` must not fork physics logic.
- Rapier is not guaranteed bit-identical across platforms — fine, because the
  server is authoritative and clients reconcile (ADR 0003), not lockstep.

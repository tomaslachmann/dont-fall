# 0013 — Client reconciliation: local replay for the predicted Character, discrete state always snaps

When the server's authoritative snapshot for the local player's own Character disagrees
with what the client already predicted, the client accepts the server's state as the new
base and replays its own buffered-but-not-yet-acknowledged inputs back through the same
shared simulation step (ADR 0005) to arrive at "now" — the classic client-side
prediction/reconciliation algorithm (Bernier, GDC 2001), also called resimulation
(Photon Fusion) or rollback (Unity Netcode for Entities) elsewhere. Short positional
error-smoothing — blending the visual transform over a few frames instead of popping —
may be layered on top later as feel-tuning, but a correction to *discrete*
`CharacterStateMachine` state (`Controlled → Ragdoll`, etc.) is never smoothed: it snaps
immediately, exactly as ADR 0006 already mandates for interpolating a *remote*
Character through a `motionState` change ("snaps, no blend, on any `motionState`
change").

This is not the cross-machine deterministic lockstep ADR 0003 rules out — it only ever
replays this one machine's own inputs against its own already-corrected base, with no
requirement to match another machine's replay bit-for-bit, and Rapier's determinism only
needs to hold across ticks on one machine, not across machines. It's nearly free to add
here specifically because ADR 0005 already mandates the exact shared
`(state, inputs) -> state` step this technique needs.

Researched rather than assumed — see `docs/research/m2-client-reconciliation.md`. Every
primary source surveyed (Valve's Source networking docs, Glenn Fiedler, Unity Netcode for
Entities, Photon Fusion) draws the same line this ADR does: smooth continuous data,
snap discrete/logical state outright.

## Consequences

- The client must buffer its own recent inputs by tick number so they can be replayed
  after a correction. How many ticks back a correction can reach is a tuning constant,
  not an architectural question.
- Positional error-smoothing (if and when it's added) only ever touches the continuous
  transform (position/rotation) — it must never be applied across a state-machine
  transition, matching the precedent ADR 0006 already set on the remote-interpolation
  side.

## Superseded in part by ADR 0026 (2026-09)

The deferred "positional error-smoothing … as feel-tuning" is now decided: it is a
**decaying render-time error offset** (the ADR 0022 mechanism, `0.5^(dt/halfLife)`,
half-life ≈ 100 ms), and the *simulation* reconciles **unconditionally** on any real
disagreement — the `RECONCILE_POSITION_ERROR = 0.2` correct-or-ignore threshold is retired
(it happened to equal one 30 Hz walk-step, so a one-tick phase slip parked on it and
popped). Local replay and "discrete state always snaps" — the core of this ADR — stand
unchanged. See `docs/research/m2-prediction-reconciliation-loop.md`.

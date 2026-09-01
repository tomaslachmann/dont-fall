# 05 — Reconciliation: local replay + snap-on-discrete-state

**What to build:** When the server's authoritative snapshot for the local player's own
Character disagrees with what was already predicted — most visibly, being Bumped into
Ragdoll by the other player, which the local client had no way to predict — the client
corrects itself by replaying its own recently-sent, not-yet-acknowledged inputs from the
server's corrected state, rather than simply overwriting its prediction (ADR 0013). A
correction that changes the Character's discrete motion state (`Controlled` to `Ragdoll`,
etc.) always applies immediately, with no visual smoothing across the transition.

**Blocked by:** 04.

**Status:** done

- [x] The client buffers its own recent inputs, tagged by the simulation tick they were
      sent for (`InputMessage.tick`, `inputBuffer` + `positionHistory` in `main.ts`)
- [x] On receiving a server snapshot that disagrees with the local prediction for the
      same tick, the client adopts the server's state as the new base
      (`RapierSimulation.reconcileCharacter` → `CharacterController.reconcileTo`) and
      replays its buffered not-yet-acknowledged inputs forward through the same shared
      step (`replayLocalCharacter`) to catch back up. Disagreement is judged tick-aligned:
      predicted position at the acked tick vs the server's report, gated by
      `RECONCILE_POSITION_ERROR`
- [x] A correction that changes the Character's motion state is applied immediately on the
      tick it's received — never smoothed (`snapTo`, and the Ragdoll snap activates the
      ragdoll in-place that same call)
- [x] Getting Bumped by the other player is reconciled correctly: the snap into Ragdoll
      is immediate and the ragdoll is re-anchored to the server's pelvis on every
      following snapshot (`Ragdoll.snapRootTo`), so it tracks without rubber-banding; no
      input replay while down (Ragdoll ignores input)
- [x] The placeholder correction from ticket 03 (`reconcile`, motion-state only) is
      replaced by `reconcileTo` (full base + replay)

**Deferred (per ADR 0013 / the research brief):** positional error-smoothing for the
continuous transform — replay + hard state-snap shipped first; add the smoothing window
only if the residual pop is actually visible at this game's speed/camera.

**Accepted M2 approximations:**

- Replay routes through the full shared `tick`, and `syncTick` realigns the tick counter
  to the server first, so Spinner phase, Checkpoint and Fall detection all stay coherent
  during replay. What it doesn't reconcile: dynamic Props take a few extra `world.step()`s
  (Prop sync is ticket 06).
- Reconciling into `Stagger` restarts the local `STAGGER_TICKS` window from 0 — the
  snapshot carries no state-progress field — so a mispredicted Stagger clears ~½ RTT late
  on the client. Rare (a medium Spinner graze, mispredicted) and self-correcting.
- Mid-dash-burst reconciliation ends the burst rather than resuming its envelope.
- The server consumes exactly one queued input per tick and reuses the last one for a
  tick a client's packet hasn't arrived for; a sustained client/server rate mismatch
  makes the client predict slightly ahead of or behind the server, corrected by the
  ordinary position-error check.

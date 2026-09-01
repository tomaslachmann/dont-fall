# 05 — Reconciliation: local replay + snap-on-discrete-state

**What to build:** When the server's authoritative snapshot for the local player's own
Character disagrees with what was already predicted — most visibly, being Bumped into
Ragdoll by the other player, which the local client had no way to predict — the client
corrects itself by replaying its own recently-sent, not-yet-acknowledged inputs from the
server's corrected state, rather than simply overwriting its prediction (ADR 0013). A
correction that changes the Character's discrete motion state (`Controlled` to `Ragdoll`,
etc.) always applies immediately, with no visual smoothing across the transition.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] The client buffers its own recent inputs, tagged by the simulation tick they were
      sent for
- [ ] On receiving a server snapshot that disagrees with the local prediction for the
      same tick, the client adopts the server's state as the new base and replays its
      buffered not-yet-acknowledged inputs forward through the same shared simulation
      step to catch back up to the present tick
- [ ] A correction that changes the Character's motion state (e.g. `Controlled` to
      `Ragdoll` from an unpredicted Bump) is applied immediately on the tick it's
      received — never smoothed or delayed
- [ ] Getting Bumped by the other player (ticket 04) is reconciled correctly and
      visibly: the local client shows itself entering Ragdoll promptly, without
      rubber-banding or repeatedly correcting the same divergence
- [ ] The placeholder correction from ticket 03 is replaced by this mechanism

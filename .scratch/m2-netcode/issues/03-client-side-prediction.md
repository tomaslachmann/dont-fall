# 03 — Client-side prediction for the local Character

**What to build:** The client re-runs the shared simulation step locally for its own
Character on every input, instead of waiting for the server's round-trip — restoring
M1's responsive movement feel over the network. When the server's snapshot for the local
Character matches what was already predicted (the common case, nothing unexpected
happening), the client shows no visible change.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] The local Character responds to input immediately (locally predicted), not after a
      server round-trip
- [ ] The client's predicted state is produced by re-running the exact same shared
      simulation step the server uses, given the same inputs (ADR 0003, ADR 0005)
- [ ] Movement, jump, and dash — and their existing M1 tuning/feel — are indistinguishable
      from offline single-player play when nothing else interferes
- [ ] Divergence between the client's prediction and the server's snapshot is handled
      with a minimal placeholder correction for now — full reconciliation is ticket 05,
      not required here

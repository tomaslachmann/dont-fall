# 0057 — Idle phases broadcast on change, not on rate

In LOBBY (and RESULTS) input is locked, the world doesn't step
(`phaseNeedsPhysicsStep`), and the clock doesn't run — yet every Match
server stringified and broadcast a full snapshot 15× a second to every
connected client, byte-identical between mutations. At one lobby that is
background noise; at broker scale (one `MatchRuntime` per Lobby, ADR 0054)
it is per-Lobby noise times the Lobby count, most of it while everyone
just stands around a roster.

## Decision

- **Live phases broadcast on rate, idle phases on change.** COUNTDOWN
  (`countdownMsLeft` ticks), RUNNING and the short ROUND_END hold keep the
  snapshot-rate broadcast. LOBBY and RESULTS send only when the shared
  (non-per-client) content changed.
- **The check is level-triggered, never edge-triggered.** Each tick in an
  idle phase compares the shared payload JSON (phase, lobby, track,
  roundRules, clock, dnf, standingsReady, roundResults, roundsRemaining —
  deliberately *not* `state`, whose tick number advances every interval and
  would make the comparison useless) against the last broadcast. Two
  mutations within one tick still send the final state; a missed "event" is
  not a concept that exists, so no update can be lost by one.
- **A join forces the next push** (`snapshotDirty`, spent by any broadcast):
  a newcomer has nothing yet while the shared payload may be unchanged for
  everyone else. Phase transitions and Lobby mutations need no flag — they
  change the compared payload by construction.
- **A `sync` request re-pulls the current snapshot** (new `ClientMessage`,
  no gate, no phase restriction; a no-op in live phases). An idle-phase
  client that attached its listener late — a game still loading its Track, a
  Screen subscribing after the welcome — asks outright instead of sitting on
  nothing until the next mutation. Both client entry points (`createLobby-
  Connection`, game `boot`) send it the moment their snapshot listener is
  live. This is what makes "broadcast on change" safe against attach timing
  without a heartbeat: staleness is always recoverable within one tick, by
  the party that suspects it.

## Consequences

- Snapshot gaps of minutes are now normal in idle phases. Consumers already
  treat gaps as packet loss (interpolation, `PredictionLoop` re-seed); the
  M4.5-known capsule-offset hard-reset on a missing `positionHistory` entry
  applies to the first live snapshot after an idle stretch exactly as it
  does to loss today — same benign reset, no new failure mode.
- `commandQueueDepth` (LEAD, ADR 0021) goes stale in idle phases along with
  everything else. Nothing reads it there — input is locked — and the first
  live tick refreshes it.
- No keepalive was added: dead-socket detection is unchanged (the `close`
  event, as before — neither side had a heartbeat, and none was needed for
  this change).
- The 30 Hz tick loop itself is untouched: phase advance, input acks,
  round-ending reads and the per-tick `simulation.snapshot()` all still run
  every tick. Only the per-client stringify-and-send is gated. Stopping the
  loop or the snapshot build in idle phases is a possible further saving,
  deliberately not taken here — the endings logic reads that state, and
  re-timing it is a separate risk from muting the wire.

# 0040 — Match phase is server-authoritative and rides the snapshot; the lobby uses the same socket

No Match, Round, or lobby state exists in code (only test-name mentions). M4 needs at least
LOBBY → COUNTDOWN → RUNNING → ROUND_END → RESULTS plus lobby interactions (nickname, ready,
Track pick, start) — without standing up matchmaking, orchestration, or a second service for two
players on a manually-started server.

## Decision

- The server owns all transitions from COUNTDOWN on. The authoritative phase rides the snapshot
  as `phase + timeLeftMs + qualified {characterId: finishTick}`; clients render it and never
  compute the end of a Round themselves.
- COUNTDOWN is 3 s derived from the server Tick: Characters spawn (join order → spawn offset),
  input locked, cameras live — so the start is synchronous with no teleport at zero.
- Lobby interactions (join / nickname label / ready toggle / Track select / start, gated on
  all-ready with the host as first joiner) travel the existing client↔server WebSocket. There is
  no lobby service and no new transport in M4; the server relays lobby state and enforces the
  start.
- Round end (all connected qualified, or clock zero), disconnect-means-DNF, and no mid-round
  rejoin all follow without further protocol: they are server-side readings of the same state.

## Considered options

- **Client-driven start/end** (the lobby tells the server when) — rejected: it splits authority
  over the one thing the server must own unconditionally (ADR 0002); two clients already
  disagree about Bump outcomes without help.
- **Separate lobby service or transport** — rejected at M4 scale: a second round-trip, a second
  deployment, and a handoff protocol, all to seat two players who already share a socket with the
  authority.

## Consequences

- Snapshots grow three fields; React routes read `phase` (lobby / countdown overlay / game /
  results) while the HUD reads the clock and the qualified map — the game loop still never runs
  through React (ADR 0008).
- Reconnect-into-running, auto-rematch, and orchestration stay deferred and now have a defined
  docking point: they are transitions on this machine, not a second machine.

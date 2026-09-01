# 02 — Authoritative server + one client over WebSocket

**What to build:** A real Node server process replaces the `stepHeadless` stub, running
one authoritative `RapierSimulation` for a Match at a fixed 30 Hz. A single browser
client connects over WebSocket, is assigned an anonymous session ID, sends its inputs
once per tick, and renders its own Character purely from the server's broadcast
snapshots — no local prediction yet (ticket 03). Movement will feel laggier than the
offline M1 client until then; this ticket proves the wire protocol works end to end.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Server runs a fixed 30 Hz loop stepping one authoritative `RapierSimulation`,
      reusing `packages/shared`'s existing fixed-timestep utilities
- [ ] A client connects over WebSocket and receives an anonymous session ID identifying
      its own Character
- [ ] Client sends its `SimInputs` once per simulation tick over the socket
- [ ] Server broadcasts a JSON snapshot of the Match's Character collection to all
      connected clients once per tick
- [ ] The connecting client renders its own Character driven entirely by received
      snapshots (existing `interpolateState` machinery), with no local simulation of its
      own
- [ ] Manually starting the server process and the client separately is enough to play —
      no on-demand spin-up, no matchmaking (ADR 0011)

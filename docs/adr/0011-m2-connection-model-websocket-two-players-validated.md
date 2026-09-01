# 0011 — M2 connection model: WebSocket, 2 players validated / 12 architected, anonymous session identity

M2 connects clients to the authoritative server (ADR 0002) over plain WebSocket (`ws` on
the server, native `WebSocket` in the browser) carrying JSON snapshots, broadcast every
simulation tick (30 Hz). A client's identity is an anonymous per-connection session ID
assigned on connect — no accounts, matching the roadmap's deferral of accounts/lobby to
M4. On disconnect the server removes that Character from the simulation and stops
broadcasting it; the server process itself keeps running regardless of how many players
remain, since M2 has no orchestrator to hand control back to (ADR 0002 explicitly defers
instance orchestration).

ADR 0002 and ADR 0003 both scope M2 to "2 players." That stays the *validated* target —
M2 is built and tested with 2 — but every data structure the connection model touches
(the server's Character collection, the snapshot's per-Character array, collision
groups) is shaped as a collection of N, never two hardcoded slots, because the actual
target is up to 12 players in a later milestone. Scaling to 12 is meant to be a
config/performance pass on top of this shape, not a rewrite of it.

Transport and format were researched rather than assumed — see
`docs/research/m2-netcode-transport.md`. WebSocket avoids the ICE/STUN/SDP signaling
infrastructure WebRTC would still need on top of it for a browser-to-dedicated-server
topology (WebRTC doesn't replace that infrastructure, it adds to it), and is what
Colyseus and Photon both fall back to for browser clients specifically. JSON is
sufficient at this scale — a 12-Character snapshot is a few hundred bytes at 30 Hz, and
ADR 0003 already says snapshot size isn't a concern at M2's scope — so no schema library
(Protobuf, FlatBuffers) is warranted; there's no cross-language requirement in a
shared-TypeScript client/server anyway.

## Consequences

- Reconnecting into an existing session is not supported — a disconnect is a full
  departure, and the vacated Character is simply gone. Fine for M2's proof-of-concept;
  will need revisiting before this reads as a real party game.
- No bandwidth/message-size optimization work happens now; it's deferred until the
  12-player target makes it a measured problem, not a guessed one.
- If a hand-packed binary snapshot format is ever needed, the plan is to write it
  directly (`ArrayBuffer`/`DataView`), not add a schema/codegen dependency — consistent
  with the project's existing dependency-light philosophy.

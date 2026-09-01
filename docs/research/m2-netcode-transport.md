# M2 netcode: transport protocol and message format

> This is the first file under `docs/research/` — a new convention, parallel to
> `docs/adr/` (decisions) and `docs/milestones/` (specs). This directory holds
> primary-source research notes that feed a specific design discussion; it is not
> itself a decision record. If the recommendations below are adopted, they should
> be captured as an ADR the normal way.

Scope: M2 is 2 players, architected toward 12. Server is authoritative
(ADR 0002), broadcasts snapshots at the fixed 30 Hz tick, each client predicts
only its own Character and interpolates everyone else (ADR 0003, 0004). No
rollback, no cross-machine determinism requirement. This note does not
re-litigate any of that.

## Recommendation

**Transport: WebSocket (via the `ws` package on the Node server, the native
`WebSocket` browser API on the client).** WebSocket is the only browser-native
option that needs zero connection-negotiation infrastructure — no STUN/TURN, no
SDP offer/answer, no ICE candidate gathering — which matters enormously for a
solo developer standing up a new authoritative server per Match. Its TCP-based
head-of-line blocking is a real cost, but at 30 Hz / 2–12 players on generally
healthy connections it's not the failure mode this game needs to defend
against, and it's the same tradeoff Colyseus (default transport) and Photon
(browser/WebGL clients specifically) both make for exactly this reason. WebRTC
DataChannels remain the documented "real" answer if head-of-line stalls prove
to be a problem in practice, and WebTransport is now a credible long-term
successor (Baseline across all major browsers as of March 2026) but is too
new to bet an M2 milestone on with no ecosystem track record yet.

**Message format: hand-packed binary (`ArrayBuffer`/`DataView`), not JSON, but
introduced only when snapshot size or `JSON.parse`/`JSON.stringify` cost
actually shows up as a problem — which ADR 0003 already predicts will not be
the case at M2's 2-player scope.** A 12-Character snapshot of positions,
quaternions, and a motion-state enum is small (well under 1 KB even
naively-packed) and cheap to serialize either way at 30 Hz; JSON's overhead is
irrelevant at this scale. Reach for a schema library (Protocol Buffers,
FlatBuffers) only if the message shape starts needing cross-version
compatibility or code generation pays for itself — neither applies to a
solo-maintained shared TypeScript type between client and server, where a
hand-rolled `DataView` encode/decode pair (or, if ragdoll bone data grows
heavy, MessagePack as an off-the-shelf, schema-less binary form) is simpler and
keeps the "no framework, dependency-light" philosophy intact.

---

## 1. Transport protocol

### WebSocket

- WebSocket is a **full-duplex** protocol that runs "the WebSocket protocol...
  as [a] persistent connection over a single TCP connection" — MDN describes it
  as opening "a two-way interactive communication session between the user's
  browser and a server" without polling. [MDN — WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- Every WebSocket connection is carried over TCP, so it inherits TCP's
  reliable, ordered, in-sequence byte stream — there is no unreliable or
  unordered mode. [MDN — WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API), [websocket.org — WebSocket vs TCP](https://websocket.org/reference/websocket-vs-tcp/)
- Browser support is effectively universal (Chrome 16+, Firefox 11+, Safari
  7+, Edge 12+), and MDN calls the interface "stable" with "good browser and
  server support." [MDN — WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
- **Head-of-line blocking is the real cost.** Glenn Fiedler (creator of the
  gaffer-on-games netcode series and, later, netcode.io / yojimbo, shipped
  netcode in commercial multiplayer titles) puts it directly: TCP "holds more
  recent packets hostage in a queue while older packets are resent over the
  network" — head-of-line blocking — which is "a huge problem for games,"
  because "the most recent data they want is delayed while waiting for old
  data to be resent, but by the time the resent data arrives, it's too old to
  be used." [Fiedler — Why can't I send UDP packets from a browser?](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/)
- The `ws` npm package (what a Node WebSocket server realistically means) is
  the de facto Node.js implementation: "a simple to use, blazing fast, and
  thoroughly tested WebSocket client and server implementation." [ws on npm](https://www.npmjs.com/package/ws)

### WebRTC DataChannels

- `RTCDataChannel` can be configured unreliable and/or unordered.
  `ordered` (default `true`) controls sequencing independently of
  reliability. Reliability is controlled by `maxPacketLifeTime` (time-bounded
  retransmission) or `maxRetransmits` (retry-count-bounded) — **mutually
  exclusive options**; setting neither yields the default fully-reliable
  channel; setting either yields an unreliable one. [MDN — RTCPeerConnection.createDataChannel()](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel)
- This is exactly the UDP-like "unordered, unreliable, small messages" mode
  real-time games want, and it's why Fiedler frames DataChannels as the
  closest thing browsers have to raw UDP: "WebRTC supports unreliable data
  channels" enabling "unordered packet transmission between browsers."
  [Fiedler — Why can't I send UDP packets from a browser?](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/)
- **But the complexity is real and Fiedler is explicit that it's the wrong
  fit for a client-to-dedicated-server architecture** (which is exactly this
  project's shape, per ADR 0002): WebRTC "falls down when data needs to be
  sent between a browser and a dedicated server," because it was designed for
  peer-to-peer and drags in STUN/ICE/TURN negotiation that a server with a
  known public IP doesn't need. He quotes agar.io's creator agreeing: "I feel
  what is needed is a UDP version of WebSockets. That's all I wish we had."
  Fiedler's own response to this gap was to design netcode.io — a
  purpose-built encrypted/authenticated UDP protocol for exactly this
  client-to-dedicated-server case — rather than recommend WebRTC for it.
  [Fiedler — Why can't I send UDP packets from a browser?](https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/)
- Setting up an `RTCDataChannel` still requires a full `RTCPeerConnection`
  with SDP offer/answer exchange and ICE candidate negotiation, which in turn
  requires a signaling channel and, for many network topologies, a
  STUN/TURN server — none of which exists solely for browser-to-known-server
  connections and all of which would need to be built and hosted just to
  reach parity with what a WebSocket connection does with one `new
  WebSocket(url)` call.

### WebTransport

- WebTransport reached **Baseline (newly available)** status in 2026: Safari
  26.4 shipped support in March 2026, which — combined with prior Chrome,
  Edge, Firefox, and Opera support — means it now "works in every major
  browser without a polyfill." [caniuse — WebTransport](https://caniuse.com/webtransport), [MDN — WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
- Its datagram API is a genuine unreliable/unordered channel purpose-built
  for exactly this game-state-update use case: "Transmission is not
  guaranteed, and order is not guaranteed. Ideal for applications where each
  message supersedes the last (e.g., game state updates)." It also avoids
  cross-stream head-of-line blocking by running over HTTP/3 (QUIC). [MDN — WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
- Even so, it is too immature to bet a solo-developer M2 milestone on: it is
  "newly available" as of only months ago, requires an HTTP/3-capable server
  (real but non-trivial infra work compared to `ws`), and lacks the years of
  battle-tested library/tooling ecosystem that `ws` and browser WebSocket
  already have. It's the transport to revisit once the game has an actual
  latency complaint that WebSocket's head-of-line blocking is causing, not a
  default to start from.

### What real frameworks/engines actually do

- **Colyseus** (a real authoritative-server multiplayer framework, closest
  first-party comparable to this project's shape) defaults to exactly this
  project's choice: "The `WebSocketTransport` with its default options is
  going to be used automatically if no `transport` is provided," built on
  `websockets/ws`. Its own alternate-transport docs list `uWebSockets.js` (a
  faster WebSocket implementation, still TCP/WebSocket) and an experimental
  WebTransport transport — WebRTC is not offered as a general transport
  option at all. [Colyseus — WebSocket (Default) transport](https://docs.colyseus.io/server/transport/ws), [Colyseus — Transport overview](https://docs.colyseus.io/server/transport)
- **Photon Engine** (commercial realtime-multiplayer middleware, ships UDP as
  its primary protocol for native clients) documents WebSocket/WebSocketSecure
  as the transport specifically for browser and WebGL clients — i.e. even a
  vendor whose core product is a custom reliable-UDP protocol falls back to
  WebSocket the moment the client is a browser. [Photon — Server 5: TCP and UDP Port Numbers](https://doc.photonengine.com/server/current/operations/tcp-and-udp-port-numbers)

### Solo-developer complexity tradeoff, explicit

| | WebSocket (`ws`) | WebRTC DataChannel | WebTransport |
|---|---|---|---|
| Connection setup | `new WebSocket(url)` on client, `ws` server accepts a handshake | Full `RTCPeerConnection` + SDP offer/answer + ICE gathering, needs a signaling channel and often STUN/TURN | `new WebTransport(url)`, but server needs HTTP/3 |
| Reliability/ordering control | None — always reliable, ordered | Per-channel, both axes independently configurable | Independent reliable streams and unreliable datagrams |
| Infra to stand up per on-demand Match server (ADR 0002) | None beyond the existing Node process | Signaling server + STUN/TURN, or reuse the WebSocket for signaling anyway | HTTP/3-capable server |
| Ecosystem maturity | Mature, ~15 years in production | Mature for P2P, awkward for client↔dedicated-server | Baseline since March 2026 — new |

Given ADR 0002's on-demand per-Match server model, any WebRTC approach would
still need a WebSocket (or equivalent) connection for signaling before the
DataChannel could even be negotiated — meaning WebRTC doesn't replace the
WebSocket work, it adds a second stack on top of it. That, combined with
Fiedler's own conclusion that WebRTC is the wrong tool for browser↔dedicated-
server, settles it for M2: **plain WebSocket, revisit only if head-of-line
stalls become an observed, measured problem.**

## 2. Message format

- The project's own ADR already states the position to build from: "Snapshot
  size and send rate need attention as Character count grows; not a concern
  at M2's 2-player scope" (`docs/adr/0003-snapshot-netcode-no-rollback.md`).
  This research does not need to relitigate that — it needs to confirm it
  still holds at 12 players and identify the point at which it stops holding.
- **JSON** is trivially available (`JSON.stringify`/`JSON.parse` built into
  both the browser and Node runtime) and is almost certainly adequate for
  M2's 2-player scope and comfortably into the 12-player target: a snapshot
  of 12 Characters' position (3 floats), rotation quaternion (4 floats), and
  a small motion-state enum is on the order of a few hundred bytes as JSON,
  sent 30 times/second — negligible bandwidth and parse cost relative to
  everything else the game loop is doing.
- **Hand-packed binary** (`ArrayBuffer` + `DataView`, writing fixed-width
  floats/enums at known offsets) removes JSON's per-field key-name and
  punctuation overhead entirely and is a natural fit once/if snapshot size or
  parse cost is actually measured as a bottleneck (e.g. once ragdoll bone
  data — dozens of extra transforms per Character on impact — needs to ride
  along). It requires no dependency, matching the project's "no framework"
  posture, at the cost of manually keeping the encode/decode offsets in sync
  by hand on both sides (mitigated here by the shared `packages/shared`
  module already being the single source of truth for the wire shape).
- **MessagePack**, "like JSON, but fast and small" per its own site, is a
  schema-less binary encoding that packs small integers into a single byte
  and short strings into one extra byte over their length — a drop-in,
  zero-schema alternative to JSON with meaningfully smaller payloads, useful
  if the team wants binary-level savings without hand-rolling a `DataView`
  layout. [msgpack.org](https://msgpack.org/)
- **Protocol Buffers** encode integers as varints (1 byte for values under
  128, scaling up for larger numbers) and length-delimited fields for
  strings/bytes/sub-messages — a compact, well-specified wire format, but it
  requires a `.proto` schema and a code-generation step. [protobuf.dev — Encoding](https://protobuf.dev/programming-guides/encoding/)
- **FlatBuffers** goes further, avoiding a parse/unpack step entirely by
  letting consumers read fields directly out of the buffer — the biggest win
  when the same message is deserialized very frequently or parse latency
  itself matters, at the cost of a schema/codegen pipeline like Protobuf.
- **Recommendation for M2 specifically:** do not introduce a schema library.
  Given the "dependency-light" philosophy already established elsewhere in
  this codebase (ADR 0001, ADR 0005) and that the client and server already
  share the exact same TypeScript types via `packages/shared`, the natural
  progression is: **start with JSON** (simplest, ships fastest, already
  matches ADR 0003's stated non-concern at this scale) **and move straight to
  a hand-packed `DataView` binary layout** (skipping Protobuf/FlatBuffers
  entirely) if and when a measured snapshot-size or parse-cost problem
  actually appears — most likely once ragdoll bone data needs to ride in the
  snapshot for more than 2 players at once. Reach for MessagePack instead of
  hand-rolled `DataView` only if that binary transition needs to happen fast
  and the schema-free flexibility is worth the added dependency; reach for
  Protobuf/FlatBuffers only if cross-language or cross-version wire
  compatibility becomes an actual requirement, which nothing in the current
  architecture calls for.

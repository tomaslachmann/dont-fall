# 0019 — Client/server time synchronisation: NTP-style ping/pong in tick space, clamped slew

ADR 0017's `SnapshotInterpolator` anchors the client's render clock to server time on the
*first* snapshot, then eases toward each observed offset at 2 %/snapshot. Research
(`docs/research/m2-time-sync-and-snapshot-rate.md`) found two failure modes that genuinely
hurt a party game: a **poisoned anchor** (a delayed first snapshot — TCP slow-start, WASM
init, GC — bakes the offset 100–300 ms wrong for ~5 s), and a **mid-match latency step**
(wifi roam — the whole non-predicted world freezes/stutters for 1–2 s while the slow ease
catches up).

## Decision

Replace "anchor once + ease" with an NTP-style handshake, working entirely in **tick space
via a monotonic clock** (`performance.now()`), never `Date.now()` — the client synchronises
*ticks*, not wall-clock, and never resets a system clock (RFC 1305: NTP itself only ever
works with offsets and dispersions).

- Client sends `ping{ clientTimeMs: T1 }`; server replies `pong{ T1, serverTimeMs: T3 }`.
  On receipt at `T4`: `rtt = T4 − T1`, `offset = T3 + rtt/2 − T4`.
- Keep the last **~16 samples**. NTP's classic window is 8 ("stability considerations limit
  the window to about eight" — its own time constants); a larger window is fine in this
  domain with different sampling intervals. Discard samples > 1σ from the median (a
  median-filter variant), then take the offset from the **lowest-RTT sample** (lowest RTT
  correlates with lowest error — RFC 1129/1305). Both are legitimate NTP filter variants;
  this ADR pins the combination we use.
- Cadence: burst ~8 pings at join, then 1/s.
- Apply the offset via a **clamped slew** — at most ~15–30 ms/s of correction (a value
  *derived for this game*, not a cited NTP constant), and snap outright only past ~100 ms
  of error.
- Every `SnapshotMessage` carries `serverTimeMs` (the server's own `performance.now()` at
  build time). `tick` alone assumes a perfect `setInterval` cadence; a biased-slow server
  (GC, 12-client JSON encoding) makes sim-time fall behind wall-time, which "anchor + ease"
  reads as unbounded drift and never fixes.

Overwatch-style time dilation (servoing client sim speed to hold the server's input buffer)
is **not** adopted — it fights packet-loss starvation, which TCP does not have. The fixed
input LEAD (ADR 0021) is the cheap 80 % version.

## Consequences

- New `ping` / `pong` message types. The client owns a small sample ring and the current
  offset estimate; it is surfaced in the net-graph overlay.
- ADR 0017's interpolation buffer is unchanged in mechanism; its clock input now comes from
  this handshake instead of a first-snapshot anchor, and a mid-match latency step is
  absorbed by the slew instead of a multi-second freeze.
- `INTERP_DELAY_MS` stops being a function of `TICK_MS` — see ADR 0020.

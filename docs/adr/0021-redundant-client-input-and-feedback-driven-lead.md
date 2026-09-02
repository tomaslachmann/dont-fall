# 0021 — Redundant client input array; a feedback-driven prediction LEAD

M2's `InputMessage` carries one input per packet; the server consumes one per tick from a
6-deep queue and drops the rest. WebSocket over TCP has no packet loss, but it has
head-of-line blocking and delivery jitter — a stalled then flushed connection delivers
several inputs at once, the queue overflows, the server repeats the previous input, and the
client mispredicts.

## Decision

**`InputMessage` becomes `{ inputs: [{ tick, input }, …] }`** — each packet carries the
current tick's input plus a redundant tail of the last **K** unacknowledged inputs. The
server dedupes by `tick` (ignores `tick ≤ lastInputTick`) and applies them in order. This
is the Quake 2/3 command-history model (`cl_packetdup`), and it protects against ordinary
out-of-order delivery as well as HOL bursts — if the packet interval is shorter than RTT,
commands repeat even with no loss, which is expected, not a bug.

**K is a fixed, configurable value (~2), not RTT-adaptive.** Reference implementations
(Quake, Unity NfE "command slack" default 2) use a fixed count. An RTT-scaled K has no
documented precedent and would make the worst-connected players send the largest packets —
exactly where we want to be leanest.

**The prediction LEAD** (how far ahead of the estimated server tick the client predicts, so
the server's command buffer never starves) is a **feedback loop**, not a one-shot RTT
calc:

- Initial estimate: `LEAD = clamp(ceil((rtt/2) / TICK_MS) + 1, 1, 3)` ticks (Overwatch and
  Unity NfE both land at 1–2).
- Then: the server reports `commandQueueDepth` in every `SnapshotMessage`; the client
  nudges `LEAD` toward "queue depth ≈ 1–2" **gradually** — a bounded rate of change, no
  step jumps. A sudden 1 → 3 on a transient latency spike would be a visible prediction
  jerk (Unity's "≤ 1–2 %/s sim-speed change" guidance).

## Consequences

- `SnapshotMessage` gains `commandQueueDepth`.
- Upload cost per packet grows by `K` inputs (small: `SimInputs` is a direction vec + two
  bools); with a fixed K this stays bounded regardless of a player's latency.
- The client's input send path and the server's input queue both key off `tick`; the
  `lastInputTick` reconciliation acknowledgement (ADR 0013) is unchanged.

## Forward note (2026-09) — two flaws found in the shipped implementation

`docs/research/m2-prediction-reconciliation-loop.md`, driven by the reconciliation-pop
defect (see ADR 0026):

1. **The server consumes input FIFO, decoupled from each input's `tick` number**
   (`inputQueues.get(id)?.shift()`), and steps physics unconditionally every tick. Every
   shipping loop surveyed instead makes the server's authoritative advance *be* the act of
   consuming that player's command for the tick being simulated, so "physics steps ==
   inputs applied by tick number" holds by construction — the property the same-tick
   reconciliation compare relies on. On a starved tick our server's step count runs ahead
   of the inputs it has applied, producing a **systematic ~0.2 u bias** in the reported
   position. ADR 0026 hides this with a render offset; removing it at the source (server
   simulates `input[serverTick]`, missing input repeats the last applied one, `lastInputTick`
   = the last tick actually simulated) is **ticket 13**, deferred pending an integration
   test against `apps/server` — the headless prediction harness fakes the client/server
   tick epoch and cannot validate it. A superseding ADR is owed if and when that ships.
2. **The LEAD *drop* subtracts a full `TICK_MS` from the prediction accumulator at once**,
   which yanks the render-interpolation alpha — a connection-quality-scaled backward pop.
   ADR 0026 changes the drop to a continuous small drain (the inject side stays
   responsive); that part is done there, not deferred.

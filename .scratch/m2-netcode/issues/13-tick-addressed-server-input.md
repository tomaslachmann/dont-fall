# 13 — The server simulates `input[serverTick]`, not FIFO next-in-queue

**ADR:** forward note on `docs/adr/0021-redundant-client-input-and-feedback-driven-lead.md`.
A **superseding ADR is owed** if and when this ships (it changes the client↔server
contract). **Research:** `docs/research/m2-prediction-reconciliation-loop.md` §1, §2, §5a.

**Blocked by:** ticket 12 should land first (it makes the residual invisible, so this can
be validated calmly). **Status: not started — needs an integration test before implementation.**

---

## Why

`apps/server/src/index.ts` consumes one queued input per server tick, FIFO
(`inputQueues.get(id)?.shift()`), and steps physics unconditionally every `setInterval`
tick. `entry.tick` is used only for dedupe/ordering, never for scheduling. When a client's
per-tick queue momentarily empties (ordinary jitter / frame-time variance) the server still
steps, repeating `lastApplied` — so its physics-step count for `lastInputTick = N` runs
ahead of the distinct inputs it has applied, and its reported position for tick `N` sits
~`WALK_SPEED / TICK_RATE_HZ` = 0.2 u ahead of the client's stored prediction for `N`. A
**systematic bias**, not float noise. Every shipping predict/reconcile loop surveyed
(Source, Overwatch, Unreal CMC, Quantum) makes the server's authoritative advance *be* the
act of consuming that player's command for the tick being simulated, so "steps == inputs
by tick number" holds by construction — the property the same-tick reconcile compare needs.

Ticket 12's render offset hides this. This ticket removes it, so corrections become **rare**
(only real jitter beyond LEAD + Rapier cross-machine FP residual), not just invisible.

## Shape (from research §5a–5c, to be confirmed by the test)

- Client stamps input in **server-tick space** — `predictionTick` chases
  `estimatedServerTick + LEAD` (it already runs a LEAD ahead; make the tick numbers share
  the server's epoch, via `TimeSync`). Redundant tail (ADR 0021) unchanged.
- Server keeps `serverTick`; each tick it applies the queued input with `tick ===
  serverTick`, else the newest with `tick < serverTick` ("repeat last"). `serverTick`
  advances by exactly one. `commandQueueDepth` = inputs buffered ahead of `serverTick`
  (still feeds the LEAD).
- **Missing input:** repeat `lastApplied` (unchanged); **no rollback** when the real input
  arrives late (ADR 0003).
- **Ack:** `CharacterSnapshot.lastInputTick` = the last server tick actually simulated for
  that player (including repeat-filled ticks). Client resets to that and replays strictly
  forward (`tick > ack`). Also `positionHistory.set(ack, server.position)` after a
  reconcile so a repeated ack computes error 0, not `Infinity` (the `keepAckedInHistory`
  harness fix — small, ship it in ticket 12 if convenient, it's independent).
- LEAD floor high enough that `input[serverTick]` has usually arrived — research says
  ~½ RTT + 1 command frame (Overwatch); needs the test to pin the number and the jitter
  margin.

## Why it's blocked on a test

`predictionRegression.harness.test.ts` couples the client and server on one virtual clock
and fakes the tick epoch, so it **cannot** validate server-tick-space alignment — a
prototype in it (`serverInputModel: "tick-addressed"`) made things *worse* because the
epochs drift. Before implementing, build either:

- a real integration test that starts `apps/server` (or its tick loop) and drives a
  faithful client against it over a modelled-latency transport, asserting
  `serverStarveCount → ~0` and the same-tick `positionError` distribution collapses to the
  FP-residual floor at 30 / 60 / 144 fps under the harness's wifi/bad jitter profiles; or
- extend the harness with a genuine shared tick-0 epoch + `TimeSync`-derived
  `estServerTick` and a decoupled server `setInterval`.

Primary success metric: the pop disappears **at the source** — `bad`-network `worstBack`
with ticket 12's offset *also* removed should still be < 2 cm.

## Done when

- The integration test above exists and is green with tick-addressed consumption.
- `apps/server` + client + `protocol.ts` changed; a superseding ADR recorded (one line:
  "the server simulates the command stamped for the tick being simulated; a missing
  command repeats the last and is reflected honestly in `lastInputTick`").
- Full suite + `/code-review` at **high**.
- `docs/networking-model.md` §4.3/§4.4 "known gap" note removed.

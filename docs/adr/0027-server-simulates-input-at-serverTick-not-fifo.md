# 0027 — The server simulates the command stamped for the tick being simulated

ADR 0021's forward note (2026-09): the server consumed queued input FIFO
(`inputQueues.get(id)?.shift()`), decoupled from each input's own `tick` number, and stepped
physics unconditionally every interval. On an ordinary momentarily-starved tick (queue
jitter, not packet loss — WebSocket/TCP has none) the server still stepped, repeating the
last-applied input — so its physics-step count for a given `serverTick` ran ahead of the
distinct inputs it had actually applied, and its reported position for that tick sat
~`WALK_SPEED / TICK_RATE_HZ` (one 30 Hz walk-step, ≈ 0.2 u) ahead of what the client had
predicted for it. A **systematic bias**, not float noise — and exactly the value ADR 0026's
retired `RECONCILE_POSITION_ERROR` threshold happened to equal, which is what let an
ordinary phase slip park on it and pop the rendered Character. ADR 0026 hides the bias with a
decaying render-time offset; this ADR removes it at the source.

## Decision

**The server's authoritative advance *is* the act of consuming the command stamped for the
tick being simulated.** Every shipping predict/reconcile loop surveyed (Source, Overwatch,
Unreal CMC, Quantum) makes this hold by construction, so "physics steps == inputs applied by
tick number" is always true — the property the same-tick reconciliation compare needs.

- **`apps/server`**: `serverTick` is now the server's own monotonic counter, advancing by
  exactly one every interval tick — not a value only ever read off the last applied input.
  Each tick, the server looks up the input queued for `tick === serverTick` in that client's
  queue (dropping anything strictly older, since it can never be wanted again); if none has
  arrived yet, it repeats `lastApplied` (unchanged fallback). `CharacterSnapshot.lastInputTick`
  is now unconditionally `serverTick` — the tick the server actually simulated for that
  client, whether a real input matched it or a repeat filled it — never left behind at the
  last tick a *distinct* input happened to land on (a client that briefly can't tell "no
  correction needed" from "no snapshot has told me otherwise yet" no longer matters, because
  the ack always advances).
- **Client (`main.ts`)**: `predictionTick`'s numbering is seeded, once, into the server's own
  tick space — `Math.round(estimatedServerTick(now)) + initialLeadTicks`, where
  `estimatedServerTick` is `SnapshotInterpolator`'s existing ping/pong-anchored estimate (ADR
  0019) and `initialLeadTicks` is `clamp(ceil((rtt/2)/TICK_MS) + 1, INITIAL_LEAD_TICKS_MIN,
  INITIAL_LEAD_TICKS_MAX)` — Overwatch's "½ RTT + one command frame," sized from the
  client's own measured RTT rather than a fixed guess. This is a **one-time seed**, gated on
  `timeSync.ready && serverInterp.ready` (both already required for other ADR 0019/0021/0026
  machinery); the free-running low tick numbers before that point are simply unmatched by the
  server (repeat-filled) and cost nothing. After the seed, ADR 0021's existing
  `commandQueueDepth` feedback continues to correct any residual drift — this ADR does not
  touch that loop, only where `predictionTick` starts counting from.
- **No rollback.** A real input that arrives after its tick has already been simulated (late
  beyond LEAD) is simply never applied for that tick — unchanged from ADR 0003's "no
  rollback" invariant. This ADR does not add server-side replay.

Validated by `apps/server/src/tickAddressedInput.integration.test.ts` — a real `startServer`
process, driven by a real `RapierSimulation`-based client over a real (loopback) WebSocket
with modelled one-way latency/jitter, everything on real wall-clock timers (the thing
`predictionRegression.harness.test.ts`'s shared virtual clock structurally cannot validate,
per ADR 0021's forward note). Median same-tick `positionError` sits at the float-noise floor
(≈0.001, down from the old FIFO server's steady-state ~0.2 under any real jitter); a real,
non-FP-noise correction (~one walk-step) still occurs sometimes — 5–10% of reconciles on a
wifi-grade connection, up to ~30% on a worst-case ~270 ms-RTT connection within a short
cold-start window, where the deliberately gentle LEAD feedback (ADR 0021/0026 — a fast
correction would yank the render alpha, ADR 0026) hasn't fully converged yet. That is the
research's own acknowledged residual ("corrections become rare... not eliminated entirely"),
an order of magnitude below the old FIFO server's steady-state norm, not a re-emergence of the
systematic bias this ADR removes.

## Consequences

- `docs/networking-model.md` §4.3's "known gap" note (the server consumes FIFO, not
  `input[serverTick]`) is removed — the gap is closed.
- New tuning constants `INITIAL_LEAD_TICKS_MIN` / `INITIAL_LEAD_TICKS_MAX` (`packages/shared
  /src/tuning.ts`) bound the one-time seed only; the ongoing LEAD band (ADR 0021) is
  untouched.
- ADR 0026's render-time offset is **not removed** — it still hides whatever residual
  mismatch remains (real jitter beyond LEAD, cross-machine Rapier floating-point residue,
  the cold-start convergence window above). This ADR makes corrections *rare*; ADR 0026 makes
  them *invisible* when they do happen. Both stay.
- `apps/server`'s existing unit tests (`index.test.ts`) that hardcoded small, arbitrary
  `tick` numbers in sent `InputMessage`s (leftover from the FIFO model, where the tick number
  was only ever used for dedupe/ordering, never for scheduling) were updated to chase the
  server's own reported `state.tick` — required once tick numbers are scheduling-significant,
  not just a dedupe key.

# 02 — The regression harness drives production, not a copy of it

**What to build:** A seam around the client's predict/reconcile loop, so the thing the netcode
regression suite measures is the thing that actually runs.

`predictionRegression.harness.test.ts` says it plainly in its own header: *"main.ts's frame loop is
a DOM/WebSocket closure with no seam, so this file ports the deterministic core of it."* It is an
excellent harness — 1115 lines, deterministic, models real network conditions — and it has been
testing a replica. Ticket 01 removes the symptom; this removes the cause.

The deterministic core is separable from the frame: sampling input, stepping the prediction,
buffering by tick, reconciling against a snapshot, replaying. None of that needs a DOM, a
WebSocket, or `requestAnimationFrame` — those are the frame's job, and they stay in the frame.

**Blocked by:** 01 (which makes the drift visible and small before the structure moves).

**Status:** blocked

- [ ] The predict/reconcile core is a unit that takes ticks, inputs and snapshots and produces
      predicted state — no DOM, no socket, no animation frame
- [ ] The harness constructs the real thing instead of porting it; the ported core is deleted
- [ ] The harness's own numbers are unchanged — same conditions, same measurements. It is
      measuring the same behaviour, just no longer measuring a replica. A number that *does* move
      is a finding to report, not to re-baseline
- [ ] `game.ts` keeps the frame: rAF, sockets, the renderer, the HUD
- [ ] Nothing about ADR 0013 / 0021 / 0026 / 0027 changes. This ticket moves code

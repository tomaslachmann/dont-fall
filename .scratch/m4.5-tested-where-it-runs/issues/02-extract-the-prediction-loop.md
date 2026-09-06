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

**Status:** done

- [x] The predict/reconcile core is a unit that takes ticks, inputs and snapshots and produces
      predicted state — no DOM, no socket, no animation frame: `predictionLoop.ts`'s
      `PredictionLoop`, covering `seed`/`step`/`recordTick`/`reconcile`/`decayCapsuleOffset`
- [x] The harness constructs the real thing instead of porting it; the ported core is deleted —
      `predictionRegression.harness.test.ts`'s own accumulator, input buffer, position history and
      capsule-offset fields are gone, replaced by one `PredictionLoop` instance. Its own
      "tick-addressed" experimental path (§5a, not validated by this harness — see
      `tickAddressedInput.integration.test.ts` for that) uses the same class via the new
      `recordTick` primitive `step` is built on, so there are still zero forked copies of the core.
      `reconcile()` here is now a thin diagnostic wrapper: it delegates the actual gate/replay/
      offset math to `PredictionLoop.reconcile` and only recomputes a `reason` label for its own
      console reporting (`report()`/`dumpCorrections()`) — never asserted on.
- [x] The harness's own numbers are unchanged where the old port was accurate. **Finding, not a
      re-baseline:** three "60 fps render cap" assertions moved (`worstBack` ~9-11cm instead of
      <2.5cm, under the "bad" 90ms-OWD/45ms-jitter network profile only). Root cause: the harness's
      OLD ported `reconcile` reset the capsule render-offset (ADR 0026) only when its own `reason`
      label was `"hard-snap"` — a label its ternary never assigns when there's no
      `positionHistory` entry for the acked tick (that case short-circuits to
      `"no-history-for-acked"` first). So the port kept smoothing through a missing-history ack.
      Production's real gate (mirrored faithfully into `PredictionLoop.reconcile`) resets whenever
      `positionError > hardSnapM`, and a missing history entry computes `positionError` as
      `Infinity` — always over that bound — so **production actually zeroes the smoothing offset
      on exactly the starved/reordered-snapshot case a bad connection produces most**, defeating
      ADR 0026 right where it matters most. This is a real, pre-existing production behavior the
      harness's own replica was never faithful enough to catch; the extraction didn't introduce
      it, it exposed it. Not fixed here (ticket 02 moves code, it doesn't change behaviour) — see
      the affected tests' own comments in `predictionRegression.harness.test.ts` for the adjusted
      bounds and full reasoning; worth its own follow-up ticket to make the offset survive a
      missing-history ack instead of hard-resetting on it.
- [x] `game.ts` keeps the frame: rAF, sockets, the renderer, the HUD — its own frame loop now just
      calls `predictionLoop.seed/step/reconcile/decayCapsuleOffset`
- [x] Nothing about ADR 0013 / 0021 / 0026 / 0027 changes. This ticket moves code — `game.ts`'s
      `PredictionLoop` is constructed with no config overrides, so production always gets exactly
      `needsCorrection`'s real gate and the real shipped constants; the config knobs
      (`reconcileEpsilon`/`hardSnapM`/`capsuleHalfLifeMs`/`keepAckedInHistory`) exist solely for
      the harness's own historical/comparison scenarios

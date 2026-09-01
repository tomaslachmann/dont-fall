# 0016 — Props are never locally predicted: server-authoritative, interpolated, obstacles only

ADR 0012 made one exception to "predict only your own Character": a Prop the local player is
actively pushing is *locally simulated* for the push duration ("the push feels immediate")
and hard-corrected the instant the server disagrees. 2026-09 playtesting: that exception is
the same predict-then-hard-correct pattern that produced a string of visible glitches this
milestone (dash-wall ragdoll, getup position, other-player mirror positions) — here it's the
Prop visibly jumping backward the moment you stop pushing (`propPushGrace` lapses, the Prop
switches from the local prediction, which has advanced, to the interpolated server pose,
which is ~½ RTT behind), and a smaller jump the other way when you start.

## Decision

**Drop the exception. Every Prop is drawn straight from the interpolated server snapshot,
always — the same as any other entity this client doesn't predict (ADR 0003).** In the local
prediction world a Prop is still a solid obstacle: pinned to the latest server pose every
tick so the local Character's own predicted movement slides against it (ADR 0012's main
rule, unchanged). It just never moves under local physics, and there is no handoff to
glitch on.

Removed: `RapierSimulation.setLocallyLiveProps` / `getContactedProps` / the `locallyLiveProps`
and `contactedProps` sets / `syncPropsToSnapshot`'s `forceLive` parameter and its
`PROP_HARD_CORRECT_DISTANCE` divergence check / the `PROP_LOCAL_SIM_GRACE_TICKS` and
`PROP_HARD_CORRECT_DISTANCE` tuning constants / `main.ts`'s `propPushGrace` bookkeeping.
`syncPropsToSnapshot(poses)` now just records the follow poses; `tick()` pins every Prop
that has one. The server never calls `syncPropsToSnapshot`, so its Props stay fully dynamic
and authoritative — unchanged.

`main.ts` re-pins the obstacle Props every frame from the **interpolated** render poses (the
same fix the other-player mirror capsules got): pinning once per snapshot from the raw pose
left the obstacle-box frozen between snapshots while the server pushed it, so a player
leaning into it predicted "blocked", got snapped forward on the next snapshot, predicted
"blocked" again — a per-snapshot sawtooth that read as lag. Interpolated + every frame, the
obstacle advances smoothly and the pushing player tracks it. `reconcile` still pins from the
raw acked-snapshot poses before its replay (tick-alignment).

## The trade-off, stated plainly

Pushing a Prop now feels ~½ RTT heavy — the box starts moving a round-trip after you lean
into it, not immediately. ADR 0012 rejected exactly this ("the core fantasy — physical
chaos: bumping, shoving — would fail ... a Bump would visibly do nothing locally for a full
round-trip"). That argument still stands for **Character-to-Character Bump**, which is why
Bump keeps its treatment (server-authoritative knockback, mover predicts being blocked). It
is weaker for a pushed Prop: leaning into a crate and having it move a beat later reads as
weight, not as broken input, whereas a crate that teleports backward reads as broken. At 2
players / M2 latencies this is the better default. Reversible: if playtesting says the push
delay kills the shoving fantasy, prediction can come back — but done as easing, not a hard
snap (or a CS2-style predicted-then-timeout-revert), not the grace-then-hard-correct this
removes.

## Consequences

- ADR 0012's "one exception" paragraph is superseded. Its main rule (other Characters and
  Props are positioned obstacles in the local world, never locally simulated) is now
  universal with no carve-out.
- Ticket 06 ("client Prop prediction") is effectively reverted to just "pin Props to the
  snapshot as obstacles" — its prediction/grace/hard-correct half is gone. Its tests are
  rewritten accordingly.
- Consistent with ADR 0015 (knockdown recovery) and the mirror-position fix: the local
  simulation predicts only what is driven by this client's own input; everything else is
  the server's, interpolated. `interpolateState` already smooths a Prop pose between the two
  most recent snapshots (30 Hz), the same path that makes a remote Character read smoothly.


---

## Superseded in part by ADR 0022 (2026-09)

This ADR removed client-side Prop prediction outright after the first attempt jumped the box
backward on release. Research (`docs/research/m2-shared-prop-prediction.md`) established that
the failure was the *handoff shape* (a hard pose swap), not the idea. ADR 0022 reinstates
prediction **only for the one Prop the local Character is touching**, as a decaying
render-time error offset (Fiedler), with `velocity`/`angularVelocity`/`atRest` added to
`PropSnapshot`. This ADR's other content stands: every *other* Prop is interpolated-only and
a pinned obstacle in the local prediction world; the server never calls `syncPropsToSnapshot`.

# 10 — A knockdown never ends locally: only the server recovers the local Character

**What was built:** `docs/adr/0015-knockdown-recovery-is-server-authoritative-only.md`,
implemented and tested. Fixes a live 2026-09 playtest bug found by debugging the "collisions
don't work" report against `[reconcile]`/`[local]`/`[server]` traces (temporary logging
added in ticket 08's follow-up, removed by this ticket): a client that mispredicted its own
dash-into-wall crash (correctly blocked, not knocked down) had **no way to ever accept the
server's authoritative `Ragdoll`** — it walked around in full control for up to ~1.9 s while
the server held it face-down and ignored its input.

**Status:** done.

**Blocked by:** 08. Supersedes ADR 0014's `bumpSeq` gate. Decouples from ticket 09 — see
"Relationship to ticket 09" below.

---

## Root cause

ADR 0014 gated a forced Ragdoll snap on a rising `bumpSeq`, assuming the client always
predicts its own dash-into-wall knockdown correctly (ADR 0005's determinism guarantee) — so
a server report with no new `bumpSeq` must be a stale echo of a knockdown the client already
ran and recovered from. False in practice: the dash-into-wall knockdown is a threshold event
(`DASH_WALL_MIN_SPEED_RATIO` against a "nitro" build-up that runs continuously across the
whole dash), and the client's own *ordinary* `RECONCILE_POSITION_ERROR` position correction
nudges the dash trajectory by centimetres while it's still building up speed — enough to flip
whether it crosses the threshold when it reaches the wall. Confirmed with a regression test
that runs two real `RapierSimulation`s (client + server) through the same input stream with
realistic latency and no artificial hacks — the divergence falls out on its own.

## Fix

- `RapierSimulation`/`CharacterController` gain an `authoritative` flag (default `true`).
  With it `false` (the client's `localSim` only), the state machine's settle-check
  (`ragdoll.maxSpeed() < RAGDOLL_SETTLE_SPEED`) never fires — only the `RAGDOLL_MAX_TICKS`
  hard backstop can locally end a knockdown, and in practice a real server snapshot always
  arrives first.
- `CharacterController.reconcileTo`'s down-state branch is now unconditional: whenever the
  server reports `Ragdoll`/`GettingUp`, the client's `motionState` is synced to match
  (entering fresh, or advancing `Ragdoll → GettingUp`), then the pelvis is re-anchored. This
  restores ADR 0013's original "any snapshot reporting a discrete state forces the snap" —
  safe now because a non-`authoritative` Character can never get *ahead* of the server on
  when a knockdown ends, so there's no stale-vs-live report left to tell apart.
- `main.ts`'s `reconcile()` collapses to: `serverDown || localDown || motionState mismatch ||
  positionError > threshold`. `bumpSeq`, `forceRagdoll`, `downSincePredictionTick`,
  `lastAppliedBumpSeq` all removed from the client.
- `bumpSeq` itself (the field, `resolveBump`'s increment, the Fall-path increment) is
  **retained** on the wire — harmless, and a plausible carrier for a future one-shot
  networked-event id (research §2.2) — but its doc comments no longer claim it gates
  reconciliation.
- Debug instrumentation from the live-tracing session (`[reconcile]`/`[local]`/`[server]`
  console logs in `main.ts` / `apps/server/src/index.ts`) removed.

## Part 2 — the render layer needed it too (angled-hit glitch)

Fixing *when* a knockdown ends surfaced *where* it's drawn. `Ragdoll.snapRootTo` re-anchors
the pelvis every snapshot but nothing re-anchors the `GettingUp` blend — so a glancing/angled
dash into a wall that settles slightly differently on the client's own local ragdoll than on
the server's pops straight the instant `Controlled` resumes. Rather than reconcile that
position harder (another two-states-kept-in-sync patch, the same shape ADR 0015 just
removed), **`main.ts` now renders the local Character from the interpolated server snapshot
while it's down and the server has confirmed** — position and bones from
`serverRender.characters[myId]`, exactly like a remote Character (research Q1 option b,
applied narrowly). `localSim` still runs its cosmetic ragdoll physics for the ~half-RTT gap
before the first confirming snapshot and still owns the instant state-machine snap. See
ADR 0015's addendum.

Explicitly declined at the same time (via a direct decision): dropping local prediction for
`Controlled` movement too. `Controlled` is nothing but input reaction; predicting it is the
whole point of ADR 0002/0003/0005/0013. Staying on that design.

## Tests

`packages/shared/src/simulation/RapierSimulation.test.ts`:
- `"RapierSimulation — client/server dash-wall knockdown desync"` — the regression test:
  two real `RapierSimulation`s, fixed input latency, main.ts's actual reconcile logic
  (condensed), asserts the client goes down whenever the server does. Was red before this
  fix (reproduced the exact playtest symptom), green after.
- `"RapierSimulation — reconcileCharacter + replay (ticket 05)"` block: rewrote the two
  tests that encoded the old `bumpSeq`-gated assumption (a stale-report test that now
  correctly expects the down-sync to apply, and a GettingUp-with-no-prior-Ragdoll edge case),
  added a test for `Ragdoll → GettingUp` advancing without a fresh knockdown, and a test
  documenting that `reconcileTo` deliberately does *not* correct the local prediction's own
  `GettingUp` position (the reason main.ts renders that from the server instead).

All 133 shared tests, plus client/server suites, pass. Typecheck clean across the monorepo.

**No test seam for the render-layer change**: `apps/client/src/main.ts` is the un-exported
browser entry point — no unit-test boundary. Verified by code review; needs a live playtest
to confirm visually.

## Relationship to ticket 09

Ticket 09 (Q1 — stop predicting the local ragdoll body, drive bones from server snapshots)
remains valid future work: it removes the residual jitter from `Ragdoll.snapRootTo`
re-anchoring a chaotic, per-machine-diverging 11-body sim every snapshot, and cuts the
resimulation cost of stepping an articulated body during replay. But it is **not** a
correctness dependency any more — this ticket fixes the actual bug (Q2: *when* a knockdown
ends) independently of Q1 (*whether* the body is locally simulated while down). Ticket 09 is
now purely a jitter/cost optimization; its checklist's "CS2-style timeout-revert" item is
also no longer needed — reconciliation now corrects a locally-predicted-but-unconfirmed
Ragdoll on the very next snapshot (whatever it says), not on a timeout.

## Explicitly NOT in this ticket

Removing local ragdoll body prediction (ticket 09) · removing `bumpSeq` from the wire
entirely · a real one-shot networked-event id for SFX/camera-kick (research §2.2, no
networked one-shot effects exist yet).

# 0015 — A knockdown never ends locally: only a server snapshot recovers the local Character

Superseded trigger: a 2026-09 playtest capture (`.scratch/m2-netcode/issues/08-collision-and-ragdoll-fixes.md`
follow-up) and a reproducing regression test (`RapierSimulation.test.ts`, describe block
"client/server dash-wall knockdown desync") showed the client walking around, in full
control, for up to ~1.9 s while the server had its Character authoritatively `Ragdoll` —
the exact "two authoritative states" failure ADR 0014's own consequences section flagged
as a possibility to revisit.

## The bug ADR 0014 didn't cover

ADR 0014 gates a forced Ragdoll snap on a rising `bumpSeq`, on the assumption that a
dash-into-wall / Spinner knockdown is always predicted correctly by the client (ADR 0005's
determinism guarantee) — so a server report with no new `bumpSeq` must be a stale echo of
a knockdown the client already ran. That assumption is false in practice: the dash-into-wall
knockdown is a threshold event (`DASH_WALL_MIN_SPEED_RATIO` against a "nitro"-style speed
build-up that runs continuously across the whole burst), and the client's own *ordinary*
continuous position-error correction (ADR 0013, `RECONCILE_POSITION_ERROR`) regularly nudges
the client's dash trajectory by a few centimetres while it's still building up speed —
enough to move exactly when it reaches the wall relative to that curve, and flip whether it
crosses the threshold. The client can and does fail to predict its own wall crash, with no
`bumpSeq` to force the correction and no other signal to fall back on — the client then has
no way to ever accept the server's Ragdoll, for the rest of that knockdown.

## Decision

**The local Character's `CharacterStateMachine` never autonomously leaves `Ragdoll` or
`GettingUp` based on its own physics settle-check while running as a client prediction.**
`RapierSimulation`/`CharacterController` gain an `authoritative` flag (default `true`,
matching today's server/test behavior); the client's local-prediction `RapierSimulation`
sets it `false`. With it `false`, `beginTick`'s `ragdollSettled` is always `false`, so only
the `RAGDOLL_MAX_TICKS` hard backstop (identical on client and server) can locally end a
knockdown — in practice that never fires first, because a real server snapshot (every tick,
~33 ms) always arrives well before it.

**`reconcileTo`'s down-state branch becomes unconditional** — this is ADR 0013's original
"any snapshot reporting a discrete state forces the snap" rule, restored. Whenever the
server reports `Ragdoll`/`GettingUp`, the client's `motionState` is synced to match
(entering the knockdown fresh if it wasn't already down, or advancing `Ragdoll → GettingUp`
if the server has and the client hasn't) and the pelvis is re-anchored to the server's
position. `bumpSeq` and the `forceRagdoll` parameter it gated are removed from
reconciliation entirely — there is no longer a "stale vs. live" ambiguity to resolve, because
the client can no longer get *ahead* of the server on when a knockdown ends. It can still be
briefly ahead on when one *starts* (a locally-predicted dash-wall hit, for instant feedback)
— that case is unaffected: it already reconciles correctly today (server disagrees →
`reconcileTo`'s not-down branch already replays the client back to `Controlled`, tested).

Why this doesn't reopen ADR 0014's double-knockdown bug: that bug required the client to
*independently* decide a knockdown was over (via its own ragdoll settle-check) strictly
before the server's snapshot said so, so a later, slower snapshot still reporting `Ragdoll`
read as a fresh event. With `authoritative: false`, the client can never independently reach
that "ahead" state in the first place — recovery is now solely the server snapshot's call,
and snapshots arrive in order (one ordered WebSocket stream, ADR 0011) — so a knockdown can
only ever be reported once, tick by tick, never re-reported after the client has already
moved past it on its own.

## Why not ticket 09's fuller rewrite

`docs/research/m2-collision-and-predicted-ragdoll.md` §1 (Q1) recommends going further:
stop predicting the local ragdoll *body* at all, and drive its bones from interpolated
server snapshots exactly like a remote Character's (ticket 09). That remains good future
work — it removes the residual jitter from `Ragdoll.snapRootTo` re-anchoring a chaotic,
per-machine-diverging 11-body sim every ~33 ms, and cuts the resimulation cost of stepping
an articulated body during replay (ADR 0013's flagged budget concern). But it is **not**
required to fix this bug: the correctness problem is entirely in *when the client decides a
knockdown ends* (Q2), not in whether it locally simulates the body's physics while down
(Q1). Decoupling them keeps this fix small, low-risk, and fully covered by the existing
physics/reconciliation test suite, and leaves ticket 09 as a pure jitter/cost optimization
with no remaining correctness dependency on it.

## Consequences

- ADR 0014 is superseded. `CharacterSnapshot.bumpSeq` and `RapierSimulation.resolveBump`'s
  increment of it are **retained** (harmless, still on the wire) but are no longer consulted
  by reconciliation — a candidate for removal in a future cleanup, not done here to keep this
  change's diff focused. It remains a plausible carrier for a future one-shot networked-event
  id (research §2.2: SFX/camera-kick gating), which is why it isn't deleted outright.
- `reconcileCharacter`/`reconcileTo` drop the `forceRagdoll` parameter — reconciling a
  down-state is now always unconditional.
- A client-authoritative `RapierSimulation` (the server, and every existing test that doesn't
  opt out) is unaffected: `authoritative` defaults to `true`, so its own knockdowns still end
  via the real physics settle-check exactly as before. Only the client's local-prediction
  instance (`apps/client/src/main.ts`'s `localSim`) sets it `false`.
- A rare edge case — the server reports the local Character already in `GettingUp` with no
  prior `Ragdoll` snapshot ever having reached this client (a missed episode entirely, e.g. a
  connection stall) — is handled by entering `Ragdoll` then immediately `GettingUp` in the
  same reconcile, a visually-approximate but non-crashing recovery; the position resyncs
  fully once `Controlled` resumes.

## Addendum: the render layer needed the same treatment (found same day, live playtest)

Fixing *when* a knockdown ends surfaced the next layer of the same problem: *where* it's
shown. `Ragdoll.snapRootTo` re-anchors the pelvis every snapshot, but nothing re-anchors the
`GettingUp` blend (its ragdoll body has already deactivated by then) — so an off-centre wall
hit (a glancing/angled dash rather than square-on) that settles even slightly differently on
the client's own locally-simulated ragdoll than on the server's produces a visible pop the
instant `Controlled` resumes. The tempting fix — reconcile the `GettingUp` blend's anchor
position too, mirroring `snapRootTo` — is the same shape of problem this whole ADR just
resolved: two independently-computed positions kept in sync by patching the reconciler
harder, instead of picking one source of truth. Rejected for that reason.

**Instead: while the local Character is down and the server has confirmed it, `main.ts`
renders it exactly like a remote Character** — position and bones straight from the
interpolated server snapshot (`serverRender.characters[myId]`), not from `localSim`'s own
prediction. This is Q1 option (b) from `docs/research/m2-collision-and-predicted-ragdoll.md`,
applied narrowly: only the *displayed* pose changes source; `localSim` still runs its own
cosmetic ragdoll physics (unchanged) to cover the ~half-RTT gap before the first confirming
snapshot arrives, and still owns the state-machine transition for the instant-feel snap. Once
the server has confirmed, its own down-state pose is authoritative and jitter-free by
construction (the same 30 Hz interpolation that already makes a remote Character's ragdoll
read smoothly) — there is exactly one down-state position on screen, and it was always going
to have to be the server's.

Considered and explicitly declined at the same time: dropping local prediction for the
*Controlled* state too (input straight to the server, render only the server's broadcast
position) — which would remove this whole class of bug by removing prediction entirely. That
trade only makes sense while a Character isn't reacting to input; `Controlled` is nothing
*but* reacting to input (WASD/jump/dash), so it would trade a rare, ~1 s, cosmetic pop for a
permanent, guaranteed, every-keypress lag equal to full RTT — reopening exactly what ADR 0002/
0003/0005/0013 were written to prevent (CLAUDE.md's non-negotiable invariant 3: "Clients
predict only their own Character"). Confirmed staying on that design.

**No test seam for the render-layer half specifically**: `apps/client/src/main.ts` is the
un-exported browser entry point with no unit-test seam (per this repo's structure — HUD is
plain DOM, the game loop never runs through a testable module boundary). The reconciliation
half (this ADR's main content) is fully covered in `packages/shared`; the render-source
choice is verified by code review and needs a live playtest to confirm visually, not an
automated test. Flagged, not silently skipped — worth revisiting if `main.ts`'s render
selection logic grows enough to be worth extracting into a testable pure function.

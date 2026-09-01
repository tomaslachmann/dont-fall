# 0014 — A server-reported Ragdoll only forces a client correction on a new `bumpSeq`

ADR 0013 says a discrete `CharacterStateMachine` correction "snaps immediately... never
smoothed" and gives the example "a Bump-into-Ragdoll snaps and re-anchors to the server's
pelvis with no replay" — read literally, *any* server snapshot reporting `Ragdoll` for the
local Character should force that snap. Ticket 08 (playtest bug 3) found this triggers a
second knockdown: the client predicts its own dash-into-wall / Spinner Ragdoll locally, and
the server produces the same `Ragdoll` state independently, roughly half an RTT later. A
stale `Ragdoll` snapshot of the knockdown the client already ran (and may already have
recovered from) was re-triggering `reconcileTo`'s snap-into-Ragdoll branch — ~2 s of lost
control instead of ~1 s.

The fix: `CharacterSnapshot` carries a monotonic `bumpSeq`, advanced only when the
*server* applies a knockdown the client had no reliable way to predict itself — a
Character-to-Character Bump (`RapierSimulation.resolveBump`) or a ledge-edge Fall
(`detectFall`). `CharacterController.reconcileTo` takes an explicit `forceRagdoll`
parameter; the client sets it only when `server.bumpSeq` has strictly risen since the last
value it applied. A server-reported down state with no new `bumpSeq` — the client's own
dash-wall / Spinner knockdown, live or stale — is a no-op beyond re-anchoring the pelvis
if the client is already down.

## Why not fix this some other way

- **A streak-based safety net** (force Ragdoll if the server holds the Character down for
  N consecutive snapshots with no new `bumpSeq` while local prediction stays upright) was
  tried and reverted: at high RTT it could re-force the tail of the client's *own* already-
  completed knockdown — reintroducing the exact bug it was meant to catch as a backstop for
  a case (the client silently missing a knockdown it was supposed to predict itself) that
  requires the shared step to have actually diverged, which ADR 0005's determinism
  guarantee says shouldn't happen for the deterministic capsule-collision math driving a
  dash-wall/Spinner hit. If that assumption turns out to be wrong in practice, the fix is a
  narrower, better-evidenced signal — not a blanket timeout.
- **A `ragdollEpoch` + `ragdollCause`/`ragdollImpulse` wire protocol** (identify each
  knockdown lifecycle explicitly, distinguish its cause, carry the impulse across the
  network) is the more complete answer and is where ticket 09's re-architecture (stop
  predicting the local ragdoll body; render it from server bones) is headed — a large
  enough change to need its own ADR when that ticket lands. `bumpSeq` is the minimal signal
  that fixes the double-knockdown without pre-empting that design.

## Consequences

- ADR 0013's "any `Ragdoll` snapshot forces a snap" framing is superseded for the local
  Character specifically: a down state must carry a new `bumpSeq` to force the transition.
  Remote-Character interpolation (ADR 0006's "snaps, no blend, on any `motionState`
  change") is unaffected — that path has no local prediction to conflict with.
- `bumpSeq` intentionally does not distinguish a Bump from a Fall, or carry the knockdown's
  cause or impulse — it only answers "did the server just apply a knockdown the client
  couldn't have predicted." Splitting it further only matters once something downstream
  (cause-specific SFX/camera-kick, an authoritative impulse for the client's own ragdoll
  launch) needs that detail.
- A genuine client-side misprediction of a *dash-wall/Spinner* knockdown (the client fails
  to detect its own deterministic collision) has no forcing signal and self-corrects only
  once the server's own Ragdoll episode ends — accepted for M2 on the strength of ADR
  0005's determinism guarantee for the capsule/collision step; revisit if playtesting shows
  otherwise.

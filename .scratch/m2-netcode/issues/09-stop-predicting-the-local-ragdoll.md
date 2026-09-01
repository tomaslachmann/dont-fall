# 09 — Stop predicting the local player's ragdoll body

**What to build:** The client no longer runs its own 11-body articulated ragdoll forward
as a predicted authoritative body. On a locally-predicted knockdown it snaps `motionState`
to `Ragdoll` (instant feel, unchanged) and then draws the ragdoll **pose** from
interpolated server snapshots — the exact `SimState.character.bones` + `interpolateState`
path ADR 0006 already built for remote Characters. Split out of ticket 08; design settled
against `docs/research/m2-collision-and-predicted-ragdoll.md` §1 (recommendation Q1,
option b).

**Blocked by:** 08.

**Status:** ready-for-agent. No longer a correctness dependency for anything — ticket 10 /
ADR 0015 fixed the actual playtest bug (client-predicted-vs-server-authoritative knockdown
*recovery* desync) independently of this ticket's scope (the local ragdoll *body*
prediction). What remains here is jitter/resimulation-cost polish only: `Ragdoll.snapRootTo`
re-anchoring a chaotic, per-machine-diverging 11-body sim every snapshot, and the
resimulation cost of stepping an articulated body during replay (ADR 0013's flagged budget
concern). The checklist's CS2-style timeout-revert item is no longer needed either —
ADR 0015 already corrects a locally-predicted-but-unconfirmed Ragdoll on the very next
snapshot, not on a timeout.

**Needs an ADR.** This supersedes the implicit "the client predicts its own ragdoll"
that tickets 03/05 introduced. ADR 0013's discrete-snap rule and ADR 0006's state machine
are unchanged; what changes is that the ragdoll *bones* were never in the
`(state, inputs) -> state` predicted contract and stop being treated as if they were.

## Why (the residual half of ticket 08's bug 1)

A freely-flung 11-body jointed ragdoll is chaotic and Rapier is not cross-machine
deterministic (ADR 0003), so the client's predicted ragdoll and the server's authoritative
one diverge within a few ticks. Ticket 05's `Ragdoll.snapRootTo` hard-yanks the client
ragdoll's pelvis to the server's every snapshot (~33 ms) — visible as jitter/teleporting
during a ragdoll flight. Every shipping approach the research surveyed treats the
knockdown flop as cosmetic and client-local or interpolated-from-authority, never as a
predicted-then-reconciled physics body (Source, CS2, Halo: Reach, Photon Fusion).

## Checklist

- [ ] On a locally-predicted knockdown the client's state machine still snaps to `Ragdoll`
      immediately, but **no local ragdoll bodies are activated**. The capsule freezes
      (as now); `CharacterController.snapshot()` for a client-side sim reports empty
      `bones` while down.
- [ ] The client renders its own ragdoll from `serverRender.characters[myId].bones`
      (interpolated between the last two server snapshots), the same code path
      `applyRemoteCharacters` uses. The camera follows the interpolated server pelvis.
- [ ] Cover the ½-RTT gap before the first `Ragdoll` snapshot for that Character: a
      1-frame hold of the last capsule pose, or a short canned hit-react, then cross-fade
      to the networked bones.
- [ ] CS2-style timeout-revert: a locally-predicted `Ragdoll` that the server never
      confirms within ~N ticks reverts to `Controlled` (the client mispredicted the
      knockdown — a lost dash input, say). Research §2.3.
- [ ] The `Ragdoll → GettingUp` and `GettingUp → Controlled` transitions for the local
      player come from the snapshot's `motionState`, not a locally-recomputed settle
      check (there's no local ragdoll body to check `maxSpeed()` on any more).
- [ ] Delete `Ragdoll.snapRootTo` and the `snapRootTo` call in `reconcileTo` — nothing to
      snap.
- [ ] `RapierSimulation.replayLocalCharacter` no longer steps an articulated ragdoll per
      replayed tick (ADR 0013's flagged resimulation cost) — a replayed down-tick just
      advances the machine/holds state.
- [ ] Re-add the `isReplaying` / first-forward-sim gate deferred from ticket 08 for
      one-shot side effects, once there's a place it matters.
- [ ] **ADR** recording the decision.

## Explicitly NOT in this ticket

The *server's* ragdoll is unchanged — it stays a full authoritative 11-body sim, and it
is what every client (including the owning one) now interpolates. Ragdoll-vs-ragdoll
collision, `GettingUp` un-pinning from geometry, and the server profiling pass are all
still ticket-08 follow-ups, not this.

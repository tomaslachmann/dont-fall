# 05b — Extract a CharacterController from RapierSimulation

**What to build:** `RapierSimulation` has grown to ~25 fields and drives capsule
movement, jump/dash, the ragdoll handoff, checkpoints, Fall detection and
snapshot shaping all at once (flagged Large Class / Divergent Change in the
ticket-05 review). Pull the Character concern into its own `CharacterController`
that owns the capsule body, the state machine, jump/dash, the ragdoll and the
handoff, exposing `tick(inputs)` and `snapshot(): CharacterSnapshot`.
`RapierSimulation` keeps the world, statics, checkpoints and Fall detection and
composes the controller.

**Blocked by:** 05

**Status:** done

- [x] `CharacterController` owns capsule + `CharacterStateMachine` + `JumpController` + `DashController` + `Ragdoll` + the handoff transitions
- [x] `RapierSimulation` composes it; world / statics / checkpoints / kill-plane stay on the sim
- [x] All existing ticket 01–05 tests pass unchanged (behaviour identical)
- [x] The implicit ordering in `tick()` (prevState before machine.tick, settled before world.step, detectFall after position writes) is either enforced or documented at the seam
- [x] Not urgent — do it before ticket 06 piles more onto the class, or fold into ticket 07

**Seam:** Fall detection can't move into the controller — it needs the sim-owned
kill-plane — so it stays a handshake: the sim calls `controller.fall(respawnPoint,
fallCount)` when the kill-plane check trips, and reads `controller.hasPendingRespawn`
to avoid re-triggering while the respawn is queued. `controller.position` (the
kinematic body's translation, kept current even while ragdolling for camera
continuity) is what both Checkpoint and Fall detection read. The tick-ordering
invariants inside `CharacterController.tick()` are unchanged, comment and all.

Verified with the full `packages/shared` suite (74/74) plus `apps/client` and
`apps/server` (91/91 total), and `tsc --noEmit` clean across all three packages.
`/code-review` at medium found no findings — a faithful mechanical extraction.

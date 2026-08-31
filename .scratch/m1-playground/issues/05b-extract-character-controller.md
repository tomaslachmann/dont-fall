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

**Status:** ready-for-agent

- [ ] `CharacterController` owns capsule + `CharacterStateMachine` + `JumpController` + `DashController` + `Ragdoll` + the handoff transitions
- [ ] `RapierSimulation` composes it; world / statics / checkpoints / kill-plane stay on the sim
- [ ] All existing ticket 01–05 tests pass unchanged (behaviour identical)
- [ ] The implicit ordering in `tick()` (prevState before machine.tick, settled before world.step, detectFall after position writes) is either enforced or documented at the seam
- [ ] Not urgent — do it before ticket 06 piles more onto the class, or fold into ticket 07

# 03 — One `isDownMotionState`

**What to build:** Six copies of "is this Character down?" become one.

The predicate `motionState === "Ragdoll" || motionState === "GettingUp"` is written out six times
across the client and shared packages. It is trivial today and wrong the moment a seventh motion
state lands — which M5's eliminated-and-spectating state is likely to be.

**Blocked by:** None.

**Status:** done

- [x] One exported predicate in `packages/shared`, beside the motion state it tests —
      `isDownMotionState` in `CharacterStateMachine.ts`
- [x] All six call sites use it; the inline copies are gone — `CharacterController`,
      `RapierSimulation`, `reconcileGate`, `game.ts` (three separate inline copies), and `scene.ts`
      (three more)
- [x] No behaviour change — it is the same boolean

# 02 — Walk: kinematic capsule + WASD + camera

**What to build:** A Character you can walk around. The Character is a kinematic
capsule driven by Rapier's kinematic character controller, moved via WASD input
that flows through the shared 30 Hz sim step. A third-person spring-arm camera
follows the Character and shortens its arm on collision with geometry, with an
optional mouse orbit and a mostly-fixed pitch.

**Blocked by:** 01

**Status:** done

- [x] Rapier integrated into `packages/shared` (`@dimforge/rapier3d-compat`); same WASM module on client and server
- [x] Character is a kinematic capsule using Rapier's `KinematicCharacterController`
- [x] WASD movement applied inside `RapierSimulation.tick`, not the render loop
- [x] Third-person spring-arm camera follows the Character (`springArmPosition`)
- [x] Camera arm shortens against geometry via raycast (`resolveArm`)
- [x] Mouse-drag orbit; `PointerOrbit.pitch` clamped at the source
- [x] Movement stays smooth — `advanceFixed` carries `previousSnapshot` across frames
- [x] `Controlled` is the only Character motion state; movement input maps to it

**Note:** architecture set by ADR 0009 (`RapierSimulation` owns Rapier, `SimState`
is a POJO, `advanceFixed` drives a `FixedSimulation`). Camera-relative movement is
done here (`movementDirection(keys, cameraYaw)`). Pointer-lock free-look (mouse
move without drag) is a follow-up — see ticket 02b. Manual browser check of feel
still pending (extension offline).

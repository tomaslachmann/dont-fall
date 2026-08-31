# 02 — Walk: kinematic capsule + WASD + camera

**What to build:** A Character you can walk around. The Character is a kinematic
capsule driven by Rapier's kinematic character controller, moved via WASD input
that flows through the shared 30 Hz sim step. A third-person spring-arm camera
follows the Character and shortens its arm on collision with geometry, with an
optional mouse orbit and a mostly-fixed pitch.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Rapier integrated into `packages/shared`; same WASM module usable client-side
- [ ] Character is a kinematic capsule using Rapier's character controller
- [ ] WASD movement applied inside the sim step (not the render loop)
- [ ] Third-person spring-arm camera follows the Character
- [ ] Camera arm shortens against geometry (no clipping through walls/ground)
- [ ] Optional mouse orbit; pitch stays within a clamped range
- [ ] Movement stays smooth under render interpolation from ticket 01
- [ ] `Controlled` is the only Character state so far; movement input maps to it

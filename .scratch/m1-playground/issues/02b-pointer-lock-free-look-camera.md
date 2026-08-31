# 02b — Pointer-lock free-look camera

**What to build:** The camera is steered by raw mouse movement, not by dragging.
Clicking the canvas engages the Pointer Lock API (cursor hidden, `movementX/Y`
drives yaw/pitch continuously); pressing Esc or losing focus releases it and
shows a small "click to look around" prompt. Movement stays camera-relative
(already true — `movementDirection(keys, cameraYaw)`).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Clicking the canvas calls `requestPointerLock()`
- [ ] While locked, `pointermove` `movementX/Y` drives `PointerOrbit` yaw/pitch (no button held)
- [ ] `pointerlockchange` / `pointerlockerror` handled; Esc releases cleanly
- [ ] A minimal overlay prompt shown when not locked, hidden when locked
- [ ] Pitch stays clamped at the source (unchanged from ticket 02)
- [ ] Drag-orbit fallback removed or kept deliberately — decide and note

# 02b — Pointer-lock free-look camera

**What to build:** The camera is steered by raw mouse movement, not by dragging.
Clicking the canvas engages the Pointer Lock API (cursor hidden, `movementX/Y`
drives yaw/pitch continuously); pressing Esc or losing focus releases it and
shows a small "click to look around" prompt. Movement stays camera-relative
(already true — `movementDirection(keys, cameraYaw)`).

**Blocked by:** 02

**Status:** done

- [x] Clicking the canvas calls `requestPointerLock()` (`FreeLookCamera`)
- [x] While locked, `mousemove` `movementX/Y` drives yaw/pitch via `applyLook` (no button held)
- [x] `pointerlockchange` / `pointerlockerror` handled; Esc release observed via `pointerlockchange`
- [x] `#lock-prompt` overlay shown when unlocked, hidden when locked (toggled each frame)
- [x] Pitch clamped at the source inside `applyLook`
- [x] **Drag-orbit fallback removed** — one input model; re-add if pointer-lock proves annoying for testing

**Seam tested:** `applyLook(current, movementX, movementY)` — pure, 5 tests. Pointer-lock
wiring is manual browser verification.

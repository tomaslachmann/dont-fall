# 03 — Track builder: on-canvas drag gizmo (TransformControls), two-tier snap

**What to build:** A selected Segment gets an on-canvas move + rotate gizmo (Three.js
`TransformControls`) — drag to reposition or rotate with the mouse, snapping to the nearest
compatible Socket (position) or 15° (rotation) by default. Holding Shift doesn't remove snapping —
it switches to a finer tier (a 0.1-unit grid for position, 5° for rotation), so there is never a
reachable position or angle that isn't a clean, reproducible value.

**Blocked by:** 02 (reuses the same `trackEdit.ts` primitives and `manuallyPlaced` flag).

**Status:** ready-for-agent

- [ ] `TransformControls` attaches to the currently selected Segment with both translate and
      rotate handles.
- [ ] A translate drag snaps to the nearest compatible Socket within a snap radius by default; a
      rotate drag snaps to 15° increments by default.
- [ ] Holding Shift during a drag switches to the finer tier for that drag — a 0.1-unit position
      grid, or 5° rotation increments — instead of disabling snap.
- [ ] Dragging a Segment marks it `manuallyPlaced` (ticket 02's flag) exactly like the keyboard
      path does.
- [ ] Manually verified live (real browser): drag a Segment onto a neighboring Socket (default
      snap), drag another with Shift held and confirm it lands on the 0.1-unit grid rather than an
      arbitrary float; rotate one without Shift and confirm it lands on a 15° increment, rotate
      another with Shift held and confirm it lands on a 5° increment.

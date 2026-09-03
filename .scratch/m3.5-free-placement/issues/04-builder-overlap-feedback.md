# 04 — Track builder: live overlap ghost-feedback

**What to build:** While placing or dragging a Segment, its footprint is checked against every
other Segment's footprint in real time — the piece renders as a red "ghost" while overlapping,
green when clear. Purely a live authoring aid; it never blocks a save.

**Blocked by:** 01 (needs the OBB overlap primitive), 02 (needs a move mechanism to be demoable).

**Status:** done

- [x] A pure overlap-check function (built on ticket 01's OBB primitive) reports whether a given
      Segment's Footprint overlaps any other Segment's.
- [x] The Segment currently being moved/dragged renders with a visual overlap state (red while
      overlapping anything, green otherwise), updated live as it moves.
- [x] Overlap feedback is purely visual — saving/publishing an overlapping Track is unaffected
      (ADR 0033/0034: manual Test Mode is the actual safety net, not a save-time gate).
- [x] Manually verified live (real browser): drag a Segment into another's footprint and confirm it
      renders red; drag it clear and confirm it renders green; save an overlapping Track and
      confirm the save still succeeds.

## Implementation notes

- **`inflateBox`/`obbsOverlap` in `packages/shared/src/math/box.ts`** — the OBB overlap primitive.
  `obbsOverlap` is the textbook 15-axis Separating Axis Theorem test for two arbitrarily-rotated
  boxes (Ericson, *Real-Time Collision Detection* §4.4.1): each box's own 3 face normals, plus the 9
  axes formed by every pair of the two boxes' edge directions, with the standard epsilon guard
  against the near-parallel-edge-cross-product failure mode. Inclusive at exact contact, matching
  `pointInBox`'s existing convention. `inflateBox` grows an `OrientedBox`'s half-extents by a fixed
  amount on every axis (a Footprint's `clearance`) before the overlap test — `clearance` existed in
  the `Footprint` type since ticket 01 but had zero consumers anywhere until this ticket.
- **`segmentOverlapsAnyOther` in `apps/track-builder/src/trackEdit.ts`** — the Track-aware wrapper:
  given a Segment's *candidate* position/orientation (a live drag's in-progress transform, not
  necessarily its currently-committed one), builds its inflated Footprint box and SAT-tests it
  against every other Segment's own inflated Footprint box.
- **Deliberately excludes the Segment's own immediate chain neighbors** (`index - 1`, `index + 1`)
  from the check. Every Module's Footprint is sized to reach exactly its own Socket boundary, so two
  correctly-connected adjacent Segments *always* touch there by construction — without this
  exclusion, every normal, correctly-chained Track would show its Segments permanently red. Same
  "the Track's own two natural connection points are special" scoping ticket 03's
  `snapPositionToNeighborSocket` already established; this ticket reapplies it for a different
  purpose (overlap, not snapping).
- **Live ghost mesh in `apps/track-builder/src/viewport.ts`**: a separate translucent
  `THREE.Mesh` (`MeshBasicMaterial`, red `0xef4444` / green `0x22c55e`, `opacity: 0.35`) sized and
  posed from the dragged Segment's own inflated Footprint box on every `TransformControls`
  `objectChange` event — a dedicated mesh rather than recoloring the Segment's own materials, so
  nothing about its actual geometry/materials needs saving and restoring around a drag. Wired into
  both translate and rotate modes (the `objectChange` listener doesn't care which), shown at
  drag-start (`dragging-changed` → `true`) and hidden at drag-end/commit, so it's only ever visible
  during an active drag.
- **No save-time gate** — `segmentOverlapsAnyOther` is only ever called from the live-drag ghost
  path; `saveTrack`/the track-service validation added in ticket 09 of the M3 round is untouched by
  this ticket, exactly as ADR 0033/0034 call for (manual Test Mode is the real safety net).

## Manual verification (real browser)

No Playwright/chromium-cli available in this environment (no network access to install either), so
this drove a real headless Chrome via the raw Chrome DevTools Protocol (`ws` package), same approach
as tickets 02/03 — real pixel-coordinate `Input.dispatchMouseEvent` press/move/release sequences on
the actual rendered translate gizmo, not simulated events. Two temporary `window.__debug*` hooks
(removed before this commit) exposed `history`/`select`/`setGizmoMode` for test-track setup and the
overlap ghost mesh's material/`TransformControls` for ground-truth reads.

Built a 5-Segment Track where the dragged Segment sits at the array's middle index (so the default
camera frames it) with a stationary target Segment 2 slots away (non-adjacent, so the neighbor
exclusion doesn't hide the overlap) and 3 filler Segments parked out of frame. Verified, against the
real running app:
- Selected the middle Segment; a real mousedown on the gizmo's red arrow correctly grabbed the X
  axis (`transformControls.axis === "X"`).
- Dragged it via real mouse-move events until its world position (`x≈2.04`) landed inside the
  target's inflated Footprint — the ghost mesh turned red (`#ef4444`), confirmed both by reading the
  material's color directly and visually in a captured screenshot.
- Continued dragging clear — the ghost turned back green (`#22c55e`), confirmed the same way.
- Released the drag — the ghost hid immediately (`visible: false`) and the commit landed in
  `history.track` at the released position, exactly matching every other gizmo-drag commit (tickets
  02/03's existing path, untouched by this ticket).
- Force-set an overlapping Track (two Segments sharing nearly the same position) directly and clicked
  **Save** for real — the request succeeded (`saved as "<uuid>"`), confirming an overlapping Track is
  never save-blocked.

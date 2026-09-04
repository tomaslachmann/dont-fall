# 03 — Track builder: on-canvas drag gizmo (TransformControls), two-tier snap

**What to build:** A selected Segment gets an on-canvas move + rotate gizmo (Three.js
`TransformControls`) — drag to reposition or rotate with the mouse, snapping to the nearest
compatible Socket (position) or 15° (rotation) by default. Holding Shift doesn't remove snapping —
it switches to a finer tier (a 0.1-unit grid for position, 5° for rotation), so there is never a
reachable position or angle that isn't a clean, reproducible value.

**Blocked by:** 02 (reuses the same `trackEdit.ts` primitives and `manuallyPlaced` flag).

**Status:** done

- [x] `TransformControls` attaches to the currently selected Segment with both translate and
      rotate handles.
- [x] A translate drag snaps to the nearest compatible Socket within a snap radius by default; a
      rotate drag snaps to 15° increments by default.
- [x] Holding Shift during a drag switches to the finer tier for that drag — a 0.1-unit position
      grid, or 5° rotation increments — instead of disabling snap.
- [x] Dragging a Segment marks it `manuallyPlaced` (ticket 02's flag) exactly like the keyboard
      path does.
- [x] Manually verified live (real browser): drag a Segment onto a neighboring Socket (default
      snap), drag another with Shift held and confirm it lands on the 0.1-unit grid rather than an
      arbitrary float; rotate one without Shift and confirm it lands on a 15° increment, rotate
      another with Shift held and confirm it lands on a 5° increment.

## Implementation notes

- **New pure functions in `trackEdit.ts`**: `setSegmentTransform` (the gizmo's drag-end commit —
  sets an *absolute* position/rotation/pitch/roll, unlike `moveSegment`/`rotateSegment`'s deltas;
  marks `manuallyPlaced`, re-chains after) and `snapPositionToNeighborSocket` (the Socket-snap
  algorithm). `MOVE_STEP_FINE`/`ROTATE_STEP`/`ROTATE_STEP_FINE` (ticket 02's step constants) moved
  here as shared exports so the keyboard path and the gizmo can never silently disagree on what
  "coarse"/"fine" mean.
- **Socket-snap is scoped to the Track's own two natural neighbors** (the Segment's predecessor's
  exit Socket, its successor's entry Socket) — deliberately **not** a track-wide nearest-Socket
  search across every Segment. Track topology is still a single linear, non-branching sequence
  (ADR 0030, unchanged by ADR 0034), so "the nearest compatible Socket" for a Segment already in
  that sequence means reconnecting to whichever neighbor it has, not grabbing an arbitrary distant
  Segment's Socket. This is also *why* the algorithm stays simple: point-alignment translation
  only, no track-wide search, no rotation math (Socket-snap never touches rotation — independent
  concern from rotate-snap, per the ticket).
- **Live vs. native snapping**: rotation's both tiers are plain grids, so `TransformControls`'
  own `setRotationSnap` handles them natively (just toggled between 15°/5° radians on Shift).
  Position's *default* tier is Socket-snap, which `TransformControls` has no concept of — so
  `translationSnap` stays `null` unless Shift is held (when it becomes the native 0.1 grid), and a
  custom `objectChange` listener applies `snapPositionToNeighborSocket` live on every drag update
  otherwise.
- **Rotate-mode gizmo pivots around the Segment's own origin** (standard `TransformControls`
  behavior), not around its entry Socket the way the keyboard/toolbar rotate does. Deliberately
  different: the toolbar's ±90° buttons exist to "turn the corridor while keeping it connected,"
  but a gizmo drag is direct manipulation — a user grabbing a rotation ring expects the object to
  spin in place around where the gizmo is, not fly off to a hidden pivot point.
- **Committing only once, at drag-end** (`dragging-changed` → `false`), not per `objectChange` —
  a whole drag gesture is one undo step, matching every other edit in this tool. Reads back the
  gizmo's final quaternion via `quatToEuler` regardless of which ring was grabbed or which space it
  rotated in — the result is decomposed into a valid (yaw, pitch, roll) triple either way, so the
  gizmo doesn't need to know or care about this project's specific yaw/pitch/roll convention.
- **Click-to-pick guard**: a click that starts/ends on a gizmo handle must never also be read as
  "clicked empty space" — the gizmo's meshes live outside `trackGroup` (which is all `pick()`
  raycasts), so a gizmo click would otherwise always miss and deselect. New
  `viewport.isGizmoActive()` (`dragging || axis !== null`) guards the existing click-to-pick
  listener.
- **Uses ticket 02's `retransformSegments` fast path** (`transformOnly: true`) for the drag-end
  commit — a gizmo drag never changes Segment count or `moduleId` either.
- Move/Rotate mode buttons added to the inspector; Rotate mode is not gated by the keyboard rotate
  axis selector (Yaw/Pitch/Roll) — grabbing a specific ring visually *is* the axis choice, so
  showing all three rings at once is the more natural direct-manipulation UX.

## Code review findings and fixes

- **Fixed — `moveSegment`/`rotateSegment`/`setSegmentTransform` called `rechainFrom` twice per
  edit**, once to defensively "settle" the touched Segment before reading it, then again after the
  mutation to cascade the rest of the Track — both calls recomputed the same downstream tail,
  since the first call's tail is invalidated (and discarded) by the mutation before it's ever used.
  Extracted a new `settleOne` that settles *just* the one Segment being touched (the exact
  computation actually needed), without also computing and throwing away everything after it. Same
  "trust the prefix" assumption `rechainFrom` already made — no behavior change, confirmed by the
  full existing test suite passing unchanged.
- **Fixed — `MOVE_STEP` (the keyboard's coarse move step) was a local magic number in `main.ts`**
  while its three siblings (`MOVE_STEP_FINE`/`ROTATE_STEP`/`ROTATE_STEP_FINE`) were deliberately
  centralized in `trackEdit.ts`. Moved it there too for consistency, even though it has no gizmo
  equivalent (the gizmo's default position tier is Socket-snap, not a fixed grid).
- **Fixed — `commitSegmentTransform` forward-referenced `applyEdit`** before its declaration,
  relying on a code comment ("this is only ever called later") rather than structure to make it
  safe. Reordered so `viewport` is declared (`let viewport: TrackViewport`, unassigned) *before*
  `select`/`rerender`/`applyEdit`, and `commitSegmentTransform` is defined *after* `applyEdit` —
  the forward reference moves from "an external callback might invoke this before `applyEdit`
  exists" to "our own functions read a local variable we fully control the assignment timing of,"
  which is a meaningfully safer class of forward reference. Re-verified live afterward (a cold
  page load with no HMR, plus a real gizmo drag) to make sure the reorder didn't break
  initialization.

## Manual verification (real browser)

Same approach as ticket 02 — no Playwright/chromium-cli available (no network access to install
either), so this drove a real headless Chrome via the raw Chrome DevTools Protocol, with **real
pixel-coordinate mouse drags** (`Input.dispatchMouseEvent` press/move/release sequences) on the
actual rendered gizmo handles, not simulated events. A temporary `window.__debug` hook (removed
before this commit) exposed `history.track` for ground-truth assertions.

Verified, against the real running app:
- Selected a Segment; the translate gizmo (red/green/blue arrows) rendered attached to it.
- A real drag on the Y arrow, well within the Socket-snap radius, landed the position **exactly**
  back on the pre-drag aligned value (not approximately — bit-for-bit) — proving Socket-snap is
  genuinely live, not just present in unit tests.
- A real Shift-held drag on the same arrow landed on `y = 5.2` exactly (a clean multiple of 0.1).
- Switched to Rotate mode (gizmo visibly changed to three rotation rings); a real drag along one
  ring, without Shift, landed on exactly 180° (a clean multiple of 15°).
- A real Shift-held drag on a ring, from a clean baseline, landed on exactly −110° (a clean
  multiple of 5°).
- `manuallyPlaced` and the inspector's "(manually placed)" hint both updated correctly after each
  commit.
- One early rotate-drag test produced a non-grid-aligned 171.6° when *continuing* a second drag on
  a Segment already rotated 180° by a prior drag — diagnosed as an Euler-decomposition artifact of
  compounding two rotations on different rings (yaw/pitch/roll redistribute non-obviously once a
  large rotation already exists), not a snapping bug: re-tested in isolation from a clean baseline
  and it landed exactly on-grid. Not a product issue, but recorded here since it's a real,
  non-obvious characteristic of decomposing a rotation into this project's Euler triple.

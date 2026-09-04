# 05 — Track builder: multi-select move/rotate

**What to build:** Select multiple placed Segments at once and move or rotate them together as a
rigid group through the same gizmo.

**Blocked by:** 03 (extends the gizmo interaction to a selection set).

**Status:** done

- [x] A second Segment can be added to the current selection (e.g. shift-click or an equivalent)
      without deselecting the first.
- [x] The gizmo, when a multi-Segment selection is active, moves/rotates every selected Segment
      together, preserving their relative offsets.
- [x] Every Segment moved this way is individually flagged `manuallyPlaced` (ticket 02's flag)
      exactly as a single-Segment drag would.
- [x] Manually verified live (real browser): select two non-adjacent Segments, drag/rotate them
      together, confirm both moved as a rigid group and both survive an unrelated upstream edit
      afterward.

## Implementation notes

- **`setSegmentTransforms` in `apps/track-builder/src/trackEdit.ts`** — the batched form of
  ticket 03's `setSegmentTransform`. Implemented as a plain `reduce` over the single-Segment
  function rather than a new algorithm: every update already carries its own final absolute
  transform (computed live by the caller from the dragged pivot's offset), so there's nothing
  about "doing several at once" that isn't just "do each one, in turn." Each fold step still runs
  its own `rechainFrom`, which is what makes the "later manually-placed Segment among the updates
  survives" test in `trackEdit.test.ts` meaningful — each update's own `manuallyPlaced: true` is
  already in place before the next update's cascade runs.
- **`selectedIndices: Set<number>` replaces the single `selectedIndex` in `main.ts`.** Every
  single-target action (rotate ±90° buttons, duplicate, delete, keyboard nudge/rotate, the module
  palette's insert-after-selection) still operates on one Segment — `primaryIndex()` (the most
  recently clicked/toggled entry, via `Set`'s insertion-order iteration) — deliberately **not**
  extended to the whole selection. The ticket asks for the *gizmo* to move a group; nothing else in
  the ticket's acceptance criteria mentions keyboard nudge or the toolbar buttons acting on a group,
  and extending every one of those inputs to "act on N Segments" wasn't asked for and would have
  meant deciding a lot of unstated semantics (e.g. what a keyboard nudge on a rotated multi-selection
  even means) with no acceptance criterion to check it against.
- **Shift-click toggles membership** (`toggleSelect`) instead of replacing the selection; a plain
  click still replaces it entirely (`select`), matching the ticket's example UX ("shift-click or an
  equivalent").
- **The multi-select gizmo drives a synthetic pivot, not any one Segment**, in
  `apps/track-builder/src/viewport.ts`. `TransformControls` can only ever attach to one
  `Object3D`, so a rigid-group move/rotate needs something else to drive. `setSelected` anchors an
  invisible `pivotObject` at the *first* selected Segment's current transform and records every
  selected Segment's transform *relative* to that pivot (`multiOffsets`); a new `objectChange`
  listener reproduces those offsets onto each selected Segment's own group live, on every drag
  update, whenever the pivot (not a single Segment) is what's attached. The single-Segment path
  (ticket 03) is untouched — `setSelected` still attaches the gizmo directly to that one Segment's
  group when there's only one, with no pivot involved at all.
- **The group rotates around the first-selected Segment's own origin** — an arbitrary but
  well-defined and simple choice; the ticket doesn't specify a pivot point, and "the Segment you
  selected first" is at least a legible, reproducible answer to "rotate around what."
- **Socket-snap and the ticket 04 overlap ghost are single-Segment only**, gated on
  `attachedIndices.length === 1`, hidden/skipped otherwise. Neither has an unambiguous multi-Segment
  meaning the ticket asks for (Socket-snap would have to pick which of several selected Segments'
  Sockets to chase; `segmentOverlapsAnyOther` is itself a single-Segment primitive), and extending
  either wasn't part of this ticket's scope.
- **The drag-end commit is unified for both paths**: `dragging-changed` → `false` now always builds
  an array of `{index, transform}` (length 1 for a single-Segment drag, N for a group) by reading
  each selected Segment's own Three.js group directly — for a single-Segment drag that group *is*
  `transformControls.object`, so the values are identical to before; for a group drag, every
  selected group was already kept live-updated by the pivot-propagation listener. One
  `onSegmentTransformCommit` call, so a multi-Segment drag is still a single undo step
  (`main.ts`'s `commitSegmentTransforms` does one `history.apply`).

## Code review findings and fixes

- **Fixed — selection-highlight `BoxHelper`s were removed from the scene but never disposed.**
  Before this ticket there was one long-lived, reused `selectionBox` (only `.visible` toggled); this
  ticket replaced it with a fresh `BoxHelper` per selected Segment on every `setSelected`/`setTrack`
  call, but only called `scene.remove(box)`, leaking a GPU geometry+material buffer on every
  selection change (a normal editing session clicking through several Segments would accumulate
  orphaned buffers indefinitely). Added a `clearSelectionBoxes()` helper that also calls the
  Helper's own `box.dispose()` (which frees both), used everywhere boxes are replaced or the
  viewport itself is disposed.
- **Fixed — `findGroup` was an O(track length) linear scan**, now called up to once per selected
  Segment on every pointer-move frame of a multi-select drag (previously at most once per
  interaction). Replaced the scan with a `groupByIndex: Map<number, Object3D>` rebuilt alongside
  `trackGroup` in `setTrack`, making every lookup O(1).
- **Fixed — `setSegmentTransforms`/`setSegmentTransform`'s transform shape was redeclared inline**
  instead of reusing `viewport.ts`'s existing `SegmentTransform` type, so the two could silently
  drift apart if either ever grew a field. Moved the canonical `SegmentTransform` interface into
  `trackEdit.ts` (the shape's actual origin — what these two functions set) and had `viewport.ts`
  import and re-export it, rather than the other way around, since `viewport.ts` already imports
  from `trackEdit.ts` and the reverse would be circular.

Re-verified live afterward (a fresh headless-Chrome run of the exact same multi-select drag
scenario below) to confirm none of the three fixes changed behavior — identical positions,
identical rigid-offset preservation, identical survival of the unrelated upstream edit.

## Manual verification (real browser)

No Playwright/chromium-cli available in this environment (no network access to install either), so
this drove a real headless Chrome via the raw Chrome DevTools Protocol (`ws` package), same approach
as tickets 02/03/04 — a real pixel-coordinate `Input.dispatchMouseEvent` drag on the actual rendered
gizmo arm, not simulated events, for the substantive part (the group drag itself). Two temporary
`window.__debug*` hooks (removed before this commit) exposed `history`/`select`/`toggleSelect` for
test-track setup/selection and each Segment's live Three.js group/the `TransformControls` instance
for ground-truth reads — selection itself (a one-line `Set` toggle) wasn't the part worth spending a
blind pixel-hunt on; the drag was.

Built a 5-Segment Track with two non-adjacent "start" Segments (index 2 and index 4, 18 units apart
on X) and three filler Segments parked out of frame. Verified, against the real running app:
- `select(2)` then `toggleSelect(4)` produced a selection box around **both** Segments and an
  inspector reading `#4 start (manually placed) (+1 more selected)` — confirmed in a captured
  screenshot.
- The gizmo attached to the pivot (`transformControls.object === pivotObject`), not either Segment
  directly.
- A real mousedown correctly grabbed the pivot's X axis; dragging it moved **both** Segments' groups
  together — read live mid-drag, their X positions differed by exactly `18` throughout the drag
  (`17.83 − (−0.17) = 18`, matching their original 18-unit separation to full float precision) —
  confirmed both numerically and visually in a screenshot showing both selection boxes having moved
  together.
- On release, both committed to `history.track` with `manuallyPlaced: true` and the exact dragged
  positions.
- Selected filler Segment 1 (upstream of both, in array order) and clicked the real **Rotate-left**
  toolbar button — the resulting `rotateSegment` re-chain runs from index 2 onward, and both
  Segment 2 and Segment 4 came through **byte-for-byte identical** to their post-drag committed
  values, confirming the "survives an unrelated upstream edit" requirement.

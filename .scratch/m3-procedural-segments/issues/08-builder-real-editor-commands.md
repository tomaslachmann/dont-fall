# 08 — Track builder: real editor (select/move/rotate/delete-any/duplicate/undo)

**What to build:** Replace "click a palette entry to append at the end, remove only the last" with
a real command-pattern editor (ADR 0031, `docs/track-builder-proposal.md` §11.3): select any
placed Segment, move it (re-snapping via Sockets), rotate it in 90° steps, delete any Segment (not
just the last), duplicate a Segment, and undo/redo every action. `EditorCommand` (`execute`/`undo`)
is the shared mechanism all of these go through.

**Blocked by:** 07 (needs Sockets to compute valid re-placement after a move/insert).

**Status:** done

- [x] **Scope deviation, deliberate:** built as pure edit functions (`trackEdit.ts`:
      `insertSegment`/`deleteSegment`/`duplicateSegment`/`rotateSegment`/`rechainFrom`) plus a
      plain snapshot-stack `TrackHistory` (undo/redo), not per-operation `EditorCommand` classes
      with their own `execute`/`undo` inversion logic. A Track here is a handful of Segments, not
      thousands — snapshotting the whole array per edit has no real cost, and is simpler/less
      bug-prone than hand-inverting each operation. `docs/track-builder-proposal.md`'s
      command-object pattern solves problems (large history, collaboration, diffing revisions)
      this tool doesn't have; reach for it if one becomes real. No separate "Move" command either
      — with Sockets, "move" only makes sense as reordering/rotating within the chain, which
      insert+delete+rotate already cover; free XYZ dragging isn't meaningful for a sequential
      socket-chained Track
- [x] `rechainFrom` is the one operation every edit reduces to: re-derive Segment positions/
      rotations from some index onward via `placeAfter`, so delete/insert/duplicate/rotate can't
      leave a gap or a stale position behind
- [x] Selecting a placed Segment (click-to-raycast in the 3D overview, `viewport.ts`'s new
      `pick`/`setSelected`) highlights it (`THREE.BoxHelper`) and shows an inspector panel
      (Module id + index, Rotate/Duplicate/Delete buttons)
- [x] Move/rotate/delete/duplicate/insert all work on the selected Segment, not just the last —
      clicking a palette entry inserts right after the current selection (or appends if nothing
      is selected)
- [x] Rotate is a fixed ±90° step (two buttons), never an arbitrary angle
- [x] Manually verified live in a real browser (Playwright + Chromium): built a 3-Segment Track,
      selected a Segment, rotated it (screenshot confirms the visual rotation — its wall feature
      moved to a different corner), duplicated it (4 Segments), deleted the duplicate (3), undid
      3 steps back to the freshly-built state, redid 1. Zero console errors
- [x] **Found and fixed a real bug via this browser verification**: the inspector panel is a DOM
      child of `#viewport` (positioned over the canvas), so its own button clicks bubbled up to
      the viewport's click-to-pick/deselect listener, immediately deselecting whatever the button
      had just acted on. Fixed by ignoring clicks whose target isn't the canvas itself

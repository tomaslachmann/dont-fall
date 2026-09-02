# 05 — Track builder: multi-select move/rotate

**What to build:** Select multiple placed Segments at once and move or rotate them together as a
rigid group through the same gizmo.

**Blocked by:** 03 (extends the gizmo interaction to a selection set).

**Status:** ready-for-agent

- [ ] A second Segment can be added to the current selection (e.g. shift-click or an equivalent)
      without deselecting the first.
- [ ] The gizmo, when a multi-Segment selection is active, moves/rotates every selected Segment
      together, preserving their relative offsets.
- [ ] Every Segment moved this way is individually flagged `manuallyPlaced` (ticket 02's flag)
      exactly as a single-Segment drag would be.
- [ ] Manually verified live (real browser): select two non-adjacent Segments, drag/rotate them
      together, confirm both moved as a rigid group and both survive an unrelated upstream edit
      afterward.

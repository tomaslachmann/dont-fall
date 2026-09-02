# 02 — Track builder: keyboard move/rotate + manually placed Segments survive edits

**What to build:** Select a placed Segment and reposition/rotate it with the keyboard — arrow keys
nudge position, a rotate step (e.g. bracket or Q/E keys) turns it in 15° increments on any axis.
Holding Shift switches both to a finer step (a 0.1-unit grid for position, 5° for rotation) —
never a fully unconstrained value, same two-tier snap ticket 03's gizmo uses. The moment a Segment
is touched this way it's flagged as manually placed and exempt from the existing `rechainFrom`
auto-recompute, so editing something earlier in the sequence no longer silently resets it.

**Blocked by:** 01 (needs the 3D rotation primitives to expose pitch/roll via keyboard).

**Status:** ready-for-agent

- [ ] Arrow-key nudge moves the selected Segment's position by a fixed step per keypress (held for
      repeat); the same keys held with Shift move by the finer 0.1-unit step instead.
- [ ] A keyboard rotate step turns the selected Segment by 15° per press, on whichever axis is
      active; held with Shift, it turns by 5° per press instead.
- [ ] `trackEdit.ts` gains a pure function that sets a Segment's position/rotation directly
      (bypassing `rechainFrom`'s chain-derivation) and marks it `manuallyPlaced` (or equivalent).
- [ ] `rechainFrom` skips any Segment flagged `manuallyPlaced` when cascading from an earlier edit
      — a Segment that's never been touched still auto-follows its predecessor exactly as today.
- [ ] Manually verified live (real browser): build a 3+ Segment Track, manually nudge/rotate the
      last Segment away from the chain via keyboard, insert a new Segment near the start, confirm
      the manually-placed Segment's position/rotation is unchanged. Undo/redo still works across
      these new operations.

# 04 — Track builder: live overlap ghost-feedback

**What to build:** While placing or dragging a Segment, its footprint is checked against every
other Segment's footprint in real time — the piece renders as a red "ghost" while overlapping,
green when clear. Purely a live authoring aid; it never blocks a save.

**Blocked by:** 01 (needs the OBB overlap primitive), 02 (needs a move mechanism to be demoable).

**Status:** ready-for-agent

- [ ] A pure overlap-check function (built on ticket 01's OBB primitive) reports whether a given
      Segment's Footprint overlaps any other Segment's.
- [ ] The Segment currently being moved/dragged renders with a visual overlap state (red while
      overlapping anything, green otherwise), updated live as it moves.
- [ ] Overlap feedback is purely visual — saving/publishing an overlapping Track is unaffected
      (ADR 0033/0034: manual Test Mode is the actual safety net, not a save-time gate).
- [ ] Manually verified live (real browser): drag a Segment into another's footprint and confirm it
      renders red; drag it clear and confirm it renders green; save an overlapping Track and
      confirm the save still succeeds.

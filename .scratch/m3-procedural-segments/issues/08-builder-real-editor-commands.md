# 08 — Track builder: real editor (select/move/rotate/delete-any/duplicate/undo)

**What to build:** Replace "click a palette entry to append at the end, remove only the last" with
a real command-pattern editor (ADR 0031, `docs/track-builder-proposal.md` §11.3): select any
placed Segment, move it (re-snapping via Sockets), rotate it in 90° steps, delete any Segment (not
just the last), duplicate a Segment, and undo/redo every action. `EditorCommand` (`execute`/`undo`)
is the shared mechanism all of these go through.

**Blocked by:** 07 (needs Sockets to compute valid re-placement after a move/insert).

**Status:** ready-for-agent

- [ ] `EditorCommand` interface + `PlaceSegmentCommand`/`DeleteSegmentCommand`/`MoveSegmentCommand`/
      `RotateSegmentCommand`/`DuplicateSegmentCommand`, each with `execute`/`undo`
- [ ] A command history (undo/redo) driving all Track mutation — no more direct
      `currentTrack = ...` mutation outside a command
- [ ] Selecting a placed Segment in the 3D overview highlights it and shows it in a simple
      inspector (which Module, its position/rotation)
- [ ] Move/rotate/delete/duplicate work on the selected Segment, not just the last one
- [ ] Rotate is constrained to 90° steps (ties to ADR 0031's collider-alignment invariant)
- [ ] Manually verified live in a real browser: build a short Track, delete a middle Segment,
      rotate one, duplicate one, undo back through all of it

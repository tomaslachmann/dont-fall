# 09 — Scale a Segment, simply

**What to build:** a uniform `Segment.scale` (ADR 0062) through the simulation,
chaining, the client and the builder — with quick buttons, a number and a
snapping Scale gizmo mode.

**Blocked by:** nothing.

**Status:** done (2026-09-15) — tests and typecheck; the live check is the user's.

## Decisions (user, 2026-09-15)

- Uniform, the whole piece (one number).
- Controls: quick buttons (½× … 3×, − / +), an exact number, and dragging a
  Scale gizmo that snaps (Shift finer).

## What to change

- [x] Shared: `Segment.scale`, bounds in tuning, validation; `resolveTrack`,
      `placeAfter`, `trackSpawn`, Moving Segment pose honour it
- [x] API validation
- [x] Client asset visuals and Moving Segment visuals scaled
- [x] Builder: group scale, overlap/snap/rotate/beside maths, `setSegmentScale`,
      inspector controls, Scale gizmo mode with snap, Motion speeds × scale
- [x] Tests at every layer

## Notes

- Scale wraps the Motion (ADR 0062): the Motion panel's sentences, strip and the
  viewport path multiply speeds by it; pivots and presets stay in the file's units.
- Controls: size presets ½× 1× 1½× 2× 3×, − / + (step 0.25, Shift 0.05), the exact
  number, the − and = keys, and a Scale gizmo mode that scales uniformly whichever
  handle is dragged, snapping to the same steps. A multi-selection doesn't scale.
- Spawn: only the height follows a scaled first piece; Players keep their spacing.

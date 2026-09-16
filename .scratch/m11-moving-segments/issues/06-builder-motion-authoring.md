# 06 — Builder: author a Motion and play it

**What to build:** the inspector edits the selected Segment's Spin / Swing /
Slide; the viewport plays every Motion live from `motionPose`, with
play/pause and a time scrubber.

**Blocked by:** 01 (independent of the physics tickets).

**Status:** done (2026-09-15) — tests and typecheck; the live check in the builder is the user's.

## What to change

- [x] Inspector Motion panel: per kind on/off, axis preset, pivot preset
      (base / centre / top) or offset, speed / amplitude / offset, period,
      easing, pauses, phase; edits are undoable Track edits
- [x] Viewport: moving Segments posed each frame from a builder clock; play,
      pause, scrub; the gizmo still edits the rest pose
- [x] Save / load / Playtest carry `motion` end to end
- [x] Tests for the pure edit functions; live check in the builder is the user's

## Notes

- `buildSegmentGroup` is now placement group → Motion node → content: the gizmo
  edits the rest placement while the piece animates inside it.
- Fixed on the way: re-chaining (`rechainFrom`/`settleOne` via `placeAfter`)
  stripped a Segment's Motion after any upstream edit; Duplicate dropped it.
- Pivot presets (centre/base/top/±x end/±z end) come off the Footprint; x/y/z
  stay editable for anything else.
- Open: the simulation's Motion clock is the server Tick, not time since the
  Round started, so a Round starts at whatever phase the server is at. Relative
  timing between Segments is exact. Anchoring Motion to Round start is a
  follow-up decision (it would change ADR 0061's "pure function of the Tick").

## Follow-up: the one-click layer (user, 2026-09-15)

Asked for Spin (and so Swing) to be "as idiot-proof as it gets, but keep what's
there". Built on top of the existing fields, which stay the truth and stay
editable — every one-click control writes into them and emits one undoable edit:

- [x] Shapes that switch the kind on and set axis + pivot at once — Spin:
      Carousel, Arm, Drum ↕, Drum ↔; Swing: Pendulum, Hammer, Seesaw — sized off
      the piece's Footprint (length = its longer horizontal side)
- [x] A 3 × 3 top-down pivot grid (corners, side middles, centre; ▲ = front,
      the Track's −Z) that moves the pivot across the piece and keeps its height
- [x] Spin direction buttons ⟲ ccw / ⟳ cw (the speed's sign), titled with the
      side they're seen from
- [x] The active shape, grid cell and direction light up
- [x] Viewport guide for the selected Segment: pivot dot + axis line (Spin
      orange, Swing purple), an arrow along a Slide; drawn through geometry
- [x] Tests: `motionForm.test.ts` (grid, shapes, shape matching)

## Follow-up: pivots off the model's parts (user, 2026-09-15)

`trap_trapcircleblue` would not spin about its wooden post: it is two meshes —
an upright at z ≈ 0.65 and an arm along −z — and every pivot preset read the
whole Footprint (`+z end` is the post's outer face, Arm took the arm's tip).

- [x] `templateParts`: one box per mesh of an asset template, in the Module frame
- [x] `findPost`: a part resting on the base and taller than wide; Arm sweeps
      about it when present (sweeper-style `trap_trapcircle*`), else the front end
- [x] `🎯 pick` beside each pivot grid: the next click on the selected piece puts
      the pivot at the clicked part's centre (Esc cancels)
- [x] Tests: `findPost` and Arm on measured sweeper bounds; `templateParts`

Not possible yet: keeping one part still while another moves (a roller turning
about its own axis while its post stays) — a Motion moves the whole Segment.
That would need Assets split into parts, a new decision.

## Follow-up: the picture layer (user, 2026-09-15)

The user asked for easing, "what state it's in now" and the rest to be visual,
and left the choice to research: `docs/research/motion-authoring-visual-aids.md`
(novice tools show a shape or the motion itself, never the maths; none shows
danger over time, so everything reuses the Impact tint's colours). All four of
its recommendations built, existing fields kept (easing dropdown included):

- [x] A plain-language sentence per kind (`describeSpin/Swing/Slide`): timings,
      fastest speed and its outcome, phase in seconds; bordered in the outcome colour
- [x] Easing as four drawn-curve buttons with a one-line hint (`EASING_HINTS`)
- [x] A one-cycle timing strip for Swing/Slide: the eased travel, holds shaded,
      coloured by outcome, a live playhead on the transport clock, drag to scrub
- [x] Viewport guide: the fastest corner's path over one cycle coloured by
      outcome (`motionPath`), and see-through copies at a Swing's extremes and a
      Slide's far end (the copies are our own idea — not in any researched tool)
- [x] Tests: `motionPreview.test.ts` (speeds/outcomes, cycle sampling, playhead
      maths, sentences, path)

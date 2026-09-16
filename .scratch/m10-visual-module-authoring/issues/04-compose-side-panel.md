# 04 — Compose side panel

**What to build:** The compose mode's property panel: primitive picker
(box/cylinder), corner-radius slider, color picker (+ Fall Guys pastel
presets), cylinder axis switch — and Socket/footprint editing, so a Module
leaves the mode placeable without code.

**Blocked by:** 03 (the panel edits the draft that ticket's mode owns).

**Status:** planned.

## Why

Gizmos place geometry; everything else about a Module (which primitive,
how round, what color, where it connects) needs a home, or authoring falls
back to hand-editing the export — the blind step this milestone exists to
kill.

## What to change

- [ ] Panel bound to the selected primitive: kind switch (box ↔ cylinder,
      sane dimension carry-over), radius slider (0 … half of shortest side,
      hidden for cylinders), color picker + pastel preset swatches, axis
      switch for cylinders, surface picker (the existing ids, not free text)
- [ ] Module-level defaults in the panel: `cornerRadius`, `color`, `surface`
      — the values per-primitive fields override
- [ ] Socket/footprint editing without code — ticket decides the UX: drag
      Socket markers in the viewport (mirroring trigger markers) vs. derive
      entry/exit from footprint faces by convention (cf. `deckModule` in
      `assetModules.ts:50-58`) with nudge. Record the choice in the ticket.
- [ ] Panel edits reflect in the viewport immediately (same frame, no apply
      button) and round-trip into the draft losslessly

## Done when

- [ ] A Module's every field (primitives, look, defaults, Sockets,
      footprint) is authorable through gizmo + panel — verified by composing
      one live with the devtools closed
- [ ] Radius slider clamps honestly at the geometry limit; color presets
      match the game's rendered shades (same hex both sides, asserted once)
- [ ] The Socket/footprint decision is recorded with its reason, and the
      losing option's drawback is named (not silently dropped)
- [ ] Draft with panel edits survives a builder reload (draft persistence,
      whatever the builder already uses for Track Drafts)

## Watch out for

**No free-text ids.** Surface and any future enum-typed field render as
pickers over the real id lists — a typo'd string that fails at publish is
the blind-authoring failure wearing a UI costume.

**Presets are presets.** The pastel swatches fill the hex field; they don't
constrain it — custom hex stays valid end to end (ticket 01's rule).

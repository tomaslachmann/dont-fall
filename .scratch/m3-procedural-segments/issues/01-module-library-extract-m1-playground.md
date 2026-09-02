# 01 — Module library: extract the M1 playground into reusable Modules

**What to build:** M1's hardcoded platforms, Spinner, and Props are refactored into a library of
named, reusable Module definitions in `packages/shared`, each with a uniform, fixed-width,
straight-line footprint (ADR 0030). A hardcoded Track — an ordered list of `{moduleId, position,
rotation}` placements referencing this library — reproduces the exact M1 playground layout. The
running game (client + server) is visually and functionally unchanged; only the authoring
representation moves from ad hoc scene/collider code to reusable, composable data.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Every M1 playground piece (platforms, Spinner, Props) exists as a named Module definition in
      `packages/shared`, usable by both client (render/local test) and server (authoritative sim)
- [ ] Every Module shares one fixed-width, straight-line entry/exit footprint (ADR 0030) — document
      the footprint convention where the Module type is defined
- [ ] A hardcoded ordered list of Module placements reproduces the M1 playground exactly (same
      geometry, same Obstacle/Prop tuning)
- [ ] Existing M1/M2 tests still pass unmodified; a manual playthrough is indistinguishable from
      before the refactor
- [ ] `Module`/`Segment`/`Track` in code match `CONTEXT.md`'s existing glossary definitions exactly

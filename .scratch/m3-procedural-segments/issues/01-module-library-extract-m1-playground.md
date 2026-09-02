# 01 — Module library: extract the M1 playground into reusable Modules

**What to build:** M1's hardcoded platforms, Spinner, and Props are refactored into a library of
named, reusable Module definitions in `packages/shared`, each with a uniform, fixed-width,
straight-line footprint (ADR 0030). A hardcoded Track — an ordered list of `{moduleId, position,
rotation}` placements referencing this library — reproduces the exact M1 playground layout. The
running game (client + server) is visually and functionally unchanged; only the authoring
representation moves from ad hoc scene/collider code to reusable, composable data.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Every M1 playground piece (platforms, Spinner, Props) exists as a named Module definition in
      `packages/shared` (`track/modules.ts`), usable by both client and server
- [x] Every Module shares one fixed-width, straight-line entry/exit footprint (ADR 0030) —
      `MODULE_STEP` (`track/Module.ts`) is the uniform displacement `chainTrack` applies between
      every Segment, identical regardless of Module content
- [x] `M1_TRACK` (`chainTrack` over `M1_MODULES`) reproduces the same beats as the original
      playground — same 6 stops, same Spinner tuning (`armLength`/`angularSpeed` unchanged), same
      3 Props, same 2 Checkpoints. **Not** byte-identical world geometry: the uniform footprint
      (ADR 0030) is fundamentally incompatible with M1's hand-tuned per-stop platform
      widths/gaps, so widths/spacing were re-authored to fit the new convention — a deliberate,
      documented deviation from the ticket's original "reproduces exactly" wording, not an
      oversight
- [x] Existing M1/M2 tests still pass unmodified (164 shared + 78 client + 13 server, all green);
      client Vite build still succeeds
- [x] `Module`/`Segment`/`Track` in code match `CONTEXT.md`'s existing glossary definitions

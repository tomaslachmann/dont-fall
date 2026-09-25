# 01 — Convert the bombs, retire the static ones

**What to build:** `pnpm convert:bomb` turns `BLIP_Bombs_v1`'s two animated drops into
`assets/bomb_A.glb` / `assets/bomb_B.glb`, black, with a collision node and the clips kept;
the shared reader accepts `role: "effect"`; the nine static `kaykit_bomb*` Assets are gone.
ADR 0126.

**Blocked by:** —

**Status:** done on tests (2026-09-23)

- [x] Reader: `effect` is a render-only role (not collision, not visual, not measured)
- [x] Converter: body UVs blue swatch → black swatch; shell-fragment material darkened;
      a `role: "collision"` node over the body mesh; clips kept
- [x] Defs: `bombAssetDefs.ts` (hand-authored, category `prop`, the `bomb` field)
- [x] Delete `assets/kaykit_bomb*.glb` and their defs; `convert:kaykit` skips the stem

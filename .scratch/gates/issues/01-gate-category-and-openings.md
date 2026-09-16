# 01 — Gate Assets: a category and a fitted opening

**What to build:** ADR 0068's build-time half — the `gate` Asset category
(hoops, arches, finish signs, all colours) and an opening mask
per gate Asset, fitted from its collision and stored in a generated defs file
with its role (`checkpoint` / `finish`).

**Status:** done (2026-09-15) — tests; the live check is the user's

## How it behaves after

- The builder's Assets tab shows a **Gate** group next to Platform / Obstacle /
  Scenery; the hoops, arches and finish signs are there and no longer in
  Scenery. Fences, flags and arrow signs stay Scenery.
- Nothing plays differently yet — a gate placed on its own is still just art
  (02 makes passing through it count).

## Checklist

- [x] `gate` in `ASSET_CATEGORIES`; converter category rules for the stems
- [x] `scripts/fit-gates.ts`: rays along a through-direction swept about X
      (±60°, then refined), enclosed opening first, floor-bounded upright
      otherwise; mask at 0.1-unit cells; generated `gateAssetDefs.ts`
- [x] Defs merged onto asset Modules (`Module.gate`)
- [x] Tests: standing hoop → enclosed, upright; angled hoop → tilted; arch and
      finish sign → floor-bounded; the centre of each opening is open, a point
      beside the gate is not; every gate-category Asset has a gate def

## Notes

- `trap_arch` stays Scenery: despite the name it is a flat D outline
  0.5 × 2 × 0.1 with no opening a Character fits through (the fitter found
  none). 22 Gates: 12 arches, 8 hoops, 2 finish signs.
- The leaning hoop fits at 40.5° and shows 5.25 of the upright hoop's 5.32
  units² — the probe's plateau, not the ring's exact lean; passing is judged
  on that plane, which is what matters.
- Re-running both converters left every GLB byte-identical.
- The Assets tab lists every `ASSET_CATEGORIES` entry (GATE included) instead
  of a hardcoded three.

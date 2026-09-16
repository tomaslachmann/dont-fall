# 01 — Asset packs usable in the builder: lag, pivot, scale, categories, full KayKit

**What to build:** Make the converted asset packs (KayKit, the ImageToStl trap
pack) buildable with: no lag on the Assets tab, a gizmo that sits on the piece,
one grid across packs, a categorized Assets tab, and the whole KayKit pack.

**Blocked by:** nothing.

**Status:** done (2026-09-14) — verified live in headless Chrome against the
running builder + API; open follow-ups listed at the end.

## Decisions (user, 2026-09-14)

- **Asset pivot = bottom-centre** (X/Z centred, resting on y = 0) for every
  Asset — the convention KayKit mostly already followed. Done in the
  converters by rewriting scene-root transforms, never mesh bytes.
- **Trap pack scaled 3.6×** — its big platform tile (1.106 m) becomes the
  KayKit 4×4 floor's 4 m. One uniform factor; the pack keeps its proportions.
- **Trap colour variants keep their ids** (`_2`, `_3`, …): they differ by
  colour (UVs), so dedupe hashes the file *as exported*, before seating.
- **Asset categories: Platform / Obstacle / Scenery**, explicit per stem in
  each converter (an unmatched stem fails the conversion). Platform includes
  supports (pillars, struts, bracing); Scenery includes railings, fences,
  signs, flags, arches, hoops and the collectible/lever/button shapes.
- **All KayKit folders imported**: `neutral` (38 grey/white/wood shapes, bare
  `kaykit_<stem>` ids, unchanged) + `blue`/`green`/`red`/`yellow` (83 coloured
  shapes each, `kaykit_<stem>_<colour>`). Dedupe is per folder.

- **Gizmo translate snapping = Socket → faces → 0.5 m grid** (user, same
  day): a dragged Segment lands flush against any other Segment's Footprint
  face within 0.5 m that it overlaps across the other two axes (stacking on
  top, under, side by side); any axis left free snaps to `MOVE_STEP`; only the
  dragged handle's axes move; Shift keeps the fine 0.1 m grid.

## What changed

- [x] Builder previews: drawn once as a still when on screen, only the hovered
      one spins (`PreviewScheduler`); canvas cleared per draw (hover smear)
- [x] Asset Segment rebuilds no longer dispose the cached template's GPU
      resources (`SHARES_TEMPLATE_RESOURCES`)
- [x] Asset files load 8 at a time; identical embedded textures shared
- [x] Converters: `seatOnPivot`, `TRAP_PACK_SCALE`, category rules, all KayKit
      folders; `AssetModuleDef.category` in shared; pivot test in
      `assetModules.test.ts`
- [x] Assets tab category filter; previews framed on the piece's centre
- [x] Socketless Segments: gizmo drag / nudge / rotate threw `has no Socket
      "entry"`, so moves never reached the Track and the next add/delete
      rebuilt them back — `settleOne`, `rotateSegment` and Socket-snap now
      share `rechainFrom`'s chainable rule; the camera re-aims only on a
      Track's first Segment or a load
- [x] `snapDragPosition`: Socket-snap, then face snap, then grid, per dragged
      axis — verified live with a real gizmo drag landing flush

## Open

- [ ] The overlap ghost inflates Footprints by `clearance`, so a face-snapped
      stack against a non-neighbor Segment shows red although it is exactly
      what was asked for — decide whether flush contact should read green

- [ ] Review the category of `trap_platform3faces*` / `trap_platformcircle*`
      (filed Platform; they may read as spinning Obstacles)
- [ ] The game client and server load **every** `ASSET_MODULE_DEFS` entry
      (now 456 files, ~29 MB) on Track load, not just the Track's Modules;
      the client's `loadAssetVisuals` twin has no texture sharing
- [ ] Pre-existing test debt: textured GLBs can't parse in Node (`self is not
      defined`) — builder `extractVisualRoot` + contexts tests; builder tests
      still name deleted ids (`platform_straight`, `corner_lshape`,
      `stairs_4step`); `trap_arrow*` collision is inside-out (negative node
      scale); shared `asset.test.ts` lacks its `ASSET_MODULE_DEFS` import; the
      demo-Track walk doesn't qualify

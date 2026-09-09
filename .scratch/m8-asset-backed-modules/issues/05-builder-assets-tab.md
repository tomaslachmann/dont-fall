# 05 — Builder Assets tab + viewport visuals

**What to build:** Asset Modules made real in the track builder: a dedicated
Assets tab listing the registry's asset Modules, click-to-place, and the
viewport drawing their visuals — so what the author places is what the game
plays.

**Blocked by:** tickets 02 (registry entries to list) and 03 (the loader
pattern to mirror — paths injectable, not game-hardcoded).

**Status:** implemented — verification pending (live blocked by sandbox: loopback `listen` is EPERM here and no browser automation is possible; everything runnable is green, see notes)

## Why

The builder viewport draws `module.statics` as boxes, so asset Modules
currently render as nothing — placeable but invisible. Placement was free
(registry-driven palette); visibility is this ticket. A dedicated tab rather
than mixing into the existing palette: the set is fixed, visual-first, and
small — four entries don't need taxonomy, and procedural entries don't need
rearranging.

## What to change

- [x] Assets tab: lists exactly the registry's asset Modules (fixed set —
      user-uploadable GLBs are a content-pipeline milestone, not a tab
      feature), click-to-place through the existing insert flow
- [x] Viewport draws each placed asset Segment's visual mesh via the
      builder's own `GLTFLoader` role filter — a deliberate ~15-line
      duplicate of ticket 03's, each copy pointing at its twin, each pinned
      by its app's tests (no shared three.js home: too small for a package,
      wrong mandate for `@dont-fall/ui`)
- [x] Bytes come from track-service (`GET /assets/:name`) at tab open —
      the same pipe as tickets 02/03, never a builder-local copy
- [x] Footprint-based machinery (overlap ghost, chaining, sockets) works
      unchanged — footprints live in the registry, not the geometry; verify,
      don't rebuild

## Done when

- [x] Viewport tests: an asset Segment renders its visual and no collision
      geometry; removing it frees everything (the builder's own
      allocate-then-free discipline, same as its boxes)
- [x] The tab lists all four with working visuals; placing from it chains
      and overlaps exactly like the existing palette
- [ ] **Live:** build a Track from the tab, publish, and playtest it from
      the builder button — the full author-to-player loop on asset Modules.
      Blocked here: no sockets or browser in this sandbox (loopback
      `listen` is EPERM; every socket suite fails at `server.listen`,
      including pre-existing tests)

## Implementation notes

- `apps/track-builder/src/assets.ts` (new): `assetTabModuleIds` (the fixed
  four), `builderLibrary` (procedural registry + asset placement halves),
  and the loader twin (`loadAssetVisuals` / `parseAssetVisual` /
  `extractVisualRoot`) — same URL derivation via shared `assetFileName`,
  same triangle-for-triangle agreement with the shared reader, each copy
  pointing at its twin in `apps/client/src/render/assetVisuals.ts`.
- Placement needs no bytes (the builder never simulates), so asset entries
  are sockets/footprints only — shared as `ASSET_PLACEMENT_MODULES` (new in
  shared `assetModules.ts`), which also simplified `ASSET_DEMO_TRACK` and is
  what publish validation now accepts. One def-to-Module mapping, three
  consumers.
- `render.ts` gains `buildSegmentGroup` (template clone for asset Segments
  with a loaded template, boxes-and-markers otherwise, always through the
  one `applySegmentTransform`); the viewport's `setTrack` takes optional
  templates and palette previews take an optional template. Clones share
  template geometry — freed with the existing sweep, re-uploaded next
  render (documented on the function; four tiny files make it noise).
- `main.ts`: every edit/snap/overlap/viewport path moved from
  `MODULE_LIBRARY` to the full library (the procedural tab loop is the only
  `MODULE_LIBRARY` use left — deliberately); Assets tab fetches once per
  session on first open through its own fetch, builds visual previews,
  places through the same insert flow; loading a Track that places asset
  Segments auto-fetches in the background. A failed tab load retries on the
  next click. No `trackEdit.ts` changes — "verify, don't rebuild".
- Publish validation (`unknownModuleIds`) now checks the exported
  `PUBLISH_MODULES` (procedural + asset ids) instead of the procedural
  registry alone — publishes (Save and Playtest alike) from the Assets tab
  validate; geometry stays a load-time concern, never a publish one.
- Untestable-in-node gaps closed statically: `shell.test.ts` pins every
  `$("...")` id in `main.ts` against `index.html` (a typo is otherwise a
  blank page with no failing test); `vite build` passes.
- Verified here: builder 107 / shared 652 / client 285 / ui 21,
  track-service in-process 42, server runtime 5, full monorepo typecheck
  clean, builder `vite build` clean. Socket suites fail exclusively at
  `listen` EPERM here — pre-existing tests included.

## Live steps (for a machine with browsers + loopback)

1. Boot the stack (`pnpm dev`) and open the builder. Open the Assets tab —
   four entries with authored-shape previews, fetched from track-service.
2. Place all four from the tab (chaining/snapping/overlap behave exactly
   like the procedural palette), Save, then Playtest — the builder
   publishes and opens the real client, which plays the Track through the
   real server: the full author-to-player loop on asset Modules.

## Watch out for

**Don't fix content with code** (same rule as ticket 04): a snag found
while authoring is a file fix, not an epsilon loosening.

**The tab is fixed-set.** "Load my own GLB" requests go to the future
content-pipeline milestone with validation UX, naming, footprint
authoring, and surface tagging — not smuggled in as a file input here.

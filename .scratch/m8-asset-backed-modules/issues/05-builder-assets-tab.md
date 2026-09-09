# 05 — Builder Assets tab + viewport visuals

**What to build:** Asset Modules made real in the track builder: a dedicated
Assets tab listing the registry's asset Modules, click-to-place, and the
viewport drawing their visuals — so what the author places is what the game
plays.

**Blocked by:** tickets 02 (registry entries to list) and 03 (the loader
pattern to mirror — paths injectable, not game-hardcoded).

**Status:** planned

## Why

The builder viewport draws `module.statics` as boxes, so asset Modules
currently render as nothing — placeable but invisible. Placement was free
(registry-driven palette); visibility is this ticket. A dedicated tab rather
than mixing into the existing palette: the set is fixed, visual-first, and
small — four entries don't need taxonomy, and procedural entries don't need
rearranging.

## What to change

- [ ] Assets tab: lists exactly the registry's asset Modules (fixed set —
      user-uploadable GLBs are a content-pipeline milestone, not a tab
      feature), click-to-place through the existing insert flow
- [ ] Viewport draws each placed asset Segment's visual mesh via the
      builder's own `GLTFLoader` role filter — a deliberate ~15-line
      duplicate of ticket 03's, each copy pointing at its twin, each pinned
      by its app's tests (no shared three.js home: too small for a package,
      wrong mandate for `@dont-fall/ui`)
- [ ] Bytes come from track-service (`GET /assets/:name`) at tab open —
      the same pipe as tickets 02/03, never a builder-local copy
- [ ] Footprint-based machinery (overlap ghost, chaining, sockets) works
      unchanged — footprints live in the registry, not the geometry; verify,
      don't rebuild

## Done when

- [ ] Viewport tests: an asset Segment renders its visual and no collision
      geometry; removing it frees everything (the builder's own
      allocate-then-free discipline, same as its boxes)
- [ ] The tab lists all four with working visuals; placing from it chains
      and overlaps exactly like the existing palette
- [ ] **Live:** build a Track from the tab, publish, and playtest it from
      the builder button — the full author-to-player loop on asset Modules

## Watch out for

**Don't fix content with code** (same rule as ticket 04): a snag found
while authoring is a file fix, not an epsilon loosening.

**The tab is fixed-set.** "Load my own GLB" requests go to the future
content-pipeline milestone with validation UX, naming, footprint
authoring, and surface tagging — not smuggled in as a file input here.

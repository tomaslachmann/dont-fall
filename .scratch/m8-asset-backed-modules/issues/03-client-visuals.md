# 03 — Client visual loading + rendering

**What to build:** What the eye gets: each placed asset Segment draws its
Visual mesh, and the Collision mesh is never drawn.

**Blocked by:** ticket 02 (nothing to draw until Segments place).

**Status:** implemented — verification pending (live blocked by sandbox; everything runnable is green, see notes)

## Why

Physics without visuals is unplayable and visuals without physics is a lie —
but the milestone deliberately orders them so. This ticket closes the loop
for the eye; ticket 02 already closed it for the feet.

## What to change

- [x] Load each asset Module's GLB with three's `GLTFLoader`, fetched from
      track-service at track load (ADR 0050 as amended — not bundled), filter
      nodes by `role` — visual nodes render, collision nodes are dropped,
      never hidden-and-kept. Loader paths injectable, not game-hardcoded:
      ticket 05 reuses the pattern through its own fetch
- [x] The role filter is deliberately duplicated in ticket 05 (each copy
      points at its twin) — too small for a package, wrong mandate for
      `@dont-fall/ui`
- [x] One visual instance per placed Segment, positioned/rotated exactly as
      the Segment places its collision (same origin, same transform — the
      two must never be positioned by separate code)
- [x] Visual bounds escaping collision past `ASSET_VISUAL_WARN` surfaces the
      dev warning from ticket 01's check where a developer will see it

## Done when

- [x] Scene tests: an asset Segment renders its visual mesh and no collision
      geometry; removing the Segment removes the mesh (no leaks across a
      Track reload — M4 ticket 01's discipline)
- [x] The code-split boundary still holds: no three.js in `packages/shared`
      (ticket 01's assertion keeps passing)
- [ ] **Live:** the ticket-02 playtest Track now *looks* like its Modules —
      boxes gone, authored shapes in their place. Blocked here: no sockets
      or browser in this sandbox

## Implementation notes

- `apps/client/src/render/assetVisuals.ts` (`loadAssetVisuals` /
  `parseAssetVisual` / `extractVisualRoot` / `assetPlacements` /
  `buildAssetVisuals`) + 14 tests green; `createStage` takes optional
  `assetTemplates`/`assetPlacements` (empty on procedural-only Tracks, so
  those render exactly as before); `game/index.ts` shares one promise-cached
  `fetchBytes` between the collision and visual loaders (no URL fetched twice
  per session) and passes ticket 01's warnings to `console.warn` via the new
  optional `loadAssetLibrary` `onWarning` (server passes nothing — unchanged).
- The `GLTFLoader`-vs-shared-reader agreement is pinned triangle-for-
  triangle: every file's filtered visual vertices equal `readAssetModel`'s
  visual positions. `role` arrives via `userData` (verified against the
  three r171 source: `assignExtrasToUserData` on nodes).
- Clones share template geometry/materials (three `clone` shares, never
  duplicates — asserted); the stage frees clones with its existing
  scene-graph sweep while templates stay session-cached. Visual meshes join
  `collidables` as leaves, so the spring-arm camera treats authored shapes
  like the boxes they replace with no raycast change.
- Verified here: shared 649 / client 285 / ui 21 / builder 88, server
  runtime 5, track-service asset-unit 4, full monorepo typecheck clean.
  Socket suites unrunnable — sandbox denies even loopback `listen`.

## Watch out for

**Two loaders, one truth.** `GLTFLoader` (visuals) and the shared reader
(collision) parse the same file twice with different code. The file is the
single source of truth; if the two ever disagree about node membership,
`role` wins in both and the file is fixed — never a loader-side override.

**Don't render the physics.** Drawing the trimesh "for debugging" and
forgetting it on is how a debug view ships. If a debug view is wanted, it
is a flag defaulting off, not a second render path.

# 03 — Client visual loading + rendering

**What to build:** What the eye gets: each placed asset Segment draws its
Visual mesh, and the Collision mesh is never drawn.

**Blocked by:** ticket 02 (nothing to draw until Segments place).

**Status:** planned

## Why

Physics without visuals is unplayable and visuals without physics is a lie —
but the milestone deliberately orders them so. This ticket closes the loop
for the eye; ticket 02 already closed it for the feet.

## What to change

- [ ] Load each asset Module's GLB with three's `GLTFLoader` (the
      MushroomKing precedent: bundled under `public/`), filter nodes by
      `role` — visual nodes render, collision nodes are dropped, never
      hidden-and-kept
- [ ] One visual instance per placed Segment, positioned/rotated exactly as
      the Segment places its collision (same origin, same transform — the
      two must never be positioned by separate code)
- [ ] Visual bounds escaping collision past `ASSET_VISUAL_WARN` surfaces the
      dev warning from ticket 01's check where a developer will see it

## Done when

- [ ] Scene tests: an asset Segment renders its visual mesh and no collision
      geometry; removing the Segment removes the mesh (no leaks across a
      Track reload — M4 ticket 01's discipline)
- [ ] The code-split boundary still holds: no three.js in `packages/shared`
      (ticket 01's assertion keeps passing)
- [ ] **Live:** the ticket-02 playtest Track now *looks* like its Modules —
      boxes gone, authored shapes in their place

## Watch out for

**Two loaders, one truth.** `GLTFLoader` (visuals) and the shared reader
(collision) parse the same file twice with different code. The file is the
single source of truth; if the two ever disagree about node membership,
`role` wins in both and the file is fixed — never a loader-side override.

**Don't render the physics.** Drawing the trimesh "for debugging" and
forgetting it on is how a debug view ships. If a debug view is wanted, it
is a flag defaulting off, not a second render path.

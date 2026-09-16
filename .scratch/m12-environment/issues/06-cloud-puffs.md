# 06 — Drifting cloud puffs

**What to build:** chunky low-poly clouds in two bands — one near the horizon,
one below the cloud floor showing through its gaps — drifting and wrapping
around the camera so the field never ends.

**Blocked by:** 03 (05 for the lower band's height)

**Status:** done (2026-09-16) — tests and typecheck. Cloud style still open: both are built, `day` draws `soft`, and the pick is the user's after seeing both. Visual check — the user's.

## What to change

- [x] 2–3 puff variants: merged low-detail icospheres (`mergeGeometries`),
      one `InstancedMesh` each, per-instance tint via `setColorAt`
- [x] Drift by `wind × dt` on the wall clock (never sim time), wrapped into a
      camera-centred tile with the pure `wrapAround` helper (tested in 02)
- [x] `frustumCulled = false` (the cached bounding sphere never updates)
- [x] `options.detail: "low"` skips the puffs
- [x] Puffs neither cast nor receive shadows
- [ ] Visual check — the user's

## Notes

- Research §3: opaque puffs, not stacked transparent sprites (fill-rate at DPR 2).
- Still open (ADR 0074): toon-banded (`MeshToonMaterial`, `NearestFilter`
  gradient map) or softly lit (`MeshLambertMaterial` + env map) — show the user
  both before settling.

## As built

- `packages/render/src/environment/cloudPuffs.ts`: three shapes, each 4–7 icospheres (detail 1)
  merged and flattened underneath, one `InstancedMesh` each. Each instance is tinted between the
  preset's `lit` and `shade`. `scatterPuffs` shares the count across the bands, heights relative to
  the cloud floor, and is seeded so every load looks the same. Each frame `puffPlacement` drifts a
  puff by `wind × seconds` on the wall clock and wraps it with `wrapAround` into a 400 × 400 field
  centred on the camera. Instances start hidden (zero scale) until the first `update`.
- **Two additions to the ticket, both needed to make it work:**
  - *Clearance.* The `day` band above the floor runs from 4.5 to 22.5 in world Y, which is the
    Track's own height, so a drifting puff could hide the route (ADR 0074: never affects play). A
    puff in a band that reaches above the floor never comes closer than 70 units horizontally to the
    camera and grows back over the next 30. Puffs beneath the floor have no clearance.
  - *Edge fade.* Puffs shrink to nothing over the field's last 40 units, so a wrap never pops, even
    with fog off in the builder's preview.
- **Holes in the floor**, so the band beneath shows through: `EnvironmentCloudFloor.openBelow`, a
  share of the floor's noise range (`day`: 0.2). The shader discards below it, and the hole's rim
  takes the shade colour. The discard costs the floor early depth testing, the one real cost here.
  0 closes the floor.
- **Style, still open:** `EnvironmentCloudPuffs.style` is `"soft" | "toon"` (`ENVIRONMENT_PUFF_STYLES`).
  `soft` is a matte `MeshStandardMaterial`: roughness 1, flat shading, emissive in the shade colour
  at 0.25. It is Standard rather than Lambert because only standard materials take
  `scene.environment`, so the puffs get sky-coloured fill like the Assets. `toon` is a
  `MeshToonMaterial` with a 3-texel `NearestFilter` gradient (96/176/255) and the same emissive. To
  compare, flip `day.puffs.style` in `packages/shared/src/track/Environment.ts`. If one wins
  everywhere, the field can go and the loser with it. If presets want different styles, it stays.
- `createEnvironment` builds the puffs only when `detail` is `"full"` and the count is above 0, and
  frees them (the geometries, `InstancedMesh.dispose` for the instance buffers, the material, the
  toon gradient) on dispose.
- `seededRandom` (mulberry32) moved to `random.ts`, shared with the floor noise.

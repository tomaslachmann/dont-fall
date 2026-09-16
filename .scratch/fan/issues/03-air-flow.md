# 03 — The air over a fan, redrawn

**What to build:** replace `apps/client/src/render/airColumns.ts`'s box and rings with the variant
picked in 00, **cartoon swooshes + puffs**, for every Volume with a flow (ADR 0075, amended
2026-09-16).

**Blocked by:** 00 (air pick — made).

**Status:** done on tests (2026-09-16). The visual check is the user's, in a real Match or in
`?freeroam=1` on a Track with a fan or an updraft.

## What changed

- [x] `packages/shared/src/track/AirColumn.ts`: the ring maths is replaced by the swoosh and puff
      maths, carried over from the prototype formula for formula and number for number:
      - `airSwooshSeed` / `Head` / `Point` / `Width` / `Alpha` / `Span`;
      - `airPuffSeed` / `Placement`;
      - `AIR_MOUTH_SHARE` and the `AIR_SWOOSH_*` / `AIR_PUFF_*` tuning.

      `AirColumnFrame.radius` became `halfWidth`. Tests are in `AirColumn.test.ts`.
- [x] `packages/render`: `createPuffLook(preset, variants, seed)`, the sky's own puff shape
      recipe, material for the preset's style, and lit-to-shade tint. The sky's own clouds are
      untouched.
- [x] `apps/client/src/render/airColumns.ts`: `buildAirColumns(volumes, environment)` returns
      `{ columns, update(nowMs, cameraPosition), dispose }`. Per Volume:
      - a group on the entry face, turned from +Y onto the force;
      - one ribbon mesh (`MeshBasicMaterial`, per-vertex alpha, an edge alpha map, fog for free),
        rebuilt on the CPU every frame and turned face-on to the camera;
      - one instanced puff mesh per shape.

      Nothing is allocated without a column to draw. Tests are in `airColumns.test.ts`.
- [x] `scene.ts`: passes the Stage's Environment preset, and `updateAirColumns(nowMs)` hands the
      camera position through. The disposal sweep frees the shared pieces, since each hangs off a
      column.
- [x] ADR 0075 amended: the box is retired, and the shared-maths rule is kept by building the
      swooshes on the CPU rather than in the prototype's vertex shader.
- [ ] Visual check (the user's): the swooshes and puffs over the fan in `day` / `sunset` /
      `night`, and a sideways Volume if one exists.

## Notes

- The Track builder never drew Volumes and still doesn't. Previewing the air there is a
  follow-up if wanted. The maths and the puff look are already shared.
- The swooshes face the camera as it stood at its last update, which can be one frame stale.
  That is invisible at this width.
- Test runs on 2026-09-16 show failures elsewhere in the dirty tree. None is in the files this
  ticket touched:
  - shared: `DEPRECATED_MODULE_IDS` now lists `updraft`; `fan_lower_poly.glb` has no def yet
    (ticket 01); `trap_arrow` winding; the asset demo Track; the fan's solid parts; type errors
    in `asset.test.ts` / `RapierSimulation.test.ts`.
  - client: `codeSplitBoundary` via `CharacterPreview`; `test_components` typecheck.

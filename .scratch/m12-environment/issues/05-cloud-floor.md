# 05 — Cloud floor replaces the drawn kill plane

**What to build:** a sea of cloud under the Track. A Falling Character sinks
into it just before it Respawns. The translucent black kill-plane mesh goes; the
simulation's kill plane is untouched.

**Blocked by:** 03

**Status:** done (2026-09-16) — tests and typecheck; the shader has never been compiled (no WebGL here), so the visual check is also its first compile — the user's.

## What to change

- [x] One plane at `cloudFloorY(preset, killPlaneY, lowestSegmentY)`; each
      `update` copies the camera's X/Z, Y stays fixed
- [x] Shader samples a generated tileable noise `DataTexture` in **world** X/Z
      (never UVs), two scrolling taps on the wall clock, `lit`/`shade` colours;
      receives scene fog (`fog: true`, fog chunks, `UniformsLib.fog`)
- [x] `createStage` passes the lowest Segment's Y; delete the `killPlane` mesh
- [x] Clamp test: a Track with a Segment 2.8 above the kill height keeps the
      floor below that Segment
- [ ] Visual check (floor height, contrast against deck tops) — the user's

## Notes

- Research §3. The kill height stays −8 (ADR 0074); a start offset of about
  +0.5 above it hides the Respawn teleport, since the camera trails 0.7–5.3
  above the Character.
- The floor is the largest surface in a downward-looking frame — keep the
  shader to two taps.

## As built

- `packages/render/src/environment/cloudFloor.ts`: a 500 × 500 plane (`CLOUD_FLOOR_RADIUS` 250) that
  `createEnvironment` adds under its root. `update` copies the camera's world X/Z. Two taps of the
  noise tile in world X/Z (one tile per ~67 units, `CLOUD_FLOOR_NOISE_SCALE`), mixed from `shade` to
  `lit` by `smoothstep(0.35, 0.75, n)`. Fog comes from three's own chunks and `UniformsLib.fog`.
- The scroll is computed on the CPU (`cloudFloorScroll`) and wrapped to one tile, so the shader
  never adds a huge offset however long a page stays open. The broad layer moves with the preset's
  wind. The finer detail layer (2.7×) drifts at half of it, so the pattern changes as it moves.
- **Edge fade (not in the ticket):** from 60 % of the radius outwards, the floor fades into the
  sky's own colour for that view direction. The fade runs after the fog, and the sky colour goes
  through the same tone-mapping and colour-space steps the dome's shader uses. So the floor meets the
  dome on the same colour in the game (fogged, via the composer) and in the builder's preview (fog
  off, straight to the canvas, ticket 10). For that, `skyDome.ts` now exports `SKY_COLOUR_GLSL` and
  `skyUniforms(preset)`, which both shaders use.
- `cloudNoise.ts`: `generateCloudNoise` is a 256² tileable fractal value noise (lattices 4–64 cells,
  quintic fade, seeded mulberry32), stretched to 0–255, one byte per texel. It becomes an `R8`
  `DataTexture` with repeat wrapping and mipmaps, one per Environment, freed on dispose. The texture
  is set on the uniforms after `UniformsUtils.merge`, which would otherwise clone it and upload the
  clone, so the texture that is freed would not be the one uploaded.
- `lowestDrawnY.ts`: `lowestDrawnY(objects)` gives the world bounding-box floor of the still pieces.
  `lowestMovingY(visual, config)` gives a lower bound for a Moving Segment over its whole Motion:
  spin and swing are rigid turns about pivots, so the bound is a ball about the pivot (spin then
  swing grows it by the pivot distance), and a slide adds the downward part of its offset, through
  orientation and scale. Tests check it against 4000 ticks of the real `movingSegmentPose`. It is
  never above that, and exact when nothing turns.
- `createStage` now builds the Environment after the Track. `lowestSegmentY` is the minimum of the
  static boxes, asset visuals and Spinners (they turn about the vertical, so their Y range never
  changes) and every Moving Segment's bound. Props are left out because they fall. The `killPlane`
  mesh is gone.
- The clamp test (a Segment 2.8 above the kill height, with an offset that would otherwise put the
  floor above it) is in `createEnvironment.test.ts`.
- Unrelated and already failing in the client suite: `codeSplitBoundary.test.ts` (`CharacterPreview`
  imports `render/characterModel`), `loop.asset-render.test.ts` (jsdom has no `URL.createObjectURL`),
  and a worker running out of heap. No client test touches `scene.ts` or `@dont-fall/render`.

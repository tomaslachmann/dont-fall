# 03 — Sky dome, fog and lights in the game (`day`)

**What to build:** the game's dark void is replaced by the `day` Environment's
sky dome, horizon-coloured fog and palette lights, drawn through
`createEnvironment`.

**Blocked by:** 01, 02

**Status:** done (2026-09-16) — tests and typecheck; the shader has never been compiled (no WebGL here), so the visual check is also its first compile — the user's.

## What to change

- [x] `packages/render`: sky dome — unit sphere, `BackSide`, `depthWrite: false`,
      `fog: false`, `gl_Position = clip.xyww`, position copied from the camera
      each `update`, high `renderOrder`; three colour stops + sun disc; keeps the
      `tonemapping_fragment` / `colorspace_fragment` includes (research §2)
- [x] `THREE.Fog` from the preset (colour = horizon stop); `options.fog: false`
      leaves `scene.fog` null
- [x] `HemisphereLight` + `DirectionalLight` from the preset; light direction from
      `sunDirection` (with `lightElevationDeg` if set); per-preset exposure
- [x] `createStage`: `environment` on `StageConfig`; delete the hardcoded
      background, fog and lights; `environment.update(camera, now)` at the top of
      `render()`; `environment.dispose()` before `disposeSceneGraph`
- [x] No Environment mesh ever joins `collidables`
- [x] Until 09 lands, the game passes `ENVIRONMENT_PRESETS.day`
- [ ] Visual check, and the `day` palette call — the user's

## Notes

- Research §1c: the chase camera never sees above ~22°, so the horizon and
  below-horizon stops carry the look in a Round; the zenith is mostly a builder
  concern.
- The palette must not match the KayKit deck-top blue (research §1e).
- Still open (ADR 0074): whether the procedural box material (`0x1c2740`)
  changes with the Environment — ask when the void is gone and the dark boxes
  are visible against the new sky.

## As built

- `packages/render/src/environment/skyDome.ts` and `lights.ts`, composed by `createEnvironment`.
  The disc's edges are uniforms (`sunCosOuter`, `sunCosInner = cos(0.75 r)`), and a `sunVisible`
  guard skips the disc and its glow at radius 0, where the two edges would meet.
- `createEnvironment` owns `toneMappingExposure` (the preset's) and `scene.fog`. On dispose it puts
  back what was there before, but only if nothing has replaced them since. The operator stays each
  app's renderer setting (01).
- The sun light aims at its default target, the origin, like the old hardcoded light; `day`'s
  sun (azimuth 60°, elevation 55°) is within a few degrees of the old `(10, 18, 6)`. Intensities are
  today's. The hemisphere's ground colour is now the cloud floor's light lilac shade instead of the
  old near-black `0x1b2430`, so platform undersides are much brighter. That is intended, but it is
  part of the visual check.
- `scene.background` is gone. The dome covers every pixel, so the clear colour never shows.
- `createStage` passes `lowestSegmentY: Infinity` until 05 computes it. The translucent black kill
  plane stays until 05 replaces it, so under `day` it shows as a dark sheet at −8.
- Still open (unchanged): the procedural box material `0x1c2740`, which now shows against a light
  sky.

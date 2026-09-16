# 04 — Environment map baked from the sky

**What to build:** glossy Assets and BLIP reflect the Environment's own sky: one
`PMREMGenerator.fromScene` bake of the dome becomes `scene.environment`.

**Blocked by:** 03

**Status:** done (2026-09-16) — tests and typecheck; the bake has never run on a GPU (no WebGL here), so the visual check is also its first real run — the user's.

## What to change

- [x] Bake a temporary scene holding only the dome; `scene.environment =
      result.texture`; a fresh `PMREMGenerator` per bake, disposed immediately
      (never a module-level singleton — research §8)
- [x] `environmentIntensity` from the preset; rebalance the hemisphere intensity
      (the env map double-counts ambient)
- [x] `dispose()` frees the PMREM render target and nulls `scene.environment`
      (`disposeSceneGraph` does not reach it)
- [x] Test the dispose bookkeeping with fakes (jsdom has no WebGL)
- [ ] Visual check — the user's

## Notes

- Research §6 and §8: ≈ 6 MiB retained per bake.

## As built

- `packages/render/src/environment/environmentMap.ts`: `bakeEnvironmentMap(renderer, preset)` builds
  its own dome from the preset (not the drawn one) in a scene of its own, bakes it with a fresh
  `PMREMGenerator` and, in a `finally`, disposes the generator and that dome. The caller owns the
  returned target. `createEnvironment` bakes before it touches the scene, so a bake that throws
  leaves the scene as it was.
- The bake dome has `depthTest: false`. It is the only object in that scene, and its depth sits
  exactly on the far plane, so the bake does not depend on how the new target's depth buffer is
  initialised. The drawn dome is unchanged.
- `scene.environment` and `scene.environmentIntensity` follow the fog pattern from 03: on dispose the
  target is always freed, and the previous map and intensity come back only if the scene still holds
  this Environment's map. For the game's Stage the previous map is `null`.
- `day` rebalanced: `environmentIntensity` 1 → 0.3, `hemiIntensity` 1.1 → 0.2. How the numbers were
  picked, from three.js r171's shader chunks: a hemisphere light contributes `albedo × colour ×
  intensity / π`, and the environment map's diffuse term contributes `albedo × sky radiance ×
  intensity`. Integrated numerically over `day`'s dome (linear colours, sun disc and glow included),
  the sky at full strength gives 2.4–2.9× the fill the old hemisphere at 1.1 gave. At 0.3 + 0.2,
  up- and side-facing surfaces get within 4 % of the old fill and undersides 10 % less, and the map
  carries about 80 % of it. So the sun keeps its share of the light and ticket 07's shadows have
  contrast to show. The cost is weaker sky reflections than intensity 1 would give. This is a
  starting balance for the visual check. The rule behind it is written on the preset.
- Only `MeshStandardMaterial` and `MeshPhysicalMaterial` read `scene.environment` (KayKit and trap
  GLBs, BLIP, the procedural boxes). Basic-material markers are unaffected.
- Tests: `environmentMap.test.ts` uses a recording `PMREMGenerator` stand-in to check one generator
  per bake, disposed before returning and never reused, a bake scene holding only the preset's dome,
  and that dome freed after the bake (not before), even when the bake throws.
  `createEnvironment.test.ts` checks the map and intensity on the scene, one bake per Environment,
  the target freed once (idempotent), and the restore rules. Breaking the code four ways (no target
  dispose, no restore, no generator dispose, dome freed before the bake) fails at least one test each
  time.

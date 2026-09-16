# 07 — Real shadows from the Environment's sun

**What to build:** Characters, Assets, moving Segments and Props cast real
shadows onto the Track, from the Environment's directional light, in its
direction.

**Blocked by:** 03

**Status:** done (2026-09-16) — tests and typecheck; never rendered (no WebGL here). The builder preview item moves to 10; tuning and the visual check are the user's.

## What to change

- [x] `renderer.shadowMap.enabled`; the Environment's `DirectionalLight` casts
- [x] Casters: the Character model and ragdoll bones (local and remote), asset
      Segment clones, moving Segments, Props. Receivers: Track surfaces (asset
      clones, procedural boxes, deck sheets as needed)
- [x] The Environment's own meshes (dome, cloud floor, puffs) neither cast nor
      receive
- [x] Shadow camera: an orthographic box that follows the camera's focus (the
      local Character), light target moved with it, origin snapped to
      shadow-map texels so it does not shimmer — the snap is a pure, tested helper
- [x] `mapSize`, box extent, bias, `normalBias` and filter type as named
      constants; tune with the user
- [x] Builder preview (10): shadows follow the orbit target, or are off there —
      decide when 10 lands
- [ ] Visual check (acne, peter-panning, shimmer, cost) — the user's

## Notes

- ADR 0074: the user chose real shadows over the research's blob shadow.
- Cost (research §6): with `autoUpdate` every caster re-renders into the map
  every frame; a 2048² map ≈ 16 MiB colour plus depth.
- A low sunset sun throws long shadows — the box must be long enough in the
  light's direction, or `lightElevationDeg` lifts it.

## As built

- `packages/render/src/environment/shadows.ts` holds the tuning constants: `SHADOW_MAP_SIZE` 2048,
  `SHADOW_BOX_HALF_EXTENT` 35 (a 70 × 70 box, ≈ 3.4 cm per texel), `SHADOW_LIGHT_DISTANCE` 60 (camera
  far plane 120), `SHADOW_BIAS` −0.0005, `SHADOW_NORMAL_BIAS` 0.02, `SHADOW_MAP_TYPE`
  `PCFSoftShadowMap`. `castSunShadow(sun)` applies them.
- `snapToShadowTexels(point, lightDirection, texelSize)` is the pure snap. It rounds the point along
  the same right and up axes `Matrix4.lookAt` gives the shadow camera, including its nudge for a
  light straight overhead, and keeps the component along the light. The test places a real
  `OrthographicCamera` the way the Environment does and checks that a fixed world point moves across
  the map only in whole texels, for any focus.
- `createEnvironment` gets `options.shadows`. When on, the sun casts, and the Environment sets
  `renderer.shadowMap.enabled` and `type`, putting them back on dispose like the exposure. It owns
  these because shadows are the Environment's sun's (ADR 0074). The tone-mapping operator stays each
  app's. `update(camera, nowMs, shadowFocus?)` moves the sun's target to the snapped focus (the
  camera without one) and the sun to 60 units along the light from it. The target now hangs under
  the root, since a directional light aims at its target's world matrix. `lights.sun.dispose()`
  frees the shadow map. `SUN_LIGHT_DISTANCE` is gone; the lights use `SHADOW_LIGHT_DISTANCE`.
- `apps/client/src/render/shadowRoles.ts`: `setShadowRole(root, "caster" | "receiver" | "both")`
  marks every mesh under a root. In `createStage`:
  - `both`: static boxes, asset visuals, Moving Segment groups, Spinners and Props, since Track
    pieces shadow the pieces below them.
  - `caster`: the Character model. It is marked before the remote pool clones it, so remote rigs
    cast too, and a knockdown is the same model posed from the ragdoll's bones (ADR 0048).
  - `receiver`: Conveyor strips and the ice, mud and bounce sheets, so a shadow shows on a mud deck
    rather than under its opaque sheet.
  - Neither: Checkpoint and Finish Zone markers.
  The shadow focus is the target `updateCamera` last followed.
- A test asserts that none of the Environment's own meshes cast or receive.
- Builder preview: **off** (decided in 10). The 70-unit box would end mid-Track in an orbit view framing
  a whole Track, and the playtest boots the real client with the real shadows.

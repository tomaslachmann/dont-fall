# Gameplay performance: culling, asset loading and physics activation (2026-09-16)

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). It feeds a design discussion; it is not a decision record.
> Builds on `docs/research/memory-bloat-investigation.md` and the planned tickets in
> `.scratch/memory-footprint/issues/` (01 load only the Track's Assets, 02 share textures,
> 05 `/assets` caching, 06 Lobbies share one library) — those are not re-argued here.

## Question

The browser should not stutter on weaker PCs as Tracks grow, and a loader should fetch only
the Assets a Track places. The user's idea: draw only the part of the Track near the player,
and on the server too, don't compute physics for everything — only what is relevant. Is that
the right lever, what else is, and how do we measure it?

## Summary

1. **Measure first.** Nothing below has been profiled in a browser; the only numbers are from
   the files and the code. Add a frame-time + `renderer.info` overlay and a server tick-duration
   log (Measurement plan) before changing behaviour.
2. **Asset loading is the clearest win and is already scoped**: tickets 01 + 02. The client
   parses all 457 GLBs on game entry, while the base race uses 33 (4.9 MB of 32.5 MB). Ticket 02
   matters for frame time too, not only memory: each of the 33 files uploads its own copy of the
   same 1024² texture (~5 MiB each on the GPU), and each first upload is a hitch.
3. **Cheapest rendering wins, no architecture change**: pull the camera's far plane in to the
   fog's far distance (300 m → ~160–180 m, everything beyond is already solid fog colour), make
   pixel ratio / MSAA / shadow-map size a quality tier with an adaptive fallback, and pre-compile
   shaders/upload textures before the Countdown ends.
4. **Heaviest geometry is four pendulums**: `trap_trapball` is 40 344 triangles each, so the four
   on the base race are 55 % of the Track's 295 k drawn triangles (and they cast shadows). A lighter
   visual (glTF-Transform `simplify`), or LOD, is worth more than any culling scheme.
5. **"Only render what's near" is mostly already done by three.js frustum culling**, per mesh.
   A distance cutoff adds little on a straight track where the camera looks down the course,
   and must centre on the *camera* (the Spectator free cam flies anywhere), not the local
   Character. Instancing/batching the repeated KayKit pieces is the next step only if draw calls
   turn out to be the bottleneck (~150 Track meshes today).
6. **Physics distance-activation: don't start there.** Rapier's BVH broad phase already makes
   far still colliders nearly free, and fixed/kinematic pairs generate no contacts by default.
   Moving Segments *could* be deactivated by distance safely (their pose is a pure function of
   the Tick), but only after Rapier's own profiler shows `world.step()` matters. The client's
   reconcile replay (N full `world.step()`s in one frame) is the more likely CPU spike.

## Current state in this codebase

### Scale (measured from files, `baseRace.ts` + the GLBs, 2026-09-16)

- Base race: **140 Segments, 32 moving**, 33 distinct Asset Modules, z from −1 to −569 m.
- `assets/`: **457 GLBs, 32.5 MB** on disk today (the memory note's 101 MB predates a
  reconversion). The base race's 33 files total **4.88 MB**.
- Placed visual triangles: **~295 k**, 144 mesh primitives (≈ one draw call each, before shadows).
  Every file has one material and embeds its own image (`fan` has 3).

| Asset | Placed (still/moving) | Visual tris each | Share of Track tris |
|---|---|---|---|
| `trap_trapball` | 0 / 4 | 40 344 | 161 k (55 %) |
| `fan` | 2 / 0 | 31 995 | 64 k (22 %) |
| `trap_hammerbig` | 0 / 5 | 4 848 | 24 k |
| `trap_trapcirclespikedoubleblue` | 0 / 1 | 13 442 | 13 k |
| every KayKit platform/pillar/barrier | ~100 | 84–960 | < 15 % together |

- Still collision (trimeshes baked verbatim, ADR 0050): **~28 k triangles** over 108 still
  Segments. Moving Segments collide as solid parts (ADR 0065): `trap_trapball` = capsule + ball,
  `trap_hammerbig` = 2 capsules + 11 hulls, the spiked drum = 18 hulls + 3 capsules, KayKit
  movers = 1 hull.

### Loading

- `packages/shared/src/track/assetModules.ts:177` `loadAssetLibrary` fetches and parses every
  def by default; the Match server calls it at boot (`apps/server/src/matchServer.ts:233`,
  via `apps/server/src/track/assetSource.ts`).
- The client does the same on game entry: `apps/client/src/game/trackLoading.ts:100`
  (`loadLibrary`, all defs) and `:116–121` (`loadVisualTemplates` over every
  `ASSET_MODULE_DEFS` id), keeping all raw bytes in `fetchedBytes` (`:85`).
- `apps/client/src/render/assetVisuals.ts:161` clones one template per placed Segment
  (`clone(true)` shares geometry and material, so no duplicate geometry upload), but
  `parseAssetVisual` does not dedupe textures (ticket 02); the builder does
  (`apps/track-builder/src/assets/assets.ts`, `shareTextures`).
- No glTF compression: the shared reader (`packages/shared/src/track/asset.ts:22–25`,
  `:192–196`) accepts plain float positions and u8/u16/u32 indices only.

### Rendering (`apps/client/src/render/scene.ts`, three r171)

- `WebGLRenderer({ antialias: true })`, `setPixelRatio(min(devicePixelRatio, 2))` (`:338–339`),
  and the frame goes through an `EffectComposer` with **4× MSAA half-float targets**
  (`apps/client/src/render/speedLines.ts:104`, `:117`). The default framebuffer's own
  `antialias` is then probably redundant work (unverified).
- Camera far plane **300 m** (`scene.ts:355`), while fog is fully opaque at **160 m**
  (`day`/`sunset`) / **180 m** (`night`) (`packages/shared/src/track/Environment.ts:172,221,270`).
  The cloud floor is a 500 m plane (`packages/render/src/environment/cloudFloor.ts:11`).
- Every Track mesh is a separate `Mesh` with `castShadow` and `receiveShadow`
  (`setShadowRole(..., "both")`, `scene.ts:380–409`, `:423–450`). No `InstancedMesh`,
  `BatchedMesh` or merged geometry for the Track; instancing is used only by cloud puffs.
- Shadows: one sun, **2048² PCFSoft map, 70 × 70 m box** following the local Character, updated
  every frame (`packages/render/src/environment/shadows.ts:8,14,26`; `createEnvironment.ts:119–127`).
- Per frame the spring-arm camera and the knockdown floor probe raycast `collidables` — every
  Track mesh, Moving Segments included (`scene.ts:371`, `:673–680`).
- The Spectator has a free cam (`apps/client/src/game/index.ts:1191–1198`).

### Physics (`@dimforge/rapier3d-compat` 0.20.0)

- One `World` per simulation. Still boxes → fixed body + cuboid; still Asset trimeshes → fixed
  body + `trimesh(ORIENTED)` (`packages/shared/src/simulation/RapierSimulation.ts:388–424`).
- Each Moving Segment is one kinematic body. **Every tick, for every Moving Segment**, the step
  switches it to `Fixed` (`holdForSweeps`, `RapierSimulation.ts:1204`, `MovingSegment.ts:189`),
  then back to `KinematicPositionBased` with the next pose (`RapierSimulation.ts:1211`,
  `MovingSegment.ts:198–203`). All 32 on the base race, regardless of where anyone is.
- `world.step()` runs only in COUNTDOWN/RUNNING (`RapierSimulation.ts:1236`).
- Client prediction: a correction replays every unacknowledged input as a full `tick()`,
  each with its own `world.step()` (`apps/client/src/net/predictionLoop.ts:308`,
  `RapierSimulation.ts:1133–1134`) — ~3–6 steps in one frame at 100–200 ms RTT, on top of up to
  `MAX_STEPS_PER_FRAME = 5` normal steps.
- Server: fixed 30 Hz, one JSON snapshot per client per tick (`SNAPSHOT_HZ = 30`,
  `apps/server/src/match/matchLoop.ts:417–423`). No tick-duration measurement exists.

## Findings

### 1. Client rendering

**Frustum culling is already per mesh.** `WebGLRenderer.projectObject` tests every object with
`frustumCulled` against the camera frustum using its bounding sphere and recurses into children;
a `Group` itself is never culled, its children are tested one by one
([three.js r171 `WebGLRenderer.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/WebGLRenderer.js)).
Since each placed Asset is a small group of 1–2 meshes, off-screen pieces behind the camera are
already skipped. The per-object cost is a sphere-vs-6-planes test plus a matrix update — trivial
at ~150 meshes. The saving a distance cutoff adds is only for pieces *in front of* the camera
and far away.

**The far plane is the free distance cutoff.** Anything beyond `fog.far` renders as flat fog
colour, yet with `far = 300` it is still drawn. Setting `camera.far` to about `fog.far` culls it
via the same frustum test with no new code path. On a straight −Z course with the chase camera
looking down it, this is exactly "render only the part near the player", centred on the camera,
so it also works for the Spectator free cam. Risk: the cloud floor is a 500 m plane whose far
edge is meant to melt into the sky (ADR 0074); clipping it at ~170 m needs a visual check —
because fog already hides that region, probably invisible (unverified; no WebGL here).
[`PerspectiveCamera.far`](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera.far).

**`THREE.LOD`** swaps children by camera distance each frame when `autoUpdate` is on
([LOD docs](https://threejs.org/docs/#api/en/objects/LOD)). Useful here only for the few heavy
pieces (`trap_trapball`, `fan`), and it needs authored lower-detail meshes. A single simpler
visual is cheaper to maintain than LOD, since KayKit pieces are already 84–960 triangles.

**Instancing / batching.** `InstancedMesh` draws many copies of *one geometry + one material* in
one call, but it is culled as one object with a bounding sphere around all instances
([InstancedMesh docs](https://threejs.org/docs/#api/en/objects/InstancedMesh)). `BatchedMesh`
(one material, many geometries) has `perObjectFrustumCulled` and `sortObjects`
([BatchedMesh docs](https://threejs.org/docs/#api/en/objects/BatchedMesh)). Merging static
geometry with `BufferGeometryUtils.mergeGeometries` gives one draw call but loses per-piece
culling and moving individual pieces
([manual: Optimize Lots of Objects](https://threejs.org/manual/en/optimize-lots-of-objects.html)).
For this codebase, with the textures shared (ticket 02), all KayKit pieces could share **one**
material, which is the precondition for a `BatchedMesh` of every still KayKit Segment. Costs:
Spring squash scales one instance (`scene.ts` `springVisuals`), the camera and floor raycasts use
per-mesh `collidables`, and the builder shares these paths. At ~150 draw calls this is a
second-round optimisation, not first.

**Draw calls vs. triangles.** Draw calls cost CPU (driver overhead per call); triangles and
pixels cost GPU. The base race has few calls and a few very dense meshes, so on a weak
integrated GPU the triangle and fill-rate side (four 40 k pendulums drawn twice, sun pass +
main pass, at pixel ratio up to 2 with 4× MSAA) is the more likely limit. Confirm with
`renderer.info.render.calls` / `.triangles`
([WebGLRenderer.info](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.info)).

**Shadow cost.** For each shadow-casting light, `WebGLShadowMap` renders every `castShadow`
object that passes `frustumCulled` against the *shadow camera's* frustum, so only the 70 m box
around the Character costs a pass. It skips the whole pass when
`shadowMap.autoUpdate === false && needsUpdate === false`, with a per-light equivalent on
`LightShadow`
([three.js r171 `WebGLShadowMap.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLShadowMap.js),
[LightShadow docs](https://threejs.org/docs/#api/en/lights/shadows/LightShadow)). Here the box
follows the Character and 32 Segments move, so the map must update most frames; the levers are
map size (2048 → 1024 is ¼ the texels), `PCFShadowMap` instead of `PCFSoftShadowMap`, and making
small props/decals non-casting. Updating the map every second frame is possible but makes
moving shadows judder — needs a visual check.

**Resolution is the biggest GPU dial.** `setPixelRatio(2)` on a HiDPI laptop is 4× the pixels
of ratio 1, and the composer's MSAA targets multiply that again
([setPixelRatio](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.setPixelRatio)). A
quality tier (pixel ratio 1–2, MSAA 0/4, shadow 1024/2048 or off, cloud puffs `detail: "low"`,
which already exists in `createEnvironment`) plus an adaptive rule that steps down after
sustained frame times over budget is the standard approach.

**First-sight hitches.** A material's program compiles and its textures upload the first time it
is drawn; `WebGLRenderer.compileAsync(scene, camera)` exists to compile ahead of time
([WebGLRenderer.compileAsync](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.compileAsync)),
and `renderer.initTexture(texture)` uploads one ahead of time
([initTexture](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.initTexture)). With
33 materials each carrying its own copy of the pack texture, the first look down the course,
or reaching a new section, can hitch. Doing this during the Countdown (the Track is static
then) removes it.

**Raycasts.** `Mesh.raycast` tests the bounding sphere, then the bounding box, then iterates
every triangle linearly
([three.js r171 `Mesh.js`](https://github.com/mrdoob/three.js/blob/r171/src/objects/Mesh.js)).
The camera arm and floor probe are short rays, so almost every mesh exits at the sphere test,
but a ray passing through a pendulum's bounds walks 40 k triangles. The client already has the
same colliders in Rapier (with a BVH, and the trapball's collision is a capsule + ball there), so
`world.castRay` would be both cheaper and consistent with physics. Low priority unless the
profile shows it.

### 2. Asset loading

**Load only what the Track places** (ticket 01). Nothing that decides a placement needs bytes:
chaining, the builder's placement machinery and publish validation use
`ASSET_PLACEMENT_MODULES` (defs only, `assetModules.ts`), so a per-Track loader breaks nothing
there. What changes: the server's library composition becomes per Track (and per Lobby Track pick /
Round draw); the ADR 0050 "fetch-once-per-loader" rule becomes "fetch-once per id per loader";
`resolveTrack` must fail readably when an id has not been loaded. The builder keeps loading its
palette as today.

**HTTP caching** (ticket 05). `ETag` + `Cache-Control: no-cache` revalidates and returns 304
bodies for unchanged files; content-hashed URLs could use `max-age=31536000, immutable`
([web.dev: HTTP cache](https://web.dev/articles/http-cache)). Floating revisions (ADR 0050)
argue for the revalidating form.

**Sharing textures** (ticket 02). Each GLB embeds the same image; per-file parsing gives one
`Texture` per file, and three.js uploads each separately. Dedup is a GPU memory and
upload-hitch fix, and it is what makes one shared material (and so `BatchedMesh`) possible.

**glTF optimisation.**
- `gltf-transform` offers `dedup`, `weld`, `prune`, `simplify`, `quantize`, `meshopt`,
  `instance` (`EXT_mesh_gpu_instancing`), `join`, `resize` and KTX2 (`etc1s`/`uastc`)
  ([glTF Transform CLI](https://gltf-transform.dev/cli)).
- `EXT_meshopt_compression` compresses buffer views, decodes at around 1 GB/s with WASM SIMD, and
  composes with quantization
  ([Khronos spec](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md));
  three.js needs `setMeshoptDecoder`. `KHR_mesh_quantization` and `EXT_mesh_gpu_instancing` need
  no decoder; `KHR_texture_basisu` needs `setKTX2Loader`
  ([GLTFLoader docs](https://threejs.org/docs/#examples/en/loaders/GLTFLoader),
  [KHR_mesh_quantization](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md),
  [KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md)).
- **Constraint specific to us:** the server and the client's collision half read GLBs with our own
  reader (ADR 0050), which only understands float positions and plain indices. Meshopt or
  quantized *collision* would need a decoder in `packages/shared` on both sides. Compressing only
  the **visual** nodes is safe (ADR 0050 already allows visuals to vary: "detail, LOD,
  compression"), but the two roles live in one file, so the converter would have to leave the
  collision/solid nodes' buffer views uncompressed. For a 4.9 MB Track on a LAN/broadband that
  is a load-time win, not a frame-time one — defer.
- `simplify` on `trap_trapball`'s *visual* (the chain alone is 39 k triangles) is the one
  optimisation that changes frame time. Its collision is already a capsule + ball when moving
  (ADR 0065), so a lighter visual does not touch the simulation.

**Streaming ahead of the player.** A Track is 5 MB and the whole of it must exist in the
simulation from Tick 0 (Checkpoints, Moving Segments), so progressive loading buys nothing
for collision. For visuals it would add pop-in and complicate the "a Round can't start until
Assets load" rule of ticket 01. Not recommended at this scale.

### 3. Physics

**Far still colliders already cost ~nothing per step.** Rapier's broad phase is an incrementally
updated BVH that only refits colliders that changed or were removed
([`BroadPhaseBvh`, docs.rs](https://docs.rs/rapier3d/latest/rapier3d/geometry/struct.BroadPhaseBvh.html));
since rapier.js 0.18 scene queries run on that broad phase instead of rebuilding a separate
structure each step ([rapier.js CHANGELOG](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md)).
And "collision-detection is completely disabled between two colliders when both are attached to
non-dynamic bodies" by default
([Rapier JS: Colliders](https://rapier.rs/docs/user_guides/javascript/colliders)), so the 108
still trimeshes vs the 32 kinematic Moving Segments produce no narrow-phase pairs. Still trimeshes
only cost work where a Character's controller sweep, a ragdoll or a Prop is near them.
**Culling still colliders by distance is not worth it** (and not needed for determinism reasons
either).

**Moving Segments cost something every tick, for everyone.** Each one gets two body-type changes
and a kinematic target per tick. Kinematic bodies do not sleep on their own; they are woken by
interaction ([Rapier JS: Rigid-bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies)).
Every moved collider is refitted in the BVH, and a body-type switch is a change the pipeline must
process (islands, broad phase) — how expensive that is in 0.20 is **unverified**; it is a
candidate hotspot at 32 bodies × 30 Hz × (1 server + 12 clients' prediction). Rapier 0.20 exposes
`world.profilerEnabled` and `timingStep()`, `timingCollisionDetection()` and more
(`rapier3d-compat/dist/pipeline/world.d.ts`), which is how to find out.

**Disabling by distance.** Both `Collider.setEnabled` and `RigidBody.setEnabled` exist in 0.20
(`collider.d.ts:193`, `rigid_body.d.ts:394`); a disabled collider "is excluded from all collision
detection and physics" while keeping its handle
([rapier `collider.rs`](https://github.com/dimforge/rapier/blob/master/src/geometry/collider.rs)).
Removing and re-adding instead would change handles and insertion order, which Rapier's
determinism guarantee depends on ("added/removed in the exact same order",
[Rapier JS: Determinism](https://rapier.rs/docs/user_guides/javascript/determinism)) — use
`setEnabled`, never remove/re-add.

### 4. Determinism constraints for physics activation

- **What must agree.** No lockstep (ADR 0003/0005): the server is the authority and a client
  corrects its own Character. But every disagreement between the client's prediction and the
  server is a correction plus a replay (a CPU spike and a visible snap), so client and server must
  make the *same physics* happen for everything the local Character can touch.
- **A Moving Segment can be re-enabled exactly.** Its pose is `movingSegmentPose(config, tick)`,
  a pure function of the Tick (ADR 0061), and `MovingSegment.place(tick)` already puts the body at
  an exact Tick pose for replays. Re-enabling = `place(tick)` + `setEnabled(true)` + the normal
  `tick(tick + 1)`. One difference: a body teleported with `setTranslation` has no kinematic
  velocity on that first step, so a Prop or ragdoll touching it that exact tick would be pushed
  differently. Avoid it by re-enabling a margin early (below), so nothing touches it on its
  first enabled tick.
- **"Near" on the server must mean near *anything dynamic*:** any non-eliminated Character's
  capsule, any active ragdoll's bones (a ragdoll can be flung far), and any dynamic Prop. A distance
  to Players only is not enough.
- **"Near" on the client** can mean near the local Character (and its ragdoll), since only that is
  predicted. Remote Characters are mirrors placed from snapshots and Props are snapped to the
  server, so a far Segment disabled on the client cannot cause a correction. But the client must
  use the **same test with a margin at least as large** as the server's for the local Character,
  or a Segment the server has enabled could be disabled in prediction.
- **Swept bounds, not rest position.** The test must use the Segment's bounds over its whole
  Motion (a 3 m hammer arm, a 20 m slide), expanded by the scale (ADR 0062). The render side
  already computes swept bounds for the cloud floor (`lowestMovingY`,
  `packages/render/src/environment/lowestDrawnY.ts`); the simulation would need its own, derived
  from `movingSegmentPose` over one period.
- **Margin vs speed.** Dash is 15 m/s (`DASH_SPEED`); a launch to the maximum 20 m height with
  `GRAVITY_Y = −22` is ≈ 30 m/s vertically. At 30 Hz, 30 m/s is 1 m per tick. A margin of ~10 m
  on enable, ~15 m on disable (hysteresis so a Segment on the boundary does not flip each tick) is
  several seconds of normal running and ~⅓ s at the maximum launch speed — enough, since the
  test runs every tick. Numbers are a starting point, unmeasured.
- **Replays.** A client replay runs from the corrected server tick forward; activation must be
  decided from the state *inside* the replayed tick, not from the frame's current state, or a
  replay sees a different enabled set than the original prediction did.
- **Is it worth it?** On the base race 12 Players spread along 570 m will keep a good part of the
  Moving Segments near *someone* on the server. The client gains more (it only has one Character),
  but the client's cost per step is also shared with the replays. Decide from
  `timingStep()` numbers, not intuition.

### 5. Networking (brief)

Snapshots are JSON, 30 Hz, one `JSON.stringify` per client (`matchLoop.ts:417–423`), parsed on
the client's main thread. With 12 Characters this is small (unmeasured) and not a likely frame-time
cause next to rendering. It matters indirectly: jitter and loss cause corrections, and corrections
run replays. Track `netMetrics` correction counts alongside frame times.

## Prioritised recommendations

| # | What | Impact / effort / risk | Touches | ADR? |
|---|---|---|---|---|
| 1 | **Instrumentation**: dev overlay with frame-time histogram (p50/p95/p99), `renderer.info` calls/triangles/textures/programs, per-frame counts of sim steps and replayed ticks; server log of tick duration and `world.timingStep()` per N ticks | Enables everything else / small / none | none | no |
| 2 | **Tickets 01 + 02 + 05** as planned (Track-only loading, shared textures, `/assets` ETags) | High (load time, GPU memory, upload hitches) / medium / low | ADR 0050 (01), memory tickets | 01 amends 0050's fetch-once rule; 06 needs one |
| 3 | **Camera far = preset `fog.far` (+ small margin)** | Medium (culls everything past the fog) / tiny / low, visual check of cloud-floor edge | ADR 0074 render-only | no |
| 4 | **Quality tiers + adaptive downgrade**: pixel ratio cap, composer MSAA 4/0, drop redundant `antialias: true` if confirmed, shadow map 2048/1024/off, `PCFShadowMap`, puffs `detail: "low"` | High on weak GPUs / small–medium / low (look changes only at low tiers) | ADR 0074 (shadows were the user's call) | short ADR or amendment: shadows become a quality setting |
| 5 | **Warm up during Countdown**: `compileAsync` + `initTexture` for the Stage | Medium (removes first-sight hitches) / small / low | none | no |
| 6 | **Lighter `trap_trapball` visual** (glTF-Transform `simplify` on the chain in the converter), check `fan` too | Medium–high (55 % of Track triangles) / small / low: visual only, collision untouched (ADR 0065) | ADR 0050 permits visual variation | no |
| 7 | **Non-casting small pieces** (flags, signage, spring pads) and consider disabling shadow cast on pieces fully below the deck line | Low–medium / small / low | ADR 0074 | no |
| 8 | **Profile Moving Segment ticking** (`holdForSweeps` / `tick` body-type switches); if hot, try a cheaper way to suppress kinematic friction | Unknown until measured / medium / medium (ADR 0061 Ride rule) | ADR 0061 | if the mechanism changes |
| 9 | **Distance activation of Moving Segments** via `setEnabled`, swept bounds + hysteresis, server "near any dynamic body", client "near local Character", decided inside replayed ticks | Only if #1/#8 show `world.step()` is a real share / medium–large / medium (prediction divergence) | invariant 2 (shared deterministic step), ADR 0003/0005/0061 | **yes** |
| 10 | **`BatchedMesh` for still KayKit Segments** (after #2 gives one shared material) | Only if draw calls are the bottleneck / large / medium (Spring squash, raycasts, builder parity) | ADR 0050 visuals path | probably |
| 11 | Camera/floor raycasts through Rapier `castRay` instead of three.js meshes | Low / small / low | none | no |
| — | Not recommended now: culling still colliders by distance; streaming visuals ahead of the player; meshopt/quantized collision | — | — | — |

## Measurement plan

**Weak-PC reference.** A real low-end machine (Intel UHD / older iGPU laptop) is the ground truth.
As a proxy on a dev Mac: Chrome DevTools Performance panel with **CPU throttling 4×/6×**
([Chrome DevTools: Performance](https://developer.chrome.com/docs/devtools/performance/reference)),
the window at a HiDPI size, and the pixel ratio forced to 2. CPU throttling does not slow the GPU,
so GPU conclusions need real hardware.

**Scenarios** (same each run): the base race, 1 Player in free-roam (`?freeroam=1`) running the
course start to finish; then 2–4 browsers in a Match; the Spectator free cam flying the full length.
Sections to note: the wrecking-ball bridge (4 × `trap_trapball`), hammer alley, the fan climb.

**Client metrics.**
- Frame time from `requestAnimationFrame` deltas: histogram, p50/p95/p99, count of frames > 33 ms
  and > 50 ms (a "stutter" count), per section.
- `renderer.info.render.calls`, `.triangles`, `info.memory.geometries/textures`, `info.programs.length`
  ([WebGLRenderer.info](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.info)). Note `info`
  resets per `render()` call, and the composer renders several passes; read it with
  `info.autoReset = false` and reset manually once per frame.
- Sim steps per frame and replayed ticks per frame (from `PredictionLoop`), corrections per minute.
- Performance panel: long tasks, GC, "GPU" track, and the time split between `stage.render` and
  prediction.
- Load: time from Track pick to first frame, bytes fetched, JS heap after load.

**Server metrics.** `performance.now()` around each tick in `matchLoop.ts` (p50/p99, ticks over
33 ms), `world.profilerEnabled = true` with `timingStep()` / `timingCollisionDetection()` sampled,
and event-loop delay with `perf_hooks.monitorEventLoopDelay`
([Node.js perf_hooks](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)),
with 1, 4 and 12 bots on the base race.

**Budgets (proposed).**
- Client: p95 frame ≤ 16.7 ms on a mid machine at the default tier; on the weak reference, p95 ≤
  33 ms at the lowest tier with < 1 % frames over 50 ms. Draw calls ≤ ~300, triangles in view
  ≤ ~300 k at the default tier.
- Simulation: one client `tick()` ≤ 2 ms p95 (so 5 steps + a 6-tick replay stays under a frame).
- Server: tick p99 ≤ 10 ms with 12 Players (a third of the 33 ms budget, leaving room for several
  in-process Lobbies, ADR 0054/0058).
- Load: game entry on the base race ≤ 5 MB transferred, cached reload near zero.

Record each result in this file (or a follow-up) with commit, machine, browser and tier.

## Open questions for the user

1. Which machine is "weaker PC"? A real target device (GPU model, screen resolution) decides
   whether the tiers are GPU-first or CPU-first.
2. Are you fine with quality tiers that turn shadows off (or down to 1024²) at the lowest level,
   given real shadows were your explicit call in ADR 0074? Automatic, or a setting in the menu?
3. Is a simplified `trap_trapball` look acceptable (fewer chain links / a smoother chain)?
4. May the far plane follow the fog, so nothing past ~160–180 m is drawn? (It is fogged out today.)
5. Do you want distance-based physics activation designed now, or only if the profile says
   `world.step()` matters? It touches the shared-step invariant and would need an ADR.
6. Order: ship tickets 01/02 first (as planned), then instrumentation + tiers — or instrumentation
   first so there is a before/after for 01/02?

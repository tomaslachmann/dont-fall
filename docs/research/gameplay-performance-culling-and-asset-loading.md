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

## Decisions (user, 2026-09-17)

This note becomes milestone **M13 — Smooth on a weaker PC** (`docs/milestones/M13.md`,
`.scratch/m13-smooth-on-weaker-pcs/issues/`). Answers to the open questions above:

1. *Weaker PC:* **none available, so it is skipped** (user, 2026-09-17: "slabší PC vynecháme,
   protože nemám k dispozici"). The dev Mac with 4× DevTools CPU throttling stands in for a weak
   CPU. A weak GPU stays unmeasured, so the GPU side of the quality levels rests on this note's
   reasoning, not on numbers.
2. *Quality tiers:* **the player picks the level in Settings, and nothing switches it
   automatically** ("Jen volba v nastavení"). The lowest level may turn shadows off.
   Recorded as **ADR 0079** (amends ADR 0074). The research's adaptive downgrade is declined.
3. *Simplified `trap_trapball`:* **declined.** Recommendation #6 is not built.
4. *Far plane follows the fog:* **yes.** M13 ticket 04.
5. *Physics distance activation:* **only if the profile says `world.step()` matters**
   ("Až podle měření"). M13 ticket 02 measures, ticket 07 decides.
6. *Order:* **instrumentation first** ("Nejdřív měření"), then tickets 01/02, so they have a
   before/after.

Also declined: recommendation #7, non-casting small pieces.

## Results

### Before — simulation benchmark (M13 ticket 03, 2026-09-17)

`pnpm bench:sim` (M13 ticket 02), commit `9401968d` plus the uncommitted M13 work, Apple M4 (10
cores), macOS 25.5, Node 24.1. The machine was not idle (load average ~5), so single spikes are
noise. 1800 measured ticks per run after 90 warm-up ticks; times in ms.

Columns:
- step through user changes: Rapier's own profiler, mean per tick.
- moving seg., char. sweeps, char. updates: timed around the shared step's own loops, outside
  `world.step()`, mean per tick.
- snapshot: the Match loop's snapshot build plus one `JSON.stringify` per client.
- down: the share of Character-ticks spent in `Ragdoll`/`GettingUp`.

The scripted bots fall and get knocked down far more than players do, so these are heavy ticks.

| scenario | chars | tick p50 | p95 | p99 | max | >2 ms | >10 ms | step | collision | solver | user changes | moving seg. | char. sweeps | char. updates | snapshot p95 | replay p95 | falls | down |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| server · start · moving | 1 | 0.150 | 0.450 | 0.640 | 1.951 | 0 | 0 | 0.116 | 0.066 | 0.024 | 0.002 | 0.010 | 0.054 | 0.007 | 0.020 | — | 1 | 35 % |
| server · start · still | 1 | 0.070 | 0.260 | 0.380 | 0.837 | 0 | 0 | 0.033 | 0.007 | 0.022 | 0.000 | 0.000 | 0.043 | 0.002 | 0.020 | — | 0 | 43 % |
| server · spread · moving | 1 | 0.150 | 0.190 | 0.200 | 0.714 | 0 | 0 | 0.113 | 0.057 | 0.034 | 0.002 | 0.007 | 0.012 | 0.002 | 0.020 | — | 0 | 74 % |
| server · spread · still | 1 | 0.070 | 0.110 | 0.130 | 0.800 | 0 | 0 | 0.043 | 0.008 | 0.030 | 0.000 | 0.000 | 0.012 | 0.002 | 0.020 | — | 0 | 72 % |
| server · start · moving | 4 | 0.320 | 0.590 | 0.710 | 0.990 | 0 | 0 | 0.184 | 0.075 | 0.081 | 0.002 | 0.007 | 0.132 | 0.008 | 0.120 | — | 1 | 51 % |
| server · start · still | 4 | 0.250 | 0.510 | 0.650 | 1.183 | 0 | 0 | 0.125 | 0.026 | 0.087 | 0.001 | 0.000 | 0.133 | 0.004 | 0.120 | — | 0 | 53 % |
| server · spread · moving | 4 | 0.190 | 0.360 | 0.510 | 0.771 | 0 | 0 | 0.127 | 0.065 | 0.039 | 0.002 | 0.007 | 0.052 | 0.009 | 0.070 | — | 41 | 20 % |
| server · spread · still | 4 | 0.100 | 0.210 | 0.380 | 0.858 | 0 | 0 | 0.050 | 0.010 | 0.033 | 0.000 | 0.000 | 0.044 | 0.004 | 0.070 | — | 32 | 19 % |
| server · start · moving | 12 | 1.070 | 2.330 | 3.080 | 3.904 | 169 | 0 | 0.298 | 0.100 | 0.160 | 0.003 | 0.007 | 0.901 | 0.021 | 0.720 | — | 12 | 35 % |
| server · start · still | 12 | 1.340 | 2.380 | 3.160 | 6.557 | 219 | 0 | 0.194 | 0.044 | 0.127 | 0.001 | 0.000 | 1.245 | 0.012 | 0.620 | — | 20 | 26 % |
| server · spread · moving | 12 | 0.510 | 1.460 | 2.300 | 2.685 | 32 | 0 | 0.193 | 0.074 | 0.085 | 0.002 | 0.008 | 0.413 | 0.020 | 0.430 | — | 122 | 16 % |
| server · spread · still | 12 | 0.580 | 3.990 | 4.430 | 6.422 | 785 | 0 | 0.108 | 0.024 | 0.070 | 0.001 | 0.000 | 1.422 | 0.010 | 0.450 | — | 74 | 13 % |
| client · 1 predicted + 11 mirrors | 1 | 0.100 | 0.170 | 0.210 | 0.711 | 0 | 0 | 0.088 | 0.053 | 0.015 | 0.002 | 0.008 | 0.011 | 0.002 | — | 1.000 | 168 | 30 % |

**What the numbers say:**

- **The server budget holds on this machine.** With 12 Characters, a tick is 0.5–1.3 ms p50 and
  2.3–4.4 ms p99, against the 10 ms p99 budget. A server CPU 2–3× slower would sit near the budget
  with several Lobbies in one process, so the Match server's log (`DONTFALL_PERF=1`) is the
  number to watch there.
- **`world.step()` is not the hot part.** At 12 Characters it is 0.1–0.3 ms. Moving vs still
  adds ~0.1 ms to the step (collision detection 0.07–0.10 vs 0.02–0.04). The per-tick Moving Segment
  switching costs 0.007–0.010 ms, and Rapier's user-change propagation 0.002–0.003 ms.
  **Distance activation of Moving Segments would save at most ~0.1 ms of a ~1 ms tick: not worth
  its ADR** (research §4, recommendation #9). Ticket 07 makes the final call with the after
  numbers.
- **The hot part is the Characters' own sweeps** (`beginTick`, the kinematic controller's
  collision sweep): 0.4–1.4 ms at 12 Characters, against 0.01–0.05 ms for one. The cost grows
  faster than the Character count and is highest where Characters stand together (`start`, and
  `spread` runs doubled up at one Respawn). This was not in the research's list; it is the lever to
  look at before anything in Rapier's step.
- **Snapshots cost as much as the step.** Building the state and stringifying it once per client is
  0.43–0.72 ms p95 at 12 clients, almost all of it the twelve `JSON.stringify` calls of
  near-identical payloads (research §5). Serialising the shared part once would cut most of it.
- **The client's prediction is cheap here.** One predicted tick is 0.17 ms p95 and a 6-tick replay
  1.0 ms p95. A worst frame of 5 steps plus a replay is ~2 ms on this machine, and would be ~8–12 ms
  on a CPU 4–6× slower: a real share of a 16.7 ms frame, but not the first suspect next to
  rendering.

### Before — browser, dev Mac, no throttling (2026-09-17)

The user's run: free-roam on the base race (`?perf=1`, quality as shipped = today's `high`), the
M13 overlay's summary.
- **Machine:** 10 cores (the M4), `devicePixelRatio` 2, canvas 2488 × 1850 (CSS 1244 × 925). The
  user agent read as a Pixel 9, so DevTools device emulation was on; the hardware is the Mac's.
- **Run:** 60 s, 3572 frames. It reached z ≈ −400 of −569, so not the whole course.

| | p50 | p95 | p99 | max | over 17 / 33 / 50 ms |
|---|---|---|---|---|---|
| frame | 16.7 | 17.8 | 25.2 | 183 | 481 (13 %) / 6 / 5 |
| sim CPU (up to 5 steps) | 0.45 | 1.05 | 1.40 | 10.5 | — |
| `stage.render()` CPU | 1.8 | 3.4 | 4.2 | 86 | — |

- **Load:** 4.7 s from boot to first frame; **460 files, 35.5 MB** downloaded (the base race places
  33 files, 4.9 MB: memory-footprint 01). JS heap after 60 s: 167 MB.
- **Renderer, latest frame:** 217 calls, 232 k triangles, 54 geometries, 41 textures, 17
  programs. **Busiest frame:** 253 calls, **550 k triangles** (both counts include the shadow pass).

Per 50 m cell, by where the camera's target stood (x always within −50…50; the camera looks ahead
along −z). The sections start at: door rush −30, sweepers −66, wrecking balls −126, moving platforms
−186, spinning squares −271, climb −328, belt climb −382, ice −453, hammer alley −501, finish −561.

| z | frames | p95 | p99 | max | over 17 ms | max calls | max triangles |
|---|---|---|---|---|---|---|---|
| −50…0 (start) | 312 | 24.7–25 | 50.2 | **183** | 45 (14 %) | 135 | 388 k |
| −100…−50 | 344 | 24.7–25 | 25.7 | 51 | 41 (12 %) | 207 | 427 k |
| −150…−100 | 758 | 17.3–24.9 | 25.2 | 66 | 112 (15 %) | 253 | **550 k** |
| −200…−150 | 705 | 24.4 | 25.2 | 33 | 110 (16 %) | 245 | 508 k |
| −250…−200 | 301 | 17.7 | 25.1 | 26 | 39 (13 %) | 236 | 278 k |
| −300…−250 | 335 | 17.3 | 17.7 | 25 | 25 (7 %) | 236 | 264 k |
| −350…−300 | 393 | 24.1 | 25.2 | 26 | 66 (17 %) | 233 | 315 k |
| −400…−350 | 424 | 17.6 | 25.1 | 25 | 43 (10 %) | 225 | 298 k |

**What this run says:**

- **The CPU is not what misses frames here.** Sim plus render CPU is ~2–4 ms of a 16.7 ms frame,
  yet 13 % of frames run long (mostly ~25 ms). This points at the GPU: pixel ratio 2, 4× MSAA
  half-float targets and a 2048² soft shadow pass (ticket 05's levers). One run cannot prove it; the
  4× CPU-throttled run below narrows it; no weak GPU is available to settle it.
- **Where it misses loosely follows the geometry.**
  - The three densest bands miss 12–16 % of frames. They hold 427–550 k triangles: the approach
    to the wrecking balls (four `trap_trapball`, research §Scale) and the balls themselves, seen
    from −150…−100.
  - The 264–315 k bands further on miss 7–17 %, so triangles are not the whole story.
  - The heaviest frame of the run looks at the balls.
- **The worst hitches are early.** Four of the five frames over 50 ms fall in the first 100 m,
  including the run's longest (183 ms), and the fifth at −150…−100. The longest `stage.render()`
  of the run was 86 ms. That fits first-sight shader compiles and texture uploads. That is ticket 06's target (warm-up), with memory-footprint 02 cutting the uploads.
- **Draw calls (134–253) are within the ~300 budget.** `BatchedMesh` (recommendation #10) has no
  case yet.
- **Loading is 7× the budget:** 35.5 MB against ≤ 5 MB. Memory-footprint 01 is the fix.

**Run 2, the same setup, longer (2026-09-17).**
- **Run:** 188 s, 11 378 frames, again to z ≈ −400. About 100 s of it was spent in the first 50 m
  (6468 frames there).
- **Not throttled, whatever the intent:** sim CPU p50 0.10 ms and render CPU p50 1.35 ms are no
  higher than in run 1, where 4× throttling would roughly quadruple both.
- **Load:** 4.8 s, the same 460 files / 35.5 MB. Heap 151 MB.

| | p50 | p95 | p99 | max | over 17 / 33 / 50 ms |
|---|---|---|---|---|---|
| frame | 16.7 | 24.2 | 25.7 | 279 | 1940 (17 %) / 54 / 9 |
| sim CPU | 0.10 | 0.95 | 2.85 | 35 | — |
| `stage.render()` CPU | 1.35 | 3.55 | 4.6 | 53 | — |

- **Renderer:** up to 277 calls and 551 k triangles; 41 textures and 17 programs, the same as run 1.
- **Where the long frames fall:**
  - The first 50 m holds 1196 of the 1940 frames over 17 ms (18 % of its frames), 49 of the 54 over
    33 ms, 6 of the 9 over 50 ms, and the run's longest frame (279 ms). It is also where the most
    draw calls were counted (277, at 394 k triangles).
  - The other cells miss 10–19 % of frames. Only −400…−350, where the belt climb (−382) first comes
    into view, has hitches again: 5 frames over 33 ms, max 93 ms. That is another first-sight
    pattern for ticket 06.
- **Both runs agree:** the CPU work per frame is small, a steady 10–17 % of frames run to ~25 ms,
  and the hitches cluster where the camera sees something for the first time.

### Before — browser, dev Mac, 4× CPU throttling (2026-09-17)

The user's run 3: device emulation off (Chrome 151 on macOS), DevTools CPU 4× slowdown.
- **Run:** 69 s, 5863 frames, to z ≈ −400.
- **Not directly comparable to runs 1–2 on the GPU side,** for two reasons:
  - The canvas is smaller: 1946 × 1562, 3.0 MP against 4.6 MP (DevTools docked beside it).
  - Frames now pace at ~9 ms (p50 9.1), so the page ran on a 120 Hz display, where runs 1–2 were
    held to 60 Hz (by the emulation or the display). On a 120 Hz display a frame "over 17 ms" has
    missed two refreshes.
- **Load:** **9.6 s** to the first frame (twice run 1's 4.7 s; parsing all 460 files on a slower
  CPU). Heap 276 MB.

| | p50 | p95 | p99 | max | over 17 / 33 / 50 ms |
|---|---|---|---|---|---|
| frame | 9.1 | 17.3 | 17.7 | 292 | 451 (8 %) / 5 / 3 |
| sim CPU | 0.05 | 3.85 | 4.9 | 29 | — |
| `stage.render()` CPU | **5.2** | **7.55** | **9.1** | 50 | — |

Renderer: up to 254 calls and 551 k triangles; 43 textures and 17 programs.

**What throttling shows:**

- **`stage.render()` is the CPU cost that grows,** about 4×: 1.35–1.8 → 5.2 ms at p50,
  3.4–3.55 → 7.55 ms at p95. It is three.js's own work before the GPU sees anything: scene
  traversal, matrix updates, culling, the shadow pass and the composer passes. On a CPU this slow
  it is the largest per-frame cost, and it scales with the number of objects and passes. That
  moves object-count work (instancing/`BatchedMesh`, fewer shadow casters) up the list for weak
  CPUs, and puts `medium`/`low` (ticket 05) ahead of any physics work.
- **Prediction stays small but spiky.** Sim CPU is 0 in most 120 Hz frames (p50 0.05, no tick
  due) and 3.9–4.9 ms at p95/p99, when a frame runs several ticks.
- **Held against the budgets:**
  - A slow CPU with this GPU would still make 60 Hz most of the time: p95 17.3 ms, and 8 % of
    frames over 17 ms.
  - CPU work alone (render p99 9.1 plus sim p99 4.9) stays under 16.7 ms. A weak GPU is the unknown,
    and none is available to measure.
- **Hitches are again at the start:** all three frames over 50 ms fall in the first 50 m (p99 59,
  max 292 ms).
- **Loading doubles with the CPU:** 9.6 s, which memory-footprint 01 addresses directly.

No weaker PC will be measured (the user has none, 2026-09-17); this throttled run is the weak-CPU
reference. Still to run (ticket 03): the Spectator free cam.

### After — browser, dev Mac, `high`, no throttling (2026-09-17)

The user's run, after M13 04, 05, 06 and memory-footprint 01/02, compared with the before runs 1 and 2
above.
- **Machine:** Chrome 151 on macOS, canvas 3008 × 1562 (4.7 MP, about run 1's size), quality `high`.
- **Run:** 214 s, 14 759 frames, the **whole course** (the cells reach z −600).

| | before (runs 1 / 2) | after |
|---|---|---|
| boot → first frame | 4.7 s / 4.8 s | **0.74 s** (warm-up included) |
| files / bytes downloaded | 460 / 35.5 MB | **36 / 6.5 MB** (33 GLBs + 3 sheet textures) |
| JS heap | 167 / 151 MB | **106 MB** |
| frame p50 / p95 / p99 | 16.7 / 17.8–24.2 / 25.2–25.7 | 16.7 / **17.6** / **17.7** |
| frames over 33 / over 50 ms | 6 / 5 and 54 / 9 | **4 / 1** |
| longest frame | 183 / 279 ms | 166 ms |
| sim CPU p95 | 1.05 / 0.95 ms | 1.05 ms |
| `stage.render()` CPU p50 / p95 / max | 1.8 / 3.4 / 86 · 1.35 / 3.55 / 53 | 2.3 / 3.25 / 44 |
| busiest frame: calls / triangles | 253 / 550 k · 277 / 551 k | **223 / 482 k** |
| textures / programs | 41 / 17 | **14 / 30** |

**What the after run says:**

- **Loading is the biggest change:** 6× faster to the first frame, 5.5× fewer bytes, 36 % less heap.
  The 6.5 MB is still over the proposed 5 MB budget; the three sheet textures (ice, mud, bounce,
  ~1.6 MB) are loaded whether the Track uses them or not.
- **The ~25 ms frames are gone.** p99 fell from ~25 to 17.7 ms. The "over 17 ms" count (1723, 12 %)
  is now vsync jitter, frames of 17.1–17.7 ms, not missed frames. The 17 ms threshold is too tight
  to separate the two; over 33 and over 50 are the meaningful counts.
- **Shared textures work:** 41 → 14 textures on the GPU. Programs rose from 17 to 30 because the
  warm-up now compiles everything, hidden and not-yet-seen variants included, ahead of time.
- **The far plane cuts the far sections.** Triangles at z −250…−300 fell from 262–264 k to
  163–165 k, and the busiest frame from 550 k to 482 k.
- **One hitch remains at the start:** 166 ms, the only frame over 50 ms (3 of the 4 over 33 ms are
  there too). A likely cause, unverified: the account's hat (ADR 0083) and skin tint are applied
  when `fetchAccount` resolves, after the warm-up. The first draw of the hat then compiles and
  uploads on the spot. Nothing else in the run hitches: every other cell stays under 33 ms, bar one
  33.3 ms frame near the finish.

Still to run: the same at `medium` and `low` with 4× CPU throttling, and the Spectator free cam.

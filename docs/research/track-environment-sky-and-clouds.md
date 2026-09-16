# The space around a Track: sky, clouds, fog and light

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). It follows the same convention as
> `docs/research/spring-assets-launch-and-animation.md`. This file feeds a design
> discussion. It is **not** a decision record: if the recommendation is adopted,
> it should be recorded as an ADR the normal way.
>
> **Partly settled (2026-09-16) as ADR 0074.** Adopted: the term Environment;
> `day`, `sunset` and `night` as the first presets; the Track author picks it
> on the Revision; Neutral tone mapping; a cloud floor under the Track; a
> builder preview toggle. Changed by the user: **real shadow maps**, not the
> blob shadow §6 recommends. From §11's later questions: a new
> `packages/render` (8), render-only confirmed (10), kill height stays −8 (9),
> composer MSAA fixed with this work (13). Cloud style (11) and the procedural
> box material (12) are still open.
>
> Written 2026-09-16, after the user asked: *"udelame research jak delat věci
> kolem dráhy tím myslím pozadí jako oblohu s mraky atd, at je to reusabilni,
> hezké atd."* In English: research how to build what surrounds the Track (the
> background, meaning a sky with clouds and so on) so that it is reusable and
> looks good. Today every Round runs inside a flat navy void. Nobody has
> designed anything around the Track yet.
>
> Three.js facts are pinned to **r171**, the version both `apps/client` and
> `apps/track-builder` depend on (`"three": "^0.171.0"`). They were checked
> against the installed `three@0.171.0` package and against the `r171` tag on
> GitHub.

Scope: everything drawn around the Track that is not a Segment. That covers the
sky, the clouds, what lies **under** the Track, distant scenery, fog, and the
lighting that has to match all of it. It also covers how to make these a
reusable, per-Track choice that the game and the Track builder draw identically.
Out of scope: Module art, the HUD, and anything the simulation reads.

Art direction assumed throughout: stylized, bright, chunky and toy-like. The Track
pieces come from KayKit-style low-poly packs, and the Character is BLIP
(`apps/client/public/models/BLIP.glb`, ADR 0071). Fall Guys is a reference for
match structure only (CLAUDE.md), but a bright sky over a void is the obvious fit
for the genre.

---

## A term this note needs: **Environment** (proposed)

`CONTEXT.md` has no word for "everything around the Track". This note uses
**Environment** and proposes adding it to the glossary:

> **Environment**: The sky, clouds, fog, light and distant scenery a Round is
> drawn inside. It is a named preset a Track refers to, and it is render-only:
> it never collides, is never simulated, and is never placed as a Segment.
> Contrast with Scenery, a placed Module that may block a Character.
> _Avoid_: skybox, background, map theme, biome, weather.

Two nearby terms should stay distinct:

- **Scenery** (already defined) is a Module you place, and it may block you. An
  Environment is neither placed nor solid. The difference is load-bearing (see §4).
- **Level themes** is a bare phrase on the roadmap. `docs/research/screens-inventory.md`
  records that it is "undefined anywhere". A reasonable reading is that a level
  theme will one day *bundle* an Environment with Module skins and music. On that
  reading the Environment is the first ingredient of a theme, not a synonym for
  it. Keeping the word "theme" free avoids having to rename things later.

---

## Recommendation

**Build one render-only `Environment` seam, driven by a small set of named data
presets, drawn identically by the game and the Track builder. Keep it all
procedural: a gradient sky dome, a cloud floor under the Track, a few instanced
low-poly cloud puffs, linear fog matched to the horizon colour, lights and an
environment map derived from the same palette, and Khronos PBR Neutral tone
mapping so the authored colours survive.** No image skyboxes, no physically
based `Sky.js`, no volumetric clouds, and no shadow maps in the first pass.

- **Sky: a camera-following gradient dome.** A custom `ShaderMaterial` on an
  inverted sphere with three colour stops (zenith, horizon, below-horizon) and an
  optional sun disc. It follows the camera's position but not its rotation, and
  uses the `z = w` trick three.js's own background box uses, so it never clips
  against the 300-unit far plane. It uses `fog: false` and draws last among
  opaque objects. The cost is one draw call and a trivial fragment shader.
  `Sky.js` is the wrong tool (§2).
- **What is under the Track matters more than the sky.** The chase camera
  always looks *down*, and it never sees sky higher than about 22° (§1c). A
  **cloud floor**, a single camera-following plane shaded with world-space
  scrolling noise, sits just above the kill height. Most platforms are read
  against it, and a Falling Character sinks into it just before it Respawns. It
  replaces today's translucent black `killPlane`.
- **Clouds are opaque instanced low-poly puffs** (merged icospheres, one draw
  call per shape variant) that drift at render time and wrap around the camera.
  Transparent billboards cost more in fill-rate, and raymarched volumetrics cost
  far more (§3).
- **Fog is `THREE.Fog` (linear), coloured with the preset's horizon stop.** That
  way fogged geometry melts into the sky at exactly the line where the dome turns
  from horizon to below-horizon. Linear fog keeps the near Track fully clear,
  which matters for a race.
- **Light comes from the same palette.** `HemisphereLight` takes the sky colour
  and the cloud-floor shade colour. The `DirectionalLight` direction is the
  preset's sun direction, the same vector the sky shader uses to draw its sun
  disc. One `PMREMGenerator.fromScene` bake of the dome becomes
  `scene.environment`. This is the single biggest visual improvement available:
  every KayKit, trap and BLIP material is a glossy dielectric (roughness 0.2–0.43),
  and three.js computes no indirect specular at all without an environment map (§6).
- **Tone mapping is `NeutralToneMapping`, in both apps.** It is built to leave
  base colours up to about 0.8 untouched with no hue shift, where ACES and AgX
  desaturate exactly the saturated blues, yellows and greens a toy-like palette is
  made of (§6).
- **An Environment is data.** An `EnvironmentId` plus plain `EnvironmentPreset`
  records (colours, sun angles, fog distances, cloud settings, light
  intensities) live in `packages/shared`, as three-free data like
  `BounceOverlay.ts`. The three.js implementation,
  `createEnvironment(scene, renderer, preset, options) → { update, dispose }`,
  lives in **one** new workspace package that both `apps/client` and
  `apps/track-builder` import, so the builder previews exactly the sky the game
  draws.
- **The preset id lives on the Revision as a row attribute,** following the
  `time_limit_ms` precedent (ADR 0038). It is authored in the builder and arrives
  at the client through the `GET /tracks/:id` fetch the client already makes.
  The Match server and the shared step never read it: it is not part of
  `RoundRules` (ADR 0043) and is never on the Snapshot. An unknown id on an old
  client falls back to the default preset with a dev warning, the same contract
  as a failed ice texture load.

---

## 1. What exists today

All of the following was checked against the code.

### (a) The game Stage: one dark void, three hardcoded lights, no colour pipeline

`apps/client/src/render/scene.ts`, `createStage`:

| what | value | line |
|---|---|---|
| `BACKGROUND_COLOR` | `0x0b0e14` (near-black navy) | 64 |
| `scene.background` | `new THREE.Color(BACKGROUND_COLOR)` | 304 |
| `scene.fog` | `new THREE.Fog(BACKGROUND_COLOR, 30, 110)` | 305 |
| camera | `PerspectiveCamera(55, aspect, 0.1, 300)` | 307–312 |
| hemisphere | `HemisphereLight(0xbfd4ff, 0x1b2430, 1.1)` | 316 |
| sun | `DirectionalLight(0xffffff, 1.7)` at `(10, 18, 6)`, target at the origin | 317–319 |
| procedural boxes | `MeshStandardMaterial({ color: 0x1c2740, roughness: 0.95 })`, dark navy picked for a dark void | 321 |
| kill plane | 200 × 200 `PlaneGeometry`, `MeshBasicMaterial(0x05070b, opacity 0.6)` at `killPlaneY` | 490–497 |

The Stage sets no tone mapping, no shadows and no `scene.environment`. The
renderer's defaults at r171 are `toneMapping = NoToneMapping` and
`outputColorSpace = SRGBColorSpace`
([`WebGLRenderer.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/WebGLRenderer.js)).

Two plumbing facts decide how an Environment plugs in:

- **The whole scene renders through `EffectComposer`.** `Stage.render` is
  `speedLines.render()`, which runs `RenderPass → ShaderPass (speed lines) →
  OutputPass` (`speedLines.ts`). The composer's targets are half-float and in the
  linear working space
  ([`EffectComposer.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/postprocessing/EffectComposer.js)).
  While rendering into a target, three.js disables per-material tone mapping
  (`WebGLRenderer.js`, the `_currentRenderTarget === null` check), and
  `OutputPass` applies `renderer.toneMapping` and the sRGB transfer to the whole
  frame at the end
  ([`OutputPass.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/postprocessing/OutputPass.js)).
  So setting `renderer.toneMapping` in the client already works, and it tone-maps
  sky, fog and geometry together. The Track builder renders straight to its
  canvas, so there each material tone-maps itself. §2 explains why a custom sky
  shader must be written to be correct on both paths.
- **Only listed meshes block the camera.** The spring-arm camera raycasts
  `collidables`, an explicit array the Stage fills (`castArm`,
  `raycaster.intersectObjects(collidables, false)`). The deck sheets and chevron
  strips already stay out of it. Anything the Environment adds is outside the
  camera raycast as long as it is never pushed onto that array. No `Layers`
  mask is needed.

`dispose()` runs `disposeSceneGraph(scene)`, which walks the scene's children and
frees their geometries, materials and material textures. It does **not** reach
`scene.environment`, `scene.background`, or any render target. An Environment
that bakes a PMREM must free that bake itself (§8).

A Track change (`loadTrack`) disposes the whole Stage, WebGL context included,
and builds a new one. So an Environment is created and destroyed with its
Stage, and nothing about it survives a Track swap.

### (b) Two more lighting setups, both unrelated to the game's

- **Track builder** (`apps/track-builder/src/scene/viewport.ts`): the main
  viewport uses `scene.background = 0xefe9fa` (lavender), `AmbientLight(0xffffff, 0.6)`,
  `DirectionalLight(0xffffff, 0.9)` at `(10, 20, 10)`, a `GridHelper`, a far plane
  of 2000 and `OrbitControls` (lines 245–256). The shared thumbnail renderer uses
  `AmbientLight 0.7` plus `DirectionalLight 0.9` over a transparent background
  (lines 105–108). ADR 0063 made the lavender canvas a **deliberate decision**:
  "a dark 3D hole in a light tool would have been the port's most visible seam".
  An Environment preview in the builder therefore has to be something the author
  switches on, not a replacement for the authoring view.
- **Screens** (`apps/client/src/screens/CharacterPreview.tsx`, used by
  `Turntable.tsx`): `HemisphereLight(0xffffff, 0x4a3a6a, 1.1)`, a key light
  `1.6` and a lilac rim light `0.7`, over an `alpha: true` canvas.

So the game, the builder and the Screens light the same assets in three different
ways, and none of them matches what an author will see in a Round. Only the
game-versus-builder mismatch is in scope here. The Screens can simply adopt a
preset's light colours later if that is wanted.

### (c) The chase camera never looks up, which makes what is below the Track the main backdrop

`apps/client/src/input/camera/springArm.ts` places the camera `CAMERA_DISTANCE = 7`
behind and above its target at `pitch`, clamped to `PITCH_MIN = 0.1` …
`PITCH_MAX = 0.85` rad. `updateCamera` then `lookAt`s the target, so the view
direction is always depressed by exactly `pitch`. With the 55° vertical FOV, the
top edge of the frame sits at **27.5° − pitch**:

| pitch | view direction | top edge | bottom edge | share of frame below the horizon |
|---|---|---|---|---|
| 0.10 rad (5.7°) | 5.7° down | **+21.8°** | −33.2° | ~60 % |
| 0.48 rad (27.5°) | 27.5° down | 0° | −55° | 100 % |
| 0.85 rad (48.7°) | 48.7° down | **−21.2°** | −76.2° | 100 % |

(Frame corners sit slightly closer to the horizon than the top-centre, so +21.8°
is the true maximum elevation visible.) Four consequences follow, and they shape
everything below:

1. **In-game, no sky above about 22° is ever visible.** The dome's zenith is only
   seen in the Track builder's orbit view.
2. **For at least half of the pitch range the horizon is off-screen,** and the
   whole backdrop is whatever is below the Track. Most platforms are read
   against the under-Track layer, not against the sky.
3. **A sun high enough to light decks well (45–60°) is never on screen in-game.**
   The sun disc matters only for low sunset-style suns and for the builder.
4. **Fog does most of the work at the horizon.** The line where fogged geometry
   meets the dome's horizon stop is on screen whenever the player looks
   flattest, which is exactly when they are looking far down the Track.

### (d) The kill plane is fixed, and Tracks can sit close to it

`DEFAULT_KILL_PLANE_Y = -8` (`packages/shared/src/tuning.ts`) is passed as-is by
both game boots (`game/index.ts`, `game/practice.ts`). Every Track uses it,
whatever its geometry. The local dev database already holds a Track with a
Segment at `y = -5.2`, only 2.8 units above the kill height. Anything the
Environment puts under the Track has to be placed relative to `killPlaneY`, not
at a fixed depth.

While a Character falls through the void, nothing is there to shorten the
camera's spring arm. At the moment it crosses the kill height, the camera
therefore trails between `7·sin(0.1) ≈ 0.7` and `7·sin(0.85) ≈ 5.3` units above
the point it follows.

### (e) The art: saturated, glossy plastic that expects an environment

Parsed from the files:

| asset | material | metallic | roughness | extension |
|---|---|---|---|---|
| KayKit pack (`kaykit_*.glb`, 370 files) | `platformer`, one shared 1024² palette PNG | 0 | 0.30 | none |
| trap pack (`trap_*.glb`) | `unitquematerial` | 0 | ~0.22 | `KHR_materials_specular` |
| `BLIP.glb` | "Vanilla cream · F3DFC3", "Eyes · warm obsidian" | 0 | 0.43 / 0.36 | `KHR_materials_specular` |

The KayKit pack's own renders (`assets/KayKit_Platformer_Pack_1.0_FREE/Samples/`,
`contents.png`) show saturated **cyan-blue deck tops** over light-grey sides,
soft reflections and soft contact shadows. Two design consequences:

- A saturated blue sky or cloud floor would **camouflage the deck tops**, and a
  pure-white cloud floor would camouflage the grey sides and the white pieces.
  The under-Track layer needs a hue and value that separates from both, for
  example a warm or lilac-tinted white with a clearly darker shade colour.
- Glossy dielectrics lit only by punctual lights look flat, because in three.js
  indirect specular exists only under `USE_ENVMAP`. `HemisphereLight` adds
  irradiance (diffuse) only
  ([`lights_fragment_maps.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/lights_fragment_maps.glsl.js),
  [`lights_fragment_begin.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js)).
  Today these materials get one specular highlight from the one directional
  light and nothing else.

### A side view of the layers this note recommends

```
  elevation never seen in-game above ~22°
        .  -  ~  ~  -  .                         sky dome (follows camera position,
    .                     .                                depth = far plane)
  :    ☼ sun disc (builder / low suns only)    :
  :  ~~ puffy clouds, upper band ~~            :  ← instanced, drift, wrap round camera
  : ▲▲ backdrop silhouettes (radius ~150–250)  :  ← fog: false, pre-tinted to horizon
  ═══════ horizon stop = fog colour ═══════════   ← fogged Track meets dome here
  :      ▭▭  Track  ▭▭▭   ▭▭                  :
  :                                             :
  ≈≈≈≈≈≈≈ cloud floor (killPlaneY + ~0.5) ≈≈≈≈≈≈  ← follows camera X/Z, fixed Y
  ------- kill plane (killPlaneY = -8) ---------  ← simulation only, no longer drawn
  :  ~~ puffy clouds, lower band ~~             :
    `  .  below-horizon stop (nadir)  .  `
```

---

## 2. The sky

| option | look | per-frame cost | authoring | what a preset sets | verdict |
|---|---|---|---|---|---|
| `scene.background = Color` (today) | flat | nothing | none | 1 colour | fallback only |
| `CanvasTexture` gradient as `scene.background` | gradient fixed to the **screen** | nothing | none | stops | **reject**: a flat texture background does not move when the camera pitches, so its "horizon" disagrees with the fog and the cloud floor across the 6°–49° pitch range |
| **gradient dome** (`ShaderMaterial`, `BackSide`) | stylized gradient, optional sun disc and horizon band | 1 draw call, a few `mix`es per pixel | code only | colours, sun angles, band width | **recommended** |
| `examples/jsm/objects/Sky.js` (Preetham) | physically based daylight | 1 draw call, heavier fragment, needs tone mapping | physical parameters | turbidity, rayleigh, mie, sun position | too realistic, not art-directable |
| equirect/cube image (+ PMREM) | whatever an artist paints or photographs | 1 draw call + a multi-MB texture | an artist per preset | one image per preset | later, if an artist paints skies |

**Why not `Sky.js`.** At r171 it is the Preetham analytic daylight model on a unit
`BoxGeometry`, with `side: BackSide` and `depthWrite: false`. Its uniforms are
`turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG`, `sunPosition` and `up`
([`Sky.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/objects/Sky.js)).
The parameters are atmospheric physics, not colours, so "make the horizon
peach" is not something a preset can say directly. The official example pairs it
with `ACESFilmicToneMapping` at `toneMappingExposure = 0.5`, scales the box to
450 000 and uses a camera far plane of 2 000 000
([`webgl_shaders_sky`](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_shaders_sky.html)).
Its output is HDR (the sun disc adds `vSunE * 19000`) and expects that tone
mapping. Most importantly for this game, its fragment shader clamps the view
angle with `max(0.0, dot(up, direction))`, so **everything below the horizon
renders as horizon haze**, and below the horizon is where §1c says the backdrop
lives. `SkyMesh.js` is the same model as a `NodeMaterial` for `three/webgpu`
([`SkyMesh.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/objects/SkyMesh.js))
and does not apply to this codebase's `WebGLRenderer`.

**`backgroundBlurriness` / `backgroundIntensity` / `backgroundRotation`** exist
on `Scene` at r171
([`Scene.js`](https://github.com/mrdoob/three.js/blob/r171/src/scenes/Scene.js)).
They act only on **texture** backgrounds: the docs say blurriness "only
influences environment maps assigned to Scene.background"
([Scene docs, r171](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/scenes/Scene.html)),
and `WebGLBackground` routes a texture through PMREM only when blurriness is
above 0
([`WebGLBackground.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLBackground.js)).
They are irrelevant to a shader dome. They would matter for the image option,
where blurring an HDR photo is a known way to stylize it, but that option needs
downloaded assets and licensing per preset.

### The dome, done the way three.js does its own background

three.js's own skybox is the recipe. The renderer's background box is a unit
`BoxGeometry` with `side: BackSide`, `depthTest: false`, `depthWrite: false`
and `fog: false`, and an `onBeforeRender` that does
`this.matrixWorld.copyPosition(camera.matrixWorld)`: **it follows the camera's
position, never its rotation**
([`WebGLBackground.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLBackground.js)).
Its vertex shader ends with `gl_Position.z = gl_Position.w; // set z to camera.far`
([`backgroundCube.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderLib/backgroundCube.glsl.js)),
and `Sky.js` does the same. After the perspective divide `z/w = 1`, so the
fragment lands exactly on the far plane
([MDN: clip space and homogeneous coordinates](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_model_view_projection)).
The dome can therefore be a *unit* sphere and still sit behind everything,
whatever `camera.far` is. The player can never reach its edge, and the 300-unit
far plane stops mattering for it.

```glsl
// vertex: a unit sphere centred on the camera (position copied each frame)
varying vec3 vDir;
void main() {
  vDir = position;                                   // local = view direction
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;                           // depth = far plane
}

// fragment
uniform vec3 zenith, horizon, nadir;                 // linear-sRGB (THREE.Color)
uniform float horizonSoftness;                       // e.g. 0.35
uniform vec3 sunDir, sunColor;
uniform float sunSize;                               // 0 disables the disc
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = d.y >= 0.0
    ? mix(horizon, zenith, pow(smoothstep(0.0, 1.0, d.y), horizonSoftness))
    : mix(horizon, nadir, smoothstep(0.0, 0.25, -d.y));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.6, s)   // disc
                   + 0.15 * pow(s, 24.0));                              // glow
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
```

Material flags: `side: BackSide`, `depthWrite: false`, `fog: false`. `fog` is
already `false` by default on `ShaderMaterial`
([`ShaderMaterial.js`](https://github.com/mrdoob/three.js/blob/r171/src/materials/ShaderMaterial.js))
but `true` on `MeshBasicMaterial`
([`MeshBasicMaterial.js`](https://github.com/mrdoob/three.js/blob/r171/src/materials/MeshBasicMaterial.js)).
A dome built from basic materials with vertex colours would get fogged into a
flat sheet unless `fog: false` is set explicitly.

Two details are easy to get wrong:

- **Keep the two `#include`s.** They make one shader correct on both of this
  repo's paths. Inside the client's composer target both chunks compile to
  no-ops, and `OutputPass` does the work. On the builder's direct-to-canvas path
  they tone-map the dome and convert it to sRGB. The r171 colour-management manual
  says `ShaderMaterial`s "have to implement their own output color space
  conversion", and that the `colorspace_fragment` chunk is enough
  ([Color management, r171](https://github.com/mrdoob/three.js/blob/r171/docs/manual/en/introduction/Color-management.html)).
  The otherwise excellent dome in `webgl_lights_hemisphere` omits it (§9), so
  copying it verbatim would draw darker, more saturated colours on the builder's
  canvas.
- **Draw it last among opaque objects.** With `depthWrite: false` and depth at
  the far plane, any pixel already covered by geometry fails the default
  `LessEqual` test, so drawing the sky last lets the GPU skip those fragments.
  three.js sorts the opaque list by `renderOrder` before material or depth
  ([`WebGLRenderLists.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLRenderLists.js)),
  so a high `renderOrder` on the dome is enough. A dome parked at the camera
  would otherwise sort to the front (smallest `z`) and be drawn first, under
  everything.

**How a preset parameterises it:** three colours, a softness, and a sun
`{ azimuthDeg, elevationDeg, color, size }`. Per §1c the zenith colour is mostly
a builder concern, and the horizon and nadir stops carry the look in-game.

---

## 3. Clouds, and what is under the Track

### Options

| technique | look | cost | notes |
|---|---|---|---|
| **cloud floor**: 1 camera-following plane, world-space scrolling noise | a soft sea of cloud under the Track | 1 draw call; 2 texture taps per pixel, over a large share of the frame when looking down | **recommended**; replaces `killPlane` |
| **instanced puffs**: merged icospheres in an `InstancedMesh` | chunky, toy-like, reads as "made of the same stuff" as KayKit | 1 draw call per shape variant, opaque | **recommended** for the cloud field above and below |
| sprites / billboards (`Sprite`, or merged quads) | painterly, soft edges | overdraw: stacked transparent layers are each fully shaded | good for a *few* soft wisps; poor for a dense field at DPR 2 |
| noise layer inside the dome shader | a flat scrolling cloud band painted on the sky | nothing extra | cheap, but §1c says the upper sky is barely seen in-game |
| volumetric raymarching | realistic | many texture samples per pixel | **out of budget** (below) |

### The cloud floor (recommended)

One large plane at `killPlaneY + floorOffset`. Each frame its X/Z copies the
camera's, and its Y stays fixed. The player therefore falls *toward* a real
height, and on a tall Track (a future Skyfall) climbing makes the floor drop away
below, which is the right feeling. Because the plane moves with the camera, its
shading must sample noise in **world** X/Z (from a varying of the world position),
never from the plane's UVs. Otherwise the pattern would swim along with the
player.

```glsl
varying vec3 vWorld;                 // modelMatrix * position, in the vertex shader
uniform sampler2D noise;             // small tileable noise, RepeatWrapping
uniform vec2 wind; uniform float time;
uniform vec3 lit, shade;             // preset colours
void main() {
  vec2 p = vWorld.xz * 0.015;
  float n = 0.65 * texture2D(noise, p + wind * time).r
          + 0.35 * texture2D(noise, p * 2.7 - wind * time * 0.6).r;
  gl_FragColor = vec4(mix(shade, lit, smoothstep(0.35, 0.75, n)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
```

To receive scene fog, a `ShaderMaterial` needs `fog: true`, the `fog_pars_*`
and `fog_vertex` chunks, and `UniformsLib.fog` merged into its uniforms
([`UniformsLib.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/UniformsLib.js),
[`fog_vertex.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/fog_vertex.glsl.js)).
That fog is what melts the floor into the dome's nadir-to-horizon band at
distance, with no visible edge.

**Height.** `floorOffset` of about **+0.5** (just above the kill height) is a
good starting point. The camera trails 0.7–5.3 units above the point it follows
(§1d), so it stays above the floor right up to the tick the Respawn fires, while
the Falling Character visibly sinks into cloud first. That hides the Respawn
teleport, and "falling into the clouds" is a clearer failure read than falling
into black. The offset must also stay below the lowest Segment of a Track, which
§1d shows can be as little as 2.8 units above the kill height. So derive it from
`killPlaneY` and clamp it; never author it as an absolute depth. The simulation's
kill plane itself does not move. Only its drawing is replaced.

**Colour.** This is the most important contrast decision in the note (§1e). The
floor is what most platforms are seen against. Use a warm or lilac-tinted white
with a clearly darker `shade`, never the saturated blue of the deck tops.

### Instanced puffs (recommended)

A "puff" is 4–7 low-detail `IcosahedronGeometry` spheres (`detail` 1–2) merged
with `mergeGeometries`
([`BufferGeometryUtils.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/utils/BufferGeometryUtils.js)),
with `flatShading` for the faceted low-poly look. Two or three variants are
drawn as `InstancedMesh`es. three.js's own docs describe `InstancedMesh` as the
tool for many objects that share a geometry and material but have different
transforms, and say it cuts draw calls
([InstancedMesh docs, r171](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/objects/InstancedMesh.html)).
Per-instance tint uses `setColorAt`. For the material, `MeshLambertMaterial` is
the cheapest. `MeshToonMaterial` with a 3-step `gradientMap` gives banded,
cartoon shading, and its docs require `NearestFilter` on that map
([MeshToonMaterial docs, r171](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/materials/MeshToonMaterial.html)).
A little `emissive` in the preset's shade colour keeps the unlit side of a cloud
from going grey.

**Drift and wrap, render-only.** Each frame, advance each instance's X/Z by
`wind × dt` on the wall clock. Do not use sim time: unlike Conveyor chevrons,
which march in sim time "so belts pause with the sim", a cloud tells the player
nothing about the game. Then wrap it into a square tile centred on the camera
(`((x − camX + half) mod size) − half + camX`), which turns 60–150 instances
into an endless field. This is a pure function, so it is unit-testable the way
this repo tests everything (the springs' squash curve, the bounce sheet's
presses). Rewriting ~150 instance matrices per frame is a tiny buffer upload.
Two bands work well: an upper band near the horizon for the flattest pitch, and
a lower band **under** the cloud floor's height that shows through gaps and
sells depth. Set `frustumCulled = false` on the field. `InstancedMesh` computes
and caches its bounding sphere the first time culling asks for it, and never
recomputes it when instances move
([`InstancedMesh.js`](https://github.com/mrdoob/three.js/blob/r171/src/objects/InstancedMesh.js),
[`Frustum.js`](https://github.com/mrdoob/three.js/blob/r171/src/math/Frustum.js)).

### Why not billboards as the main technique

mrdoob's own "Clouds" demo (§9) merges 8000 textured quads into one geometry, so
it draws in a single call. But every quad is transparent with depth test and
depth write off, so each pixel covered by ten quads is shaded ten times. At this
game's `setPixelRatio(min(devicePixelRatio, 2))`, with the cloud layer covering
most of a downward-looking frame, that fill-rate is the cost to avoid. Opaque
puffs let the depth test discard hidden fragments. A handful of soft wisp
sprites near the horizon remains a fine *accent*.

### Why volumetric clouds are out of budget

three.js's `webgl_volume_cloud` renders **one** cloud in a box: a 128³
`Data3DTexture` sampled along a ray with up to 100 steps per pixel
([`webgl_volume_cloud`](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_volume_cloud.html)).
The state of the art for a real cloudscape is Guerrilla's Horizon Zero Dawn
system, a dedicated R&D effort presented at SIGGRAPH 2015. Its abstract states
it was "targeting GPU performance of 2ms" on a console title
([Advances in Real-Time Rendering 2015](https://advances.realtimerendering.com/s2015/index.html)).
A browser party game with 12 Characters, an existing full-screen post pass and
mobile ambitions should not spend its frame there. The stylized look does not
want realistic volumes anyway.

---

## 4. Distant scenery

Distant scenery should make the world feel bigger than the Track, and it must
never become gameplay.

- **Kinds that fit:** floating islands (flat-topped rocks with a grassy cap);
  far-off stacks built from the Track's **own** art (the
  `kaykit_platform_decorative_*` templates the client already loads), shown as
  silhouettes; a ring of low-detail "other courses"; balloons or blimps; stars
  and a moon for a night preset (one `THREE.Points` draw).
- **Draw calls:** `InstancedMesh` for repeated shapes, or `BatchedMesh` for a
  mixed set that shares one material. The docs say `BatchedMesh` needs
  `WEBGL_multi_draw` or falls back to a slower path
  ([BatchedMesh docs, r171](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/objects/BatchedMesh.html)).
  Either way the backdrop costs 1–3 draw calls. The KayKit templates are
  single-mesh with one shared material, so an instance can reuse the template's
  geometry and material directly.
- **Placement and parallax:** a ring at radius about 150–250, which stays inside
  the 300-unit far plane. Moving the ring with the camera's X/Z by a factor `k`
  (about 0.85–0.95) makes it drift across the view as slowly as something much
  farther away would, without ever leaving the far plane or being passed. The
  vertical position stays fixed, so a tall climb still moves past it.
- **Fog:** the backdrop sits beyond today's fog `far` (110), so scene fog would
  flatten it into the horizon colour completely. Give its materials `fog: false`
  and **pre-tint** them toward the horizon stop by a fixed amount (for example
  60 %). This is the "max opacity" idea from Unreal's height fog (§5): distant
  things stay as readable silhouettes instead of vanishing.
- **Out of physics, out of the camera raycast.** The Environment is never passed
  to `resolveTrack`, so Rapier never sees it. The camera never hits it because
  its meshes are never added to `collidables` (§1a). This is the practical
  difference from **Scenery**: a Scenery Module may block a Character and is
  placed by an author, while backdrop scenery is part of an Environment preset
  and is never solid. If an author wants a solid island near the route, that is
  a Module, not an Environment.

---

## 5. Atmosphere and fog

**What three.js fog does at r171.** The vertex chunk stores
`vFogDepth = -mvPosition.z`, which is **view-space depth**, not radial distance.
The fragment chunk mixes toward `fogColor` by `smoothstep(fogNear, fogFar, depth)`
for `Fog`, or by `1 − exp(−density² · depth²)` for `FogExp2`
([`fog_vertex`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/fog_vertex.glsl.js),
[`fog_fragment`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/fog_fragment.glsl.js)).
So "linear" fog is actually smoothstepped. And because the depth is along the
view axis, things at the screen edges fog slightly less than things at the same
distance in the centre. With a 55° FOV that is acceptable.

| | `Fog(color, near, far)` | `FogExp2(color, density)` |
|---|---|---|
| near Track | **fully clear until `near`** | always a little hazy |
| art direction | "clear to 40, gone by 160": two intuitive numbers | one density; the fully-fogged distance is implicit |
| look | a defined band | more natural falloff |
| **fit** | **recommended**: readability of the course ahead matters most | a possible later option for a "misty" preset |

**Match the fog colour to the horizon stop.** The fog colour *is* the dome's
`horizon` colour. That is what makes a fogged platform dissolve into the sky
instead of into a grey wall, and it is exactly what `webgl_lights_hemisphere`
does (`scene.fog.color.copy(bottomColor)`, §9). Unreal's height fog
documentation makes the same point from the other side: a sky-derived
inscattering colour keeps heavily fogged distant geometry matching the sky
([Exponential Height Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/exponential-height-fog-in-unreal-engine)).

**Colour space.** Fog is mixed *after* tone mapping and colour conversion inside
each material's shader. `fogColor` is uploaded in the output colour space when
drawing to the canvas, and in the linear working space when drawing into a
render target
([`WebGLMaterials.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLMaterials.js),
[`UniformsUtils.js` `getUnlitUniformColorSpace`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/UniformsUtils.js)).
Either way, a `THREE.Color` built from a preset's hex lands correctly on both of
this repo's paths. Nothing needs converting by hand.

**Distances.** Today's 30/110 was chosen for a dark void. With a bright horizon
and a cloud floor, it is worth starting at about `near 40 / far 160` and tuning
per preset. `far` must stay well inside `camera.far = 300`. The dome ignores the
far plane (§2), and the backdrop opts out of scene fog (§4), so raising
`camera.far` is not needed. Keeping it at 300 also keeps depth precision where
the Track is.

**The builder needs different fog.** An orbit camera zoomed out to frame a whole
Track sits far outside the chase camera's distances, and game fog would grey out
the Track being edited. `createEnvironment` should take a `fog: false` option
for the orbit view. The playtest (`?freeroam=1`, which boots the real client)
already shows the real fog.

**Sky dome and fog.** The dome and the backdrop set `fog: false`, as §2 and §4
describe. Scene fog applies to the Track, the Characters, the puffs and the
cloud floor.

**Height fog: optional, later.** A fog that thickens with depth (so the void
below looks deeper, and a sunset preset gets a low haze) is a documented
technique. Inigo Quilez derives the analytic integral for exponential
height-dependent density along a view ray, and shows colouring fog by the sun
direction
([iquilezles.org, "fog"](https://iquilezles.org/articles/fog/)). Unreal exposes
the same idea as *Fog Height Falloff*, *Start Distance*, *Fog Cutoff Distance*
and *Fog Max Opacity*
([Unreal docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/exponential-height-fog-in-unreal-engine)).
In three.js r171 there are two ways to add it:

- **Globally**, by replacing `THREE.ShaderChunk.fog_vertex` and `fog_fragment`
  before any material compiles. The replacement has to compute its own world
  position: the built-in `worldPosition` exists only under `USE_ENVMAP`,
  `USE_SHADOWMAP` and a few other defines
  ([`worldpos_vertex.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/worldpos_vertex.glsl.js)),
  and it must repeat the `batchingMatrix` and `instanceMatrix` multiplications
  `project_vertex` does. A global patch also changes every material on the page,
  including the Screens' `CharacterPreview` in the same bundle.
- **Per material**, via `onBeforeCompile`, plus a `customProgramCacheKey` when
  the patch varies. The docs note that `onBeforeCompile` is not carried by
  `clone()`
  ([Material docs, r171](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/materials/Material.html)).
  That matters here: every asset visual is a `template.clone(true)`.

The cloud floor plus horizon-matched linear fog already gives most of the look.
Defer height fog until a preset needs it.

---

## 6. Lighting that matches the sky

**Hemisphere light from the palette.** `HemisphereLight(skyColor, groundColor,
intensity)` sits "directly above the scene" and "cannot be used to cast
shadows"
([HemisphereLight docs, r171](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/lights/HemisphereLight.html)).
Set `skyColor` from a preset light colour near the dome's zenith, as
`webgl_lights_hemisphere` does in reverse by copying the light colour into the
dome (§9). Set `groundColor` from the **cloud floor's shade colour**: the light
bouncing up onto the undersides of platforms comes from the clouds, and that
tint is what ties the pieces to the world.

**One sun vector.** The preset stores `sun: { azimuthDeg, elevationDeg }` once.
The sky shader's `sunDir` and the `DirectionalLight`'s position
(`sunDir × distance`, target at the camera's focus) both derive from it, so the
light always comes from where the disc is drawn. §1c adds one wrinkle: a low
sunset sun is the only kind visible in-game, and a light that low rakes across
the decks and leaves the sides of every platform dark. A preset may therefore
need an explicit, *named* override (`lightElevationDeg`) that lifts the light
above the drawn disc. That is an art cheat and should be flagged as one, not
silently applied.

**Environment map: bake the dome once.** `PMREMGenerator.fromScene(scene,
sigma, near, far)` renders a scene into a 256-size cube around the origin and
prefilters it. During the bake it forces `NoToneMapping` and restores the
renderer's settings afterwards
([`PMREMGenerator.js`](https://github.com/mrdoob/three.js/blob/r171/src/extras/PMREMGenerator.js),
[docs](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/extras/PMREMGenerator.html)).
Bake a temporary scene holding only the sky dome (and optionally a few puffs and
the floor), assign `result.texture` to `scene.environment`, then dispose the
generator. Every standard or physical material picks up reflections and
indirect light **in the Environment's own colours**. Glossy KayKit plastic
reflects the sky, and BLIP's cream reads warm under a sunset. `Scene` at r171
also has `environmentIntensity` and `environmentRotation`
([`Scene.js`](https://github.com/mrdoob/three.js/blob/r171/src/scenes/Scene.js)),
so a preset can dial it. `RoomEnvironment`
([`RoomEnvironment.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/environments/RoomEnvironment.js))
is the palette-free alternative: a neutral studio box, fine for the builder's
thumbnails but disconnected from any sky.

With an environment map active, the hemisphere light double-counts ambient light.
Expect to lower its intensity (or drop it) and let `environmentIntensity` carry
the fill. The exact values are a tuning pass. Numbers written here would be
guesses.

**Tone mapping and colour space.** r171 ships `NoToneMapping`, `Linear`,
`Reinhard`, `Cineon`, `ACESFilmic`, `Custom`, `AgX` and `Neutral`
([`constants.js`](https://github.com/mrdoob/three.js/blob/r171/src/constants.js)),
all supported by `OutputPass` (§1a). The tone-mapping shader credits Filament
and Blender for AgX and links model-viewer's comparison for Neutral
([`tonemapping_pars_fragment.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js)).

| operator | behaviour on a saturated, mid-bright palette | fit |
|---|---|---|
| none (today) | colours pass unchanged, bright values clip hard | fine only while nothing is HDR; an env map and a sun disc make values above 1 routine |
| `ACESFilmic` | filmic contrast; model-viewer reports it cannot output canary yellow or bright greens and blues | fights the palette |
| `AgX` | smooth highlight roll-off; model-viewer reports significant saturation loss | fights the palette |
| **`Neutral`** (Khronos PBR Neutral) | base colours with every channel in roughly 0.08–0.8 come out exactly as authored, with no hue shift; only highlights are compressed | **recommended** |

Sources: the Khronos specification
([KhronosGroup/ToneMapping, PBR Neutral](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md))
and model-viewer's comparison
([modelviewer.dev/examples/tone-mapping](https://modelviewer.dev/examples/tone-mapping)).
Near-white values (cloud tops, a sun disc) *are* compressed a little, which a
per-preset `toneMappingExposure` can offset. Two practical notes:

- Switching the operator changes **every** asset's look, BLIP included, and every
  basic-material marker (Checkpoint, Finish Zone), because those are
  `toneMapped` by default. Neutral moves mid-tone colours least of the options,
  but the switch still needs its own visual check.
- The builder must use the same operator and exposure, or its preview is wrong.
  The operator is an app-level renderer setting, not a preset field. Exposure is
  per preset.

**Shadows: none in the first pass (open question).** A `DirectionalLight` shadow
means `renderer.shadowMap.enabled`, `castShadow`/`receiveShadow` on every asset
clone, and a shadow camera box that follows the player. With the default
`autoUpdate`, the shadow map re-renders every caster **every frame**
([`WebGLShadowMap.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLShadowMap.js)).
The map is an RGBA render target plus depth buffer at `mapSize` (default 512²,
[`LightShadow.js`](https://github.com/mrdoob/three.js/blob/r171/src/lights/LightShadow.js)).
A crisp 2048² map is about 16 MiB of colour plus a depth buffer of similar size,
and a moving shadow box shimmers unless its texels are snapped. What a
platformer actually needs from a shadow is to know where it will land. A **blob
shadow** under each Character (a raycast down and one decal quad) gives that for
almost nothing. It is a Character-readability feature rather than part of the
Environment, and deserves its own ticket. three.js's `webgl_shadow_contact`
([example](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_shadow_contact.html))
blurs a small depth render into soft contact shadows under a fixed area, which
is the look of the KayKit renders but suits a turntable better than a long
Track.

---

## 7. Reusability: the Environment as data

### The data shape (three-free, in `packages/shared`)

This follows the pattern `BounceOverlay.ts` and `conveyorStrip.ts` already use:
pure numbers that both renderers read, and that the API can validate against.

```ts
// packages/shared/src/track/Environment.ts (sketch, not a decision)
export const ENVIRONMENT_IDS = ["day", "sunset", "night", "candy"] as const;
export type EnvironmentId = (typeof ENVIRONMENT_IDS)[number];
export const DEFAULT_ENVIRONMENT_ID: EnvironmentId = "day";

/** Hex colours are sRGB, as authored; renderers wrap them in THREE.Color. */
export interface EnvironmentPreset {
  sky: {
    zenith: number; horizon: number; nadir: number;
    horizonSoftness: number;
    sun: { azimuthDeg: number; elevationDeg: number; color: number; size: number };
  };
  /** Colour is always sky.horizon: no second field to drift out of sync. */
  fog: { near: number; far: number };
  light: {
    hemiSky: number; hemiIntensity: number;   // hemi ground colour = cloudFloor.shade
    sunColor: number; sunIntensity: number;
    /** Named art cheat (§6): light the decks from higher than the drawn sun. */
    lightElevationDeg?: number;
    environmentIntensity: number;
  };
  exposure: number;
  cloudFloor: { lit: number; shade: number; offsetAboveKillPlane: number; wind: [number, number] } | null;
  clouds: { count: number; color: number; shade: number; bands: [number, number][]; wind: [number, number] } | null;
  backdrop: { kind: "none" | "islands" | "stacks" | "stars"; radius: number; tintToHorizon: number };
}

export const ENVIRONMENT_PRESETS: Record<EnvironmentId, EnvironmentPreset> = { /* … */ };

/** API publish validation, in the `invalidBounceReason` idiom. */
export const invalidEnvironmentReason = (value: unknown): string | undefined => …;
```

Suggested first presets. These are palettes to try, not decisions:

| id | sky (zenith → horizon → below) | cloud floor | sun | backdrop | note |
|---|---|---|---|---|---|
| `day` (default) | pale, slightly teal blue → warm cream → soft lilac-grey | warm white, lilac shade | high (~55°) | islands | the palette must not match the deck-top blue (§1e) |
| `sunset` | violet → peach/coral → dusky rose | pink-white, mauve shade | low (~8°), `lightElevationDeg` ~35° | stacks | the only in-game-visible sun |
| `night` | deep indigo → blue-violet → near-black blue | dim blue, darker shade | moon disc, cool light | stars | keep hemisphere fill high enough that decks stay readable |
| `candy` | pink → mint → pastel lilac | cotton-candy pink | mid | balloons / islands | the "party" preset |

### The seam (three.js, shared by both apps)

```ts
export interface EnvironmentOptions {
  /** Where the cloud floor is derived from (DEFAULT_KILL_PLANE_Y today). */
  killPlaneY: number;
  /** Game chase view: preset fog. Builder orbit view: none (§5). */
  fog: boolean;
  /** Low-end: skip the puff field and backdrop; the sky, floor, fog and env map stay. */
  detail: "full" | "low";
}

export interface Environment {
  /** Once per rendered frame, after the camera is placed. Render-only: moves the
   *  dome (position), the floor (X/Z), the puff field (drift + wrap), the backdrop (parallax). */
  update(camera: THREE.Camera, nowMs: number): void;
  /** Frees every geometry, material, texture and render target it made, and
   *  clears scene.fog / scene.environment. Idempotent. */
  dispose(): void;
}

export const createEnvironment = (
  scene: THREE.Scene, renderer: THREE.WebGLRenderer,
  preset: EnvironmentPreset, options: EnvironmentOptions,
): Environment => { /* adds one root Group; sets scene.fog, scene.environment */ };
```

Everything the Environment adds hangs under **one** `THREE.Group`, so its
lifetime is one `add` and one `remove`.

- **In the game:** `createStage` takes `environment: EnvironmentPreset` in
  `StageConfig`. It replaces lines 304–305 (background and fog), 316–319
  (lights) and 490–497 (kill plane) with one `createEnvironment` call. It calls
  `environment.update(camera, performance.now())` at the top of
  `Stage.render()`, which the game loop already calls after `updateCamera`
  (`game/index.ts`, `practice.ts`). It calls `environment.dispose()` before the
  `disposeSceneGraph` sweep. The Environment's meshes never join `collidables`.
- **In the builder:** the viewport creates it with `fog: false` behind an
  author-facing "preview Environment" toggle, so the lavender canvas and grid
  stay the default authoring view (ADR 0063). The thumbnail renderer stays
  neutral.

### Where the preset id lives

ADR 0041 gives the test: *"would a different Match on this same Track reasonably
want a different value?"* For an Environment the honest answer is "sometimes,
for variety". But the value is also bound up with the geometry: an author tunes
contrast against their deck colours, and the cloud floor has to clear their
lowest Segment. Weighed against that, and against how the codebase already
handles Track-level values:

| home | how the client gets it | server involvement | verdict |
|---|---|---|---|
| **Revision row attribute** (`environment TEXT NOT NULL DEFAULT 'day'`) | already fetches `GET /tracks/:id` for the exact Revision (ADR 0028); `StoredTrack` gains a field, `fetchTrack` returns it | none: the Match server fetches the Track but ignores the field | **recommended**, like `time_limit_ms` (ADR 0038) |
| inside the `data` envelope | same fetch | none | rejected for the reason ADR 0038 gave: it changes the `Segment[]` contract every consumer parses, for a value `resolveTrack` never needs |
| `RoundRules` / Round override | would ride the Snapshot | **violates render-only**: `RoundRules` is read by the shared step (ADR 0043) | rejected |
| Lobby pick on the lobby/welcome message | a protocol field | server relays an id | possible **later** as an override on top of the Revision default, the way ADR 0041 reopened ADR 0038; not needed for a first pass |

Mechanics, following precedent: add the column the way `time_limit_ms` and
`survivor_target` were added (`ALTER TABLE tracks ADD COLUMN … NOT NULL DEFAULT`
in `apps/api/src/db/db.ts`, so old Revisions backfill to `day`). Validate on
publish with `invalidEnvironmentReason` so a typo can never be stored. On the
client, an id the running build does not know (a newer server's preset) falls
back to `DEFAULT_ENVIRONMENT_ID` with a dev warning, never an error. This is
the "a cosmetic must never brick boot" contract `trackLoading.ts` already
applies to the ice, mud and bounce textures. It should not be a field of
`TrackRoundDefaults`, which is specifically "the Round defaults a Track Revision
carries". A sibling field on `StoredTrack`, or a small `TrackPresentation`
record, says what it is.

### Where the three.js code lives

| option | for | against |
|---|---|---|
| duplicate in each app (the `iceTexture.ts` / `assetVisuals.ts` "deliberate duplicate" policy) | no new package | that policy is explicitly for "~15 lines, too small for a package". A dome shader, floor shader, puff field, fog, lights and PMREM come to hundreds of lines, and the whole point is that the builder previews exactly what the game draws |
| put three.js into `packages/shared` | one place | `packages/shared` has no `three` dependency and runs on the server. ADR 0007 scopes it to what "must behave identically on both sides" of the network, which rendering is not. ADR 0050 keeps "three.js stays client-only" for the GLB reader |
| **a new workspace package** (for example `packages/render`, `@dont-fall/render`, `three` as a peer dependency) | one implementation, imported by `apps/client` and `apps/track-builder`, tested once. `packages/ui` is the precedent for a non-simulation package | a layout change worth an ADR (ADR 0007). Its mandate should be written down: "three.js rendering shared by the game and the Track builder". The existing ice, mud, bounce and asset-visual twins would then have a natural home too, as a separate cleanup |

**Recommended:** the new package, with the preset *data* staying in
`packages/shared` because the API must validate ids and the server bundle must
never pull in three.js.

---

## 8. Performance budget and dispose hygiene

Estimated additions, not measured (no browser run for this note):

| piece | draw calls | geometry | per-pixel | memory |
|---|---|---|---|---|
| sky dome | 1 | `SphereGeometry(1, 32, 16)`, under 1k triangles | a few `mix`/`pow`; early-z rejects covered pixels (§2) | none |
| cloud floor | 1 | 2 triangles (or a small disc) | 2 texture taps + fog, over much of a downward frame: **the most expensive per-pixel piece** | noise texture: 256² RGBA ≈ 0.25 MiB, plus about 30 % for mipmaps ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)) |
| puff field | 2–3 (one per variant) | ~60–150 instances × a few hundred triangles | opaque Lambert or toon | negligible; ~150 matrices uploaded per frame |
| backdrop | 1–3 | instanced or batched | opaque, `fog: false` | reuses loaded templates where possible |
| stars (night) | 1 | `Points` | trivial | negligible |
| environment map | 0 per frame | — | one extra sample per standard-material fragment | **≈ 6 MiB retained**: `fromScene` allocates a 768 × 1024 RGBA half-float cube-UV target (`3·max(256, 112)` × `4·256`), plus a same-size ping-pong target during the bake that `generator.dispose()` frees ([`PMREMGenerator.js`](https://github.com/mrdoob/three.js/blob/r171/src/extras/PMREMGenerator.js)) |
| **total** | **~5–9 extra** | | | **~7 MiB** |

For scale: MDN's WebGL guidance is to batch many similar things into single
draws ([best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)),
and every Environment piece above is already one call per material. The real
risk is fill-rate on high-DPR mobile screens. That is why the recommendation
prefers opaque puffs to stacked transparent sprites, and keeps the floor shader
to two taps. `detail: "low"` removes the puffs and backdrop and leaves the
sky, floor, fog and environment map, which are what carry the look.

The noise texture is best generated in code into a `DataTexture` at creation
time (no fetch, no asset, no licence). The alternative is procedural value noise
in the floor shader, which trades the texture for more per-pixel maths on the
largest surface in the frame. Measure both before choosing.

**Dispose hygiene.** The r171 manual is explicit. Geometries, materials,
textures and render targets are released only by their own `dispose()`.
Disposing a material does not dispose its textures. Removing a mesh from the
scene frees nothing. `WebGLRenderer.info` shows what is still allocated
([How to dispose of objects, r171](https://github.com/mrdoob/three.js/blob/r171/docs/manual/en/introduction/How-to-dispose-of-objects.html)).
Applied here:

- `Environment.dispose()` frees its own geometries, materials and noise
  texture, the **PMREM render target** (`scene.environment` is not reached by
  `disposeSceneGraph`, §1a), and any `InstancedMesh` via its `dispose()`. It
  then sets `scene.environment = null` and `scene.fog = null`. Calling it before
  the Stage's sweep and making it idempotent means a double free is harmless;
  the manual says a disposed resource is simply re-created if used again.
- **Create the `PMREMGenerator` per bake and dispose it immediately.** The docs
  warn that disposing one generator makes the others unusable. A module-level
  singleton would reproduce the Vite hot-update failure mode
  `docs/research/memory-bloat-investigation.md` suspects in the builder's
  thumbnail renderer: a singleton re-created per hot update, leaving the old one
  and its uploads alive.
- **Do not cache GPU resources across Stages.** A Track swap disposes the
  renderer and forces context loss (§1a). CPU-side data (the preset, a generated
  noise array) can be cached, but textures bound to the old context cannot be
  reused.
- The same memory note found 370 decoded copies of one KayKit texture because
  the client does not dedupe. A backdrop built from those templates should reuse
  the already-loaded template materials, never re-parse them.

**Found in passing: the game scene is not antialiased.** `createStage` asks for
`antialias: true`, but the scene renders into `EffectComposer`'s default target,
which is created without `samples` (the `RenderTarget` default is `samples: 0`,
[`RenderTarget.js`](https://github.com/mrdoob/three.js/blob/r171/src/core/RenderTarget.js),
[`EffectComposer.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/postprocessing/EffectComposer.js)).
Only the final full-screen quad reaches the antialiased canvas. Thin distant
silhouettes and cloud edges will show the aliasing. The usual fix is to pass
`EffectComposer` a render target with `samples: 4`, which quadruples the
half-float colour buffer. This was read from source, not confirmed in a
browser, and it is a separate change from the Environment.

---

## 9. Prior art

Primary sources only. Each item says what to take from it.

- **three.js `webgl_lights_hemisphere` (r171)**
  ([source](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_lights_hemisphere.html)).
  A gradient sky dome: `SphereGeometry(4000, 32, 15)`, a `BackSide`
  `ShaderMaterial` mixing `bottomColor` → `topColor` by
  `pow(max(normalize(worldPos + offset).y, 0), exponent)`.
  `uniforms.topColor.value.copy(hemiLight.color)` and
  `scene.fog.color.copy(bottomColor)` make one palette drive the dome, the light
  and the fog. That is the core of §5 and §6. Differences from what this note
  recommends: the dome is a fixed 4000-radius sphere (so the camera far plane is
  5000), it has no below-horizon colour, and its fragment shader has no
  `colorspace_fragment` (§2).
- **three.js `webgl_shaders_sky` + `Sky.js` (r171)**
  ([example](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_shaders_sky.html),
  [object](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/objects/Sky.js)).
  The Preetham model, ACESFilmic at exposure 0.5, box scale 450 000, far plane
  2 000 000. Take the `z = w` trick. Leave the physical model (§2).
- **three.js's own background renderer**
  ([`WebGLBackground.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLBackground.js)).
  The camera-position-only follow, `fog: false` and `depthWrite: false`: the
  reference for how a sky should behave.
- **mrdoob, "Clouds"** ([demo and source](https://mrdoob.com/lab/javascript/webgl/clouds/)),
  by three.js's author. 8000 textured planes merged into one geometry, with
  `depthWrite: false`, `depthTest: false`, `transparent: true`, and fog computed
  in its own fragment shader, all over a CSS gradient background. It shows that
  a whole cloud field can be one draw call. It predates modern three.js (it uses
  `THREE.Geometry` and `GeometryUtils.merge`, both since removed), so take the
  technique, not the code, and mind the overdraw (§3).
- **three.js `webgl_volume_cloud`**
  ([source](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_volume_cloud.html)).
  What a raymarched cloud costs even for one box (§3).
- **three.js `webgl_instancing_scatter`, `webgl_mesh_batch`,
  `webgl_materials_toon`, `webgl_tonemapping`, `webgl_shadow_contact`**
  ([examples at r171](https://github.com/mrdoob/three.js/tree/r171/examples)).
  Working references for instanced placement, batched mixed geometry, gradient-map
  toon shading, a live comparison of every tone-mapping operator, and soft
  contact shadows.
- **Guerrilla Games, "The Real-time Volumetric Cloudscapes of Horizon: Zero
  Dawn"** (Andrew Schneider, SIGGRAPH 2015 Advances)
  ([course page](https://advances.realtimerendering.com/s2015/index.html)). The
  abstract's 2 ms GPU target shows what production volumetrics cost. Only the
  course page's abstract was read for this note; the slide PDF could not be
  text-extracted here.
- **Inigo Quilez, "fog"** ([article](https://iquilezles.org/articles/fog/)).
  Sun-tinted fog and analytic height fog (§5).
- **Epic Games, Exponential Height Fog**
  ([docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/exponential-height-fog-in-unreal-engine)).
  The parameter set a later height-fog preset field could mirror (§5).
- **Khronos PBR Neutral** ([spec](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md))
  and **model-viewer's tone-mapping comparison**
  ([page](https://modelviewer.dev/examples/tone-mapping)). §6.
- **Fall Guys / Mediatonic: no first-party source found.** Searches for a
  Mediatonic GDC talk, devlog or Unity case study on Fall Guys' sky, backdrop or
  environment art turned up nothing citable. The Unity blog URL referenced by a
  third-party digest now redirects to the blog index, and the ArtStation
  "Art Blast" feature returned HTTP 403. No claim in this note rests on Fall
  Guys, which is consistent with CLAUDE.md using it for match structure only.

---

## 10. What it would take

Seams and files:

- `packages/shared/src/track/Environment.ts`: `EnvironmentId`,
  `ENVIRONMENT_PRESETS`, `DEFAULT_ENVIRONMENT_ID`, `invalidEnvironmentReason`,
  plus pure helpers (`sunDirection(preset)`, `cloudFloorY(preset, killPlaneY,
  lowestSegmentY)`, `wrapAround(camera, position, tile)`). All unit-testable
  under vitest with no WebGL.
- `packages/render/` (new): `createEnvironment` and its pieces (`skyDome.ts`,
  `cloudFloor.ts`, `cloudPuffs.ts`, `backdrop.ts`, `bakeEnvironmentMap.ts`). Tests
  cover the pure parts plus dispose bookkeeping with fakes, since jsdom has no
  WebGL.
- `apps/client/src/render/scene.ts`: an `environment` field on `StageConfig`;
  replace the background, fog, light and kill-plane lines; call `update` in
  `render()`; call `dispose` before the sweep; set `renderer.toneMapping`.
- `apps/client/src/game/trackLoading.ts`, `game/index.ts`, `game/practice.ts`:
  thread the fetched id through to `createStage`.
- `apps/api/src/db/schema.ts`, `db.ts`, `tracks/*`: the `environment` column,
  backfill, publish validation, and the `StoredTrack` field.
- `apps/track-builder`: a preset picker beside the Time Limit field
  (`api/timeLimitField.ts`), written on publish and playtest, plus a
  "preview Environment" toggle in the viewport (`scene/viewport.ts`, fog off).

Rough tickets, in order:

1. **ADR + glossary.** "The Environment is render-only presentation data on the
   Revision", with the new `packages/render` package (amends ADR 0007's layout)
   and the `Environment` term proposed for `CONTEXT.md`.
2. **Tone mapping to Neutral, in both apps.** On its own first, with a visual
   check of every asset family and BLIP, because it changes everything's look.
3. **Environment data and seam, sky dome + fog + lights, `day` only.** Replaces
   the dark void. No clouds yet.
4. **Environment map bake** from the dome, with light intensities rebalanced.
5. **Cloud floor** replacing the kill-plane mesh, derived from `killPlaneY` and
   clamped under the lowest Segment.
6. **Puff field** with drift and wrap, two bands, `detail: "low"`.
7. **Persistence:** the Revision column, API validation, `StoredTrack`, client
   fallback, and the builder picker and preview toggle.
8. **More presets and the backdrop kinds** (`sunset`, `night` with stars,
   `candy`).
9. *(Separate, optional)* blob shadows under Characters; composer MSAA (§8);
   height fog.

---

## 11. Open questions

1. **The word.** Is "Environment" right, and should it go into `CONTEXT.md` now?
   Is a future "level theme" a bundle *containing* an Environment, or something
   else?
2. **Which presets ship first?** `day` alone to prove the seam, or
   `day` + `sunset` from the start? Is `night` wanted, given its readability
   cost?
3. **Who picks the Environment?** The Track author on the Revision
   (recommended), a Lobby override on top later, or random per Round for
   variety?
4. **Neutral tone mapping.** Accept a global change to how every asset and BLIP
   look, as the price of an environment map and a sun that can exceed 1.0?
5. **Shadows.** None; a blob shadow under each Character (recommended as its own
   ticket); or a real shadow map with its per-frame cost?
6. **What is below the Track?** A cloud floor (recommended), or theme-dependent
   alternatives (sea, lava, an endless drop)? Note that a surface such as lava
   would *suggest* a danger rule, while the Fall is the rule whatever is drawn.
7. **Builder preview.** Off by default behind a toggle (respects ADR 0063's
   lavender canvas), or on by default so authors always tune against the real
   sky?
8. **Where the three.js code lives.** A new `packages/render` (recommended),
   per-app duplicates, or three.js in `packages/shared`? If a render package,
   should the existing ice, mud, bounce and asset-visual "deliberate duplicates"
   move into it later?
9. **Should the kill height become per-Track?** It is fixed at −8 for every
   Track, one stored Track already sits 2.8 above it, and a tall Skyfall Track
   would want more room. The cloud floor derives from whatever is decided.
10. **The render-only line.** Confirm an Environment never affects play (no wind,
    no darkness that hides the route, no fog thick enough to hide a gap). That
    is the load-bearing choice everything above rests on.
11. **Cloud style.** Toon-banded (`MeshToonMaterial`) or softly lit
    (`MeshLambertMaterial` plus environment map)?
12. **The procedural box material** (`0x1c2740`, chosen for a dark void). Should
    it change with the Environment, or are procedural boxes grey-box-only now?
13. **Composer MSAA** (found in passing, §8). Fix it with this work or
    separately?

---

## Sources

three.js, all at tag `r171` (also checked against the installed `three@0.171.0`):

- Objects and environments: [`Sky.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/objects/Sky.js), [`SkyMesh.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/objects/SkyMesh.js), [`RoomEnvironment.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/environments/RoomEnvironment.js), [`BufferGeometryUtils.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/utils/BufferGeometryUtils.js).
- Scene, fog, lights, materials: [`Scene.js`](https://github.com/mrdoob/three.js/blob/r171/src/scenes/Scene.js), [`ShaderMaterial.js`](https://github.com/mrdoob/three.js/blob/r171/src/materials/ShaderMaterial.js), [`MeshBasicMaterial.js`](https://github.com/mrdoob/three.js/blob/r171/src/materials/MeshBasicMaterial.js), [`LightShadow.js`](https://github.com/mrdoob/three.js/blob/r171/src/lights/LightShadow.js), [`InstancedMesh.js`](https://github.com/mrdoob/three.js/blob/r171/src/objects/InstancedMesh.js), [`Frustum.js`](https://github.com/mrdoob/three.js/blob/r171/src/math/Frustum.js), [`RenderTarget.js`](https://github.com/mrdoob/three.js/blob/r171/src/core/RenderTarget.js), [`constants.js`](https://github.com/mrdoob/three.js/blob/r171/src/constants.js).
- Renderer internals: [`WebGLRenderer.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/WebGLRenderer.js), [`WebGLBackground.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLBackground.js), [`WebGLRenderLists.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLRenderLists.js), [`WebGLShadowMap.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLShadowMap.js), [`WebGLMaterials.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/webgl/WebGLMaterials.js), [`UniformsUtils.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/UniformsUtils.js), [`UniformsLib.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/UniformsLib.js), [`PMREMGenerator.js`](https://github.com/mrdoob/three.js/blob/r171/src/extras/PMREMGenerator.js).
- Shader chunks: [`backgroundCube.glsl.js`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderLib/backgroundCube.glsl.js), [`fog_vertex`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/fog_vertex.glsl.js), [`fog_fragment`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/fog_fragment.glsl.js), [`worldpos_vertex`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/worldpos_vertex.glsl.js), [`lights_fragment_maps`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/lights_fragment_maps.glsl.js), [`lights_fragment_begin`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js), [`tonemapping_pars_fragment`](https://github.com/mrdoob/three.js/blob/r171/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js).
- Post-processing: [`EffectComposer.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/postprocessing/EffectComposer.js), [`OutputPass.js`](https://github.com/mrdoob/three.js/blob/r171/examples/jsm/postprocessing/OutputPass.js).
- Examples: [`webgl_lights_hemisphere`](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_lights_hemisphere.html), [`webgl_shaders_sky`](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_shaders_sky.html), [`webgl_volume_cloud`](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_volume_cloud.html), [`webgl_shadow_contact`](https://github.com/mrdoob/three.js/blob/r171/examples/webgl_shadow_contact.html), [examples index](https://github.com/mrdoob/three.js/tree/r171/examples).
- Docs and manual at r171: [Scene](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/scenes/Scene.html), [HemisphereLight](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/lights/HemisphereLight.html), [PMREMGenerator](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/extras/PMREMGenerator.html), [InstancedMesh](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/objects/InstancedMesh.html), [BatchedMesh](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/objects/BatchedMesh.html), [MeshToonMaterial](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/materials/MeshToonMaterial.html), [Material](https://github.com/mrdoob/three.js/blob/r171/docs/api/en/materials/Material.html), [How to dispose of objects](https://github.com/mrdoob/three.js/blob/r171/docs/manual/en/introduction/How-to-dispose-of-objects.html), [Color management](https://github.com/mrdoob/three.js/blob/r171/docs/manual/en/introduction/Color-management.html).

Other primary sources:

- MDN: [WebGL model view projection](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_model_view_projection) (clip space, homogeneous `w`), [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) (batching, mipmap memory overhead, back-buffer size).
- Khronos: [PBR Neutral tone mapping](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md). Google model-viewer: [tone-mapping comparison](https://modelviewer.dev/examples/tone-mapping).
- mrdoob: [Clouds demo](https://mrdoob.com/lab/javascript/webgl/clouds/).
- Guerrilla Games / SIGGRAPH 2015: [Advances in Real-Time Rendering course page](https://advances.realtimerendering.com/s2015/index.html).
- Inigo Quilez: [fog](https://iquilezles.org/articles/fog/).
- Epic Games: [Exponential Height Fog](https://dev.epicgames.com/documentation/en-us/unreal-engine/exponential-height-fog-in-unreal-engine).
- Repo: `apps/client/src/render/scene.ts`, `speedLines.ts`, `disposeSceneGraph.ts`, `assetVisuals.ts`; `apps/client/src/input/camera/springArm.ts`; `apps/client/src/game/index.ts`, `practice.ts`, `trackLoading.ts`; `apps/client/src/screens/CharacterPreview.tsx`, `Turntable.tsx`; `apps/client/src/hud/hud.ts`; `apps/track-builder/src/scene/viewport.ts`, `assets/iceTexture.ts`; `packages/shared/src/tuning.ts` (`DEFAULT_KILL_PLANE_Y`), `track/Track.ts` (`StoredTrack`, `TrackRoundDefaults`), `track/BounceOverlay.ts`, `track/conveyorStrip.ts`; `apps/api/src/db/schema.ts`, `db.ts`; `assets/KayKit_Platformer_Pack_1.0_FREE/` (`Samples/`, `contents.png`, glTF materials); ADR 0007, 0008, 0028, 0038, 0041, 0043, 0050, 0063, 0071; `docs/research/memory-bloat-investigation.md`, `screens-inventory.md`.

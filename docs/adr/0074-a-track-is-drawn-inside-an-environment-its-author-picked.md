# 0074 — A Track is drawn inside an Environment its author picked

## Context

Every Round runs inside the same near-black navy void: `scene.background` and
`scene.fog` are one hardcoded `0x0b0e14`, two hardcoded lights, a translucent
black plane at the kill height, no tone mapping, no environment map, no
shadows (`apps/client/src/render/scene.ts`). The Track builder and the
Screens' `CharacterPreview` light the same assets two more, unrelated ways.
Nothing about what surrounds a Track is designed, reusable, or chosen by
anyone.

The user asked for exactly that (2026-09-16): *"udelame research jak delat
věci kolem dráhy tím myslím pozadí jako oblohu s mraky atd, at je to
reusabilni, hezké atd."* Researched in
`docs/research/track-environment-sky-and-clouds.md` (three.js facts pinned to
r171, the version both apps use). Its load-bearing findings:

- **The chase camera never looks up.** Pitch is clamped to 0.1–0.85 rad with a
  55° FOV, so no sky above ~22° is ever on screen in a Round, and for at least
  half the pitch range the horizon is off-screen. **What lies under the Track
  is the main backdrop**, not the sky.
- **Every Asset is glossy plastic with no environment map.** KayKit, trap and
  BLIP materials are dielectrics at roughness 0.2–0.43, and three.js computes
  no indirect specular without `scene.environment`. They get one highlight
  from one light and nothing else.
- **The client renders through `EffectComposer`**, so `renderer.toneMapping`
  is applied once, by `OutputPass`, to sky, fog and geometry together; the
  builder renders straight to its canvas, so a custom sky shader must include
  the tone-mapping and colour-space chunks to be right on both paths.

Settled with the user (2026-09-16), answering the note's open questions:

1. *"environment je dobrý"* — the term.
2. *"i night"* — `day`, `sunset` **and** `night` in the first set.
3. *"autor dráhy"* — the Track author picks it.
4. *"jsem"* — Neutral tone mapping accepted, knowing it changes every Asset's
   and BLIP's look.
5. *"dal bych tam skutečné stíny"* — **real shadows**, overruling the note's
   blob-shadow recommendation.
6. *"mraky pro teď"* — a cloud floor under the Track, for now.
7. *"přepínač tam mít"* — the builder previews the Environment behind a
   toggle.

## Decision

**A Track Revision names one Environment preset. The Environment is
render-only presentation data: a sky dome, a cloud floor, drifting cloud
puffs, fog, and the lights, environment map and shadow direction that match
them. The game and the Track builder draw it through one shared seam.**

### What an Environment is

- **Data first.** An `EnvironmentId` and plain `EnvironmentPreset` records
  (sky colour stops, one sun vector, fog distances, light colours and
  intensities, exposure, cloud floor and cloud puff settings) live in
  `packages/shared` as three-free data, like `BounceOverlay.ts`. The API
  validates ids against it; the server bundle never pulls in three.js.
- **The first presets are `day` (the default), `sunset` and `night`.** Palettes
  are a tuning pass, not part of this decision; the note's §7 table is the
  starting point. Two constraints from the research are binding: the sky and
  cloud floor must never match the saturated blue of the KayKit deck tops, and
  `night` must keep fill light high enough that the route stays readable.
- **Sky:** a camera-following gradient dome (position, never rotation; depth at
  the far plane via `z = w`; `fog: false`; drawn last among opaque objects),
  three colour stops and an optional sun disc. Not `Sky.js`, not an image
  skybox.
- **Under the Track: a cloud floor.** One camera-following plane (X/Z follow,
  Y fixed) with world-space scrolling noise, derived from `killPlaneY` and kept
  below the lowest Segment. It replaces the drawn kill plane; the simulation's
  kill plane does not move. A Falling Character sinks into cloud before it
  Respawns. Sea, lava or an endless drop are not built now — "for now" is the
  user's word, so another under-Track kind may come later as a preset field.
- **Cloud puffs:** opaque instanced low-poly clusters that drift on the wall
  clock (never sim time) and wrap around the camera. No volumetric clouds.
- **Fog:** `THREE.Fog`, its colour always the preset's horizon stop.
- **Light:** `HemisphereLight` and one `DirectionalLight` from the preset's
  palette; the light's direction is the preset's sun vector (with a named
  `lightElevationDeg` override for a low sunset sun). One
  `PMREMGenerator.fromScene` bake of the dome becomes `scene.environment`.

### Tone mapping

**`NeutralToneMapping` (Khronos PBR Neutral) in both apps**, with exposure a
per-preset field. The operator is an app-level renderer setting, not a preset
field, and the builder must use the same one or its preview lies. It lands as
its own step, before any sky, with a visual check of every Asset family and
BLIP.

### Shadows

**Real shadow maps from the Environment's directional light.** The research
recommended a blob shadow for cost; the user chose real shadows. What that
means:

- `renderer.shadowMap.enabled`; the preset's directional light casts. Its
  direction is the preset's sun (so a sunset throws long shadows), which keeps
  shadows and sky in agreement by construction.
- Characters (the model and the ragdoll's bones), placed Assets, moving
  Segments and Props cast; Track surfaces receive. The Environment's own
  meshes (dome, cloud floor, puffs) neither cast nor receive.
- The shadow camera is a box that follows the local Character (the camera's
  focus), with its origin snapped to shadow-map texels so it does not shimmer.
- `mapSize`, box extent, bias and filter type are tuning, not decided here.
- The cost is accepted knowingly: with the default `autoUpdate` every caster
  is re-rendered into the shadow map every frame, and a 2048² map is roughly
  16 MiB of colour plus depth (research §6).

### Where the choice lives

- **On the Revision row**, as `environment TEXT NOT NULL DEFAULT 'day'`,
  following `time_limit_ms` (ADR 0038). Old Revisions backfill to `day`.
  Publish rejects an unknown id (`invalidEnvironmentReason`).
- **Not in the `data` envelope**, for the reason ADR 0038 gave, and **not a
  field of `TrackRoundDefaults`** — it is not a Round default.
- **The author picks it in the Track builder**, beside the Time Limit field;
  it is written on publish and on playtest.
- **The client reads it from the `GET /tracks/:id` fetch it already makes.**
  An id the running build does not know falls back to `day` with a dev
  warning, never an error — the same "a cosmetic must never brick boot"
  contract `trackLoading.ts` applies to the Surface textures.
- **The Match server and the shared step never read it.** It is not in
  `RoundRules` (ADR 0043) and never on the Snapshot. A Lobby override on top of
  the Revision default stays possible later, the way ADR 0041 reopened ADR 0038,
  and is not built now.

### The builder

The viewport gets a **"preview Environment" toggle**. The lavender canvas and
grid stay the default authoring view (ADR 0063); the toggle swaps in the
Revision's Environment with fog off (an orbit camera framing a whole Track sits
far outside the chase camera's distances). The playtest path boots the real
client and shows the real fog. Thumbnails stay neutral.

### Render-only, by rule

**An Environment never affects play** (confirmed by the user in a follow-up
round the same day): no wind, no darkness that hides the route, no fog thick
enough to hide a gap. The server and the shared step never read it. A preset
that would need a gameplay rule is not an Environment preset; it would be a new
ADR.

### Where the three.js code lives: a new `packages/render`

**A new workspace package, `@dont-fall/render`, holds three.js rendering shared
by the game and the Track builder** (user's choice). This amends ADR 0007's
layout: `packages/shared` stays three-free and server-safe (ADR 0050's "three.js
stays client-only" holds — `packages/render` is only ever imported by
`apps/client` and `apps/track-builder`), and `packages/ui` is the precedent for
a non-simulation package. `three` is a peer dependency. The preset *data* stays
in `packages/shared`, because the API validates ids. The existing per-app
"deliberate duplicates" (ice, mud and bounce textures, asset visuals) have a
natural home there later, as a separate cleanup — not part of this work.

### Kill height stays −8

The kill height stays `DEFAULT_KILL_PLANE_Y` on every Track for now. The cloud
floor derives from it and is clamped below the lowest Segment; a per-Track kill
height is a later decision (a tall Skyfall Track is the likely trigger).

### Antialiasing is fixed with this work

The client scene renders into an `EffectComposer` target created without
`samples`, so the renderer's `antialias: true` never reaches it (read from
source, not yet confirmed in a browser). Cloud and horizon edges would show it,
so the composer gets a multisampled target as part of this work, accepting the
larger GPU buffer.

## Still open

- **Cloud style** — toon-banded (`MeshToonMaterial`) vs softly lit
  (`MeshLambertMaterial` plus the environment map).
- **The procedural box material** (`0x1c2740`, picked for a dark void) — tied to
  the Environment, or left as grey-box only.
- **Distant backdrop scenery** (floating islands, silhouettes; research §4) —
  not in the first pass, not rejected either.

These are visual calls settled with the user in the tickets that touch them.

## Considered options

- **Blob shadow under each Character instead of a shadow map** — nearly free
  and gives a platformer the one thing it needs from a shadow (where you will
  land). Rejected by the user in favour of real shadows.
- **`Sky.js` (Preetham)** — physical parameters instead of colours, HDR output
  tuned for ACES, and it renders everything below the horizon as haze, which is
  where this camera looks.
- **Image skyboxes** — an artist and a licence per preset; possible later.
- **ACES or AgX tone mapping** — both desaturate the saturated blues, yellows
  and greens the toy-like palette is made of.
- **The Environment in `RoundRules`, or picked in the Lobby** — the first
  breaks render-only (the shared step reads `RoundRules`); the second is a
  possible later override, not the default home.
- **`candy` in the first set** — not chosen; the three presets above are.
- **Per-app copies of the Environment code** — the repo's duplicate policy is
  for ~15 lines; this is hundreds, and the builder's preview must be exactly
  what the game draws.
- **three.js inside `packages/shared`** — `shared` runs on the server and ADR
  0007/0050 keep three.js out of it.
- **A per-Track kill height now** — deferred; nothing needs it yet.

## Consequences

- `createStage` loses its hardcoded background, fog, lights and kill-plane
  mesh to one Environment call; the Environment is created and disposed with
  its Stage, and must free its own PMREM target (`disposeSceneGraph` does not
  reach `scene.environment`).
- Every Asset, BLIP and every basic-material marker (Checkpoint, Finish Zone)
  changes look under Neutral tone mapping and a sky-coloured environment map.
- Shadow maps add a per-frame caster pass and a few tens of MiB of GPU memory;
  a low-end path, if one is needed, is a later decision.
- The API gains an `environment` column and validation; the builder gains a
  picker and a viewport toggle.
- The repo gains a third package, `packages/render`, with its own mandate:
  three.js rendering shared by the game and the Track builder, never imported
  by `apps/server` or `apps/api`.
- The composer's multisampled target costs more GPU memory than today's
  single-sample one.
- `CONTEXT.md` gains **Environment**. A future "level theme" is expected to
  *bundle* an Environment with other things, so the word "theme" stays free.

## Amended by ADR 0079 (2026-09-17)

Real shadows are the default, not unconditional: graphics quality is a
per-device player setting, and its `low` level draws no shadows (`medium` uses
a 1024² `PCFShadowMap`). The shadow constants above become the `high` level's
values. Nothing else here changes.

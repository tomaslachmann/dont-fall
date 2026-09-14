# Authoring new Track Modules without a DCC tool

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). Answers one question; if adopted, capture the
> decision as an ADR the normal way.
>
> **Follow-up revision (2026-09-14):** the human rejected §3's "author TS data
> records" — writing boxes blind as numbers with no visual feedback is
> unacceptable. New hard requirement: **the author must SEE the Module while
> authoring it**, still without learning any DCC tool. §§2.6–2.8 and §3 are
> rewritten for that; §§2.1–2.5 stand (collider/visual split unchanged).

## 1. Question

What is the EASIEST way for a non-3D-artist (will not learn Blender or any DCC
tool) to author NEW track Modules for this game's Track builder, given:

1. Fall Guys look — chunky shapes with ROUNDED corners/edges;
2. physics hitboxes stay STRAIGHT (flat cuboid walk surfaces — characters walk
   flat, never dip into rounded visual gaps), so visuals and colliders are
   separate by design;
3. colliders build IDENTICALLY on client and server from the same source;
4. Modules plug into the existing Track builder flow;
5. **the author SEES the Module while authoring it** (visual feedback loop).

## 2. Findings

### 2.1 The repo already has a code-authored Module path — and it is the seam

A `Module` is data: `statics: FloorBox[]` plus Sockets, footprint, and optional
garnish (`packages/shared/src/track/Module.ts:77-120`). `M1_MODULES`
(`packages/shared/src/track/modules.ts:36`) is a hand-written TS record — no
Blender involved, no bytes on disk. The two Module kinds the registry decides
between (ADR 0050) are *procedural* (`statics` cuboids) and *asset-backed*
(GLB trimeshes); a code-authored Module is simply a new procedural entry.

- Colliders: `RapierSimulation` builds one fixed-body cuboid collider per
  `statics` box (`packages/shared/src/simulation/RapierSimulation.ts:327-341`),
  identical on both sides because both run the same shared constructor over the
  same resolved Track. Requirement (3) holds by construction — nothing new to
  prove.
- Client visuals: `createStage` draws each static with `boxMesh`, a plain
  `THREE.BoxGeometry` sized from the same half-extents
  (`apps/client/src/render/scene.ts:173-185,224-228`).
- Builder flow: placement, chaining, Socket-snap and overlap read Sockets and
  footprints — never triangles — so a new registry entry needs no bytes and no
  per-module builder work (`apps/track-builder/src/assets.ts:18-25`, ADR 0050
  "the track builder picks both up without per-module work"). Requirement (4)
  holds by adding one record entry.

### 2.2 The collider must stay a straight cuboid — Rapier's own docs say why

`ColliderDesc.roundCuboid(hx, hy, hz, borderRadius)` exists
([ColliderDesc API](https://www.rapier.rs/javascript3d/classes/ColliderDesc.html)),
but the [RoundCuboid API](https://www.rapier.rs/javascript3d/classes/RoundCuboid.html)
states the border radius "will effectively increase the half-extents of the
cuboid by this radius": the shape is the inner cuboid *dilated* by a sphere
(`RoundShape<Cuboid>`, [docs.rs](https://docs.rs/rapier2d/0.25.1/rapier2d/geometry/type.RoundCuboid.html)).
Flat faces stay flat, but the footprint grows by `r` in every direction and the
edges curve — a Character walking near a platform edge would round off and dip.
That violates requirement (2) exactly where it matters. Keep
`ColliderDesc.cuboid` (what `RapierSimulation` uses today) and round only the
visual.

### 2.3 RoundedBoxGeometry: rounded visuals in one line of code, no DCC

Three.js ships
[`RoundedBoxGeometry`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/geometries/RoundedBoxGeometry.js)
(`three/addons/geometries/RoundedBoxGeometry.js`):

```js
new RoundedBoxGeometry(width, height, depth, segments, radius)
```

Sourced facts from that file: it extends `BoxGeometry`, keeps overall
dimensions (radius is clamped to the shortest half-side), rounds all 12 edges
with `segments` subdivisions, and keeps segment counts odd "so that we have a
plane connecting the rounded corners" — i.e. the top face stays a true flat
plane at full height. Rendered at the same center/size as today's `boxMesh`
box, its top face is coplanar with the straight cuboid collider's top: the
Character walks flat while the eye sees Fall Guys chunk. The only divergence is
at edges, where the visual recedes inward by up to `r` — feet at the very edge
visually overhang slightly. Standard practice is a small `r` (0.1–0.15) next to
multi-unit platforms; the gap is sub-shoe.

Cost: one client-side swap in `boxMesh` (plus the builder's own preview mesh,
same one-liner) — shared code and therefore physics stay untouched, satisfying
the no-three.js-in-shared boundary ADR 0050 enforces.

### 2.4 Non-box profiles: ExtrudeGeometry with bevel, still code-only

For pieces a rounded box cannot express (L-corners, stair side-profiles),
[ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html)
builds a mesh from a 2D `THREE.Shape` plus `bevelEnabled`/`bevelThickness`/
`bevelSize`/`bevelSegments`. Caveat from those docs: the bevel *expands* the
outline by `bevelSize`, so the outline must be inset by `r` to keep
visual-over-collider honest. Colliders remain hand-placed `FloorBox` cuboids
underneath — the same visual/collider separation as 2.3.

### 2.5 Considered and NOT recommended

- **SDF-to-mesh authoring**: no maintained, dependency-light meshing library
  fitting this stack surfaced; three.js's own `MarchingCubes` addon is a
  metaball demo object, not an authoring pipeline. Rejected.
- **CSG composition**: real libraries exist, but CSG output would feed
  *colliders* too, re-opening the identical-both-sides proof and adding a
  dependency — for shapes rounded boxes + extrusions already cover. Revisit
  only if a Module needs holes.
- **Authoring GLBs in code into the M8 pipe**: strictly more machinery (GLB
  writer, role nodes, footprint validation) for zero gain over the procedural
  path when the shapes are parametric anyway.

### 2.6 What the track-builder already does visually — place only, never compose

Read in full: `viewport.ts`, `render.ts`, `trackEdit.ts` (exports),
`assets.ts`, `api.ts`, ADR 0034. The builder is already a substantial visual
editor — but every visual operation acts on **Segments referencing existing
Modules**, never on Module contents:

- Whole-Track orbit overview with `GridHelper`, per-Segment groups built by
  `buildModuleGroup`/`buildSegmentGroup` (`viewport.ts:124-148`,
  `render.ts:143-180`); auto-rotating per-Module palette thumbnails through one
  shared offscreen renderer (`viewport.ts:41-79`); asset Segments render clones
  of fetched visual templates (`viewport.ts:349-369`).
- `TransformControls` gizmo in **translate + rotate only**, with Socket-snap
  override on drag, two-tier grid snaps, multi-select rigid-group pivot, and
  live red/green overlap ghost (`viewport.ts:191-334`; `setGizmoMode` admits
  only `"translate" | "rotate"`, `viewport.ts:110,426-428`).
- `trackEdit.ts` exports prove the ceiling: insert/append/delete/duplicate
  *Segments*, move/rotate *Segment transforms*, snap, overlap — no function
  takes a box apart or adds geometry to a Module.
- Playtest is real simulation, not a preview: publish the Draft under the
  reserved `PLAYTEST_TRACK_ID` and open the actual game at
  `/play?track=…&freeroam=1` (`api.ts:37-58`, `main.ts:511-532`).

So the visual feedback loop the new requirement asks for exists at Track level
(place → see → playtest) but there is **no Module-composition surface at all**:
new Module contents today can only be typed as numbers (rejected) or modeled
in Blender (rejected).

### 2.7 The lightest visual authoring: a compose-from-boxes mode in the builder

Everything the mode needs is already a proven in-repo pattern or a first-party
addon:

- **Move + resize gizmos**: the builder already drives `TransformControls`
  (2.6); its [`scale` mode](https://threejs.org/docs/pages/TransformControls.html)
  (`mode: 'translate' | 'rotate' | 'scale'`, with `setScaleSnap`) turns the
  same gizmo into a box resizer. Verified present in the installed
  three@0.171.0 source (`setScaleSnap`, scale gizmo/picker; scale is always
  local-space). One new mode: attach the gizmo to one *box inside a Module
  draft* instead of to a Segment — translate moves it, scale resizes it,
  `translationSnap`/`scaleSnap` reuse the builder's existing snap tiers, and a
  second `GridHelper` (already used at `viewport.ts:139`) grounds the local
  frame.
- **What you see is what simulates**: the mode edits `FloorBox[]` (centers +
  half-extents) — exactly the data `RapierSimulation` turns into colliders
  (2.1). Rendering each draft box twice — solid rounded visual (§2.3) plus the
  existing wireframe-box marker treatment `render.ts` already gives triggers —
  shows collider and look simultaneously, so the req-(2) gap is *visible* while
  authoring instead of surprising in playtest.
- **Rejected alternative — in-game build mode**: the client renderer is the
  real WYSIWYG, but it has no editor harness (no gizmos, no picking, no
  undo/history, no publish path), while the builder has all four. Building a
  second editor inside the game to reuse its renderer costs more than reusing
  the builder's editor with game-matching materials.

### 2.8 How the authored result flows back into the game

The registry is compile-time TS on purpose: `MODULE_LIBRARY = M1_MODULES`
(`modules.ts:252`); asset defs likewise (`ASSET_MODULE_DEFS`); server,
predicting client, builder, and track-service publish validation
(`unknownModuleIds` → 400) all import the same ids from `@dont-fall/shared`.
A visually composed Module must therefore become a registry entry, and there
are exactly two doors:

- **(a) Export-and-commit (recommended):** the builder serializes the composed
  Module (statics + Sockets + footprint — plain JSON, the shape `Module.ts`
  already declares) to a downloadable/copy-pasteable snippet the author commits
  into the registry. Zero architecture change: colliders flow through the
  existing shared path on both sides (req 3 by construction), publish
  validation keeps working unchanged, and "Authored once" (CONTEXT.md: Module)
  stays literally true. Cost is one serializer + paste-target docs.
- **(b) Server-stored custom Modules (rejected for now):** track-service would
  store Module definitions, serve them to match server + clients + builder
  before any sim loads, and publish validation would resolve ids against stored
  Modules instead of the shared registry — a content pipeline with versioning,
  fetch-failure modes, and a Revision-immutability interplay (what does an old
  Revision mean if its Module's definition changes?). That is a milestone, not
  a feature, and ADR 0050 already deferred "track-service as an art store" on
  the same grounds.

## 3. Recommendation

**Add a "compose Module from boxes" mode to the track-builder; export the
result into the shared registry; render everything rounded.**

1. New builder mode editing a Module draft's `FloorBox[]` with the existing
   gizmo stack: `TransformControls` translate (already wired) + `scale` (one
   `setMode` + `setScaleSnap` away per the official docs and installed source),
   on a `GridHelper`, rendering each box as solid-rounded + wireframe-collider
   so authoring IS the req-(2) check. Sockets/footprint get marker + drag
   treatment mirroring the existing trigger markers in `render.ts`.
2. "Export Module" serializes the draft to a registry-ready snippet (§2.8a);
   author commits it — colliders, validation, and builder placement then work
   with no further code.
3. The §2.3 `RoundedBoxGeometry` swap (client `boxMesh` + builder preview)
   gives every Module — old and newly composed — the Fall Guys look in one
   shared-code-untouched change.
4. Playtest stays exactly today's loop: place the new Module on a Draft,
   Playtest publishes it to the real game.

Rough effort: **M** — the gizmo/viewport reuse is real but a new mode with
selection-inside-a-Module, Socket/footprint editing, and export is still a few
days, not an afternoon. No ADR strictly required (no shared-architecture
change); worth one short record if Socket-editing UX settles anything
surprising. The server-stored-Modules milestone (§2.8b) stays explicitly out.

## 4. Open questions

1. Should `cornerRadius` be global, per-Module, or per-`FloorBox`? (unchanged
   from before; thin trim pieces may want smaller/no rounding)
2. Socket authoring UX: drag Socket markers in the compose mode, or derive
   entry/exit from footprint faces with a convention (cf. `deckModule` in
   `assetModules.ts:50-58`) and let the author nudge?
3. Does the compose mode need wedge/arc primitives now (ADR 0055's
   `buildBlockGeometry`), or do stacked cuboids (stairs as boxes — the M8
   `stairs_4step` precedent) cover the first Modules?
4. Export format: JSON paste, or generated-TS download? JSON is smaller;
   generated TS matches the registry's current handwritten shape exactly.

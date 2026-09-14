# 0050 — Asset-backed Modules: one GLB per Module, parsed at runtime on both sides

M8 replaces procedural Module geometry with authored assets: one GLB per
Module in `assets/`, carrying both what you see and what you collide with.
Settled in a grilling session (2026-09) against four already-authored
placeholder assets (`platform_straight`, `ramp_45`, `stairs_4step`,
`corner_lshape`), which already embody the chosen shape — this ADR ratifies
what is on disk rather than inventing it.

## Decision

- **One file per Module, two role-marked nodes.** `<moduleId>.glb` holds a
  `role: collision` node and a `role: visual` node (glTF node extras). The
  stray `collision: True` flag the exporter also sets is ignored; `role` is
  authoritative. No split `.visual.glb` / `.collision.glb` files — one file
  keeps the pair from drifting apart on disk.
- **Parsed at runtime, on both sides, by one shared reader** in
  `packages/shared` (GLB is a trivial container; three.js stays client-only).
  The server needs collision geometry for its authoritative sim and the
  predicting client needs the identical geometry, so both parse the same
  bytes through the same code. Nothing is pre-baked at build or publish
  time: no second source of truth before there is content worth optimizing.
- **Collision is a trimesh, verbatim, statics only.** The collision node's
  triangles become a Rapier trimesh exactly as authored — the meshes are
  hand-built simple geometry (tens of vertices), so exactness is free and
  hull-shrinking would only invent error. Trimesh colliders must be static,
  so articulated asset parts (spinner arms and the like) are out of scope
  until a dynamic representation is designed.
- **Surfaces ride node extras.** A collision (sub)mesh carries
  `surface: "<id>"`, resolving through the existing
  `node ?? Module ?? "default"` chain (ADR 0036). An unknown id is a
  load-time hard error — `SurfaceId` is an open string, so only the loader
  can catch a typo before it silently plays as default.
- **Validation is load-time, shared, and strict about collision only.**
  Collision bounds exceeding the Module's footprint past
  `ASSET_FOOTPRINT_EPSILON` (the anti-gap overlap allowance) fails the load
  on both sides identically — a mismatched asset must never simulate
  differently per side. Visuals escaping collision past `ASSET_VISUAL_WARN`
  log a dev warning only: visuals may legitimately vary (detail, LOD,
  compression) while collision stays single-source.
- **Node transforms are baked**, never required to be identity — exporter
  axis conversions must keep working without author intervention.
- **Served bundled, not versioned.** Client bundles the GLBs (like the
  character model); the server reads them from disk. Track-service owns
  Track compositions, not Module art.

## Considered options

- **Split visual/collision files** — rejected: doubles the files that can
  disagree and buys nothing while one exporter writes both nodes at once.
- **Pre-baked collision JSON at build/publish time** — rejected: a build
  step plus a second artifact to keep in sync, before any content exists
  whose load cost would justify it. Revisit with profiling data, not before.
- **Convex hulls instead of verbatim trimeshes** — rejected for statics:
  hulls approximate, and there is nothing to approximate away at these
  vertex counts. Hulls return with dynamic asset parts, which need them.
- **Track-service as the art store (versioned, fetchable)** — rejected for
  M8: art versioning is a content-pipeline milestone, not this one.

## Consequences

- `CONTEXT.md` gains **Asset**, **Collision mesh**, **Visual mesh**.
- Asset Modules are a new Module kind alongside procedural ones (moduleId →
  GLB + footprint + Surfaces); the registry, not the loader, decides which
  is which, and the track builder picks both up without per-module work.
- Filename stem must equal `moduleId`, enforced by the loader.
- M8 is pipeline + placeholders: final beveled/textured visuals are a later
  content drop that changes no code by design.

## Amendment (2026-09-09, M8 grill follow-up)

The "Served bundled, not versioned" bullet above is superseded: track-service
serves the bytes (`GET /assets/:name`, read from a disk dir), and all three
loaders — match server at boot, client at track load, builder at tab
open — fetch through it. Reason: two `public/` copies drift silently, and a
sync script treats the symptom; one pipe deletes the problem. Revisions
float (latest wins); in-match consistency comes from fetch-once-per-loader,
with a documented window — an asset edit landing *between* the server's and
a client's fetch splits that match, the exact window ADR 0032 closed for
tracks, accepted here because art edits are rare and revision-pinned art
(content hashes in the welcome) belongs to the content-pipeline milestone,
not M8. History above is preserved as decided; this section records what
changed and why.

## Amendment (2026-09-11, M9 asset drop)

The role marker gains a fallback. `extras.role` (`"collision"` / `"visual"`)
stays the authoritative marker and still wins wherever it is present, but a
meshed node carrying no `role` extra at all is now also accepted when its
**node name** ends in `_Collision` / `_Visual` (case-insensitive, suffix
only). Reason: a Blender custom property is quietly lost to a
duplicate-and-rename, an object join, or a library override, while the
outliner naming convention survives all three — the ten-block drop this
amendment came from carries the names and none of the properties. The
fallback is deliberately narrow: an *explicit but unrecognized* `role` still
fails (a typo is an authoring error, not a reason to guess from the name),
`_Collision` anywhere but the end of the name names nothing, and a node
marked neither way still fails the load loudly rather than being silently
dropped from collision.

Unchanged, and re-affirmed: a GLB is authored **in the Module's own local
frame, Y-up** — the reader applies node transforms and nothing else. Assets
exported Z-up are re-exported with Blender's "+Y Up" option rather than
rotated in code, so one frame holds for every file and shared never
transforms authored geometry on its way into the simulation.

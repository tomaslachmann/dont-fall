# 02 — Registry + trimesh statics on both sides

**What to build:** Asset Modules as a real Module kind: registry entries for
all four, collision meshes baked into Rapier trimesh statics in the sim the
server authorizes and the client predicts.

**Blocked by:** ticket 01 (nothing to bake until the reader exists).

**Status:** planned

## Why

This is the milestone's load-bearing ticket: the first time an authored
triangle moves a Character. Everything after it (visuals, builder, content)
is presentation or cleanup around physics that already works.

## What to change

- [ ] Asset Module kind alongside procedural ones: `moduleId` ↔
      `<moduleId>.glb` filename stem (enforced by the loader), footprint +
      default Surface + sockets authored in code beside the entry
- [ ] `resolveTrack` (or its asset path) turns each placed asset Segment's
      collision mesh into static trimesh colliders with the node's resolved
      Surface — the same `Surface`/`Volume`/trigger machinery procedural
      floors already flow through, not a parallel one
- [ ] Server reads GLBs from disk, client fetches bundled files — both
      through ticket 01's reader, no second parse anywhere
- [ ] Footprints + sockets for the four, measured off the actual files so
      Segments tile without gaps or overlaps past the epsilon

## Done when

- [ ] Physics tests, no rendering: a Character dropped onto
      `platform_straight` lands at the file's height; `ramp_45` carries it
      down without skipping (M3.6's ramp rule still holds on authored
      triangles); `stairs_4step` climbs step by step
- [ ] The same test against server-built and client-built worlds gives the
      same answer — one geometry, two sims
- [ ] A footprint-violating file fails the load instead of simulating wrong
- [ ] **Live:** host a Match on an asset-Module Track and walk it (visuals
      still boxes at this point — ticket 03's problem, not this one's)

## Watch out for

**Trimesh colliders are static-only** (ADR 0050). If any of the four files
hides a moving part, it stays out of the collision mesh — articulated asset
parts are explicitly not M8.

**Sockets are authored, not derived.** The files carry no socket data; a
mis-measured socket breaks Track chaining silently. Measure twice, and cover
each socket with a placement test.

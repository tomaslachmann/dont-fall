# 02 — Registry + trimesh statics on both sides

**What to build:** Asset Modules as a real Module kind: registry entries for
all four, collision meshes baked into Rapier trimesh statics in the sim the
server authorizes and the client predicts.

**Blocked by:** ticket 01 (nothing to bake until the reader exists).

**Status:** implemented — verification pending (live + socket suites blocked by sandbox; everything runnable is green, see notes)

## Why

This is the milestone's load-bearing ticket: the first time an authored
triangle moves a Character. Everything after it (visuals, builder, content)
is presentation or cleanup around physics that already works.

## What to change

- [x] Asset Module kind alongside procedural ones: `moduleId` ↔
      `<moduleId>.glb` filename stem (enforced by the loader — the fetch URL
      is derived from the id, so a mismatch is impossible by construction),
      footprint + default Surface + sockets authored in code beside the entry
      (`ASSET_MODULE_DEFS` + `attachAssetGeometry`, geometry on the entry,
      composed per-consumer — the static registry never holds bytes)
- [x] `resolveTrack` turns each placed asset Segment's collision mesh into
      world-space `staticTrimeshes` with the node's resolved Surface, through
      the same `staticSurfaceByHandle` machinery — and refuses a Module
      carrying both statics and asset geometry
- [x] Server fetches GLBs from track-service at boot (`assetSource.ts`),
      client fetches them at track load (cached, fetch-once-per-session) —
      both through ticket 01's reader via injected fetch, no second parse
      anywhere (ADR 0050 as amended: one pipe, floating revisions).
      Track-service serves `GET /assets/:name` from disk (plus `Dockerfile`
      COPY + `TRACK_ASSETS_DIR`)
- [x] Footprints + sockets for the four, measured off the actual files so
      Segments tile without gaps or overlaps past the epsilon

## Done when

- [x] Physics tests, no rendering: a Character dropped onto
      `platform_straight` lands at the file's height; `ramp_45` carries it
      down without skipping (M3.6's ramp rule still holds on authored
      triangles); `stairs_4step` descends step by step (see deviation)
- [x] The same test against server-built and client-built worlds gives the
      same answer — one geometry, two sims (`matchRuntime.test.ts`, green)
- [x] A footprint-violating file fails the load instead of simulating wrong
- [ ] **Live:** host a Match on an asset-Module Track and walk it (visuals
      still boxes at this point — ticket 03's problem, not this one's).
      Blocked here: no sockets or browser in this sandbox

## Implementation notes

- `TriMeshFlags.ORIENTED` on every asset collider (pseudo-normals for border
  contacts): correct exactly when winding is consistently outward, which all
  four files are (signed-volume proof) and a new test pins per file — a
  future file breaking the assumption fails there, not as a fall-through.
- Deviation (user-approved mid-ticket): stairs DESCENDS. 0.375 risers are
  unclimbable with autostep off (lip ladder spikes: mounts ≤0.15), autostep
  itself stays off per M3.6's measured dash rationale, so the sockets flip
  entry-high/exit-low and the geometry is untouched — like every M1 module,
  it goes downhill. Descending verified grounded, no jump, no fall.
- `corner_lshape` is honestly NOT an L: collision and visual are the same
  8x4 straight slab (verified triangle-by-triangle). Socketed along its long
  axis as the straight piece it is; a true-L remodel is ticket 04's new
  content item. Name lies, physics doesn't.
- Socket heights come from TOP FACES, never max-Y verts (side-wall tops
  fooled one measurement into seating the stairs exit 0.375 proud as a
  wall) — the chained descent test caught it; the note is on the def.
- Verified here: shared 646 / client 271 / ui 21 / builder 88, server
  runtime 5, track-service asset-unit 4, full typecheck clean. Socket suites
  (matchServer, service routes) written-or-untouched but unrunnable —
  sandbox denies even loopback `listen`.

## Watch out for

**Trimesh colliders are static-only** (ADR 0050). If any of the four files
hides a moving part, it stays out of the collision mesh — articulated asset
parts are explicitly not M8.

**Sockets are authored, not derived.** The files carry no socket data; a
mis-measured socket breaks Track chaining silently. Measure twice, and cover
each socket with a placement test.

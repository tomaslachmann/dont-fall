# 0055 — Block builder: parametric blocks on a split grid with typed snap points

The track builder (ADR 0034 free placement) places fixed-geometry Modules.
Authors need one stretchable block — width/length/height, a wedge made by
raising one edge (shear, not rotation), and an arc — that always tiles cleanly:
no arbitrary heights, snap-together faces, stacking on top of each other.
Settled as a research note first
(`docs/research/block-builder-grid-and-snapping.md`); this ADR records the
adopted decisions.

## Decision

- **One parametric `block` Module kind, parameters on the Segment.**
  `Segment` gains one optional field, `params?: BlockParams`
  (`cuboid` | `wedge` | `arc`, grid-count ints + `angleDeg` + `slopeAxis`).
  Purely additive like ADR 0034's `pitch`/`roll`: old Revisions parse
  unchanged, no migration, extended shape appears only in new Revisions
  (Revision immutability, ADR 0032).
- **Split grid: `GRID_XZ = 0.5`, `GRID_Y = 0.25`.** Every dimension is an
  integer multiple of its axis unit. 0.5 horizontal reuses `MOVE_STEP`,
  equals `GROUND_SNAP_DISTANCE`, and divides `SOCKET_SNAP_RADIUS = 1.5`
  exactly; 0.25 vertical is one half-cell (author feedback: 0.5 vertical is
  too coarse) and still divides both. Stacking height is therefore always
  `k * 0.25` — purely additive, no special stacking rule.
- **Snap-point typology: face / edge / corner + stacking.** Top face doubles
  as the stacking receiver (`top-face -> bottom-face`, the ADR 0031
  socket-to-socket precedent generalized from track flow to block assembly).
  Priority: stacking face > entry/exit flow sockets > edge > corner > grid
  fallback. Radius stays `SOCKET_SNAP_RADIUS = 1.5`; green/red ghost with
  reason follows the proposal pipeline.
- **Geometry generation lives once in `packages/shared`**
  (`buildBlockGeometry(params)`): analytic wedge (cuboid envelope, high edge
  full height, low edge zero), arc tessellated by angle step <= 15° with rim
  snaps on quadrant boundaries. Builder preview, game collider, and server
  validation all call it. Wedge/arc collision is a static trimesh through the
  existing M8 (`StaticTrimesh`) pipeline — no new collider machinery.
- **Warn in the builder, reject at publish.** Live ghost warnings never block
  authoring (ADR 0033 posture); the server rejects unquantized/unknown params
  with a readable reason (existing `POST /tracks` 400 order, reject-not-clamp).
  Same split for physics warnings: wedge slope in slide (35–60°) or wall
  (>= 60°) territory, step-ups above the measured max jump height.
- **Free tilt and parametric slope coexist.** `params` geometry is baked in the
  block's local frame, then the existing Segment orientation
  (`segmentOrientation`) applies on top — the ADR 0050 "bake, then orient"
  split. Tilt never de-quantizes `params`; tilt-induced slide/wall/stack-break
  is covered by the warnings above.
- **Phased: cuboid + wedge first (no tessellation risk), arc second.**
  Arc collider form (single trimesh vs. convex pieces) and ghost UX for the
  enlarged snap set are explicitly deferred to measured/prototyped follow-ups,
  not decided here.

## Consequences

- `packages/shared/src/track/Track.ts`: `Segment.params`, `GRID_XZ`/`GRID_Y`,
  `quantize` helper, `buildBlockGeometry`.
- `packages/shared/src/track/Track.ts` (`resolveTrack`) +
  `RapierSimulation`: consume generated geometry (cuboid stays cuboid, wedge
  and arc become `StaticTrimesh`).
- `apps/track-service`: `isSegment` + `validate.ts` gain the optional `params`
  branch (unknown-kind rejection mirrors `unknownModuleIds`).
- `apps/track-builder`: face/edge/corner snap points + stacking receiver,
  dimension entry tiers (1 cell / Shift-0.1 uncommitted), slope and
  jump-reachability warnings, measured max jump height as the warning
  threshold.
- CONTEXT.md gains **Block** (parametric), **Grid unit**, **Snap point** if
  this ships — glossary only, no implementation detail.

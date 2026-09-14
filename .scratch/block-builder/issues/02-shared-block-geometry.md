# 02 — `buildBlockGeometry` + sim wiring (cuboid + wedge)

**What to build:** The single source of truth for parametric geometry:
`buildBlockGeometry(params)` in `packages/shared`, and its two consumers —
`resolveTrack` (world baking) and `RapierSimulation` (colliders).

**Blocked by:** ticket 01 (the schema it builds from).

**Status:** planned

## Why

This is the phase's load-bearing ticket: the first time a parameterized
triangle moves a Character. Everything after it (snap points, builder UI,
playtest) is assembly and presentation around physics that already works.
One generator called by builder preview, game collider, and server validation
means the three can never disagree.

## What to change

- [ ] `buildBlockGeometry(params)` in `packages/shared`:
  - `cuboid` → one box (`lengthGrid*GRID_XZ × heightGrid*GRID_Y ×
    widthGrid*GRID_XZ`); stays a cuboid collider, never a trimesh
    (exactness is free, hull-shrinking would only invent error — same
    reasoning as ADR 0050 for statics)
  - `wedge` → analytic trimesh from the cuboid envelope: high edge full
    height, low edge zero, slope face between, `slopeAxis` selecting the
    slope direction; emit slope angle `atan(height/length)` alongside for
    the ticket-04 warnings
  - Deterministic: same params → same vertices on client and server, no
    float formatting, no per-app reimplementation
- [ ] `resolveTrack`: parametric Segments bake through the generator —
  cuboid into `statics`, wedge into `staticTrimeshes` with the resolved
  Surface (the M8 pipeline: same `staticSurfaceByHandle` machinery, a Module
  carrying both statics and asset geometry stays refused, parametric output
  follows the same exclusivity)
- [ ] `RapierSimulation`: wedge trimesh via the existing
  `ColliderDesc.trimesh(..., TriMeshFlags.ORIENTED)` path — outward winding
  pinned by a test, exactly like the M8 asset files
- [ ] Segment orientation composes on top: baked local geometry, then
  `segmentOrientation` (ADR 0055 "bake, then orient") — covered by a tilted-
  wedge test proving tilt never de-quantizes `params`

## Done when

- [ ] Physics tests, no rendering: a Character dropped onto a `3×1×3` cuboid
  lands at its top face; a `<= 35°` wedge carries it up walking (no jump, no
  slide); a `>= 60°` wedge face is a wall (blocked, never grounded)
- [ ] Same test against server-built and client-built worlds gives the same
  answer — one geometry, two sims
- [ ] A `35–60°` wedge is walkable-into-`Sliding` (state machine owns the
  split, §3.6 rules), not a physics surprise
- [ ] Full typecheck + shared suite green

## Watch out for

**Winding.** The trimesh path is correct exactly when winding is consistently
outward (M8 ticket 02's lesson). The generator must emit outward winding by
construction, and a test must pin it — a future edit breaking the assumption
fails there, not as a fall-through.

# 03 — Snap points: face / edge / corner + stacking

**What to build:** Typed snap points on parametric blocks, generalizing ADR
0031 sockets from track flow to block assembly — including the top-face
stacking receiver that makes "skládáme na sebe" work.

**Blocked by:** ticket 02 (needs baked block extents to attach points to).

**Status:** planned

## Why

Free placement with only grid fallback reproduces the exact disease the
research was commissioned to kill: every block a slightly different height,
micro-gaps between neighbors. Snap points are what make assembly feel like
Trackmania instead of a 3D spreadsheet.

## What to change

- [ ] Per-block snap families, derived from `params` (never hand-authored):
  - **face**: center of each cuboid face; top face doubles as the stacking
    receiver (wedge: top face of the envelope + slope-face center)
  - **edge**: midpoint of each of the 12 cuboid edges (wedge: exposed
    non-slope edges) — flush side-by-side alignment
  - **corner**: 8 cuboid corners (wedge: 6 vertices) — corner-to-corner joins
- [ ] Stacking = `top-face → bottom-face` socket-to-socket (ADR 0031
  precedent); stacked heights sum on-grid automatically (`k * 0.25`, purely
  additive — no inherited footprint, no column check; each block keeps its
  own footprint evaluated in world space)
- [ ] Snap priority (first match wins): stacking face > entry/exit flow
  sockets (existing `snapPositionToNeighborSocket` logic) > edge > corner >
  grid fallback; radius stays `SOCKET_SNAP_RADIUS = 1.5`
- [ ] Overlap test treats stacked contact correctly: faces may *touch*,
  volumes may not interpenetrate (contact tolerance, not zero) — a block
  placed exactly on another must pass, not flag
- [ ] Ghost accept/reject with reason follows the proposal pipeline
  (`docs/track-builder-proposal.md:319-331`); stacking receiver gets its own
  reason strings ("stacked on <block>", "intersects <block>")

## Done when

- [ ] Unit tests (pure edit functions, the `trackEdit.ts` seam): in-radius
  face snap, edge flush alignment of two side-by-side cuboids (no gap past
  epsilon), corner join, stacking a block exactly on top (passes overlap),
  intersecting placement (rejected with reason), priority order
  stacking > flow > edge > corner > grid
- [ ] Tilted blocks: stacking snap requires matching (or untilted) frames —
  mismatched tilt warns instead of snapping (ADR 0055 coexistence rule)

## Watch out for

**Snap-point explosion in the UI.** Face + edge + corner on every block is a
lot of candidates in dense assemblies — priority order must be total (no
ties) so the gizmo never flickers between two equally-good targets mid-drag.
Per-type ghost coloring is ticket 08's prototype question, not this ticket's.

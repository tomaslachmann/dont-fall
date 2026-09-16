# 10 — Moving pieces collide as solid parts; pressed from above shoves sideways

**What to build:** ADR 0065 — solid parts fitted into every Asset at build time
and used by Moving Segments, plus the pressed-from-above push rule — so a
swinging `trap_trapball` never holds a Character underneath or carries a ragdoll
inside it.

**Blocked by:** 02, 04.

**Status:** done (2026-09-15) — tests and typecheck; the live check is the user's.

## Decisions (user, 2026-09-15)

- Both fixes; the push rule first.
- Concave moving pieces (holes, pipes, hoops, arches) are decomposed into several
  hulls, not filled.

## What changed

- [x] `pushDirection` in `RapierSimulation`: a grounded Character pressed from
      above is shoved sideways (or along the body's sweep), and the Impact's
      closing speed is measured that way — test with a trimesh sphere pendulum
      that fails without it
- [x] `scripts/convert-solids.ts`: components, small-part grouping, concavity →
      V-HACD, ball/cylinder/capsule/box by hull-volume fill, else hull; stored as
      `role: "solid"` nodes; both converters regenerate every GLB and log the parts
- [x] Shared reader: `SolidShape`/`SolidPart`, `ValidatedAsset.solid`,
      `Module.asset.solid`; `resolveTrack` hands a Moving Segment its (scaled)
      solids instead of trimeshes; `MovingSegment` builds ball/capsule/cylinder/
      cuboid/convexHull colliders
- [x] Tests: fitting (sphere → ball, box, capsule, hoop decomposed with its hole
      open); every committed Asset has solid parts covering its collision mesh;
      the real `trap_trapball` swinging — ragdoll not carried inside, a Character it
      reaches pushed out

## Notes

- Found on the way (pre-existing, not changed): a Character spawned within ~2 cm
  above a very large static box (half-extent ≥ 20) sinks through it; spawns in
  play sit 1.2 above the first piece, so it doesn't show up there.

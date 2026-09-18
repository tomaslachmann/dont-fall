# 0100 — Quarter pieces are centred like every Asset, and come in sizes

## Context

The quarter circle (a quarter disc, radius 1) and the quarter curve (a quarter
annulus, radius 1 to 2) arrived on 2026-09-17 modelled about the centre of the
circle they belong to, and that was kept on purpose: four of them turned
0/90/180/270° about one point make a ring, with no hand alignment. They were
the only Assets exempt from the pivot convention (X/Z centred, resting on
y = 0).

Working with them in the builder showed the cost. The gizmo sat off the mesh
(for the curve, in its own hole), rotating a piece swung it round a point it
does not occupy, and every other piece in the Assets tab behaves differently.
On 2026-09-18 the user asked for them to be centred like the rest, and for a
family of sizes, 1×1, 2×2, 3×3, 4×4 and so on, made by scaling.

## Decision

**The quarter pieces follow the pivot convention with no exemption, and come
in every size from 1×1 to 8×8, one metre tall.**

- The arc-centred files are now masters in `assets/quarter_pieces/`.
  `pnpm convert:quarters` (`scripts/convert-quarters.ts`) writes the family
  into `assets/` and generates `packages/shared/src/track/quarterAssetDefs.ts`,
  the way the KayKit and trap converters do. It repackages and never remodels:
  the mesh bytes are the master's, and only the scene roots' transforms
  change. The exception is a solid hull's points, which have the scale baked
  in because the reader places solid parts rigidly.
- **The scale is X/Z only.** A Segment's own scale is uniform (ADR 0062), so a
  uniformly scaled 4×4 would just be the 1×1 at scale 4, four metres tall. The
  family has the KayKit `platform_NxNx1` shape instead, and the same naming:
  `kaykit_platform_quarter_{circle,curve}_NxNx1_blue`. A curve N×N wraps the
  circle (N/2)×(N/2), as the masters do.
- **The 1×1 circle and the 2×2 curve keep their original, unsized ids**
  (`kaykit_platform_quarter_circle_blue`, `kaykit_platform_quarter_curve_blue`).
  Renaming them would turn every stored Track that places them into one that
  fails to load (an unknown Module throws in `resolveTrack`).
- The generated `QUARTER_ARC_CENTRES` records where each piece's circle is
  centred in its own frame (the footprint corner the arc curls around).
  `disc()` in `authoring.ts` reads it to offset each quarter from the disc's
  centre, and moves a Motion's spin or swing pivot onto that centre, so a
  spinning disc still turns as one. A test checks every recorded centre
  against the real bytes.

## Consequences

- **Stored Tracks that place the two original pieces are shifted** by half a
  piece, turned with it (0.5·scale for the circle, 1·scale for the curve). The
  user's call: no migration. The code-authored Tracks (Spin Cycle, Cog Arena,
  Sky Rings) were re-published as revision 2, and their resolved world
  geometry (static collision, spinning discs at several ticks, Surface decks,
  belts, spawns) was checked to be identical before and after. Builder-made
  Tracks that use the pieces (`base-survival`, the playtest revisions) need
  re-placing by hand.
- The Docker API bakes `assets/` into its image, so a new converter output
  reaches it only after `docker compose up --build api`.
- A scaled piece's rim bevel widens with it but does not deepen: at 8×8 the
  chamfer is 0.4 m across and still 5 cm tall. The texture is a palette atlas,
  so the stretch does not show in its colours.

# 0075 — A Volume rides its asset's def, and an updraft finally shows its air

## Context

The procedural `updraft` Module (M3.7 ticket 04) is the last grey-box
*mechanic* in the library: a plain 2×4 deck whose only meaning is the column
of air above it. Worse than the deck, the column itself never renders
in-game — `volumes` travel into the sim only, so a player walks into visibly
empty space and floats. ADR 0070 settled the parallel case for bounce ("a
deck that throws you back and looks like concrete is a trap, not a
mechanic"); an updraft you cannot see is the same trap from the other side.

The art search came back the way 0070's did: all 456 committed assets
grepped, no fan/vent/blower among them; KayKit has no fan even in its paid
EXTRA tier; the Unity-store ventilators are off-style. The Spring category
(ADR 0069) already showed where mechanics live now — on the def, beside the
mesh — and the rest rides Surfaces. But an updraft is neither a one-shot
launch nor contact: it is a region of space pushing every tick, which is
exactly what a Volume already is (ADR 0036).

Settled with the user (2026-09-16): a new fan GLB comes from the art stream,
modelled to the spec below — and the seam plus the visible air land now, so
the GLB only has to drop in.

## Decision

**A Volume is the third mechanic that rides an asset def, and every Volume
draws its own flow.**

- **`AssetModuleDef.volumes?: VolumeConfig[]`** — authored in the def's own
  local space exactly like a procedural Module's, carried onto the Module by
  `attachAssetGeometry` and `ASSET_PLACEMENT_MODULES`, resolved into world
  space by the same `resolveTrack` path every Volume already takes. Absent
  when the asset carries none, like `launch`, never an empty array. No
  replicated state changes: the Volume was always resolved track data, and
  still is.
- **Not a Surface.** A Surface is contact (grip, restitution, pads); a
  Volume is a region of space above and around the piece. Expressing a fan
  as a Surface would be the hack this seam exists to avoid saying.
- **The `fan` category, the fan⟺volumes invariant test, the def entry,
  and the procedural `updraft`'s retirement land WITH the GLB, not
  now.** A category today would render an empty palette tab that promises
  an asset nobody can place. Retirement follows the pads (ADR 0064), not
  deletion: a geometry-only stub stays so old Tracks load, the id joins
  `DEPRECATED_MODULE_IDS`, and the resolve warning points at the fan. The
  builder fixtures placing `"updraft"` migrate onto the fan id.
- **The flow draws itself** (`AirColumn.ts` + `airColumns.ts`, ADR 0070's
  rule: shared pure maths, no shader to keep in step). A translucent region
  marker in the Checkpoint/Finish-Zone "walk into this" family, plus rings
  streaming along the Volume's own `force` — an updraft rises, a sideways
  wind would read sideways, with no extra data. A zero-force Volume draws
  nothing (walking into one does nothing, so nothing should promise flow),
  and `prefers-reduced-motion` parks the rings with the meaning intact.
- **No new ubiquitous term.** The mechanic stays Volume/updraft; the piece
  is an Asset carrying one.

## The asset that landed

One file — `fan.glb`. The plan above assumed authored flat-shaded art in
the Spring pads' four colours; the actual drop is a Meshy-AI generation —
textured (baseColor + metallicRoughness + normal, 4.4 MB), 451k tris, no
roles, centred on the origin — so colour variants would need separate
generations, and the file needed converting before it could land at all:

- **Simplify** (meshoptimizer, error 0.01 — the thin blades and guard bind
  the count, not the target): 451k → ~18k tris, with fresh area-weighted
  smooth normals, since the sculpt's own died with its vertices.
- **Collision is a proxy**, not the sculpt: a closed 12-gon cylinder
  (radius = the visual's max radial extent, 1.299; height = its seated
  1.179) with outward winding verified by signed volume. Open AI blades
  would fail the suite's closed-and-outward rule and snag capsules.
- **Seated on the pivot** (X/Z centred, resting on y = 0), baked into the
  vertices so no reader has a transform to disagree on; nodes carry
  `extras.role` visual/collision. 18 MB → 5.2 MB.
- The conversion script is deliberately uncommitted: it imports the
  simplifier through a deep `.pnpm` store path (a transitive dependency,
  not ours to pin), which would be a landmine in `scripts/`. A second
  Meshy drop re-derives the recipe from this section.

The def (`fanAssetDefs.ts`, hand-authored — no converter emits the bare
`fan` stem), sockets empty, volumes carrying the procedural deck's proven
field, re-seated with its foot on the head's top and standing wider than
the proxy — brushing the fan catches air, like the old field stood wider
than its boards:

```ts
{
  id: "fan",
  category: "fan",
  footprint: {
    bounds: { center: { x: 0, y: 0.589, z: 0 }, halfExtents: { x: 1.299, y: 0.589, z: 1.299 } },
    clearance: 0.5,
  },
  sockets: [],
  volumes: [
    {
      bounds: { center: { x: 0, y: 4.179, z: 0 }, halfExtents: { x: 1.5, y: 3, z: 1.5 } },
      force: { x: 0, y: 40, z: 0 },
      maxInducedSpeed: 10,
      priority: 1,
    },
  ],
}
```

Style caveat, recorded honestly: an AI texture does not read as KayKit
flat-shaded plastic. If the fan clashes in the viewport, the fix is a new
drop (a low-poly Meshy re-export, or authored flat-shaded art in the
kit's language) through this same recipe — the seam, the category and
the field stay put.

## Amended 2026-09-16 — the air is cartoon swooshes and puffs

The box and rings looked terrible in play and did not fit the game (the
user's words). A throwaway prototype (`apps/client/prototypes/fan-airflow/`,
ticket `.scratch/fan/issues/00`) put today's look beside cartoon and
realistic candidates. The user picked **cartoon swooshes + puffs**, at the
prototype's default numbers.

- **Swooshes:** thin tapered ribbons spiralling along the force. They widen
  from a mouth (0.36 of the Volume's half-width, measured off the fan's
  rotor) to the Volume's own half-width, and curl out at the far end.
- **Puffs:** small cloud puffs popping out of the entry face. Each grows,
  spirals out and shrinks away, drawn in the active Environment's own cloud
  style (`createPuffLook` in `packages/render`, the sky's shape recipe,
  material and lit-to-shade tint).
- **The translucent box marker is retired.** The swooshes spread to the
  Volume's width, so the air marks its own region.
- **The shared-maths rule holds.** The prototype drew the swooshes in a vertex
  shader. The game builds them as CPU ribbons from `AirColumn.ts`'s pure
  functions instead, so there is still no shader to keep in step. The cost is
  about 500 vertices a frame per column. The only shader-side logic is the
  material's alpha map, a fixed edge profile across each ribbon.
- `AirColumnFrame.radius` (an inset ring radius) became `halfWidth`. The
  `AIR_RING_*` maths is gone.
- Unchanged: the flow follows the force, a zero-force Volume draws nothing,
  and `prefers-reduced-motion` parks the clock.

The fan asset itself moves to `fan_lower_poly.glb`, with a spinning rotor
cut out at radius 0.64 (tickets `.scratch/fan/issues/01`–`02`). This
section's "The asset that landed" is amended when that lands.

## Amended 2026-09-16 — the fan is replaced, and its rotor turns

The user found the fan above ugly. The same Meshy model arrived as a
lower-poly export (`assets/Meshy_fan/fan_lower_poly.glb`, 67.7k tris, three
2048² JPEGs, plus Blender's leftover `Cube`), and replaces it. It may itself
be replaced later, so the converter is committed this time:
`scripts/convert-fan.ts` (`pnpm convert:fan`). `meshoptimizer@0.18.1` is now a
root dev dependency rather than a deep `.pnpm` path. The recipe changes:

- **The rotor is its own node.** A triangle whose centroid lies within 0.64
  of the Y axis and above y 0.30, in the export's frame, is rotor. The user
  picked 0.64 from side-by-side renders. The rotor is baked about its own
  axis, and its node carries `extras: { role: "visual", spin: 14 }`.
  `spin` is rad/s about the node's own +Y, and 14 is the user's pick from
  the prototype. `packages/render`'s `findSpinningParts` / `spinParts` turn it
  on the wall clock, in the game and in the builder's preview. The shared
  reader ignores the extra, so it never reaches collision.
  `prefers-reduced-motion` parks it.
- **The budget is measured.** The housing is simplified to 30k tris and the
  rotor to 2k, with borders unlocked: a Meshy mesh is full of open edges, and
  locking them held the housing at 41k. Rendered side by side, 18k (the old
  fan's budget) went lumpy and lost its corner studs, while 30k reads like
  the 63.5k source. Textures are re-encoded at 1024², JPEG q85. The file is
  1.96 MB, down from 6.8 MB.
- **Collision is a box**, 1.899 × 1.180 × 1.899, closed and outward. It
  replaces the 12-gon cylinder, because this housing is square. The ADR 0065
  solid part is that box.
- **The def is resized** (`fanAssetDefs.ts`, still hand-authored from the
  converter's printout). Footprint half-extents are 0.9494 × 0.5899 ×
  0.9497. The Volume keeps its proven field (half-width 1.5, 6 tall, force
  40, cap 10), its foot re-seated on the new top at 1.1798.

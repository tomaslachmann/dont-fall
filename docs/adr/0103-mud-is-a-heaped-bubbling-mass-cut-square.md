# 0103 — Mud is a heaped, bubbling mass, cut square

## Context

Mud (ADR 0067) had been drawn as a textured sheet. Its replacement in
`@dont-fall/render` (`mud/mudLook.ts`, `mudShape.ts`, `mudMesh.ts`) made it a
mass standing on the deck that a Character's feet sink into. Physics is
unchanged: the Character still stands on the deck's own collider. The code
already cited this ADR number, but the ADR had not been written.

The first version had a rounded roll-off at every free edge, a heaped lip, and
glossy puddles sunk into the body. It covered the piece out over its bevel.
The user's verdict on 2026-09-18:

> ted prosim o vytuneni mud aby vypadal fakt hezky a sedel do hry, ted je to
> takove meh, má to být vizualne hezké fall style guys, asi hrudkovité, bublat
> místo těch kaluží asi, je to takový easy win a bez "zaoblených" okrajů, má
> to kopírovat surface assetu pod nim, ale bez toho zkosení.

The user followed up in the same session:

> ze ten overlay ma byt i pres ten zohnuty okraj bloku, at muzeme navazovat
> mud vedle sebe vizuelne.

## Decision

**Mud is a toy's mud: a thick chocolate mass heaped into clods, cut square
where it stops, and bubbling.** It is render-only, built once in
`@dont-fall/render`, and drawn the same way by the game and the Track builder.

- **Coverage.** The mass covers the piece's top face grown out over its
  bevel to the footprint (`mudCoverage`). This lets two pieces laid edge to
  edge carry one mass across the seam. The seam rule is unchanged: an edge
  counts as a seam when another mud deck lies just past it, at the same height
  and moving with it.
- **Cut square.** There is no roll-off and no lip. The body stands at full
  height right to a free edge, and a vertical side runs from there down to
  where the bevel meets the piece's own side. Every piece this game places has
  a 45° chamfer (measured: 0.05 wide and 0.05 deep in asset units; the quarter
  curve's is 0.033), so the side goes as deep as the bevel is wide
  (`mudBevel`). It hides the bevel and never runs down the piece's side, which
  it would z-fight. The side's top vertices are the body's own boundary
  vertices, so a dent at the edge takes the side down with it.
- **Clods.** The height is a base depth (`MUD_DEPTH` 0.16) plus a slow swell
  plus clods. Each clod is a soft dome on a jittered world grid, and neighbours
  are merged by a smooth maximum, so they run into each other like dollops.
  Everything is sampled in world space, so a seam meets at one height. Colour
  is painted per vertex: broad blotches, a caramel crest on each clod, and a
  deeper shade in the creases.
- **Bubbles instead of puddles.** A share of the cells of a grid across the
  deck holds a bubble spot, never within `MUD_BUBBLE_INSET` of a cut side. Each
  spot swells a glossy bubble out of the mud, pops it, and leaves a ring that
  spreads and sinks back in, on its own period and phase. The pose is a pure
  function of time (`mudBubblePose`), drawn with two `InstancedMesh`es per
  deck. The game drives it on sim time through `MudSheet.update`. The builder
  drives it on its wall clock through `simmerMud`, which walks the scene the
  way `spinParts` does. Under `prefers-reduced-motion` the bubbles hold still.
- **Wading** is unchanged: feet press dents that fill back in.

All numbers are named in `mud/mudLook.ts`.

## Consequences

- **No shader here has ever been rasterised** (CLAUDE.md, M12), so every
  number in `mudLook.ts` is a first guess at the look, balanced by reasoning
  rather than by eye. **Waiting on the user:** the clods' size and height, the
  palette, the gloss, how busy the bubbling is (`MUD_BUBBLE_CHANCE`,
  `MUD_BUBBLE_PERIOD_*`), and whether the cut side reads right over a real
  KayKit bevel.
- Each mud deck adds two draw calls, one for bubbles and one for rings. Their
  instance counts are small (roughly one spot per 4 m² of deck). They are not
  frustum-culled and cast no shadow.
- The top grid is finer: 0.15 m spacing instead of 0.2, capped at 80 cells
  across, so clods about 0.6 m wide keep their shape.

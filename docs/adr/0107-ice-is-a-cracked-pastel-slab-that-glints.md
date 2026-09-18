# 0107 — Ice is a cracked pastel slab that glints

## Context

Ice had been drawn as ADR 0066's sheet: the deck's own art under a
translucent tiled photo texture, fetched from the API. After the mud's redo
(ADR 0103) the user asked for the same treatment on 2026-09-18:

> předělali jsme mud vizuál, ať nám víc sedí do hry, to stejné bych chtěl
> udělat s ice vizuálem.

The look itself was settled in a question round the same day. Every choice
below marked "the user's" is an answer from it — all four took the
recommended option.

## Decision

**Ice is a toy's ice: a thick opaque pastel slab with a visible edge, cut
square over the bevel, cracked and bubbled inside, frostier at its edges,
sparkling now and then.** It is render-only, built once in
`@dont-fall/render` (`ice/iceLook.ts`, `iceShape.ts`, `iceMesh.ts`), and
drawn the same way by the game and the Track builder. Physics is unchanged:
the Character stands on the deck's own collider, and the slab (0.1 tall) is
drawn over it, exactly the mud's trick.

- **A thick slab, on the mud's machinery** (the user's). The slab stands on
  the mud's own slab rules (ADR 0103, imported from `mudShape`): it covers
  the piece out over its bevel to the footprint, it is cut square at a free
  edge with a vertical side running down to where the bevel meets the piece,
  and an edge into a neighbouring ice deck — same height, moving with this
  one — is a seam the slab carries across, with the same hairline skirt.
  Neighbouring ice reads as one frozen surface.
- **Cracks and frozen bubbles** (the user's, both). They live in one shared
  `DataTexture`, generated from pure functions — no file, no fetch, no DOM —
  because a crack vein is far thinner than any sane vertex grid. The cracks
  are the borders of a jittered cell pattern (where the two nearest cell
  points stand equally close — how sheet ice shatters into plates), a bright
  core in a soft halo; the bubbles are pale specks, each its own size and
  depth, the deeper the fainter. The fields are periodic on the texture's
  tile so it wraps, and the slab's UVs anchor it to **world** space, so a
  vein runs on across a seam. The texture is drawn as the one translucent
  layer, a hair above the opaque body — nothing to mis-sort against.
- **Sparkle glints** (the user's, over a travelling sheen). Star spots on a
  jittered grid across the deck, seeded by where the deck is, each popping a
  flat two-armed star for ~0.6 s on its own period and phase — two
  `InstancedMesh` draws worth of the mud's bubble discipline. The pose is a
  pure function of the time (`iceGlintPose`): the game drives it on sim time
  (`IceSheet.update`), the builder on its wall clock (`glintIce`, walking the
  scene the way `simmerMud` does). Under `prefers-reduced-motion` they hold
  still.
- **Opaque pastel** (the user's). Three pale blues blotched per vertex in
  world space, frosted to near-white over `ICE_RIM_WIDTH` at every free
  edge, glossy (`roughness 0.18`) so the Environment's own map is what makes
  it read as ice under every preset. The cut side is frost at the lip, a
  deeper blue at the foot. The deck below is hidden, like the mud's.

All numbers are named in `ice/iceLook.ts`.

## Considered options

- **A thin glaze / a better sheet.** Rejected by the user: the slab, like
  the mud, is the look that fits the game.
- **Slab plus surface frost lumps.** Offered, not taken — the top stays
  flat; the interest is colour, cracks and gloss.
- **Cracks per vertex.** Rejected on arithmetic: resolving a 0.03-wide vein
  per vertex needs a grid an order denser than the mud's, on decks Slip
  Stream makes 18 m wide.
- **A travelling specular sweep.** Rejected in favour of the glints — busier
  on the big ice fields.

## Consequences

- **Superseded:** ADR 0066's *drawing* — the photo texture, its
  `ICE_TEXTURE_FILE`/`ICE_TILE_WORLD`/`ICE_OVERLAY_OPACITY`/
  `ICE_OVERLAY_LIFT` constants and the whole texture fetch pipeline (client
  session cache, builder lazy load, thumbnails) are gone; the served
  `assets/ice_surface.jpg` no longer has a reader. ADR 0066's *rule* stands:
  which decks are icy (`moduleHasIceSurface`), and that ice with no look is
  a trap, not a mechanic. ADR 0096's cut-to-the-deck survives inside the
  slab's own coverage geometry.
- `packages/render/src/mud/mudShape.ts` is now explicitly shared slab
  machinery (coverage, seams, noise, placement), imported by the ice — a
  candidate to become `slab.ts` if a third mass ever appears.
- **Waiting on the user:** every visual — the palette, the crack scale, the
  glint rhythm — none of it has ever been rasterised in this repo.

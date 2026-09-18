# 0096 — A Surface sheet is cut to its deck

## Context

From the user, after playing the four authored Tracks on 2026-09-18:

> surface nekopírují tvar tzn je čtverec na kruhu

Ice, mud and bounce all drew their sheet from `DeckFrame.halfX/halfZ` — the
Module footprint's bounding rectangle. On a platform that is exactly the deck.
On the quarter circle and quarter curve the arenas' floors are built from, it
is the square the quarter disc is inscribed in: a round deck wore a square of
ice with four corners hanging over nothing.

Six places built that rectangle, three in the game scene (`iceOverlays.ts`,
`mudOverlays.ts`, `bounceSheets.ts`) and three in the Track builder's
`render.ts`, each from its own `PlaneGeometry`/`BoxGeometry`.

## Decision

**A deck's sheet is cut to its Asset's own top face.** `deckPlanOf(module,
scale)` reads the Asset's collision meshes, keeps the triangles that lie on the
highest face and point up, and projects them flat into the deck's own frame —
a `DeckPlan` of vertices and indices, relative to the `DeckFrame`'s centre and
already scaled. `resolveTrack` puts it on the `DeckFrame` beside `halfX`/`halfZ`,
so everything that seated the rectangle seats the plan with no other change.

**No plan means the rectangle, and three cases deliberately have none:**

- a procedural Module, which has no Asset collision to read;
- a top face that already covers 99% of its footprint, where there is nothing
  to cut;
- a top face under 10% of it — which is what a **ramp** produces, because a
  ramp's highest point is one edge and "the triangles at the top" there is a
  sliver rather than the surface anyone walks on. Falling back keeps a ramp
  drawn exactly as it was.

**Two shared geometry builders**, in `@dont-fall/render` so the game and the
builder cut the same shape: `deckSheetGeometry` for a flat sheet (ice, and the
bounce sheet's rest lattice) and `deckBlockGeometry` for mud's filled mass —
its top from the plan and its sides skirted from the plan's boundary edges,
in two material groups instead of a box's six faces. UVs mirror
`PlaneGeometry`'s over the footprint rectangle, so every existing texture
`repeat` keeps the texel density it had.

**A plan is subdivided for a sheet whose shape lives in its vertices.** The
bounce sheet domes and dents per vertex, and a collision mesh's top face can be
two triangles where the lattice it replaces had hundreds; `smoothDeckPlan`
splits until there are at least 400.

## Consequences

- Every round deck in Cog Arena and Sky Rings now wears a round sheet, and the
  holed platform's sheet has the hole in it.
- Ordinary platforms change too, slightly: a KayKit deck's top face is 0.9 of
  its footprint across (the authored bevel), so its sheet insets by 0.05 per
  unit of scale instead of overhanging the bevel. More correct, and at a lane's
  scale it is 10 cm.
- The side skirt is emitted in both windings. An outline can wrap a hole as
  readily as the outside, so which way is "out" is not a property of the edge,
  and a few extra triangles cost less than getting it wrong in a renderer that
  cannot be run in a test.
- `DeckPlan.test.ts` pins what the arithmetic has to produce — a quarter disc's
  area rather than its square's, a hole that survives, a ramp that falls back.
  The winding sign was wrong on the first attempt and produced no plan at all
  for any Asset, which is exactly the class of mistake that test catches.
- **How any of it looks is the user's check.** No shader or geometry here has
  ever been rasterised in this repo (no WebGL), so what is proven is the
  numbers, not the picture.

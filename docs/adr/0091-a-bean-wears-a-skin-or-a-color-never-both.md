# 0091 — A bean wears a skin or a color, never both

## Context

`BLIP_Skins_v1_Pack` arrived on 2026-09-17: twelve authored body skins in
two collections — six patterned colours (StarterCream, MintSpots,
SunsetStripes, Galaxy, HazardNeon, Prismatic) and six animals (Zebra, Tiger,
Cow, Leopard, Giraffe, Frog) — each a 2048² sRGB base-colour PNG plus a
512² inventory icon, with the pack's own suggested unlock level.

With them came a re-export of the rig, `BLIP_Character_Skins_v1.glb`. It is
the cosmetics-pack rig (ADR 0083) with the same 24 nodes, the same 20-joint
`BLIP_Rig`, the same `Hat_Tuck` morph and the same 51 clips — verified
against the GLB's own JSON chunk before the swap — plus exactly two
additions: a `TEXCOORD_0` channel on the body, and a body material carrying
a base-colour map (StarterCream, embedded) instead of the flat
`Vanilla cream · F3DFC3` factor. **The older rig cannot wear any of this**:
it has no UVs, so there is nothing to map the art onto. The swap is
therefore not optional, and it is also free — nothing else about the rig
moved.

The game already had a body cosmetic: `bodySkin`, a small int indexing seven
hues plus a "factory look" id, tinting the rig's materials (M9 ticket 15).
It was always a placeholder for real art, and its own comments said so. The
real art is now here, and it wants the word "skin".

Settled with the user the same day:

- **`bodySkin` is renamed `color`** — column, API field, roster field,
  results map, Character Select tab. It keeps its meaning (a flat tint) and
  loses only a name it was borrowing.
- **A bean has a `skin` *or* a `color`, never a blend.** A skin paints the
  whole body; the colour under it is simply not drawn.
- **Skins unlock by level**, at the pack's levels (1, 3, 4, 6, 8, 10, 12,
  14, 16, 18, 20, 24) — exactly the shape hats already use.
- **The pack's source files are not kept.** Only the GLB, the twelve
  textures and the twelve icons go into `public/`; the 16 MB `.blend`, the
  collection sheets, the README and the pack's own JS/JSON helpers are
  dropped.

## Decision

**A skin is a hat for the body.** It travels the identical path: a nullable
text column on the Account, validated and level-gated on
`PUT /auth/me/cosmetics`, read back on `/auth/me`, bound to the seat by the
match server on `auth`, carried on the Lobby roster every snapshot, captured
into the saved Match result for the podium, and picked on a Character Select
tab beside the hats. Nothing about the protocol or the storage is new — only
the field is.

**A colour and a skin are one look, not two layers.** Both write the same
body material, so they get one writer: `render/skins.ts`'s `SkinCloset`,
whose only verb is `wear(rig, skin, hue)`. Two independent writers would
race — a colour arriving from one roster refresh after a skin's texture
resolved from another would silently wipe the skin. The closet is the hat
`Wardrobe`'s twin, with its guarantees: loaded once and worn by many, the
latest choice wins, anything that isn't a skin is no skin, and a rig cloned
from a dressed rig writes its own look before someone else's can show.

**The base colour is written, not restored.** `BASE_BODY_COLOR_ID` used to
mean "put back whatever the artist authored", which the old rig made easy —
its body was a flat colour factor. On the new rig the authored body is a
*texture*, and remembering it per material is a trap: `Material.clone()`
round-trips `userData` through `JSON.parse(JSON.stringify(...))`, so a
`THREE.Texture` stashed there does not survive the clone every restyle
performs. Instead the base is the literal cream `#F3DFC3` — sampled from
`starter-cream.png`, which is a flat fill of exactly that colour across every
UV island. A colour therefore always means *clear the map, set the colour*,
and nothing has to remember anything.

## Consequences

- Twelve skins at 2048² cost ~21 MiB of GPU memory each, uncompressed. The
  closet's "only what is worn, fetched once, shared by everyone wearing it"
  is a memory rule here, not just a latency one — with twelve Players in
  twelve different skins the worst case is real, and relevant to M13.
- `starter-cream` is visually the same bean as the base colour. That is the
  art pack's own design (its "vanilla base"), not an accident, and both stay:
  one is where every Account starts, the other is a skin you equip.
- Existing Accounts keep their bean: `body_skin` is renamed in place with
  `ALTER TABLE ... RENAME COLUMN`, and `skin` arrives NULL, which means "wear
  your colour" — the look nobody had to change.
- The old texture-less `BLIP.glb` is gone, replaced at the same path. Every
  bone measurement, knockdown pose and hat mount is unaffected, and
  `modelBones.test.ts` still pins them against the real file.

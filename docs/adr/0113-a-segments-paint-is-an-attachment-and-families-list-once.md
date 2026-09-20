# 0113 — A Segment's paint is an Attachment, and families list once

## Context

The user, on 2026-09-20, about the track builder's palette: every colored
KayKit shape lists 4 times (`_red`/`_blue`/`_green`/`_yellow`, 280 files for
70 shapes). Show each shape once and repaint it instead — a color picker in
the style of Character Select's COLOR tab (striped swatches), a defined set
of colors, repainting only the parts that are painted.

The first design tried hue rotation of the texture's saturated texels. It
died on measured data before it ever worked: the 4 files of a family embed
byte-identical textures (same SHA) and differ only in UVs — KayKit repaints
by remapping into a shared atlas, so there is no red texture to rotate. Worse,
the remap is arbitrary per shape: the ball's red highlights sample near-white
(235,238,240) where its blue ones sample full blue (40,159,216) — a lightness
change no hue rotation can reach. And the dominant hue over the whole atlas
(26°) is not the mesh's own red (358°), so every shift landed ~26° off while
dusty bevels stayed original. The user pointed at the character instead —
which never touches a pixel (ADR 0091) — and the render follows it now.

## Decision

**Paint is a `color` Attachment on the Segment (`SegmentColor.ts`): one of 8
hue ids, defaulting to the placement's own.** The palette groups each complete
4-file set under its canonical `_red` file (`assetColorFamilyOf`); a lone
`_blue` (the quarter pack) or a bare id is its own look and lists as-is. The
builder places the canonical with its color stored, and the inspector's COLOR
section repaints through striped swatches derived from the aimed hues.

- **Paint works the way the character's does, and never touches a pixel.**
  An authored hue (red/blue/green/yellow) on a family member wears that hue's
  own file outright (`authoredPaintFileId`, the character's `paintModel`):
  `X_red` + blue draws `X_blue.glb`'s bytes, KayKit's UV mapping included.
  Anything else — a new hue (orange/cyan/purple/pink), or paint on a lone
  look — tints the placed file flat (the character's `tintModel`: one
  material color at the character's own saturation/lightness, map cleared),
  built once per (file, paint) and session-cached.
- **A paint file still loading falls back to the flat tint** (the character's
  `SkinCloset`: a color now, the authored art when it arrives) — picking a
  color never blanks its Segment. The game loads paint files up front
  (`visualAssetIdsOf`, visuals only — collision keeps `assetIdsOf`); the
  builder tops them up on every full rebuild, beside the legacy top-up.
- **Legacy ids and files stay, resolving exactly.** `X_blue` with no paint
  still loads `X_blue.glb`'s own bytes — the 5 code-owned Tracks and every
  published Revision render pixel-identical, and nothing is migrated or
  deleted. The 8 hues include all 4 authored ones, and `red` on the canonical
  is the file itself.
- **Paint is visual-only, so it rides on a Prop.** The one exemption to the
  prop-clash rule (ADR 0099): it changes no physics. `resolveTrack` never
  reads it (an Asset Prop's shape carries it for the renderer, beside the
  `moduleId`/`scale` that already do); Moving visuals look it up by segment
  index from a caller-built array instead.

## Considered options

- **Hue rotation of saturated texels.** Built first, then measured dead (see
  Context): same-texture-different-UVs, the ball's lightness change, the 26°
  source error, dusty parts staying original. Deleted, not kept beside.
- **Re-authored neutral textures + tint.** Exact for every hue, and a
  content-authoring project (280 textures) for looks the file swap already
  gives the authored four.
- **Family stems as module ids (`X` + color instead of `X_red` + color).**
  Cleaner names in track JSON, but every registry/physics/loader lookup would
  need family awareness; canonical file ids keep all of those untouched, and
  the inspector shows the stem where it matters (the tile caption).

## Consequences

- Authored hues on new placements byte-match the legacy files (the same
  bytes, not an approximation). New hues tint the whole piece flat —
  including grey undersides — the way a bean's tint paints the whole bean.
- The 4 new-hue targets are first guesses: no rasterised check exists in this
  repo, so whether the flat orange/cyan/purple/pink sit right next to
  KayKit's baked shading is the user's live check.
- The builder fetches a paint file per authored hue worn (top-up beside the
  deduped tab stream), the game per Track load; a flat tint fetches nothing.
  Runtime memory is one template per worn file plus one tinted clone per worn
  new hue; disk keeps all 280 files by decision.

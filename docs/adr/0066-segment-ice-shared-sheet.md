# 0066 — Ice attaches to a Segment, and icy decks wear a shared sheet

## Context

M3.6 shipped ice as pure physics on a placeable Module ("the Surface is the
deliverable, not the look"): an ice Module is a bridge platform nothing tips
a player off by sight, and ADR 0064's belt work re-affirmed it ("mud/ice stay
invisible by design"). Two things about that never sat right, and they
surfaced together:

1. Ice you can't see is a trap, not a mechanic: ice removes turn authority,
   and a player who can't see it coming can't play around it. (Mud keeps its
   invisibility — surprise slowdown is a prank, surprise loss of steering is
   a death sentence.)
2. A Module is the wrong unit for ice. ADR 0064 already moved directional
   floor behaviour from placeable pads to Segment attachments ("this asset
   carries whoever stands on it") — ice is the same idea for grip: "this
   whole deck skates", on any Module, not a slippery-flavoured bridge you
   place next to the interesting geometry.

Meanwhile the asset pipe serves GLBs only, and no renderer has ever loaded
an image: every deck treatment so far is procedural geometry (chevron
strips) or flat colours. An ice look wants a real frozen surface, not
another flat tint.

## Decision

**Ice attaches to a Segment like a belt does, the `ice` Module is retired,
and every icy deck wears one shared translucent sheet.**

- `Segment.ice?: boolean` — exactly `true` when present (detaching removes
  the key, mirroring the belt). `resolveTrack` forces the Segment's every
  collider to the ice Surface (boxes, trimeshes, Moving parts and solids —
  the attachment says "this whole deck skates", so per-box overrides don't
  survive it, exactly like a belt's whole-deck carry).
- Icy decks are visible: `resolveTrack` returns per-icy-Segment `iceDecks:
  { segmentIndex, deck }` entries, where `deck` is the same footprint frame
  (`DeckFrame`, extracted from `ConveyorBelt`) a belt strip runs on — one
  `deckFrame` helper serves both. A deck counts as icy by attachment or by
  module authorship (`moduleHasIceSurface`), so retired-Module Tracks keep
  their sheets too.
- Both renderers lay the same sheet: the shared texture repeated every
  `ICE_TILE_WORLD` units across the footprint at the deck top, translucent
  (`ICE_OVERLAY_OPACITY`) so the deck's own art shows through, lifted below
  the chevrons' own lift so a belt on ice still marches visibly above it.
  Sheets ride Moving Segments by re-parenting, exactly like chevron strips.
- The texture is ambientCG Ice 003's Color map (CC0, seamless), converted to
  quality-85 JPEG as `assets/ice_surface.jpg` with a provenance sidecar —
  the repo's first image map, fetched once per session through the same
  bytes pipe as the GLB art.
- The API's `/assets` route serves `.png`/`.jpg` alongside `.glb` (strict
  charset unchanged, content type per suffix), and publish validation
  accepts `ice: true` / 400s anything else with the Segment index.
- Legacy: `ice` joins `DEPRECATED_MODULE_IDS` (geometry-only retirement
  like the pads — hidden from the palette, warning per Segment), except it
  keeps its Surface: an old Track must skate exactly where it always did.
  The warning names the fix (attach ice to the Segment).
- A missing texture degrades, never bricks: the game boots unsheeted with a
  dev warning, the builder re-syncs unsheeted and retries on the next full
  sync. A cosmetic must not fail a Match or crash the builder.

## Consequences

- ADR 0064's "mud/ice stay invisible by design" now reads "mud stays
  invisible by design"; mud and bounce stay module-authored until one of
  them needs the attachment treatment too.
- New shared surface: `Segment.ice`, `invalidIceReason`/`isSegmentIce`,
  `IceDeck`, `DeckFrame`, `moduleHasIceSurface`, the `ICE_*` tuning consts,
  and `resolveTrack(...).iceDecks` (renderers only — physics keeps reading
  the Surface off ground colliders, so no protocol change).
- The game stage takes `iceDecks` + `iceTexture`; the builder gains an
  Inspector ice panel (attach/detach on the primary Segment) and the
  viewport sheets attached ice from the Segment, module ice from the Module.

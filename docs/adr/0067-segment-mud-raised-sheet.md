# 0067 — Mud attaches to a Segment, and muddy decks wear a raised sheet

## Context

ADR 0066 moved ice from a placeable Module to a Segment attachment with a
shared translucent sheet — and left mud module-authored "until one of them
needs the attachment treatment too". Mud needs it now, for the same two
reasons ice did: a Module is the wrong unit for a whole-deck Surface, and
mud you can't see is a trap, not a mechanic.

Mud differs from ice in one physical respect the look must carry: ice is a
film over the deck, mud is a layer you stand in. Feet should sink slightly
into it while the physics keeps colliding with the deck itself.

## Decision

**Mud mirrors ice end to end (attach, retire, sheet), except the sheet is
raised ankle-deep and opaque.**

- `Segment.mud?: boolean` — exactly `true` when present (detaching removes
  the key). `resolveTrack` forces the Segment's every collider to mud
  through one `attachedSurface` (ice and mud share the collapse); publish
  refuses an ice+mud pair outright (one deck, one Surface), while
  `resolveTrack` still defines mud-wins precedence for Tracks that arrive
  unvalidated — mud's opaque raised sheet is the visible top layer, so
  physics matches what the eye sees.
- `resolveTrack` returns per-muddy-Segment `mudDecks: { segmentIndex, deck }`
  entries on the same shared `deckFrame`; a deck counts as muddy by
  attachment or by module authorship (`moduleHasMudSurface`), so
  retired-Module Tracks keep their sheets too.
- Both renderers lay the same sheet: the shared texture repeated every
  `MUD_TILE_WORLD` units across the footprint, `MUD_OVERLAY_LIFT` (0.08)
  above the deck top, opaque and matte. Feet at deck level sink below it;
  the deck's own art stays buried. Above the chevrons' own lift by design —
  a belt running under mud reads as covered, which is what it is.
- The texture is ambientCG Ground 094 C's Color map (CC0, seamless) as
  `assets/mud_surface.jpg` with a provenance sidecar, served by the
  already-widened `/assets` route and validated like ice at publish.
- Legacy: `mud` joins `DEPRECATED_MODULE_IDS` (geometry-only retirement —
  hidden from the palette, warning per Segment naming the fix), keeping its
  Surface so old Tracks drag exactly where they always did.
- The missing-texture contract is ice's: degrade, never brick (unsheeted
  boot with a dev warning in the game; re-sync unsheeted and retry on the
  next full sync in the builder).

## Consequences

- New shared surface: `Segment.mud`, `invalidMudReason`/`isSegmentMud`,
  `MudDeck`, `moduleHasMudSurface`, the `MUD_*` tuning consts, and
  `resolveTrack(...).mudDecks` (renderers only — no protocol change).
- The game stage takes `mudDecks` + `mudTexture`; the builder gains an
  Inspector mud panel and the viewport takes both sheet textures per
  `setTrack`.
- Bounce is now the last module-authored Surface — the same treatment
  awaits it if it ever needs a look or a per-Segment authoring.

## Amendment — the sheet becomes a filled, living block

A floating plane 0.08 above the deck reads as a floating plane: from any
low side angle the gap underneath is visibly air. And a mud texture that
never moves reads as a photograph of mud, not mud — worse, a Character
crossing it leaves no trace, so the walk itself is invisible.

- **Filled**: the lift is now a block — textured top, untextured cut-earth
  sides (`MUD_SIDE_COLOR`, the texture's own sampled average darkened)
  running the whole 0.08 down to the deck top. The gap is mud. The sides
  run coplanar with the deck's own edges, so both renderers keep the
  polygon offset to win depth there.
- **Breathing**: the surface idles on `mudSloshOffset` — a slow
  oscillation, deliberately not a march (a marching texture reads as flow,
  a second conveyor; mud is sticky, so it breathes in place), staggered
  per Segment so neighbouring decks never sync. Both renderers pose the
  same breath off their own clocks (sim time in the game, the
  motion-preview clock in the builder).
- **Rippling**: the game stage stashes every Character's capsule centre
  from both applies and each sheet answers feet over it with expanding,
  fading rings — tested in the sheet's own local frame, so moving
  carriers work with no extra math, and feet jumping OVER the mud ripple
  nothing. A pooled 8 rings per sheet, oldest stolen under a crowd.
  `prefers-reduced-motion` parks the slosh at zero and spawns nothing.
- The builder previews the breath only — it shows no Characters, so no
  rings spawn there; only the game answers feet.
- Shared surface grows by the slosh/ripple consts plus the two pure fns
  (`mudSloshOffset`, `mudRipplePose`), still renderers-only, still no
  protocol change.

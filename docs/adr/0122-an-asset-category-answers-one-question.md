# 0122 — An Asset category answers one question

## Context

The registry holds 230 Asset shapes (497 files). Since ADR 0050 they have been
listed under six groups — `platform`, `obstacle`, `spring`, `gate`, `fan`,
`scenery` — assigned per stem by the converters and read by the Track builder's
Assets tab and the MCP server's `list_categories` / `list_modules`.

The user's report (2026-09-21): *"trap_arrowtrap\* jsou sweepery, trap_trapcircle
taky atd. trapdoor by měl být spíš platform jak obstacle a teď celkově to řazení
nedává moc smysl, když je tam třeba fan a spring a ty věci jsou v obstaclu."*

The groups were cut on three different axes at once:

- **What it is to a runner** — `platform`, `scenery`.
- **What mechanic it carries** — `spring` (5 shapes), `fan` (1 shape),
  `gate`.
- **Whatever was left** — `obstacle`, which held 55 shapes: the sweeping bars
  and discs, the hammers, the hanging ball, but also `trapdoor` (a floor), the
  spike plates (a floor), the shooter, the punching glove, and the loose balls
  and bombs a Character only shoves.

So `platform` mixed the decks you run on with the pillars, barriers, struts and
pipes that hold them up, `obstacle` was a leftovers bin, and two of the six
groups existed because one mechanic wanted to be findable. An author looking for
a deck scrolled past 46 pillars; an author looking for a spinning bar found it
under the same word as a bomb.

## Decision

**A category answers one question — what the piece is to a runner — and a
mechanic never moves a piece between groups.** Seven groups, in the reading
order both listings show:

| Category | Rule | Shapes |
|---|---|---|
| `floor` | you stand on its top | 80 |
| `structure` | holds the route up or walls it in; not stood on | 46 |
| `sweeper` | it moves into you | 39 |
| `launcher` | it throws you | 6 |
| `gate` | you pass through it | 7 |
| `prop` | loose enough to shove | 14 |
| `scenery` | dressing | 38 |

(Counts are palette shapes — a colour family is one entry, ADR 0113.)

What moved, and why:

- **`platform` → `floor` + `structure`.** Decks, slopes, stairs, quarter
  curves, `belt`, `fragile_block` and the trap pack's decks are Floor; KayKit's
  `barrier`, `pillar`, `strut`, `bracing`, `pipe` and `structure` pieces are
  Structure.
- **`obstacle` is gone.** Its bodies meant to be swept through a route — the
  trap pack's `arrowtrap*`, `trapcircle*`, `hammer*`, `trapball`, `trap*`, plus
  `sweeper_2arms` — are Sweeper, and so are the two Assets that act by
  themselves and reach into the route, `shooter` and `punching_glove`. Its loose
  shapes — `ball`, `bomb`, `arrow`, and KayKit's `cone` — are Prop.
- **`trapdoor` is a Floor** (the user's call). So is a spike plate
  (`trap_platformspike*`) and so is `fragile_block`: **a mechanic is a field on
  the piece, not a group of its own.** A spiked deck wears `hazard`, which the
  Assets tab already draws as a red dot on the tile; a breaking one wears
  `fragile`. An author hunting a deck is hunting a deck.
- **`spring` + `fan` → `launcher`.** The one axis the exception is allowed on:
  a group may be named after a mechanic only when *every* member carries it and
  nothing outside does. Two groups qualify — Gate (its opening, ADR 0068) and
  Launcher (a Spring's `launch`, ADR 0069, or a fan's updraft `volumes`, ADR
  0075) — and `assetModules.test.ts` holds both directions of that rule.

**An inserted Structure stands on the last Floor** (the user's call). The Track
builder's `placementFor` reads the category to decide where a freshly inserted
unchainable Segment lands: a Floor continues the run off the last Floor's −Z
face, everything else stands on the middle of its top. A pillar now takes the
second path rather than the first — under ADR 0034 free placement, one drag
moves it under the deck.

## Consequences

- `ASSET_CATEGORIES` is the seven ids above, in that order, and the order *is*
  the UI order: the Assets tab's segmented control and `list_categories` both
  read the array. The tab opens on `floor`.
- The converters' `CATEGORY_RULES` are the only place a stem is categorized
  (`convert-kaykit`, `convert-imagetostl`, `convert-quarters`); the generated
  def files were regenerated, and the diff is `category:` lines only — no
  footprint, no byte of any GLB. The hand-authored defs (`dfAssetDefs`,
  `fanAssetDefs`) were edited in place.
- Nothing stored changes. A category has never been persisted on a Segment or a
  Revision; it is derived from the def at listing time, so every stored Track
  and every draft is untouched.
- Nothing simulated changes either — with the one exception above, the category
  reaches exactly two readers: the builder's Assets tab (filter, counts, insert
  placement) and the MCP server's discovery tools.
- `Obstacle` stays in `CONTEXT.md` as the general word for a Module that
  threatens a Character; it is no longer the name of a group. `Floor`,
  `Structure`, `Sweeper` and `Launcher` are new glossary terms.
- Still open, and only play can answer it: whether `pipe_*` belongs in Structure
  or Floor (KayKit's tubes are 2 × 3 m and a Character may well be meant to run
  through them), and whether the trap pack's big rotating rigs
  (`trap_platformcircle*`, `trap_platform3faces*`, 8 × 5 × 10 m) read as Floors
  you ride — they are filed as Floor on the strength of their names, and no
  authored Track places one yet.

# M4 screens visual design: Fall Guys out-of-match UI style brief

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — see `docs/research/m2-netcode-transport.md` for the
> convention. This file feeds the M4 screens discussion; it is not itself a
> decision record. If the direction below is adopted, it should be captured
> as an ADR the normal way.

Scope: the visual/UI design of Fall Guys' out-of-match screens (main menu,
lobby / Show Selector, round results / qualification banners) as an
implementable style brief for DON'T FALL's M4 milestone (React: main menu,
lobby with nickname + ready + track picker + host start, results with rank +
times + falls). The in-match HUD is plain DOM and explicitly NOT in scope.

## Primary sources

All visual claims below trace to one of these; secondary write-ups corroborate
layout structure only, never alone for a visual claim.

- **S1** — [fallguys.com homepage](https://www.fallguys.com/en-US), fetched live
  2026-09-04. Its shipped stylesheet is the single best source of exact hexes,
  button construction, heading treatment, and the heading/body font pairing
  (observed verbatim in `<style>` rules, quoted below).
- **S2** — [Fall Guys Event Brand Guidelines v1.0.0 (PDF, Epic CDN)](https://cdn2.unrealengine.com/fallguys-eventbrandguidelines-v-1-0-0-fadcec12ac9b.pdf).
  Confirms the brand display font by name (p.14: "Do not use fonts that
  resemble Titan One in your logo or supporting text") and names the brand
  elements (p.15: "font, flourishes, face plates, crowns, backgrounds").
- **S3** — [Titan One on Google Fonts](https://fonts.google.com/specimen/Titan+One)
  (Rodrigo Fuenzalida, SIL OFL 1.1 — exact brand font, freely usable) and the
  [Asap family](https://fonts.google.com/specimen/Asap) (the body font S1
  loads alongside it: `fonts.googleapis.com/css2?family=Asap…&family=Titan…`).
- **S4** — [Fall Guys Season 2 news post on fallguys.com](https://www.fallguys.com/en-US/news/fall-guys-season-2---out-now):
  "our brand new Show Selector lets you pick from a lovingly curated playlist
  of Fall Guys 'Shows'" — confirms the lobby pattern is a card/playlist picker.
- **S5** — Mediatonic patch notes: Season 4.5 notes confirm the qualification
  screen carries a "Top X Qualify" counter matched against the qualified-squad
  count ([Gamespot](https://www.gamespot.com/articles/fall-guys-season-4-5-patch-two-new-rounds-custom-games-crossplay/1100-6491407/?ftag=CAD-01-10abi2f));
  Season 4 notes confirm a post-elimination flow and a live "Qualified"
  counter element ([Gamespot](https://www.gamespot.com/articles/fall-guys-season-4-is-live-with-patch-notes-takes-place-in-year-4041/1100-6489144/?ftag=CAD-01-10abi2f)).
- **S6 (secondary, layout only)** — [Round Over Screen wiki](https://fallguysultimateknockout.fandom.com/wiki/Round_Over_Screen):
  a full-screen banner reading `Qualified!` or `Eliminated!` appears at round
  end. Used only to corroborate screen structure, not styling.
- **S7 (secondary, palette corroboration)** — Designer interview on season
  palettes: "a rich, candyfloss pink and icy blue with splashes of minty
  green" ([Escapist](https://www.escapistmagazine.com/the-secrets-of-how-fall-guys-creates-adorable-designs-incredible-brand-collaborations/));
  default bean is "bubblegum pink" ([ESPN](https://www.espn.ph/esports/story/_/id/29734365/meet-minds-fall-guys-costumes)).

## 1. Palette (all hexes observed verbatim in S1's stylesheet)

| Token | Hex | Role | Observed in |
|---|---|---|---|
| `bean-pink` | `#FF30A4` (`#F73CA3` same ramp) | Hot-pink accent: progress bars, highlights | S1 (`.ljiycR{…background:#FF30A4…}`, pink underline `#f73ca3`); S7 candyfloss/bubblegum pink |
| `royal-purple` | `#A643FA` | Primary CTA fill; secondary-button border/text | S1 (`button.primary{…background:#A643FA…}`, `button.secondary{…border:4px solid #A643FA…}`) |
| `deep-violet` | `#6713EC` | Gradient end-stop, never a flat fill | S1 (`linear-gradient(270deg,#A643FA 0%,#6713EC 100%)` nav + section bands) |
| `sky-blue` | `#00BFF3` → `#0081DE` | Blue CTA/link gradient (radial, light top-left → deep bottom-right) | S1 (`.primary{…background:radial-gradient(100% 185.14% at 100% 100%,#00BFF3 0%,#0081DE 100%)}`) |
| `ice-blue` | `#84D3FB` | Pale blue tint for backgrounds, icon accents | S1 stylesheet, single use |
| `link-blue` | `#0074E4` | Text-link / info blue | S1 (`.MuiTypography-colorPrimary{color:#0074E4}`) |
| `star-yellow` | `#FED530` | Accent headings, links-on-dark, stars/crowns | S1 (`h…{color:#FED530}`, `.faq a{color:#FED530}`) |
| `ink` | `#282828` | Body/dark text on light fills | S1 (`.primary{color:#282828;background:#00BFF3…}` — dark text sits ON bright fills) |
| `paper` | `#FFFFFF` | Panel fills, button faces, heading text on color | S1 throughout; secondary button is white fill + purple border |
| `shadow-ink` | `rgba(0,0,0,0.25)` | The ONLY shadow color: hard offset text shadows | S1 (`text-shadow:0px 4px 4px rgba(0,0,0,0.25)`, `2px 2px 4px rgba(0,0,0,0.25)`) |

Notes: gradients are always two-stop, same-hue (purple→violet, light-blue→deep-blue) —
never purple-blue soup across hues (S1). Red `#DE3341` appears once in S1's CSS;
reserve it for errors/DNF only. Text is white on saturated fills, `ink` on bright
fills (yellow/sky) — never mid-grey body text.

## 2. Typography

- **Headings/labels/CTAs: Titan One (S2 + S3).** S2 names it as the brand font;
  S1 uses it for every heading and button label: `font-family:Titan One`,
  `text-transform:uppercase`, `font-weight:500`, tight `line-height:0.9–1.2`,
  near-zero letter-spacing (`0.00025em`). It is chunky, rounded, single-weight
  display sans — and it is on Google Fonts under OFL, so use the real thing,
  not a lookalike (S2 explicitly forbids lookalikes for brand use; for us the
  inverse applies: ship Titan One itself). Use for: screen titles, CTA labels,
  banner words (`QUALIFIED`), rank numerals, countdown digits.
- **Body/UI text: Asap (S1 + S3).** S1 loads Asap next to Titan One and sets
  `font-family:Asap(,sans-serif)` for body/link text. Rounded-humanist,
  OFL-licensed, holds up at small sizes for lobby rows, track names, timers,
  helper text. Use for: player names, results rows, track dropdown items,
  helper/error copy.
- **Numbers:** big display numbers (rank, countdown, `n/2`) in Titan One
  uppercase; tabular small numbers (times `m:ss.mmm`, fall counts) in Asap
  with `font-variant-numeric:tabular-nums` so columns don't jitter.
- **Treatment, not just typeface:** S1 headings on color are white (or
  `#FED530` for accent lines) with a hard offset drop shadow (`0px 4px 4px`
  for hero, `2px 2px 4px` for cards) — no stroke/outline on web type, no blur
  glow. Button labels are uppercase Titan One with `text-shadow:none` (S1) —
  the white 4px button border carries the pop, not the glyphs.

Fallback stack: `'Titan One', 'Asap', system-ui, sans-serif` for display;
`'Asap', system-ui, sans-serif` for body. Both via Google Fonts (S3); pin
weights (Titan One 400 only; Asap 400/600/700).

## 3. Signature components

(a) **Big CTA buttons (S1, verbatim construction).** Pill, `border-radius:30px`,
`border:4px solid #fff` on a flat `#A643FA` fill (primary) or `4px solid
#A643FA` on white fill with purple text (secondary). Label: Titan One,
uppercase, white (primary) / purple (secondary), no text-shadow. Hover: flat
fill shift + `box-shadow:0 0 18px #00BFF3` glow (S1) — the single sanctioned
glow, reserved for hover. Height ~48–56px, full-width on mobile stacks.

(b) **Lobby cards / name plates.** Structure corroborated by the Show Selector
playlist-picker pattern (S4) and S1 card rules (`Titan One, uppercase, white,
2px 2px 4px rgba(0,0,0,0.25)`, 3-line clamp): white rounded panel, bean/costume
avatar left, Titan One uppercase name plate, one status chip (Ready / Not
ready). Selected card = 4px `royal-purple` border (secondary-button pattern,
S1); unselected = white fill, `ink` text, no border. No per-card badges,
scores, or icons beyond the one status chip.

(c) **Qualification banners + results rows.** Screen structure: full-screen
`QUALIFIED!` / `ELIMINATED!` banner word (S6) + a `TOP X QUALIFY` counter
paired with the qualified count (S5). Render the banner word in Titan One
uppercase, white with the hero `0px 4px 4px rgba(0,0,0,0.25)` shadow (S1 hero
pattern), centered over a dimmed/scene backdrop — one line, no sub-badges.
Results rows: Asap, rank numeral in Titan One, qualified rows white / cut rows
greyed with red (`#DE3341`, sparingly) rank only; single hairline separators,
no zebra striping.

(d) **Panel shapes (S1).** Large radii (pills `30px`, cards ~16–24px), thick
outlines (`4px solid` white-on-color or color-on-white), and hard offset
shadows (`0px/2px 4px rgba(0,0,0,0.25)`) — never blurred glassmorphism,
never 1px grey borders, never layered soft elevation stacks. Panels are opaque
white or one flat brand fill.

(e) **Backgrounds (S1 + S2).** Sparse by construction: S1 puts content on flat
fills with at most one two-stop gradient band per viewport
(`linear-gradient(270deg,#A643FA,#6713EC)` header bands) plus a few large
simple shapes; S2's brand-element list is "flourishes, face plates, crowns,
backgrounds" — i.e. a handful of chunky motifs (crown, face-plate oval,
confetti dots), never grids, noise, or photo collage. Rule of thumb: one
gradient band + ≤3 large flat shapes per screen, content panels opaque above.

## 4. Anti-slop rules (Fall Guys vs generic AI slop)

1. **DO one flat fill or one same-hue two-stop gradient per surface; DON'T
   blend purple→blue→pink across a screen.** S1 gradients are always
   same-hue pairs (`#A643FA→#6713EC`, `#00BFF3→#0081DE`).
2. **DO thick outlines + hard offset shadows; DON'T do glassmorphism.**
   Panels are opaque with `4px` borders and `0/2px 4px rgba(0,0,0,.25)`
   shadows (S1) — no `backdrop-blur`, no translucent layering.
3. **DO Titan One, uppercase, for headings/CTAs only; DON'T set body, rows,
   or helper text in display type.** S1 reserves Titan One for headings and
   button labels; everything else is Asap (S1/S3).
4. **DO white text with a hard shadow on saturated fills, `ink` on bright
   fills; DON'T use grey-on-grey or low-contrast pastel text.** Both
   treatments are verbatim S1 rules.
5. **DO at most one status chip per card; DON'T invent badge clutter**
   (ranks, streaks, icons, decorative stars on every row). S4's selector and
   S5's counter show one datum per element: pick state, qualify count.
6. **DO sparse flat backgrounds (one band + ≤3 chunky motifs: crown,
   face-plate, confetti); DON'T add grids, dot-matrices, noise, or floating
   decorative cards.** Follows S2's closed brand-element list and S1's flat
   section bands.
7. **DO reserve hot pink (`#FF30A4`) and star yellow (`#FED530`) as accents
   on white/dark; DON'T make them full-screen fills.** S1 uses pink for a
   progress bar and yellow for accent headings/links — sparks, not walls.
8. **DO the single sanctioned glow (`0 0 18px #00BFF3`) on primary-button
   hover only; DON'T glow text, borders, or cards at rest.** (S1 hover rule.)

## 5. M4 mapping (buildable spec per screen)

Shared tokens: `paper` panels, `ink` body text, Titan One uppercase headings
(white/`star-yellow` w/ `2px 2px 4px` shadow), primary CTA = purple pill /
white 4px border, secondary = white pill / purple 4px border, bg = flat light
fill + one purple gradient band + ≤3 flat motifs. Fonts via Google Fonts
(Titan One + Asap). All component patterns refer to §3.

- **Main menu.** Centered stack on flat fill with one top gradient band:
  game wordmark (Titan One, white + hero shadow, or `star-yellow` second
  line), bean motif optional (S2 characters-as-provided — simple oval
  face-plate, no custom art). Buttons (§3a): PLAY (primary), plus TRACKS/
  SETTINGS as secondary pills if needed for M4 routing. Leave out: news
  carousels, store teasers, badges, daily-login widgets.
- **Lobby.** Title row (Titan One, `star-yellow` "LOBBY" + white track name).
  Player cards (§3b): white panel per slot — avatar circle, nickname in Asap
  600, exactly one Ready/Not-ready chip (Ready = flat `#A643FA` fill, white text; Not-ready = white fill,
  `ink` text, 2px `ink` border). Track picker = Show-Selector-style card list (S4):
  track name (Titan One small) + time limit + best time in Asap, selected =
  4px purple border. Host START button (§3a primary, enabled only when all
  ready per M4 spec); non-hosts see a waiting line in Asap. Leave out:
  costume pickers, party codes/links, chat, private/public toggles (all
  explicitly NOT in M4).
- **Results.** Banner word (§3c): `QUALIFIED!` white Titan One + hero shadow
  for each qualifier (personal: `QUALIFIED #n`), single line; non-qualifiers
  get `ELIMINATED` with red rank only. Rows (Asap, §3c): rank (Titan One) ·
  nickname · time (`tabular-nums`, qualifiers by finish time) or checkpoint
  progress for DNF · falls count; qualifiers white, DNF greyed. CTA row:
  BACK TO LOBBY (primary); no auto-rematch timer (M4 spec). Leave out: live
  standings, crown/XP rewards, share buttons, per-fall breakdowns.

Deliberately M4-out (do not style yet): matchmaking, accounts, store/currency,
emotes/costumes, spectator/betting, multi-round carry-over — per M4's
"Explicitly NOT in M4" list, so no component for them should exist even as
disabled controls.

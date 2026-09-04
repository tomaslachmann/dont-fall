# Screens: wireframes, components, and reusability

> Research note under `docs/research/`, same convention as `docs/research/m2-netcode-transport.md` and
> `docs/research/screens-inventory.md` — feeds design discussion, decides nothing itself. If any
> direction below is adopted it should be captured as an ADR the normal way.
>
> A greyscale, structure-only wireframe set covering every Screen in this document — Main menu,
> Lobby (with chat/party-bar integrated), Countdown, Results, Settings (Controls/Audio/Video +
> nested Accessibility), Account, Login/Register, the Bet screen, and the full proposed list —
> lives at `docs/research/screens-wireframes.html`. It applies no color/type/motion decisions (see
> `docs/research/design-system.md` for those, still mostly open slots); it exists to validate
> layout, hierarchy, and cross-Screen component reuse before any visual pass begins.

## 0. Why this file doesn't build on the two earlier design docs

`docs/research/m4-screens-visual-design.md` and `docs/research/m4-design-system.md` derived a full
token set (color, type, radii, shadow) by reverse-engineering `fallguys.com`'s own shipped
stylesheet and Fall Guys' brand guidelines PDF, down to exact hexes (`#A643FA`, `#FF30A4`) and the
brand display font (Titan One). **That baseline has been explicitly rejected** for this project.
The two files are cited here only as "a direction already tried," not as ground truth, for two
reasons stated directly by CLAUDE.md: Fall Guys is this project's reference for match *structure*
only — Lobby → Countdown → Round → Results — and "never for feel" (`CLAUDE.md`, Design philosophy).
Copying Fall Guys' own brand palette and brand font wholesale is the literal opposite of "never for
feel": it's importing another game's *entire visual feel*, not its structure.

This file also does **not** treat the current placeholder styling in `apps/client/index.html` or
`apps/track-builder/index.html` (dark background, monospace font, thin borders) as a design
input. That styling has no design intent behind it — it is an unstyled dev scaffold, and per
direction received while writing this file, its colors/fonts/borders are dropped entirely as a
visual baseline. What *does* still stand from those two files is pure architecture, independently
confirmed by ADR 0008 and ADR 0034 (§2 below): the HUD is plain DOM text mutated every frame, not a
component tree, and the Track builder is a wholly separate vanilla-TS application with its own
markup and stylesheet. Those are load-bearing technical facts this file's reusability analysis
must respect; the actual CSS values in those two files are not.

So every wireframe and visual judgment below is grounded in three things only: (a) this project's
own identity as stated in `CLAUDE.md` and its own vocabulary in `CONTEXT.md` (the *concept* —
chaotic, physical, slapstick, hand-tuned physics feel — never any existing pixels from this repo or
Fall Guys'), (b) fresh external research into real shipped multiplayer/party games and current
design discourse (cited inline, with access dates), and (c) this document's own professional
judgment, explicitly labeled as such wherever the underlying facts run out.

**Screen list source:** every Screen treated below is drawn from `docs/research/screens-inventory.md`
(a separate, not-rejected file — it catalogs *which* Screens exist or are proposed, and is used
here purely as an index; its own reference-game research on Fall Guys, Trackmania, and Golf With
Friends is reused and cited where relevant, since that research itself is sound — the rejection
above is about the *visual-design* files, not the inventory). Every Screen in that file's §1
(confirmed M4 flow), §2 (named-but-unscoped), and §3 (proposed) gets a full wireframe / component /
reusability / anti-slop treatment below — no lighter pass for any of them. Where the inventory
itself already flags a Screen as having no real-game precedent (the Bet screen) or no defined
concept at all (level themes), that gap is preserved and reasoned through from first principles,
labeled as this file's own speculation, rather than papered over with a borrowed analogy that
doesn't fit.

---

## 1. Anti-slop foundation: what "generic AI-feeling UI" actually is, and what to do instead

This section is fresh research (none of it reused from the two rejected files, which had no
anti-slop research of their own worth keeping) and is written once, referenced per-Screen in §4.

### 1.1 What the current design-discourse critique actually names

Four 2026 sources converge on a specific, nameable pattern rather than a vague "looks cheap"
complaint:

- **Adrian Krebs, "AI Design Slop and How to Spot It"**, developersdigest.tech, 22 Apr 2026
  ([link](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), accessed
  2026-09-04). Audited 1,590 real landing pages and scored them against 16 concrete tells: the
  Inter typeface used universally; a specific lavender-purple accent ("VibeCode Purple");
  permanent dark mode with barely-passing-contrast grey body text; gradients and large colored
  glow/box-shadows used decoratively; centered hero headlines; badges floating above an H1;
  colored top/left borders on cards; identically-styled icon-topped feature-card rows; numbered
  1-2-3 step sequences; stat-banner rows; emoji used as nav icons; all-caps section labels; default
  shadcn/ui components; and glassmorphism frosted-card effects. 22% of the sample hit 4+ of these
  at once — this is a real, statistically identifiable cluster, not a subjective vibe.
- **Jason Zhou, "Why AI Design Looks Generic"**, superdesign.dev, 15 Jun 2026
  ([link](https://superdesign.dev/blog/why-ai-design-looks-generic), accessed 2026-09-04). Names
  the mechanism, "distributional convergence": a model asked an open design question returns the
  statistical center of its training data — "safe design choices that work universally and offend
  no one just dominate web training data" — which is why unrelated products converge on the same
  Inter font, purple-indigo gradient, centered hero, and three rounded cards. His fix is process,
  not a style rule: separate *picking a direction* (references + constraints) from *exploring
  options* from *implementing* — collapsing all three into one pass is what produces the safe
  average.
- **925 Studios, "AI Slop Fonts and Gradients: The Tells That Give Away AI Design"**,
  925studios.co ([link](https://www.925studios.co/blog/ai-slop-design-tells), accessed 2026-09-04)
  and the developersdigest audit both independently flag the *specific* purple/indigo gradient as
  traceable to a tooling default (Tailwind CSS shipping `indigo-500` since 2019) rather than a
  deliberate color choice anyone made — the tell isn't "purple is bad," it's "purple chosen by
  default is a fingerprint of nobody having decided."
- **Glassmorphism specifically** — multiple 2025-2026 design-trade sources (surveyed via search,
  2026-09-04: LogRocket's UX blog, `medium.com/design-bootcamp`, `uxpilot.ai`) converge on the same
  point: frosted-glass panels read as decoration divorced from function — "problems arise when
  glass is applied indiscriminately... dense interfaces, data-heavy views, and text-focused screens
  demand clarity" — and that it "thrives on Dribbble... but appears far less frequently in
  functional, production-level products." The critique isn't the blur itself, it's blur with no
  reason: no actual layered-glass or depth metaphor in the game world it's decorating.

**Common thread across all four:** slop isn't a specific hex code, it's *the absence of a reason*.
Every one of the 16 tells above is a default reached for when nobody actually decided anything —
generic because it could belong to any product. The antidote in all four sources is the same
non-visual claim: pick a direction from the *thing itself* (its rules, its world, its constraints)
before touching typography or color, and make choices specific enough that they'd look wrong
grafted onto a different product.

### 1.2 Applying this to DON'T FALL specifically, not generically

CLAUDE.md's own identity gives concrete material to make choices *from*, which is the actual
antidote per §1.1 — not a rule list to satisfy, but source material:

- **"Physical chaos and player interaction — bumping, shoving, and falling"** and **"Hilarious when
  you fail"** (`CLAUDE.md`, opening line and Design philosophy) argue against the number-one slop
  tell across all four sources: bland symmetry and safety. A menu for a game whose entire premise
  is *things going wrong in a funny, physical way* can afford visible tilt, overlap, a button that
  looks like it's mid-wobble, imperfect alignment — asymmetry as a feature, not sloppiness, exactly
  the "asymmetry/tension" antidote the brief calls for. A perfectly centered, perfectly symmetric
  hero-plus-three-cards layout would be the single worst fit for this specific game, worse than for
  almost any other genre.
- **The Fall / Respawn / Checkpoint vocabulary** (`CONTEXT.md`) and the fact that the whole game's
  name is a command ("DON'T FALL") is real material for typography and iconography that no other
  game's training-data-average font choice could produce: a wordmark or heading treatment that
  itself looks like it's about to tip over, or numerals for a countdown that visibly "wobble" on
  entry (this game already has a named `Wobble` mechanic for the Character's mesh — `CONTEXT.md`
  "Wobble" — the same procedural-lean idea is free creative material for UI motion, not just
  character rendering).
- **Physical materials over glass.** This game's entire pitch is Rapier-simulated physical bodies —
  capsules, ragdolls, dynamic Props, spinners. A UI that reaches for frosted-glass panels (§1.1's
  most-flagged decorative tell) borrows a *screen-space* metaphor (translucent material behind
  glass) that has zero connection to a game about solid bodies colliding. A more specific choice:
  panels and buttons that behave like the game's own physical vocabulary suggests — a card that
  visibly "lands" with a little overshoot-then-settle when it appears (the game already has spring-
  arm camera and procedural Wobble as prior art for that kind of motion with personality, per
  CLAUDE.md's M1 status log), or a button press that has real squash, not a CSS `:active` opacity
  dip.
- **Restraint on iconography.** §1.1's "stock icon packs used indiscriminately" tell applies
  directly to a Lobby's ready-toggle or a Settings page's category icons — a generic checkmark/gear
  from a default icon font reads as safe-average. This project doesn't need custom iconography for
  every glyph (that's its own cost/scope trade-off, flagged per-Screen below where it matters most:
  Main menu, Lobby, Results), but where an icon carries actual game meaning — a Checkpoint flag, a
  Fall indicator, a Dash-cooldown pip — drawing it from the game's own Track-builder Module
  vocabulary (`CONTEXT.md` "Module", "Checkpoint") rather than a generic pack is the concrete,
  low-cost version of "custom iconography tied to the game's own world."
- **Type as a decision, not a default.** Per Zhou and Krebs, Inter (or its lookalikes) is *the*
  single most-flagged tell precisely because reaching for it answers nothing — it's simply what's
  already loaded/known. This document does not select a replacement typeface (that's a real design
  decision belonging to whoever executes this work, likely worth its own short spike/ADR rather
  than an unShown pick buried in a research doc) — but it does assert the antidote directly: **any**
  specific, deliberate pairing beats Inter+system-ui by default, provided the pairing was chosen
  *because* of something about this game (weight and boldness matching "chaotic," a rounder,
  slightly off-kilter display face matching "hilarious when you fail") and not because it was the
  first result in a font picker.

Each per-Screen subsection in §4 has its own "Anti-slop application" line applying this reasoning
to that Screen's specific slop risks — a Lobby's ready-toggle list is one risk (symmetric card
grid); a Results screen's rank list is a different one (a generic leaderboard-with-avatars
template); Settings is a third (default-feeling toggle switches and sliders). None of them are
re-derived from scratch each time; they cite back to this section.

---

## 2. Reusability architecture: React Screens / plain-DOM HUD / vanilla-TS Track builder

Written once here, referenced per-Screen in §4 rather than re-argued each time.

### 2.1 The real constraint

`docs/adr/0008-react-for-screens.md` draws a hard boundary: React owns Screens and routing; the HUD
"stays plain DOM, drawn by the game itself... has no place in a component tree," specifically
because it updates every frame and per-frame values through a component tree is "friction with no
benefit over `element.textContent`" (ADR 0008, Considered options). `docs/adr/0034-track-builder-
free-placement.md` independently confirms the Track builder "stays a standalone vanilla-TS app...
no React. ADR 0008's React-for-Screens decision covers `apps/client` only" — folding it into a
React "Create" Screen is explicitly deferred to "if/when M4 ships that shell, not before."

That means there is **no shared component runtime** across the three surfaces. A React
`<LobbyPlayerList>` cannot be imported into the HUD's per-frame `hud.textContent` write
(`apps/client/src/main.ts`, confirmed live: the HUD is a single template-literal string assigned to
`textContent` every animation frame, e.g. `hud.textContent = \`DON'T FALL — M2 · predicted +
reconciled\n...\`` — real DOM nodes never enter into it) or into the Track builder's own
`document.getElementById(...)`-driven DOM wiring. Any "reusability" claim that implies shipping the
same component or the same JS module across these three is false, so this file only ever claims
one of three narrower, real things:

- **(a) Shared design tokens** — CSS custom properties (color, spacing, type scale, radius, motion
  duration/easing curves) are just CSS values; nothing stops all three surfaces from importing the
  same `tokens.css` (or the equivalent generated at build time) and using the same custom
  properties in their own separately-authored stylesheets. This is the single most legitimately
  shareable thing across all three, and it's the mechanism recommended throughout §4 wherever
  "shared visual identity" is claimed.
- **(b) Shared visual/interaction *patterns*, reimplemented per stack** — e.g., "a card with a
  drop-landing overshoot, used for the Lobby's Track picker AND the Track builder's Module
  palette" is a legitimate reuse claim, but it means the *idea* (proportions, motion curve, hover
  state) is specified once and *coded twice* — once as a React component, once as vanilla-TS DOM +
  CSS — not shared code. Each per-Screen subsection that claims this is explicit that it's pattern
  reuse, not code reuse.
- **(c) Genuinely shareable plain logic from `packages/shared`** — functions with no DOM/React
  dependency (formatting a finish time, computing Qualification rank order, a Time-Limit countdown
  string) can be imported by both the React Screens and the HUD (already true today: the HUD
  imports simulation constants like `TICK_RATE_HZ` and `DASH_COOLDOWN_MS` directly). This is real
  code sharing, but it's logic, never UI, and it's small — most Screens below have little or no
  qualifying logic.

### 2.2 What is deliberately NOT shared, and why

- **The HUD's performance envelope is categorically different.** It mutates every rendered frame,
  synchronously, in the same loop that also steps physics and renders Three.js
  (`apps/client/src/main.ts`'s `frame` loop). A Screen's DOM updates on user interaction or a
  ~1 Hz network tick (e.g. a Lobby's ready-toggle list) at most — three-plus orders of magnitude
  less frequent. Introducing React's reconciliation cost, or even just component-tree overhead,
  into the HUD's frame budget would be pure regression for zero benefit, which is exactly ADR
  0008's own reasoning, reused here rather than re-litigated per Screen.
- **The Track builder has no router, no auth/session concept, and a different DOM lifecycle**
  (a persistent single-page tool with panel toggles, `apps/track-builder/index.html`'s own
  `#palette`/`#inspector`/`#browse` panels shown/hidden via the `hidden` attribute) — it has no use
  for `react-router`, and nothing about a Screen's routing/state-management layer is portable to
  it. Only the visual/pattern layer (§2.1b) and shared tokens (§2.1a) ever cross that boundary.
- **Screens' own state (auth, connection, lobby membership) has no HUD or Track-builder
  analog** and isn't discussed as "reusable" anywhere below — it's Screen-internal by construction.

---

## 3. Per-Screen treatment

Each subsection: **Wireframe** (reference + layout), **Components** (React, named with rough
props/responsibilities — even for Screens far from being built, since this is architecture
research, not implementation), **Reusability** (specific application of §2), **Anti-slop
application** (specific application of §1).

### 3.1 Main menu — `confirmed`, content unspecified

**Wireframe.** The strongest, most directly comparable reference is Golf With Your Friends: a
"notably minimal Host/Join/Options/Customise main menu" (`docs/research/screens-inventory.md` §4,
citing the [Steam store page](https://store.steampowered.com/app/431240/Golf_With_Your_Friends/)
and, for the exact button layout, the [Fandom wiki](https://golf-with-your-friends.fandom.com/wiki/Golf_With_Your_Friends),
both accessed 2026-09-04 per that file). That is a strong precedent that a chaotic party game's
main menu needs almost nothing: a small vertical stack of 3-5 actions, no dashboard, no feed, no
carousel. This project's own confirmed routing — "main menu → lobby" (`docs/milestones/M4.md`
"Screens") — matches that minimalism exactly: there's nothing to browse yet (no matchmaking, no
accounts, per M4's exclusion list), so a menu trying to look "full" (news feed, promoted-content
tiles, a shop button to nowhere) would be inventing content the game doesn't have, which is its own
slop risk (empty modules dressed up to look busy). Layout: full-bleed background (a looping
render of the game's own physics — a spinner mid-swing, a ragdoll settling — rather than a static
illustration, since this project already has the exact 3D assets a background needs and a static
JPEG would waste the one thing this menu can uniquely show); a primary "Play" action large and
alone, not sharing visual weight with secondary items; Settings and (once it exists) Account as
small, corner-anchored secondary affordances, matching Golf With Friends' own "gear icon in the
corner" convention observed for Fall Guys' Settings entry point too (`docs/research/screens-
inventory.md`/Fall Guys settings, [esports.net](https://www.esports.net/wiki/guides/fall-guys-settings/),
accessed 2026-09-04, "select the gear icon in the top right corner to access the settings menu").

**Components.**
- `<MainMenuScreen>` — top-level route component; owns nothing but layout and navigation.
- `<PrimaryPlayAction>` — the single large "Play" button; `onPlay: () => void` navigates to Lobby
  (or, once it exists, to Create/Join — §3.19).
- `<MenuBackground>` — mounts a lightweight, non-interactive render of the game world (could be a
  cut-down `<GameCanvas>` mode, or a pre-rendered loop if a live physics render is too costly to
  keep running behind a menu — a real performance trade-off worth its own spike, not decided here).
- `<SecondaryMenuRail>` — small corner cluster of Settings / Account / Credits / Changelog links;
  `items: {label, icon, onSelect}[]`.

**Reusability.** Tokens only (§2.1a): the button, background-wash, and type-scale tokens defined
for this Screen should be the same tokens every other Screen consumes, since Main menu is the
first thing a player sees and functionally *sets* the palette for everything downstream. No pattern
or logic reuse candidates specific to this Screen beyond the generic `<PrimaryButton>`/
`<SecondaryButton>` pair every Screen in this document reuses (defined once here, referenced
elsewhere as "the standard button pair").

**Anti-slop application.** This is the highest-leverage Screen to get right per §1.2, since a
generic hero-plus-cards Main menu sets the tone for the whole app. Concretely: no centered-hero-
plus-three-feature-cards layout (§1.1's most literal tell) — there's nothing to put in three cards
yet, and inventing filler content to fill that template is worse than an honest, minimal menu.
Motion: the Play button should have a physical "give" (a slight squash/overshoot on press,
matching §1.2's "physical materials over glass" point), not a flat opacity-fade `:active` state.

### 3.2 Lobby — `confirmed`

**Wireframe.** Two real precedents, both cited in `docs/research/screens-inventory.md` §1/§4: (1)
Fall Guys' Show Selector, "a lovingly curated playlist of Fall Guys 'Shows'" ([fallguys.com Season 2
post](https://www.fallguys.com/en-US/news/fall-guys-season-2---out-now), accessed 2026-09-04 per
that file) — a card/playlist-picker pattern for the Track-selection portion specifically; (2) Golf
With Friends' in-lobby match-settings screen, where "time limit, stroke limit, ball shape" are
"configured inside lobby creation, not a separate settings screen" — direct precedent for folding
this project's per-Revision Time Limit display into the Lobby itself rather than a separate
sub-screen, which this project's own M4 spec already does (`docs/milestones/M4.md`: "the lobby
reads the Time Limit, never writes it"). Layout, translating both into this project's actual
confirmed content (`docs/milestones/M4.md` "Screens" + `CONTEXT.md` "Lobby"): a left/main column
listing joined Players — nickname, a Ready toggle each, host marked distinctly (`CONTEXT.md`:
"host = first joiner starts when all ready") — and a right or lower panel holding the Track
dropdown (sourced live from the track-service listing per M4.md) with the selected Track's Time
Limit surfaced read-only next to it. A single "Start" action, enabled only for the host and only
once M4's all-ready condition is met, sits apart from the Ready toggles so it can't be
mis-tapped as another ready button.

**Components.**
- `<LobbyScreen>` — owns the WebSocket lobby-phase subscription (ADR 0040: lobby messages "travel
  the existing client↔server WebSocket").
- `<LobbyPlayerList>` — `players: {id, nickname, ready, isHost}[]`; renders one row per Player.
- `<ReadyToggle>` — `ready: boolean; onToggle: () => void`; the local Player's own row only —
  presented distinctly from the read-only state of every other Player's row.
- `<TrackPicker>` — `tracks: TrackListing[]; selected: string; onSelect: (id) => void`; disabled
  for non-hosts (M4.md gives Track selection to the host implicitly via "host... starts").
  Draws the Trackmania-style "card" visual pattern (§2.1b) shared conceptually with the Track
  builder's own Module palette (§3.21 below covers the browser variant of this same pattern at
  larger scale).
- `<TimeLimitBadge>` — `ms: number`; read-only display, pulling the format function from
  `packages/shared` if one already exists for time formatting (worth checking at implementation
  time — a genuine §2.1c candidate, since the HUD will need the identical formatting for its own
  Round timer per M4.md's HUD checklist).
- `<HostStartButton>` — `enabled: boolean; onStart: () => void`.

**Reusability.** `<TrackPicker>`'s *card* pattern (§2.1b) is the clearest cross-surface case in this
whole document: the same "Module/Track as a bordered preview card with a name label" visual idea
should read as one design language whether it's the Lobby's dropdown-replacement card list, the
Track builder's `#palette` Module list, or the browser Screen in §3.21 — three different codebases,
one specified look. Time formatting is a real §2.1c logic-reuse candidate (see above). The HUD's
own upcoming Round-timer element (M4.md) should visually rhyme with `<TimeLimitBadge>` via shared
tokens (§2.1a) even though it's a different DOM element in a different render loop.

**Anti-slop application.** The generic-tell risk here is the "identically-styled icon-topped
feature-card row" (Krebs, §1.1) applied to a player list — five uniform rows with a generic
checkmark icon for "ready." Per §1.2's asymmetry point: the host's row is structurally different
(they own Track selection and Start) and should look different, not just carry a small badge —
visually anchoring the host's authority reinforces the game's own "host = first joiner" rule
instead of hiding it behind a tiny icon.

### 3.3 Countdown (overlay) — `confirmed`, routing boundary unsettled

**Wireframe.** `docs/research/screens-inventory.md` §1 flags the open question directly: is this a
routed Screen or an overlay on `<GameCanvas>`? M4.md's own description — "Characters spawned...,
input locked, cameras live" — describes a state where the 3D game is already fully rendering, which
functionally settles the layout question even if the routing question stays open: whatever
component shows "3… 2… 1…" must render *on top of* a live game view, not instead of it, so
visually it is an overlay regardless of which router node owns it. No cited reference game supplies
a strong precedent here beyond the generic "big numeral counts down over the live scene" convention
common to nearly every online multiplayer game (own judgment — this is too universal a UI
convention to need a specific citation). Layout: a single large numeral or word, center-screen,
non-interactive (input is locked per CONTEXT.md's own "Countdown" definition), fading in the game's
already-live camera behind it rather than dimming it heavily — dimming would fight against the
Character/camera already being "live," which is the one differentiator M4.md calls out.

**Components.**
- `<CountdownOverlay>` — `secondsRemaining: number` (or a tick-derived render value, matching
  ADR 0025's tick-based rendering precedent already used for Spinner phase in `apps/client/src/main.ts`);
  purely presentational, no interaction.
- If routed rather than an overlay: `<CountdownScreen>` wrapping `<GameCanvas>` plus
  `<CountdownOverlay>` — the open architecture question this Screen can't resolve on its own;
  flagged here as still open, matching the inventory's own flag.

**Reusability.** This is the one Screen in this document where the plain-DOM-HUD boundary is
genuinely blurry, because unlike every other Screen, it must render live, every frame, over a
running physics simulation — the same performance profile as the HUD, not a normal Screen (§2.2's
"HUD performance envelope" argument applies almost as strongly here as to the HUD itself). That's
a real argument, independent of the inventory's own framing, for leaning toward *not* making this a
React component at all, and instead treating the countdown numeral as a HUD-adjacent plain-DOM
element the game loop itself drives — worth surfacing to whoever resolves the open routing question
in ADR 0040's successor, since it changes which of the three "reusability" buckets in §2.1 even
applies (if it's plain DOM, then only §2.1a tokens and §2.1c logic apply, and there is no React
component to decompose at all — the component list above assumes the React answer is chosen).

**Anti-slop application. ** The numeral itself is exactly the kind of moment CLAUDE.md's "hilarious
when you fail" identity can carry into UI motion: a countdown digit that has a little Wobble-style
lean (reusing the Character's own procedural-lean concept, `CONTEXT.md` "Wobble," as UI-motion
inspiration, not code) reads as specific to this game; a flat fade/scale digit transition (the
generic default for every countdown UI) does not.

### 3.4 (In-Match HUD) — not a Screen, included only for flow completeness

Per `CONTEXT.md` and ADR 0008 this is explicitly *not* a Screen and gets no wireframe/component
treatment here — it is plain DOM, drawn by the game loop, "has no place in a component tree" (ADR
0008). It is included in this document only because §2 and §3.3 both depend on understanding its
real technical shape: today it is a single `<div id="hud">` whose `textContent` is overwritten
wholesale every animation frame (`apps/client/src/main.ts`, confirmed by direct read — e.g.
`hud.textContent = \`DON'T FALL — M2 · predicted + reconciled\n...\``); M4.md's HUD checklist adds
a Round timer, `Qualified n/2`, and a personal Qualified/Eliminated banner to that same plain-DOM
surface, not a new one. No anti-slop treatment applies to it as a *Screen* concern, though the
motion-personality point in §1.2 (Wobble-style lean, physical "give") is equally available to HUD
elements like a personal banner, since it's a CSS/DOM technique, not a React one.

### 3.5 Results — `confirmed`

**Wireframe.** Fall Guys' Round Over flow is the closest real precedent, cited in the inventory: a
full-screen `QUALIFIED!`/`ELIMINATED!` banner word appears at round end ([Round Over Screen
wiki](https://fallguysultimateknockout.fandom.com/wiki/Round_Over_Screen), secondary source per
the inventory's own S6, layout-only, accessed 2026-09-04), paired with a live "Qualified" counter
element confirmed via patch-note coverage ([Gamespot, Season 4](https://www.gamespot.com/articles/fall-guys-season-4-is-live-with-patch-notes-takes-place-in-year-4041/1100-6489144/?ftag=CAD-01-10abi2f),
accessed 2026-09-04). Trackmania's leaderboard convention (`CONTEXT.md`-adjacent — see §3.22) is
the second reference: a clean, monospaced-feeling rank list sorted by time, which is a better model
for the *rows* than Fall Guys' own results screen, since this project's own Results spec is more
data-dense than Fall Guys' round-over banner alone: "rank Qualified by finish time and DNF by
checkpoint progress, show falls per player" (`docs/milestones/M4.md`). Layout: a personal
banner/headline first (own Qualified/Eliminated result, largest and first-read, matching Fall
Guys' own banner-word precedent), then the full ranked list beneath it — Qualified players ordered
by finish time, DNF players ordered by Track/checkpoint progress underneath them (exact ordering
per `CONTEXT.md` "Results": "rank with Qualified ordered by finish time and the rest by Track
progress"), a falls-count column per row, and a single "Back to Lobby" action (M4.md: "both players
return to the lobby... no auto-rematch timer" — deliberately no countdown-driven auto-advance UI).

**Components.**
- `<ResultsScreen>` — owns the ranked list computed from the Snapshot's final
  `qualified {characterId: finishTick}` data (M4.md).
- `<PersonalResultBanner>` — `outcome: "qualified" | "eliminated"; rank?: number`.
- `<ResultsList>` — `rows: {nickname, qualified, finishTime | trackProgress, falls}[]`.
- `<ResultsRow>` — one row; visually distinguishes Qualified (has a finish time) from DNF
  (has progress instead) per CONTEXT.md's own ordering rule — these are not the same kind of row
  and shouldn't be styled identically with just a color swap.
- `<BackToLobbyButton>` — host-only "start another Round on another Track" affordance folded in
  here per M4.md, vs. a plain "return" for non-hosts.

**Reusability.** The finish-time/rank computation itself is a strong §2.1c candidate: if
`packages/shared` already contains (or gains) a pure function for "qualified sorted by time, DNF
sorted by progress," both `<ResultsList>` and any future HUD live-standings feature (explicitly
deferred per M4.md, but named as a "later" concern) can consume the identical function — this is
actual shared logic, not just a visual pattern. The row/card visual pattern (§2.1b) should
carry over to §3.23's Match-history Screen and §3.22's Leaderboards, since all three are "a ranked
list of {name, time/score, secondary stat}" at heart — one visual language, three separate
implementations.

**Anti-slop application.** The most literal risk here is a "generic leaderboard-with-avatars
template" — evenly-spaced rows, identical rank badges, no differentiation between a Qualified time
and a DNF's honest failure. Per §1.2, this game's whole identity runs on Fall/Respawn/Checkpoint
being *funny*, not shameful — the DNF rows are a real opportunity to lean into "hilarious when you
fail" (e.g., showing exactly where/how a DNF player fell, tied to their actual fall count, rather
than hiding it behind a plain "DNF" label) instead of the generic pattern of quietly graying out
losers, which is both slop-flavored (default treatment) and tonally wrong for this specific game.

### 3.6 Settings — `named, unscoped`, priority: ship-blocking

**Wireframe.** Every reference game researched has some settings surface, confirming the
inventory's own "ship-blocking" call. Fall Guys' own structure is the most directly transferable:
"four main sections... Audio, Graphics Options, Keyboard and Controller," accessed via "a gear icon
in the top right corner" ([esports.net Fall Guys settings guide](https://www.esports.net/wiki/guides/fall-guys-settings/),
accessed 2026-09-04). Among Us' settings split is a second, simpler data point: "General,
Graphics, and Data" tabs ([Among Us Fandom, Settings](https://among-us.fandom.com/wiki/Settings),
accessed 2026-09-04) — a smaller game needing fewer categories than Fall Guys, which is the more
apt comparison for this project's actual current input surface (WASD, pointer-lock free-look,
Dash, jump — no gamepad-remap complexity yet documented anywhere). Layout: a left-hand tab rail
(Controls / Audio / Video, three tabs matching this project's actual current mechanical surface —
Video only because "camera/motion accessibility options are a plausible real need" per the
inventory's own §3 note on this project's spring-arm camera and free-look) with the content panel
on the right; a persistent "Back" affordance (not a full navigation loss — this Screen is reached
from both Main menu and, per Among Us' own precedent of a settings entry "within the lobby," a
future in-Lobby settings entry point too); no destructive "Reset to Default" placed anywhere near
primary actions, given Among Us' own general/graphics/data split treats "Data" (network) as its own
careful category.

**Components.**
- `<SettingsScreen>` — owns the tab state and the actual persisted-settings object (localStorage,
  since there's no account system yet per §3.7).
- `<SettingsTabRail>` — `tabs: {id, label}[]; active: string; onSelect`.
- `<ControlsPanel>` — key-rebind rows for the actual current input surface (WASD, jump, Dash,
  free-look sensitivity) — the inventory's own top concern ("zero documented plan for key
  rebinding, sensitivity... with a Character that already has WASD, pointer-lock free-look, Dash").
- `<AudioPanel>` — volume sliders (master/music/sfx, mirroring Fall Guys' own three-way split).
- `<VideoPanel>` — resolution/quality/vsync-equivalent controls, plus (own judgment, flagged as
  such — no reference game's researched material broke this out distinctly, per the inventory's own
  "flagged as a gap in this file's own research coverage" note) a camera-shake/motion-reduction
  toggle, justified by this project's own spring-arm camera and ragdoll-spin-heavy feel.
- `<SensitivitySlider>` — reused inside `<ControlsPanel>`; a generic enough primitive it's also the
  right shape for `<AudioPanel>`'s volume sliders (one shared slider component, not two).

**Reusability.** Tokens (§2.1a) carry the toggle/slider look consistently. The Track builder
already has its own inline UI needs (gizmo mode toggles, snap-tier controls per ADR 0034) that are
conceptually the same *interaction* as a Settings toggle — a shared *pattern* (§2.1b: "a toggle/
segmented-control that looks like it belongs to this game") is a legitimate, low-cost target even
though the Track builder's actual toggle markup will never import this Screen's component.

**Anti-slop application.** Settings screens are one of the most template-shaped Screens in any
app — the single highest risk here is default browser-native-feeling toggle switches and sliders
(literally the least-designed UI element in most products). Per §1.2's "physical materials"
point, a toggle that visibly "snaps" with a small overshoot (motion consistent with everything else
in this game being about physical snapping and settling, not smooth linear tweens) is a small,
cheap way to make even this most-generic-by-default Screen feel specific to this game rather than
copy-pasted from a UI kit.

### 3.7 Account / registration — `named, unscoped`, priority: nice-eventually

**Wireframe.** The strongest reference here is a negative one, already surfaced by the inventory:
Golf With Your Friends ships with "no accounts beyond platform (Steam) identity" (`docs/research/
screens-inventory.md` §4) — a real, successful data point that a small party game doesn't need this
Screen at all for a long time, matching this project's own current state, where "`authorId` is a
single hardcoded constant for now" (`docs/adr/0032-track-publishing-mocked-author-immutable-
revisions.md`, cited by the inventory) and M4.md explicitly excludes accounts. Because there is
genuinely no shipped reference for *this exact game's* eventual account Screen (nicknames already
exist via the Lobby, so "registration" here likely means claiming a nickname or linking a platform
identity, not a traditional email/password form), this wireframe is reasoned from first principles,
labeled as such: a minimal two-path Screen — "Continue as Guest" (large, primary, since §3.10 argues
this is the actual default path for a long time) and a smaller "Create Account / Sign In" path
below it, never the reverse emphasis. No multi-step wizard, no email-verification flow speculated
here — genuinely undecided, and inventing wizard steps for a feature with zero product decision
behind it yet would be worse than saying so.

**Components.**
- `<AccountScreen>` — route-level; the two-path layout above.
- `<GuestContinueAction>` — reuses the nickname-entry concept already implicit in the Lobby's
  "nickname label" (M4.md) — worth being the *same* nickname-entry component wherever it appears
  (§2.1b pattern, or even literal component reuse within `apps/client`'s own React tree, which is
  the one case in this whole document where actual code-level reuse across Screens, not just
  patterns, is legitimate, since both live in the same React app).
- `<AuthForm>` — deliberately left unspecified beyond "identity fields, a submit action" — no
  invented field list, per the reasoning above.

**Reusability.** `<GuestContinueAction>`'s nickname-entry UI is the one clear case of literal
component reuse in this document, shared between this Screen and the Lobby, since both are React
and both live in `apps/client`. No HUD or Track-builder crossover — neither surface has any
identity concept at all.

**Anti-slop application.** The generic tell to avoid here is the default SaaS-signup template
(centered card, "Sign up" / "Log in" tab switcher, social-icon row) — appropriate for a productivity
app, tonally flat for a game whose whole identity is physical slapstick. Per §1.2, even this
utilitarian Screen can carry a trace of the "hilarious when you fail" identity in copy/microcopy
(a nickname-collision error message can be funny rather than a bare "username taken") without
needing new visual chrome.

### 3.8 The Bet screen — `named, unscoped`, priority: mechanic-gated

**Wireframe.** The inventory is explicit and correct: "none of Fall Guys, Trackmania, or Golf With
Friends has anything resembling spectator betting" and "no reference game's screen layout to crib
from" (`docs/research/screens-inventory.md` §2). This document's own search confirms the same gap —
no shipped party/racing game surfaced a betting-on-a-live-match mechanic during this research pass.
Reasoning from first principles only, clearly labeled: the nearest *structurally* similar UI (not
tonally, just structurally — a live event with a small number of discrete outcomes and a
prediction commitment) is a sports-book "who wins" market, but that reference is deliberately not
imported wholesale here since prediction-market/gambling-app visual conventions (odds tickers,
stake sliders) would clash badly with this game's own slapstick identity per §1.2 — a mismatch this
document flags rather than resolves. Layout, first-principles: this Screen only exists for an
already-eliminated Player in Spectator Mode (`CONTEXT.md` "Spectator Mode"), so it should overlay
the live spectator camera view (structurally similar to §3.3's Countdown overlay: UI drawn over a
still-live game render, not a full route away from it) rather than replace it — betting on who
wins while *watching* who's winning is the entire point. A simple picker of remaining Characters
(avatar + nickname, no odds/stake mechanics speculated, since CONTEXT.md's own "Bet" entry commits
only to "a prediction... for XP / coins," not a wagering *amount*) with a single confirm action,
then a locked-in state showing the pick until Round end.

**Components.**
- `<BetOverlay>` — mounted only during Spectator Mode; `remainingCharacters: {id, nickname}[];
  onPick: (id) => void`.
- `<CharacterPickList>` — the picker itself; visually similar to `<LobbyPlayerList>` (§3.2) since
  both are "a list of Characters to choose/act on," a legitimate §2.1b pattern echo even though the
  interaction differs (select-one vs. ready-toggle-many).
- `<BetLockedBadge>` — shows the locked-in pick post-confirm.

**Reusability.** No shared logic candidate yet (no XP/coin economy exists anywhere in this project's
docs per the inventory's own note — "an XP/coin economy is implied the moment Betting ships"), so
this is pattern-only reuse (§2.1b) against `<LobbyPlayerList>` and, if built, §3.16's wallet
display. No HUD or Track-builder crossover — Spectator Mode has no analog in either.

**Anti-slop application.** Precisely because there's no reference to lean on, this is the Screen
most at risk of reaching for a generic "prediction market" template out of not having anything else
to copy — the anti-slop discipline here (per Zhou, §1.1) is to deliberately *not* import gambling-
app visual conventions (odds tickers, glowing "place bet" CTAs, chip-stack iconography) just
because they're the closest existing genre, and instead let the actual constraint (a single pick,
for flavor stakes, made by someone already out of the Round and just watching) produce something
plainer and more playful — closer to picking a favorite at a party than placing a wager.

### 3.9 Tutorial / controls-intro Screen — `proposed`, priority: mechanic-gated / nice-eventually

**Wireframe.** The inventory's own counter-evidence is the strongest reference: "neither Fall Guys
nor Golf With Friends gate players behind a mandatory tutorial Screen — both drop players straight
into a lobby/menu" (`docs/research/screens-inventory.md` §3). That's a real, cited data point
against a dedicated Screen at all. First-principles layout for the lightweight alternative the
inventory itself leans toward ("a lightweight in-HUD hint may be enough"): not a Screen in the
ADR-0008 sense at all, but a small, dismissible first-Round overlay drawn by the HUD's own plain-DOM
layer (a short list of controls — WASD / Space / Shift-dash / mouse-look, matching the exact
control line already present in the HUD's own current text, `apps/client/src/main.ts`'s
`\`WASD move · Space jump · Shift dash · mouse look\`` line) that fades after the first few seconds
of movement input, never blocking play.

**Components.** If it stays HUD-shaped, there are no React components at all — this is worth
stating plainly rather than inventing a `<TutorialOverlay>` React component for a thing that
structurally shouldn't be one. If a fuller onboarding flow is ever justified (e.g. once Grab and
Power-ups exist, per CLAUDE.md's roadmap), it would be a genuine `<OnboardingScreen>` sequence, but
nothing in this project's docs justifies that scope yet — flagged, not invented.

**Reusability.** If HUD-shaped: shares the HUD's own plain-DOM/no-React-cost profile (§2.2)
entirely — literally the same technical bucket as the HUD itself. If it ever became a real Screen,
tokens only (§2.1a).

**Anti-slop application.** The genre-generic tell to avoid is a mandatory, multi-step "Welcome!"
carousel with progress dots — a pattern this game's own cited references (Fall Guys, Golf With
Friends) explicitly don't use, and one that runs directly against CLAUDE.md's "Easy to understand"
philosophy: if the controls need a multi-screen tutorial to explain, that's itself a design smell
this document flags rather than solves.

### 3.10 Guest/nickname-only play as a first-class permanent path — `proposed`, priority: ship-blocking (decision, not new Screen)

**Wireframe.** Not a new Screen per the inventory's own framing — it's a decision about how
`<GuestContinueAction>` (§3.7) and the Lobby's existing nickname label (M4.md) behave, made
explicit rather than reached by omission. Golf With Your Friends is again the direct precedent: a
shipped, successful game running entirely on platform identity with no bespoke account system
(`docs/research/screens-inventory.md` §4). First-principles layout consequence: the nickname-entry
UI (wherever it lives — Main menu, Lobby, or a pre-Lobby step) must handle nickname collisions
gracefully within a single Lobby (two "Alex"s at once) without implying a persistent, globally
unique identity the game doesn't have — e.g. a silent per-Lobby disambiguation suffix rather than a
blocking "this name is taken" error, since there is no account system to make "taken" a meaningful
global concept.

**Components.** No new component beyond what §3.2 (`<LobbyPlayerList>`) and §3.7
(`<GuestContinueAction>`) already define — this entry exists to record the constraint those
components must satisfy (nickname is per-Lobby, not globally reserved), not to add new UI surface.

**Reusability.** N/A beyond what's already covered under §3.2/§3.7 — this is a behavioral
constraint on existing components, not new reusable material.

**Anti-slop application.** N/A directly — no new visual surface. The one relevant discipline: don't
retrofit account-style UI chrome (a "username" field with live-availability-checking, a pattern
borrowed from account-based products) onto what's actually a lightweight per-Lobby nickname —
that mismatch would itself be a slop tell (a UI pattern imported from a different kind of product
than what's actually being built, echoing §1.1's core point about defaults chosen without a reason).

### 3.11 Profile / stats-summary Screen — `proposed`, priority: mechanic-gated on Account/registration

**Wireframe.** No direct reference game researched surfaced a profile Screen distinct from a
results/match-history view worth citing separately from §3.23's Match history (own judgment: Fall
Guys and Golf With Friends' own researched material, per the inventory, didn't break this out as a
separate Screen from account-linked stats generally). First-principles layout, gated on
Account/registration existing at all (§3.7): a header (nickname, any chosen Character/skin per
§3.15), then a small set of stat tiles drawn directly from vocabulary this project already
computes at Round end — falls, Qualification rate, wins — per `CONTEXT.md`'s own Fall/Qualification
terms, exactly as the inventory itself notes ("Content would draw on CONTEXT.md's own Fall/
Qualification vocabulary"). No invented stats beyond what Results already produces per Round
(`docs/milestones/M4.md`: rank, finish time, falls) — a profile is that same data aggregated over
many Rounds, not a new data source.

**Components.**
- `<ProfileScreen>` — route-level, gated behind having an Account at all.
- `<StatTile>` — `label, value` generic tile; reused across falls/Qualification-rate/wins, and
  the same primitive §3.22 (Leaderboards) and §3.23 (Match history) can draw from.
- `<CharacterBadge>` — shows the Player's currently equipped skin (§3.15 crossover) if that ships.

**Reusability.** `<StatTile>` is a real cross-Screen pattern candidate (§2.1b) shared with §3.22/
§3.23 — same visual primitive, three separate Screens' worth of different data behind it. No HUD or
Track-builder crossover.

**Anti-slop application.** The classic generic-tell here is a dashboard of identical KPI tiles in a
uniform grid (directly matching Krebs' "stat banner rows" tell, §1.1). Per §1.2, weighting the
tiles by what's actually funny/notable about *this* Player (most falls in one Round, longest
Qualification streak) rather than uniform equal-size tiles is the concrete antidote — the data this
project already tracks (falls!) is inherently more colorful than a generic "games played" counter.

### 3.12 Friends list / party Screen — `proposed`, priority: nice-eventually

**Wireframe.** Fall Guys ships "Lobbies & Friends list" as a named feature (`docs/research/
screens-inventory.md` §4, cross-platform-progression source); Golf With Friends' whole name and
Host/Join flow implies the same social layer without a dedicated Screen name being sourced
separately. M4's own Lobby spec explicitly defers "party codes/links, chat, private/public
toggles" (`docs/milestones/M4.md`) — confirmed deferred, not confirmed unnecessary, per the
inventory. First-principles layout for when it's built: a simple list (online friends, invite
action per friend, a "create/join party" affordance) that feeds *into* the Lobby rather than
replacing it — a party is a group that then joins one Lobby together, not a separate persistent
room of its own (no reference game researched suggested otherwise).

**Components.**
- `<FriendsScreen>` — route-level list.
- `<FriendRow>` — `nickname, onlineStatus, onInvite`.
- `<PartyBar>` — a persistent, small cross-Screen strip (visible from Main menu and Lobby) showing
  current party members — this is the one component here that structurally has to live outside a
  single route, more like a header/chrome element than a Screen-local component.

**Reusability.** Pattern-shared with `<LobbyPlayerList>` (§3.2) — a friend row and a lobby-player
row are visually the same idea (nickname + status + one action) at different points in the flow.
No HUD/Track-builder crossover (no social concept exists in either).

**Anti-slop application.** The generic tell is a social-app-borrowed layout (online/offline dots,
a "Discord-style" sidebar) grafted onto a party racing game without adjustment. Per §1.2, this
Screen benefits from being visually subordinate to the *game* content rather than looking like a
lifted messaging-app panel — small, corner-anchored, not a dominant Screen of its own.

### 3.13 In-lobby/in-match chat or quick-emote system — `proposed`, priority: nice-eventually, genre-generic

**Wireframe.** The inventory itself labels this "generic genre observation... not tied to one
specific reference game's mechanic." This document's own research didn't surface a stronger
citation either — treated as first-principles from here. Given CONTEXT.md's HUD constraint (plain
DOM, per-frame) and this game's already-established input surface (WASD + mouse-look leaves little
free input for typed chat mid-Round), the more plausible shape for the *in-match* half of this is a
quick-emote wheel (a small radial or row of preset reactions bound to an unused key/button),
structurally similar to party-game quick-chat wheels broadly common in the genre (no single game
cited — acknowledged as an unsupported generic convention, not a specific borrowed layout). The
in-Lobby half is more conventional: a simple scrolling text chat panel beside the player list,
matching the kind of thing M4.md defers ("chat... deferred, not confirmed unnecessary" per the
inventory).

**Components.**
- `<LobbyChatPanel>` — `messages: {nickname, text, at}[]; onSend`.
- `<QuickEmoteWheel>` — HUD-adjacent, not a Screen component at all if it fires mid-Round (same
  reasoning as §3.9's tutorial hint: mid-Round UI is HUD territory per ADR 0008, not React).

**Reusability.** `<LobbyChatPanel>` has no cross-surface pattern candidate worth naming (chat UI is
generic enough that forcing a "shared pattern" claim here would be manufactured, not real). The
in-match emote wheel shares the HUD's technical bucket (§2.2) exactly like §3.9.

**Anti-slop application.** A generic chat-bubble UI (rounded speech bubbles, avatar-left message
list) is fine and low-risk here since chat is inherently utilitarian — the higher-value anti-slop
move is on the *emote wheel*, where using this game's own already-established physical-comedy
vocabulary (an emote that's literally a stumble/wobble animation, not a generic emoji) is both
on-identity and something no other game's chat system would produce.

### 3.14 Private-lobby-via-code Screen/flow — `proposed`, priority: nice-eventually

**Wireframe.** Two strong, directly-applicable references: Fall Guys' Share-Code + Lobby-Code split
("a host redeems a code for a private lobby... friends join via a separate Lobby Code,"
`docs/research/screens-inventory.md` §4) and Jackbox Party Pack's simpler single-code model — "the
game will display a four-letter room code at the top of the screen... Players enter in the 4-letter
room code being displayed" ([jackboxgames.com, How to Play](https://www.jackboxgames.com/how-to-play),
accessed 2026-09-04) plus a QR-code scan-to-join shortcut on top of the same code
([Jackbox TV room codes overview](https://smart.columbus.gov/columbus-news/jackbox-tv-room-codes-your-guide-to-joining-the-party-1764797795),
accessed 2026-09-04, secondary/corroborating). Jackbox's model is the better fit for this project's
actual scale (2-12 players, ADR 0011) than Fall Guys' two-tier Share-Code/Lobby-Code system, which
exists to manage up to 40 players across sub-lobbies — unneeded complexity here. Layout: a
prominent, large, easy-to-read code displayed once a Lobby is created (matching Jackbox's own "code
stands out against the background, making it nearly impossible to overlook"), a single text-entry
field plus "Join" action on the other side, and — cheap to add given Jackbox proves its value — a
QR code alongside the text code for same-room mobile joins.

**Components.**
- `<LobbyCodeDisplay>` — `code: string`; large, copyable, with an optional `<QRCode>` render.
- `<JoinByCodeForm>` — `onSubmit: (code) => void`; lives on the pre-Lobby Create/Join Screen
  (§3.19), not inside the Lobby itself.

**Reusability.** No shared logic beyond the code-generation function itself, which is a small,
pure, genuinely shareable §2.1c candidate if it ever needs to be validated/formatted the same way
client-side and server-side. No HUD/Track-builder crossover.

**Anti-slop application.** Low risk generically (a room-code UI is inherently simple and hard to
over-decorate), but the QR/code-display moment is a good place for the same physical "landing"
motion (§1.2) other cards use, so the whole app reads as one system rather than this one Screen
feeling imported wholesale from Jackbox's own visual style.

### 3.15 Character/skin-select Screen — `proposed`, priority: nice-eventually

**Wireframe.** Both Fall Guys and Golf With Friends treat "visual self-expression as close to
table-stakes for this genre" (`docs/research/screens-inventory.md` §3), and Golf With Friends'
own cosmetic model — "ball skins/hats/trails, all earned, explicitly no microtransactions" (per
the inventory's §4, Steam-page-sourced) — is the more relevant precedent for this project than Fall
Guys' shop-driven model, since neither this project's docs nor CLAUDE.md mention any monetization
intent. This project also already has multiple playable-looking Character models with zero
selection UI — "a MushroomKing character model swap" (CLAUDE.md's own status log, cited by the
inventory) — meaning this Screen's job on day one may be as simple as picking between models that
already exist as assets, not a whole cosmetics pipeline. Layout: a grid or horizontal carousel of
available Character models with a live-rotating 3D preview (reusing the same render pipeline the
game already has, not a static icon — this project's actual 3D assets are a real asset a flat image
grid would waste, echoing the same point made for the Main menu's background in §3.1), a single
"Select" confirm action, and — if any are locked (mechanic-gated on §3.16/§3.17 existing) — a
distinct locked visual state rather than hiding them.

**Components.**
- `<CharacterSelectScreen>` — route-level, or a Lobby sub-panel (undecided; either wiring is valid
  since it's the same data either way — flagged as an open placement question, not resolved here).
- `<CharacterPreview>` — `modelId: string`; mounts a small live 3D render.
- `<CharacterGrid>` — `models: {id, name, locked}[]; selected; onSelect`.

**Reusability.** The 3D-preview rendering approach (mounting a lightweight Three.js scene for one
model) is architecturally close to what `<MenuBackground>` (§3.1) already needs and to the Track
builder's own live Three.js viewport (`apps/track-builder`'s `#viewport`) — not shared *code*
(different apps, different React/vanilla-TS boundary per §2.1), but the same underlying idea
("mount a small Three.js scene inside a UI panel") is worth solving once as a documented pattern
each surface implements for itself.

**Anti-slop application.** The tell to avoid is a generic "character select carousel" lifted
wholesale from any fighting-game UI kit (chevron arrows, a stat-bar comparison panel implying combat
balance this game doesn't have). Per §1.2, since these models are cosmetic-only and this game's
tone is slapstick, the panel should read as playful, not competitive — no invented "stats" per
Character that don't exist mechanically.

### 3.16 Cosmetics shop / currency Screen — `proposed`, priority: mechanic-gated

**Wireframe.** Two directly opposed, both-cited precedents: Fall Guys' "Show-Bucks/Fame-Pass model"
(paid + earned currency feeding a shop) versus Golf With Friends' "no microtransactions, all
earned" model (`docs/research/screens-inventory.md` §3, both citing §4's sourcing). The inventory
is explicit that "no evidence in this project's own docs" points to an economy being intended at
all — this Screen is fully speculative pending that decision, and this document does not pick a
side; it lays out the shared *shape* both precedents agree on regardless of monetization stance:
a grid of purchasable/earnable items (reusing `<CharacterGrid>`'s exact layout idea from §3.15,
since a shop is structurally "the locked half of Character/skin-select plus a price"), a currency
balance displayed persistently in a corner (relevant to §3.17's wallet too), and item detail on
selection (preview + cost + owned/equip state).

**Components.**
- `<ShopScreen>` — route-level.
- `<CurrencyBalance>` — `amount: number; currency: "coins" | "xp"`; the same component §3.8's Bet
  screen and §3.17's progression Screen would also need — a genuine shared-pattern anchor point
  across three otherwise-unrelated proposed Screens.
- `<ShopItemGrid>` / `<ShopItemDetail>` — mirrors `<CharacterGrid>`/`<CharacterPreview>` from §3.15
  almost exactly, reinforcing that this Screen and Character-select are the same visual family.

**Reusability.** Strong pattern reuse (§2.1b) against §3.15 (item grid) and shared component
candidate (§2.1, literal React reuse within `apps/client`) for `<CurrencyBalance>` across this
Screen, §3.8, and §3.17 — three proposed Screens that would otherwise each reinvent the same small
balance widget.

**Anti-slop application.** Shop UIs are one of the most heavily genre-converged UI categories that
exist (grid-of-cards-plus-price is close to a universal default) — precisely the kind of Screen
where §1.1's "safe average" risk is highest because the *category itself* is a template. The
concrete defense per §1.2 is tying the shop's currency and framing back to this game's own
"hilarious when you fail" identity (e.g., currency named/flavored around falling or chaos rather
than a generic "Coins," which Golf With Friends' and Fall Guys' own currencies both already do in
their own voice — "Show-Bucks" — proof this is a real, low-cost lever every precedent already
pulls).

### 3.17 XP/leveling or Season-Pass-style progression Screen — `proposed`, priority: mechanic-gated on Betting

**Wireframe.** The inventory correctly notes this is "the one economy-adjacent Screen with actual
textual grounding in this project's own docs" via CONTEXT.md's "Bet" entry committing to "for XP /
coins." Battle-pass/season-pass conventions researched fresh here: a horizontal tiered track is the
dominant shape across every major implementation surveyed — Fortnite's "tiered progression (100
levels), XP-based unlocks... Free vs Paid tracks," and Overwatch 2's redesign replacing one long
linear track with "a set of shorter tracks you can complete in any order... each running roughly
8 to 10 tiers" (both via [Overwatch 2 Battle Pass overview](https://allthings.how/overwatch-season-4-battle-pass-how-tracks-and-tier-hacks-work/)
and the [Battle pass Wikipedia overview](https://en.wikipedia.org/wiki/Battle_pass), both accessed
2026-09-04). Given this project's own economy is entirely undecided beyond "for XP/coins" (no paid
tier implied anywhere in this project's docs), the applicable shape is Overwatch 2's simpler
short-track model, not Fortnite's dual free/paid-track complexity — a single horizontal row of
tiers, each revealing a reward icon on unlock, with the current-tier marker and progress-to-next-
tier bar as the primary focal element.

**Components.**
- `<ProgressionScreen>` — route-level.
- `<TierTrack>` — `tiers: {level, reward, unlocked}[]; currentLevel`; the horizontal scrollable
  track itself.
- `<CurrencyBalance>` — reused verbatim from §3.16 (same component, same widget).
- `<TierRewardDetail>` — shown on selecting a tier; mirrors `<ShopItemDetail>` (§3.16) closely
  enough to be the same underlying pattern (a reward preview + its unlock condition).

**Reusability.** High pattern overlap with §3.16 (reward-detail pattern) and literal component
reuse of `<CurrencyBalance>`. No HUD/Track-builder crossover — nothing here has any in-Round or
Track-authoring analog.

**Anti-slop application.** Same core risk as §3.16 — the tiered-track shape is itself a heavily
converged template — the same defense applies: tie tier rewards and milestone framing to this
game's own Fall/Checkpoint/Qualification vocabulary rather than a generic "Level 12" label with no
game-specific voice.

### 3.18 Matchmaking / server browser — `proposed`, priority: ship-blocking eventually, can stay minimal

**Wireframe.** Both cited reference games argue against building a traditional server browser at
all: Fall Guys is "queue-based matchmaking only," Golf With Friends is "flat Host/Join, no
matchmaking" (`docs/research/screens-inventory.md` §3/§4, both citing already-fetched sources) —
"real data point against building one here either." First-principles layout for the minimal version
this argues for: not a Screen at all in the traditional server-list sense, but a single "Find Match"
action (if/when automated matchmaking is ever built) that transitions straight into a Lobby once
matched, with at most a lightweight searching-state indicator (elapsed time, players found so far)
rather than a filterable server list — matching the "stay minimal" framing directly.

**Components.**
- `<FindMatchAction>` — a single button, likely folded into Main menu (§3.1) rather than its own
  route.
- `<MatchmakingStatus>` — `elapsedSeconds, playersFound`; a small transient overlay, not a full
  Screen, shown between pressing Find Match and arriving in a Lobby.

**Reusability.** Minimal — this Screen barely exists per the research above. `<MatchmakingStatus>`
shares its "transient, non-blocking overlay" shape with §3.3's Countdown overlay conceptually
(both are "a small live-status element shown briefly over/before real content"), a loose pattern
echo worth naming even though the two serve very different moments.

**Anti-slop application. ** The generic tell to actively avoid, precisely because it's the industry
default for anything called "matchmaking," is a filterable data-grid server-browser UI (region/
ping/player-count columns) — both cited references prove this genre doesn't need it, and building
one anyway would be importing an unrelated genre's convention (traditional FPS server browsers)
wholesale, the same "borrowed pattern with no reason" failure mode named in §1.1.

### 3.19 Create/Join private match Screen — `proposed`, priority: nice-eventually

**Wireframe.** Distinct from Lobby itself per the inventory's own framing: "a step *before* Lobby
where a host picks 'create' vs. 'join by code'" — directly mirroring both Fall Guys' Share-Code
flow and Golf With Friends' Host/Join split (`docs/research/screens-inventory.md` §3, both already
cited in §4). Layout: a simple two-button fork (Create / Join) reached from Main menu's Play action
(§3.1) — Create leads straight into a fresh Lobby with a generated code (§3.14's
`<LobbyCodeDisplay>`); Join surfaces `<JoinByCodeForm>` (§3.14) inline rather than as its own
sub-screen, keeping this whole flow to at most two taps before a Lobby.

**Components.**
- `<CreateOrJoinScreen>` — route-level, the fork itself.
- Reuses `<LobbyCodeDisplay>` and `<JoinByCodeForm>` from §3.14 directly (literal component reuse,
  same React app).

**Reusability.** Essentially all of this Screen's substance is §3.14's components reused in place —
this entry mainly exists to record *where in the flow* that code lives, not to introduce new UI.

**Anti-slop application.** Low risk — this is a two-button fork with almost no surface for
decoration to go wrong. The one relevant point from §1.2: keep it exactly that simple (two buttons)
rather than padding it with unrelated promotional content to make the Screen feel less empty
(the same "inventing filler" trap flagged in §3.1).

### 3.20 Spectating a match in progress — `proposed`, priority: mechanic-gated

**Wireframe.** Explicitly distinct from the already-named Spectator Mode (`CONTEXT.md`'s camera
state for an *eliminated* Player mid-Round) — this is a late-joining friend or pure observer with no
Character in the Round at all, and the inventory found "no camera/UI concept named anywhere for
this case." No reference game researched surfaced a strongly citable precedent distinct from
generic broadcast/observer-mode conventions common across esports titles broadly (not attributed to
one specific researched game — flagged as an unsupported generic convention, consistent with how
this document treats §3.13's chat wheel). First-principles layout: a free/cycling camera similar to
what Spectator Mode already needs for an eliminated Player (real reuse opportunity — the *camera
behavior*, not the UI chrome, per CONTEXT.md's existing Spectator Mode definition), plus a minimal
overlay listing remaining Players to jump the camera between, and explicitly no HUD elements that
imply control (no Dash cooldown, no checkpoint splits — those belong to a Character being
controlled, which this observer has none of).

**Components.**
- `<SpectateOverlay>` — `characters: {id, nickname}[]; onFollow: (id) => void`; structurally close
  to `<CharacterPickList>` (§3.8) — another "pick a Character from a live list" pattern.
- No dedicated route Screen necessarily — like Countdown (§3.3) and the emote wheel (§3.13), this
  likely renders over the live game view rather than as a separate routed page, and is arguably
  HUD-adjacent plain DOM rather than React for the same per-frame-camera-following reason as §3.3.

**Reusability.** Camera-following logic itself, if it already exists for eliminated-Player
Spectator Mode, is the real reuse target here (§2.1c, assuming it's implemented as plain logic
rather than tightly coupled to the eliminated-Player code path) — worth flagging for whoever
implements Spectator Mode to keep that behavior generalizable to a non-eliminated observer from the
start, rather than needing a later refactor.

**Anti-slop application.** Same reasoning as §3.13/§3.3: minimal, non-blocking overlay chrome,
not a full dashboard — an observer's job is to watch the physical chaos this game is actually about,
so the overlay itself should recede rather than compete for attention.

### 3.21 Player-facing Track browser/gallery — `proposed`, priority: nice-eventually, escalating

**Wireframe.** Trackmania's Track Of The Day is the strongest, most directly relevant precedent
available for this exact concern, and the inventory already argues persuasively for why: "this
project is a Track-authoring game (M3) as much as a Fall-Guys-style Match game, making the
Trackmania analogy stronger here than the Fall Guys one" — a featured, rotating community Track
with its own leaderboard ([What is a Track Of The Day?](https://doc.trackmania.com/play/what-is-totd/),
accessed 2026-09-04 per the inventory's own §4). Fall Guys' own Show Selector with "Creator Round
Playlists" (already cited, §3.2) is the secondary reference for the *browsing* half specifically
(filtering/curating many Tracks, vs. TOTD's single-featured-item model). Layout, combining both: a
featured "Track of the moment" hero slot at the top (Trackmania's model, since this game's own
generator — M3's track-service, per CLAUDE.md's status — can produce fresh rotating content the
same way TOTD does), then a filterable/searchable grid beneath it of the full catalog (Fall Guys'
playlist-picker model), each entry showing the same preview-card visual (§2.1b, shared with
`<TrackPicker>` in §3.2 and the Track builder's own `#palette`/`#browse` panels) at larger scale
with more metadata (author, best time, play count).

**Components.**
- `<TrackBrowserScreen>` — route-level.
- `<FeaturedTrackHero>` — `track: TrackListing`; the TOTD-style slot.
- `<TrackGrid>` / `<TrackCard>` — the filterable catalog; `<TrackCard>` is the large-scale sibling
  of §3.2's `<TrackPicker>` card and the Track builder's Module-preview cards — one visual idea,
  three separate implementations across two apps and one Screen family.
- `<TrackFilterBar>` — `filters: {...}; onChange`.

**Reusability.** The strongest §2.1b case in this whole document: the "Track/Module as a preview
card" pattern spans this Screen, the Lobby's `<TrackPicker>` (§3.2), and the Track builder's own
`#palette` Module list and `#browse` Track list (`apps/track-builder/index.html`'s existing panel
structure, confirmed by direct read) — three genuinely separate codebases (React Screen, React
Screen, vanilla-TS tool) that should still look like one visual language.

**Anti-slop application.** The generic tell is an undifferentiated content-grid (identical
thumbnail cards, a generic "sort by" dropdown) indistinguishable from any marketplace UI. Per §1.2,
since this game's Tracks are themselves physically distinctive (Modules like Spinner, Ice, Moving
Platforms — `CONTEXT.md` "Module"), preview art that actually shows the Track's own geometry/motion
(a short looping render, not a static screenshot) is both more useful and impossible to mistake for
a generic template, echoing the same "use the game's own 3D content instead of stock imagery" point
made for §3.1 and §3.15.

### 3.22 Leaderboards — `proposed`, priority: nice-eventually, higher-value than convention suggests

**Wireframe.** Trackmania's TOTD leaderboard model is the direct, well-evidenced precedent the
inventory already names: each rotating Track carries "its own 24-hour leaderboard" (`docs/research/
screens-inventory.md` §3/§4, [doc.trackmania.com](https://doc.trackmania.com/play/what-is-totd/),
accessed 2026-09-04). The inventory's own reasoning for why this is higher-value than generic genre
convention suggests is worth repeating here since it directly shapes the layout: "the Results Screen
already computes finish time and Track progress per CONTEXT.md — a per-Track best-time leaderboard
is a natural extension of data already computed at Round-end." Layout: reuses §3.5's
`<ResultsRow>` visual shape almost exactly (rank, nickname, time) but scoped per-Track rather than
per-Round, reached from that Track's own card in §3.21's browser (a natural "view leaderboard" action
on `<TrackCard>`) rather than as a standalone globally-browsable Screen with no entry point.

**Components.**
- `<TrackLeaderboardScreen>` — `trackId: string`; route-level, or a modal/panel launched from
  `<TrackCard>` (§3.21) rather than a full separate route — an open placement question, same
  caveat as §3.15's.
- `<LeaderboardRow>` — near-identical in shape to `<ResultsRow>` (§3.5) and `<StatTile>`'s sibling
  list form (§3.11) — the same "ranked row" primitive recurring a third time.

**Reusability.** The finish-time formatting/sorting logic flagged as a §2.1c candidate under §3.5
is the exact same logic this Screen needs — the single strongest plain-logic reuse case in this
document, since a per-Track leaderboard and a per-Round Results list are the identical
computation (sort by finish time) over a different data scope.

**Anti-slop application.** Low novel risk since this reuses §3.5's already-considered row design;
the one addition worth naming is Trackmania's own "time-boxed" framing (a 24-hour rotation) — if
adopted, surfacing the countdown-to-reset visibly (rather than a bare list with no sense of
urgency) is what makes a leaderboard feel alive rather than a static table, consistent with §1.2's
motion-with-personality point.

### 3.23 Match history Screen — `proposed`, priority: nice-eventually, lower than leaderboards

**Wireframe.** The inventory is explicit that "none of the three reference games surfaced a
dedicated match-history Screen distinct from a stats/profile Screen" — this is acknowledged pure
genre speculation, and this document's own research didn't surface a stronger citation either.
First-principles layout: a reverse-chronological list of past Rounds (Track played, outcome,
finish time or DNF, falls) — structurally the closest thing in this whole catalog to §3.5's
`<ResultsList>` replayed over time rather than shown once, which is the honest way to describe this
Screen: it's Results, persisted and listed.

**Components.**
- `<MatchHistoryScreen>` — route-level, gated on Account/registration existing (no persistent
  history without an account to attach it to).
- `<MatchHistoryRow>` — same shape as `<ResultsRow>` (§3.5) plus a Track name/date; the same
  "ranked/outcome row" primitive recurring a fourth time across this document (§3.5, §3.11's list
  form, §3.22, here) — strong evidence this primitive is worth designing once, well, rather than
  once per Screen.

**Reusability.** Directly reuses §3.5's row pattern and the same finish-time formatting logic
flagged under §3.5/§3.22 (§2.1c). No new reusable material beyond what those two entries already
establish.

**Anti-slop application.** Nothing new beyond §3.5's own treatment — this Screen's entire
anti-slop posture is "don't diverge from the Results row design for no reason," which is itself the
correct anti-slop move (consistency instead of each Screen reinventing its own row style, the same
"safe-average-per-Screen" failure mode at a smaller scale).

### 3.24 Accessibility settings — `proposed`, priority: judgment call, not confidently bucketed

**Wireframe.** The inventory flags this honestly as a research gap, not a confirmed absence: "no
reference game's researched material broke this out as a distinct sub-screen... flagged as a gap in
this file's own research coverage." This document's own fresh research (Fall Guys' and Among Us'
settings structure, §3.6) also didn't surface a distinct accessibility tab in either — both fold
motion/subtitle-style options (where they exist) into general Video/Graphics settings rather than a
separate Screen. Given that, and given the inventory's own reasoning that "this game leans heavily
on physical camera movement (spring-arm camera, free-look, ragdoll spins... camera/motion
accessibility options are a plausible real need," the most defensible layout (own judgment) is
**not** a separate Screen at all but a distinct, clearly-labeled section within `<VideoPanel>`
(§3.6) — camera-shake intensity, FOV, colorblind palette swap, subtitle/caption sizing (once there's
any text-driven content to caption) — promoted to its own top-level Settings tab only if it grows
past what a single panel section can hold.

**Components.**
- `<AccessibilitySection>` — nested inside `<VideoPanel>` (§3.6) initially; `<CameraShakeSlider>`,
  `<ColorblindModeSelect>`, `<SubtitleSizeSlider>` as its child controls, each reusing the same
  `<SensitivitySlider>` primitive already defined for §3.6's control-rebinding panel.

**Reusability.** Entirely nested reuse of §3.6's own components and tokens — no new primitives.

**Anti-slop application.** The risk here is treating accessibility as a checkbox-compliance
afterthought (a bare list of toggles with no visual care, itself a kind of generic default). Per
§1.2's restraint point, giving these controls the same motion/interaction quality as every other
control in `<ControlsPanel>`/`<AudioPanel>` — not a visually second-class section — is the concrete
antidote.

### 3.25 Disconnect/error/reconnect Screen(s) — `proposed`, priority: ship-blocking for two of three sub-cases

**Wireframe.** No single shipped-game precedent cleanly covers all three sub-cases the inventory
splits out, so each is treated with its own grounding. General disconnect-UI research (surveyed
2026-09-04 across Roblox DevForum threads and general game-UI discussion, all secondary/community
sources rather than an official design doc, flagged as such) converges on one clear pattern for
severe disconnects: a **modal, center-screen, blurred-background message that cannot be
missed or mistaken for still-being-connected** — explicitly contrasted with an earlier, rejected
pattern of "a red bar... but players could still run around... confusion about whether the
connection was actually lost." That one finding is the load-bearing design rule for all three
sub-cases below: never a subtle toast for anything that actually ends the session.

- **(a) Local client error/disconnect** (ship-blocking): full-screen takeover, not a toast — a
  short message plus a single "Return to Main Menu" action. No reconnect-attempt UI speculated,
  since M4.md's own server behavior for this case ("no mid-round rejoin") makes a retry button
  actively misleading.
- **(b) Server full / version-mismatch at join time** (ship-blocking): shown *before* ever entering
  a Lobby, as a takeover on the Create/Join Screen (§3.19) or Main menu (§3.1) itself, with a
  specific, honest message (distinguishing "server full" from "your client is out of date" — a
  version-mismatch message the player can actually act on by reloading/updating, vs. a full-server
  message they can only wait out).
- **(c) Mid-Round disconnect** (nice-eventually per the inventory, since M4.md's own server
  behavior already exists — "removes the Character and records DNF"): the client's *own* screen for
  this, from the disconnected player's perspective, follows the same modal-takeover rule as (a) —
  the player who dropped sees the same "connection lost, return to menu" treatment, not a
  softer in-Round toast, since by definition their Round is already over for them.

**Components.**
- `<ConnectionErrorScreen>` — `kind: "local-disconnect" | "server-full" | "version-mismatch" |
  "mid-round-disconnect"; message: string`; one component, four message variants, since all four
  share the identical modal-takeover shape per the research finding above — inventing four visually
  distinct Screens for what's structurally one pattern would be over-engineering, not thoroughness.
- `<ReturnToMenuAction>` — the single consistent recovery action across all four variants.

**Reusability.** Tokens only (§2.1a) — no pattern or logic worth sharing beyond what
`<ConnectionErrorScreen>` itself already consolidates internally. No HUD/Track-builder crossover
(though the *reasoning* — never a subtle indicator for something session-ending — is worth carrying
into the HUD's own existing connection-loss handling, which today already does something close to
right: `apps/client/src/main.ts` currently sets `hud.textContent = "DON'T FALL — connection
lost\nreload the page to rejoin"` directly in the HUD's plain-DOM text on disconnect, consistent
with "can't be missed," not a subtle indicator — worth noting as an existing behavior already
aligned with this research, not something needing new design work in the HUD itself).

**Anti-slop application.** The main risk is treating an error state as a low-priority afterthought
styled as a bare browser-default alert. Per §1.2, an error screen can still carry this game's
tone — a disconnect message written with a little of "hilarious when you fail"'s voice (without
undermining the seriousness of "you can't rejoin") is a cheap way to keep even a failure state
on-brand rather than defaulting to generic, voiceless system-error copy.

### 3.26 Credits Screen — `proposed`, priority: nice-eventually, low cost

**Wireframe.** Pure genre convention, not strongly evidenced either way by any of the researched
reference games (matching the inventory's own framing) — first-principles layout: a simple,
scrollable list grouped by role/contribution, reached from Main menu's secondary rail (§3.1), no
interaction beyond scroll and back.

**Components.**
- `<CreditsScreen>` — route-level, static content.
- `<CreditsSection>` — `heading, names: string[]`.

**Reusability.** Tokens only (§2.1a) — nothing else meaningfully shareable; this is the lowest-
complexity Screen in the whole catalog.

**Anti-slop application.** Cheap but easy to get right: per §1.2, even a plain scrolling list can
carry a small physical touch (names that "fall" into place as they scroll into view, echoing the
game's own name) rather than a flat fade-in list — low cost, on-identity, better than the generic
default.

### 3.27 Changelog / patch-notes Screen or link — `proposed`, priority: nice-eventually

**Wireframe.** Both Fall Guys and Trackmania maintain active, dated public patch-notes pages as
their primary player-facing communication channel (per the inventory's own citation of Mediatonic's
Gamespot-covered patch notes and Trackmania's own documentation site, both already cited in §3.2/
§3.5/§3.21 above) — and the inventory's own judgment that this is "likely cheaper as a link to an
external page than a built-in Screen" is sound and adopted here rather than re-litigated: this
document does not design a full in-app changelog Screen, only the link/entry-point treatment.

**Components.**
- `<ChangelogLinkAction>` — a single Main-menu secondary-rail item (§3.1's `<SecondaryMenuRail>`)
  that opens an external page in a new tab/window, not an in-app route.

**Reusability.** N/A — deliberately not a Screen with its own components.

**Anti-slop application.** N/A — no new visual surface to get wrong.

### 3.28 Legal (ToS/Privacy Policy) Screen or link — `proposed`, priority: ship-blocking once data/commercial shipping is involved

**Wireframe.** Not sourced to any of the reference games directly during this research pass (the
inventory flags the same gap: "inferred they have one, not confirmed"). First-principles layout,
matching §3.27's reasoning exactly: a link-style entry point (Main-menu secondary rail, or the
Account/registration Screen at the point nicknames/data are first collected, §3.7) to externally-
hosted legal text, not an in-app rich Screen — there's no product reason for this to be anything
more than a link until an actual legal-review need (real personal data collection, real commercial
shipping) exists.

**Components.**
- `<LegalLinkAction>` — same shape as `<ChangelogLinkAction>` (§3.27); reused pattern, arguably
  the same underlying `<ExternalLinkAction>` primitive for both.

**Reusability.** Literal component reuse candidate with §3.27 (`<ExternalLinkAction>` as a shared
primitive taking a label + URL).

**Anti-slop application.** N/A — no new visual surface.

### 3.29 Round-type-aware Results variants — `proposed`, priority: mechanic-gated on Survival/Collect/Team Rounds

**Wireframe.** The inventory itself notes no reference-game research targeted this specific question
during its own pass ("Fall Guys would be the better analog to research next... it wasn't researched
for this specific question"). This document's own research pass also did not add new sourcing here,
consistent with the inventory's own scoping — flagged rather than papered over with an
under-researched claim. First-principles layout for what changes vs. §3.5's base Results: a Team
Round's Results needs a team-grouping level above the individual-row list (two team blocks, each
containing its own ranked rows) rather than one flat list; a Survival Round's Results likely drops
the "finish time" column entirely (Survival has no finish line to time, per `CONTEXT.md`
"Survival": "the last players standing advance") in favor of "time survived"; a Collect Round's
Results substitutes "items collected" for finish time. In every case the underlying `<ResultsRow>`
primitive (§3.5) is reused with a different secondary-stat column, not a redesigned row.

**Components.**
- `<ResultsScreen>` (§3.5) gains a `roundType` prop that swaps which secondary-stat column
  `<ResultsRow>` renders (`finishTime | trackProgress` for Race, `survivedMs` for Survival,
  `itemsCollected` for Collect) and, for Team Rounds, wraps rows in a `<TeamResultsGroup>` —
  `team: string; rows: ResultsRowData[]`.

**Reusability.** Entirely additive to §3.5's own components — no new primitive beyond
`<TeamResultsGroup>`, which itself is just a labeled grouping wrapper around the existing
`<ResultsRow>` list.

**Anti-slop application.** Nothing new beyond §3.5's own treatment — the discipline here is
resisting the urge to redesign Results per Round type just because the data differs; per §1.2's
consistency point (echoed in §3.23), one row language across all Round types is more coherent than
four bespoke Results layouts.

### 3.30 Level-select / theme-select Screen — `proposed`, priority: mechanic-gated, possibly not a Screen at all

**Wireframe.** The inventory is explicit that "'Level themes'... is undefined anywhere in the
project's own docs; no basis to say whether this implies a Screen or is purely Module/Track art
direction." This document's own research adds nothing that resolves that ambiguity — it's
genuinely unscoped, and reasoning a confident wireframe into existence here would manufacture a
decision nobody has made. What can be said from first principles, clearly labeled as speculation:
*if* level themes end up being a purely visual reskin of existing Modules (a "Surface" or biome
reskin, per `CONTEXT.md`'s own "Surface" entry describing floor properties independent of Module
type), then it needs no Screen at all — it's a Track-authoring concern living entirely inside the
Track builder (§ADR 0034's own domain), not a player-facing Screen. *If* instead it means
selecting a themed *set* of Tracks to play through (closer to Trackmania's Campaign concept, not
directly cited here since the inventory didn't research Trackmania's Campaign structure
specifically), it would look like a reskinned version of §3.21's Track browser — a themed filter on
the same `<TrackGrid>`, not a new component family.

**Components.** Deliberately none proposed beyond "if a Screen at all, reuse §3.21's
`<TrackGrid>` with a theme filter" — inventing a bespoke `<LevelSelectScreen>` component tree for an
undefined concept would be the wrong kind of thoroughness here.

**Reusability.** Whatever this becomes, it's additive to §3.21, not a new pattern.

**Anti-slop application.** N/A pending the concept being defined at all.

### 3.31 A "Final Race" / Skyfall transition moment — `proposed`, priority: nice-eventually, presentation flourish

**Wireframe.** `CONTEXT.md`'s own "Final Race" and "Skyfall" entries describe the mechanical shape
("a tall vertical Track the last Players climb; first to the top wins") but the inventory correctly
notes no reference game researched here has "a comparable elimination-ladder structure" to crib a
transition beat from — Fall Guys' own multi-round elimination format would be the more apt game to
research for this specific question, and the inventory flags that it wasn't targeted for this pass
either; this document's own research pass didn't add new sourcing here for the same reason (staying
honest about the gap rather than forcing an ill-fitting analogy from Trackmania/Golf With
Friends/Rocket League/Among Us, none of which have an elimination-ladder final round at all).
First-principles treatment only, labeled as such: since CONTEXT.md frames this as reusing existing
Screen infrastructure rather than needing new UI ("could be a Results variant or a Countdown-overlay
variant rather than a wholly new route" — the inventory's own reasonable framing, adopted here), the
concrete recommendation is to treat it as a special-cased `<CountdownOverlay>` (§3.3) — the same
"3…2…1…" mechanism, but with a distinct visual treatment (framing that telegraphs "this is the last
one, and it's vertical" — e.g. a camera pull-back showing the Track's full vertical scale before the
numeral appears, since Skyfall's whole identity per CONTEXT.md is verticality) rather than inventing
a wholly new routed Screen for a single transitional beat.

**Components.**
- `<CountdownOverlay>` (§3.3) gains a `variant: "standard" | "finalRace"` prop controlling the
  pre-numeral camera framing beat described above — additive, not a new component tree.

**Reusability.** Entirely additive to §3.3 — the single clearest case in this whole catalog of "this
proposed Screen isn't really a new Screen at all," worth stating plainly rather than padding this
document with an invented component family for a one-line CLAUDE.md roadmap phrase.

**Anti-slop application.** The opportunity here is purely presentational and cheap: Skyfall's own
verticality is distinctive enough on its own (per CLAUDE.md's roadmap framing as "the signature...
concept") that the anti-slop move is simply *not undercutting it* with the same flat countdown
treatment used for an ordinary Round — the moment already has real, game-specific drama built in;
the UI's only job is to not smother it with generic chrome.

---

## 4. Sources consulted (external, with access dates)

- Adrian Krebs, ["AI Design Slop and How to Spot It"](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), developersdigest.tech, 22 Apr 2026 (accessed 2026-09-04).
- Jason Zhou, ["Why AI Design Looks Generic"](https://superdesign.dev/blog/why-ai-design-looks-generic), superdesign.dev, 15 Jun 2026 (accessed 2026-09-04).
- 925 Studios, ["AI Slop Fonts and Gradients: The Tells That Give Away AI Design"](https://www.925studios.co/blog/ai-slop-design-tells) (accessed 2026-09-04).
- Glassmorphism critique survey: [LogRocket, "Liquid Glass is here — how should designers respond?"](https://blog.logrocket.com/ux-design/apple-liquid-glass-ui/); [Medium/Design Bootcamp, "Glassmorphism: The most beautiful trap in modern UI design"](https://medium.com/design-bootcamp/glassmorphism-the-most-beautiful-trap-in-modern-ui-design-a472818a7c0a); [uxpilot.ai, "12 Glassmorphism UI Features, Best Practices, and Examples"](https://uxpilot.ai/blogs/glassmorphism-ui) (all accessed 2026-09-04).
- Rocket League UI: [interfaceingame.com, Rocket League screenshots](https://interfaceingame.com/games/rocket-league/); [David Carron, "Rocket League UI"](https://davidcarron.com/rocket-league-ui) (both accessed 2026-09-04).
- Among Us settings/lobby: [Among Us Fandom, "Settings"](https://among-us.fandom.com/wiki/Settings) (accessed 2026-09-04).
- Stumble Guys main-menu redesign: [Stumble Guys community hub, "Upcoming Changes Coming to Ability Progression & Main Menu"](https://communityhub.stumbleguys.com/news/upcoming-changes-coming-to-ability-progression-and-main-menu) (accessed 2026-09-04).
- Fall Guys settings structure: [esports.net, "Fall Guys Settings"](https://www.esports.net/wiki/guides/fall-guys-settings/) (accessed 2026-09-04).
- Jackbox room codes: [jackboxgames.com, "How to Play"](https://www.jackboxgames.com/how-to-play); [secondary corroboration on QR-code join](https://smart.columbus.gov/columbus-news/jackbox-tv-room-codes-your-guide-to-joining-the-party-1764797795) (both accessed 2026-09-04).
- Battle pass conventions: [Wikipedia, "Battle pass"](https://en.wikipedia.org/wiki/Battle_pass); [allthings.how, "Overwatch Season 4 Battle Pass: How Tracks and Tier Hacks Work"](https://allthings.how/overwatch-season-4-battle-pass-how-tracks-and-tier-hacks-work/) (both accessed 2026-09-04).
- Disconnect/connection-loss UI convention (secondary/community sources): surveyed via Roblox DevForum threads on disconnect UI, 2026-09-04 — used only to corroborate the "modal takeover, never a subtle indicator" pattern, not as an authoritative design source.
- Reused from `docs/research/screens-inventory.md` (not re-fetched independently, cited via that file's own sourcing): Fall Guys ([fallguys.com](https://www.fallguys.com/en-US/news/introducing-fall-guys-creative), [Season 2 news](https://www.fallguys.com/en-US/news/fall-guys-season-2---out-now), [Round Over Screen wiki](https://fallguysultimateknockout.fandom.com/wiki/Round_Over_Screen), Gamespot patch-note coverage), Trackmania ([doc.trackmania.com TOTD](https://doc.trackmania.com/play/what-is-totd/)), Golf With Your Friends ([Steam page](https://store.steampowered.com/app/431240/Golf_With_Your_Friends/), [Fandom wiki](https://golf-with-your-friends.fandom.com/wiki/Golf_With_Your_Friends)) — all originally accessed 2026-09-04 per that file.

## 5. This project's own sources consulted (primary, by path)

`CLAUDE.md` (identity, design philosophy, roadmap); `CONTEXT.md` (all cited terms: Player,
Character, Match, Round, Race/Survival/Collect/Team Round, Qualification, Time Limit, Finish Zone,
Lobby, Countdown, Results, Track, Draft, Revision, Module, Segment, Surface, Checkpoint, Fall,
Respawn, Spectator Mode, Bet, Skyfall, HUD, Screen, Wobble); `docs/research/screens-inventory.md`
(screen list, statuses, priorities, and its own reference-game citations, reused where noted);
`docs/adr/0008-react-for-screens.md`; `docs/adr/0034-track-builder-free-placement.md`;
`docs/adr/0032-track-publishing-mocked-author-immutable-revisions.md` (cited via the inventory);
`docs/adr/0024-player-identity-and-reconnect-shaping.md` (cited via the inventory);
`docs/milestones/M4.md` (Screens/HUD checklists, exclusions); `apps/client/src/main.ts` (confirmed
by direct read: HUD is a single `textContent` string reassigned every animation frame, including
its current disconnect-message handling); `apps/track-builder/index.html` (confirmed by direct
read, structure only — panel layout `#palette`/`#viewport`/`#inspector`/`#browse`/`#toolbar` — not
its current CSS values, per the correction recorded in §0).

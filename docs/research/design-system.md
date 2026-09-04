# Design system: tokens and component-construction specs

> Research note under `docs/research/`, same convention as `docs/research/m2-netcode-transport.md`,
> `docs/research/screens-inventory.md`, and `docs/research/screens-wireframes-and-components.md` —
> feeds design discussion, decides nothing itself. If any direction below is adopted it should be
> captured as an ADR the normal way. No `m4-` prefix: per `screens-inventory.md`'s own catalog this
> spans every Screen the game has, is named for, or will plausibly need — not only M4's four.

## 0. Grounding, and what this file is explicitly not

Two prior files attempted this ground before: `docs/research/m4-screens-visual-design.md` (still in
the repo, read-only reference below) and `docs/research/m4-design-system.md` (deleted — its content
is not reconstructed here and was not re-read from git history to write this). Both derived their
entire token set — exact hexes (`#A643FA`, `#FF30A4`), the brand display font (Titan One) — from
Fall Guys' own shipped stylesheet and brand-guidelines PDF. `screens-wireframes-and-components.md`
§0 already explains why that baseline is wrong for this project and rejects it explicitly: CLAUDE.md
names Fall Guys as this project's reference for match *structure* only — "never for feel" (CLAUDE.md,
Design philosophy, quoted verbatim in `screens-wireframes-and-components.md` §0) — so copying Fall
Guys' brand palette and brand font wholesale "is the literal opposite of 'never for feel': it's
importing another game's entire visual feel, not its structure" (`screens-wireframes-and-components.md`
§0). This file inherits that rejection rather than re-litigating it. `m4-screens-visual-design.md` is
cited exactly once more below (§5, negatively) purely to record what was tried and rejected; no value
in it is reused as a source for any token in this file.

Nor does this file treat the current placeholder styling in `apps/client/index.html` or
`apps/track-builder/index.html` (dark background, `ui-monospace`, thin 1px borders, flat hover-color
swaps) as a design input, for the same reason `screens-wireframes-and-components.md` §0 already gives:
"that styling has no design intent behind it — it is an unstyled dev scaffold." It is used exactly
once below (§3) as a *technical* fact — confirming neither app currently imports a shared stylesheet —
not as a source of any color, radius, or font value.

Everything below traces to exactly one of: `docs/research/screens-inventory.md` (cited as
"inventory §n"), `docs/research/screens-wireframes-and-components.md` (cited as "wireframes §n"),
`CLAUDE.md`, `CONTEXT.md`, or is labeled **`[proposal]`** — this document's own new construction,
introduced because the two source files establish a direction in prose but stop short of a number, a
curve, or a hex. Per the task that produced this file: where nothing sourced determines a specific
value (an exact hex, an exact typeface name), that is stated outright as an **open slot** (§6) rather
than invented and presented as settled.

---

## 1. Foundations

### 1.1 Color

**The mechanism, before the values.** Two convergent findings from wireframes §1.1 justify building
the palette *bottom-up from mechanics* rather than top-down from a decorative brand hue:

- 925 Studios / the developersdigest audit both flag the specific purple/indigo accent as
  traceable to "a tooling default... rather than a deliberate color choice anyone made — the tell
  isn't 'purple is bad,' it's 'purple chosen by default is a fingerprint of nobody having decided'"
  (wireframes §1.1).
- This project, unlike a generic SaaS product, already has several colors implied by its own
  mechanics before any decorative accent is chosen at all: Qualified vs. eliminated (CONTEXT.md
  "Qualification", "Elimination"), Ready vs. not-ready (CONTEXT.md "Lobby"), a host's distinct
  authority (wireframes §3.2: "the host's row is structurally different... and should look
  different, not just carry a small badge"), and Fall itself (CONTEXT.md "Fall" — "the core
  failure... 'Don't fall' is this").

So the palette below is organized as **functional roles first** (derived from what the game's own
rules already distinguish), with a single decorative **accent** role deliberately left open (§6)
rather than filled with a default. This ordering is itself the concrete antidote to "purple chosen by
default": every functional color has a reason before any color exists for pure branding.

| Role | Token | Derivation | Value |
|---|---|---|---|
| Surface (base) | `--df-color-surface-0/1/2` | A layered-depth scale for background → panel → raised element, needed because §1.2 rejects glass/blur as the way to show depth ("panels and buttons that behave like the game's own physical vocabulary" — wireframes §1.2) — depth must come from *opaque* layering + elevation (§1.3), not translucency. | **[proposal, open slot]** — exact neutrals not sourced; must not default to the dev-scaffold's `#0b0e14` blue-black (dropped per §0), and must clear real contrast, not "barely passing" (wireframes §1.1's own phrase for the tell to avoid). |
| Ink (text) | `--df-color-ink-primary/secondary` | Same contrast requirement as above. | **[proposal, open slot]**, contrast target below. |
| Qualify / Ready | `--df-color-go` | CONTEXT.md "Qualification"; wireframes §3.2 Ready toggle, §3.5 Results ranking. A "go" signal — the one role every reference-game precedent needs regardless of brand (green-family is the near-universal "positive/advance" convention, not itself a slop tell since it's functional, not decorative). | **[proposal, open slot]** for exact hue; must read as clearly distinct from `--df-color-host` (below) since both can appear on the same Lobby row. |
| Fall / DNF | `--df-color-fall` | CONTEXT.md "Fall"; wireframes §3.5 anti-slop note: DNF rows are "a real opportunity to lean into 'hilarious when you fail'... instead of the generic pattern of quietly graying out losers." A pure alarm-red (the generic "error" default) would fight that framing — Fall is a *funny* failure the game is built around, not a system error. | **[proposal]** — direction: a warm, saturated amber/orange rather than blood-red; a "cartoon uh-oh" register, not a "your card was declined" register. Exact hue is an open slot. |
| Host authority | `--df-color-host` | wireframes §3.2, quoted above. | **[proposal, open slot]** — must be visually distinct from `--df-color-go`, since a host is also shown as Ready. |
| Checkpoint | `--df-color-checkpoint` | CONTEXT.md "Checkpoint"; used only where a Checkpoint concept surfaces in Screen UI (e.g. a Results DNF row annotated with "fell after Checkpoint 3", per the DNF anti-slop point above). | **[proposal, open slot]**. |
| Accent (decorative) | `--df-color-accent` | The one role with no mechanical grounding — pure brand decoration (primary CTA fill on Main menu, etc.). | **Left open deliberately** — see §6. Not filled with a placeholder, unlike the roles above, because inventing one here would recreate exactly the "chosen because it was available, not because of something about this game" failure §1.1 names. |
| Border / hairline | `--df-color-border` | §1.4 (borders). | **[proposal, open slot]** — a neutral, not a hue; never a decorative accent color per §1.4. |

**Contrast rule (grounded, not a placeholder).** Krebs' audit names "permanent dark mode with
barely-passing-contrast grey body text" as one of the 16 concrete tells (wireframes §1.1). The
antidote this document adopts as a hard constraint on whatever exact values fill the open slots
above: body text against its surface must clear a real, comfortable contrast ratio, not the legal
minimum — **AA (4.5:1) is a floor, not a target; design toward ~7:1 (AAA) for primary body/ink pairs**
wherever the palette allows it. This is a testable rule the open-slot values must satisfy once
chosen, not a specific color.

**Light/dark is itself unsettled.** No sourced document commits this game's Screens to dark mode,
light mode, or a togglable theme — flagged as an open slot in §6, not defaulted here, precisely
because "permanent dark mode" chosen without a reason is itself one of the four sources' named tells.

### 1.2 Typography

**Scale.** A single systematic scale, used everywhere a size is needed, rather than each Screen
picking its own numbers ad hoc — the smaller-scale version of the same "absence of a reason" problem
§1.1 diagnoses at the level of a whole layout. **[proposal]** — the specific steps below are this
document's own construction; the requirement that there be *one* deliberate scale follows from
wireframes §1.1's framing, the numbers themselves are not sourced from anywhere:

| Token | Size | Role |
|---|---|---|
| `--df-type-micro` | 12px | Fine print, timestamps, the `id`-style secondary line already seen in the Track builder's own `.track-entry .id` pattern (structural precedent only, not a styling one, per §0). |
| `--df-type-label` | 14px | Row secondary stat (a Results row's falls count), tab labels, form labels. |
| `--df-type-body` | 16px | Base reading size: Settings copy, chat text, list item text. |
| `--df-type-emphasis` | 18px | Row primary text — a nickname in `<LobbyPlayerList>`, a Track name in `<TrackCard>`. |
| `--df-type-heading` | 22px | Panel/section headers — a Settings tab's panel title, "Modules" in the Track builder. |
| `--df-type-title` | 28px | Screen title — Lobby heading, Results heading. |
| `--df-type-subdisplay` | 36px | Secondary numerals/tier labels — a `<TierTrack>` level number (wireframes §3.17). |
| `--df-type-display` | 48px | Banner word — `QUALIFIED!`/`ELIMINATED!` (wireframes §3.5, citing the Fall Guys Round-Over precedent), a Main-menu Play action label. |
| `--df-type-hero` | 64px | The Countdown numeral (wireframes §3.3) — the single largest, most load-bearing text moment in the whole app. |

**Numerals: tabular figures for anything ranked or timed.** wireframes §3.5 cites Trackmania's
leaderboard as "a clean, monospaced-feeling rank list sorted by time... a better model for the *rows*"
than Fall Guys' own banner-only Results. Concretely: any column showing a finish time, a rank number,
or a Time-Limit countdown (`<TimeLimitBadge>`, `<ResultsRow>`'s time column, `<LeaderboardRow>`)
uses `font-variant-numeric: tabular-nums` (or a monospaced numeral face) so digits align vertically
down a column — a small, cheap, directly-cited construction detail, not a placeholder.

**Typeface: an explicit open slot, with criteria, not a name.** wireframes §1.2 is direct that this
is "a real design decision belonging to whoever executes this work, likely worth its own short
spike/ADR rather than an un-shown pick buried in a research doc" — that judgment is adopted here
unchanged; no font family is named. What *is* sourced is the criteria the eventual pick must satisfy
(wireframes §1.2, quoted): the display/heading face should have "weight and boldness matching
'chaotic,' a rounder, slightly off-kilter display face matching 'hilarious when you fail'" and must
be chosen "because of something about this game... not because it was the first result in a font
picker." A **two-face pairing** is proposed as the *shape* of the answer (not its identity):

- `--df-font-display` — the distinctive, personality-carrying face for headings, banner words, and
  the Countdown numeral. **Open slot** — name TBD by the follow-up spike wireframes §1.2 calls for.
- `--df-font-body` — a plain, highly legible workhorse for dense content (Settings rows, Results
  rows, chat). Using a plain face *here* is not the Inter-tell wireframes §1.1 warns against, because
  the tell is reaching for a neutral default *as the entire type system with no other decision made*
  — pairing a deliberate display face with a neutral body face is a considered pairing, not an
  absence of one. **Open slot** for the exact family, but explicitly not required to be as
  personality-driven as `--df-font-display`.

No system-ui/monospace stack is retained as a fallback from the dev scaffold's placeholder styling
(dropped per §0) beyond the tabular-numeral rule above, which is a functional requirement, not a
borrowed aesthetic.

### 1.3 Spacing

**[proposal]** — a single 4px-based scale, for the same "one deliberate system, not ad hoc" reason
as §1.2's type scale; not sourced from either source file, which don't specify layout metrics:

`--df-space-1: 4px` · `--df-space-2: 8px` · `--df-space-3: 12px` · `--df-space-4: 16px` ·
`--df-space-5: 24px` · `--df-space-6: 32px` · `--df-space-7: 48px` · `--df-space-8: 64px` ·
`--df-space-9: 96px`

Applied per wireframes' own recurring layout language: `--df-space-2`/`--df-space-3` for row internal
padding (`<LobbyPlayerList>` rows, `<ResultsRow>`), `--df-space-5`/`--df-space-6` between major
layout regions (Lobby's player-list column vs. Track-picker panel, per wireframes §3.2's "left/main
column... right or lower panel" layout), `--df-space-7`+ for a Screen's outer gutters.

### 1.4 Corner radius

Two named tells bound this directly rather than leaving it a free choice: Krebs' audit lists
"default shadcn/ui components" among the 16 concrete tells (wireframes §1.1) — shadcn's own defaults
apply one soft, medium-large radius (`rounded-md`/`rounded-lg`) uniformly to every surface, which is
exactly the "one blanket value with no reason" failure mode. The corrective, grounded in §1.2's
"physical materials" point (panels/buttons "behave like the game's own physical vocabulary" rather
than a generic soft-UI default): radius should vary *by role*, deliberately, and skew smaller/more
restrained than the shadcn-default look — solid physical objects (a capsule Character, a Prop box,
Rapier's cuboid colliders per `docs/research/slope-and-surface-movement.md`'s own description of this
project's statics) are not universally pill-rounded.

| Token | Value | Role |
|---|---|---|
| `--df-radius-sharp` | 2px | Functional/dense chrome — a `<StatTile>`, a `<TimeLimitBadge>`, anything that reads as informational rather than "an object you press." |
| `--df-radius-standard` | 6px | The default for buttons and form controls — enough softening to read as touchable, far short of a pill. |
| `--df-radius-card` | 10px | Cards specifically (`<TrackCard>`, `<CharacterGrid>` items, the Track builder's own Module-preview cards per §3, once ported) — the one role allowed the most rounding, since cards are the element §2's "landing" motion treats as a discrete physical object. |

All three are **[proposal]** values — the *reasoning for varying by role instead of one blanket
token* is the grounded part; the exact pixel counts are this document's own construction.

### 1.5 Border

Krebs' audit names "colored top/left borders on cards" as one of the 16 tells (wireframes §1.1) —
a decorative accent stripe applied for no reason beyond visual interest. The corrective: borders in
this system are **structural, never decorative** — a single neutral hairline (`--df-color-border`,
§1.1) at a consistent weight, used to separate distinct regions (a row from the row below it, a panel
from the viewport behind it) the way a physical object has an edge, not to carry a brand color.

`--df-border-width: 1px` (functional dividers, e.g. between `<LobbyPlayerList>` rows) ·
`--df-border-width-emphasis: 2px` (a selected `<TrackCard>`, an active Settings tab — emphasis via
*weight*, not a new color, matching wireframes §3.2's point that the host row "should look different,
not just carry a small badge" — the emphasis border is one concrete way to do that without reaching
for a decorative color accent).

### 1.6 Elevation / shadow

The most directly grounded foundation in this document. Wireframes §1.1 names glassmorphism as a
top-cited tell across all four of its sources — "frosted-glass panels read as decoration divorced
from function," thriving on "Dribbble" but rare in "functional, production-level products," and the
critique "isn't the blur itself, it's blur with no reason: no actual layered-glass or depth metaphor
in the game world it's decorating." This project's world has no glass metaphor at all — it has solid
Rapier bodies, capsules, Props, ragdolls (wireframes §1.2: "This game's entire pitch is
Rapier-simulated physical bodies... A UI that reaches for frosted-glass panels... borrows a
screen-space metaphor that has zero connection to a game about solid bodies colliding"). The
constructive alternative wireframes §1.2 proposes directly: "a card that visibly 'lands' with a
little overshoot-then-settle."

Concretely, elevation here means **contact shadows, not ambient glow**: small blur radius, a defined
offset implying one consistent light direction (top-left, arbitrary but fixed system-wide), moderate
opacity — the opposite construction from a glassmorphism panel's large, soft, low-opacity blur.
**[proposal]** for the exact numbers:

| Token | box-shadow (light-mode direction, top-left light) | Role |
|---|---|---|
| `--df-elevation-0` | none | Flush with the background — HUD-adjacent overlays, resting text. |
| `--df-elevation-1` | `0 1px 2px rgba(ink, 0.28)` | Resting card/button — a `<TrackCard>` at rest, a `<StatTile>`. |
| `--df-elevation-2` | `0 3px 6px rgba(ink, 0.32)` | Lifted/interactive — hover or drag state, "about to be picked up." |
| `--df-elevation-3` | `0 8px 16px rgba(ink, 0.4)` | Overlay/modal separation from the backdrop — `<ConnectionErrorScreen>`'s takeover, `<CountdownOverlay>`'s numeral group if it needs to read above a busy 3D scene. |

No `backdrop-filter: blur(...)` anywhere in this system — panels are opaque or near-opaque fills,
never frosted, per the glassmorphism critique above. If a future Screen genuinely needs a
translucent panel over the live 3D scene (Countdown, Bet, Spectate all render over a live game view
per wireframes §3.3/§3.8/§3.20), the panel content itself stays opaque; only its *backdrop dimming*
(a flat, non-blurred scrim) may use transparency — never a blurred glass panel for the content itself.

### 1.7 Motion and timing

The second most directly grounded foundation, and the one where the source material's language is
most explicitly a "next level of concreteness down" opportunity — the task's own example. Four
distinct motion primitives recur across wireframes §3, named once here and referenced per-component
in §2:

**(a) Landing (`--df-motion-land`).** Sourced from wireframes §1.2 ("a card that visibly 'lands' with
a little overshoot-then-settle when it appears") and repeated per-Screen: `<TrackCard>` entrance
(§3.2, §3.21), `<LobbyCodeDisplay>` (§3.14), Credits list rows "that 'fall' into place" (§3.26).
**[proposal]** concrete spec: duration **320ms**, easing **`cubic-bezier(0.34, 1.56, 0.64, 1)`** (a
standard "back-out" curve — the specific curve family that produces an overshoot past 100% before
settling, which is the mechanical meaning of "overshoot-then-settle"), transform
`translateY(12px) scale(0.96)` → overshoot to `scale(1.03)` at ~65% of the duration → settle at
`scale(1)`. Applied to any element using the Card primitive (§2.2) and, staggered, to list rows
(§2.5).

**(b) Press (`--df-motion-press`).** Sourced from wireframes §1.2 ("a button press that has real
squash, not a CSS `:active` opacity dip") and §3.6 (a Settings toggle "that visibly 'snaps' with a
small overshoot"). **[proposal]** concrete spec: on press, **90ms** to `scaleY(0.94) scaleX(1.03)`
(a squash, not a uniform shrink — width and height move in opposite directions, the way a soft
physical object actually compresses) with easing `ease-out`; on release, **160ms** back to `scale(1)`
with the same back-out curve as (a) but a smaller overshoot magnitude (`scale(1.015)` peak) so a
button doesn't visually "bounce" as dramatically as a card landing — presses are frequent and fast;
landings are occasional and can afford more flourish.

**(c) Toggle snap (`--df-motion-toggle-snap`).** A named variant of (b) specifically for the thumb
travel inside `<ReadyToggle>` and any Settings switch (wireframes §3.6). **[proposal]**: **140ms**,
same back-out curve as (a), thumb overshoots its resting position by ~8% of the track's travel
distance before settling — mechanically the same "overshoot-then-settle" idea as landing, applied to
a translation instead of a scale.

**(d) Modal takeover (`--df-motion-modal-takeover`).** The one motion primitive whose spec is
*fast and decisive by requirement*, not playful — sourced directly from wireframes §3.25's own cited
finding on disconnect UI: "a modal, center-screen, blurred-background [sic — see note] message that
cannot be missed or mistaken for still-being-connected," explicitly contrasted with a rejected pattern
where "players could still run around... confusion about whether the connection was actually lost."
**[proposal]** concrete spec: **120ms**, linear or a simple `ease-out` (deliberately *not* the
back-out curve used everywhere else — an overshooting connection-lost modal would undercut the
"cannot be missed... cannot be mistaken" urgency the source finding calls for), backdrop opacity
0 → full in the same 120ms, no partial/ambiguous intermediate state held for longer than one frame.
(Wireframes §3.25 itself uses "blurred-background" loosely, quoting community secondary sources —
per §1.6 above, this system's actual construction is an opaque or flat-scrim backdrop, never a blur,
regardless of that source's own wording.)

**(e) Wobble-as-UI-motion — used sparingly, by name, not as a default.** CONTEXT.md's own "Wobble"
entry ("the procedural, non-simulated lean/sway of the Character's visual mesh while Controlled")
is cited in wireframes §1.2 and again at §3.3 and §3.4 as "free creative material for UI motion, not
just character rendering" — specifically for the Countdown numeral ("a countdown digit that has a
little Wobble-style lean") and a HUD personal banner. **[proposal]** concrete spec, scoped
deliberately narrow: a slow rotational oscillation, `rotate(-1.5deg)` ↔ `rotate(1.5deg)`, **2400ms**
per half-cycle, `ease-in-out`, looping only while the element is idle/on-screen with no other
interaction happening (a Countdown numeral between beats, a "wobble wordmark" on Main menu). This is
explicitly *not* proposed as a general-purpose UI animation — applying a Wobble-style sway to every
element would recreate exactly the kind of "safe average, applied everywhere for no specific reason"
problem §1.1 diagnoses, just with a different signature motion instead of a different signature
color. It is reserved for the two moments the source material itself names.

---

## 2. Component-construction specs

Each entry below names the component(s) from `screens-wireframes-and-components.md` §3 it specifies,
gives concrete states, and says exactly which §1 tokens/motion primitives it uses and why — the
"actually specify it" version of that file's per-Screen anti-slop prose, per the task's own worked
example (an overshoot-then-settle spec as duration + easing + transform, not a restated abstraction).

### 2.1 Button pair — `<PrimaryButton>` / `<SecondaryButton>`

Named once in wireframes §3.1 as "the standard button pair every Screen in this document reuses" —
the single most cross-cutting component in the whole catalog (every Screen with any action uses it:
Main menu's `<PrimaryPlayAction>`, Lobby's `<HostStartButton>`, Results' `<BackToLobbyButton>`,
Settings' save/back actions, etc.).

- **Construction.** `<PrimaryButton>`: solid fill (`--df-color-accent` once filled, §6), `ink`-on-fill
  text at `--df-type-emphasis`, `--df-radius-standard`, `--df-elevation-1` at rest.
  `<SecondaryButton>`: `--df-color-surface-1` fill, `--df-border-width` outline in `--df-color-border`,
  same radius/type, `--df-elevation-0` at rest (secondary actions don't compete for the "lifted"
  read primary actions get).
- **States.**
  - *Default*: as above.
  - *Hover*: `--df-elevation-1` → `--df-elevation-2`, no color shift beyond a small (≤6%) lightness
    step — the lift itself is the feedback, not a color swap (a direct application of §1.2's
    "physical, not flat" point: hover reads as "this is about to be pressed," matching how a real
    raised object catches more light when approached).
  - *Active/press*: `--df-motion-press` (§1.7b) — the squash transform, not an opacity dip (this is
    the literal, named anti-pattern wireframes §1.2 calls out: "not a flat opacity-fade `:active`
    state").
  - *Disabled*: flat 40% opacity, `--df-elevation-0`, no hover/press motion registers at all (motion
    absence *is* the disabled signal, on top of opacity).
  - *Focus-visible*: a 2px outline ring in `--df-color-host` (chosen only for maximum contrast against
    both button variants; not semantically tied to "host" here — a keyboard-navigation ring is a
    distinct concern from the host-authority color role, sharing the token only because both need a
    high-visibility, non-decorative marker color) offset 2px from the button edge, never relying on
    color alone per the §1.1 contrast rule.
- **Anti-slop tie-back.** Directly answers wireframes §3.1's own anti-slop line: "the Play button
  should have a physical 'give' on press... not a flat opacity-fade."

### 2.2 Card primitive — `<TrackPicker>` (Lobby), `<TrackCard>` (Track browser), `<CharacterGrid>` item

Wireframes §3.21 calls the Track/Module-as-preview-card idea "the strongest §2.1b case in this whole
document... one visual idea, three separate implementations across two apps and one Screen family"
— `<TrackPicker>` (wireframes §3.2), `<TrackCard>` (§3.21), and the Track builder's own `#palette`
Module-preview markup all share this one construction, reimplemented per-stack per
`screens-wireframes-and-components.md` §2.1(b)'s "pattern reuse, not code reuse" rule (§3 below).

- **Construction.** `--df-elevation-1` at rest, `--df-radius-card` (10px, the one role allowed the
  largest radius per §1.4), `--df-border-width` hairline in `--df-color-border`, a live or looping
  render of the Track/Module/Character's own 3D geometry as its preview (wireframes §3.1/§3.15/§3.21
  all independently make this same point: "use the game's own 3D content instead of stock imagery" —
  never a static screenshot where a live render is affordable).
- **States.**
  - *Default*: as above; entrance via `--df-motion-land` (§1.7a) — the exact "overshoot-then-settle"
    spec wireframes §1.2/§3.2 describe only qualitatively.
  - *Hover*: `--df-elevation-1` → `--df-elevation-2` plus `scale(1.02)` — "about to be picked up,"
    consistent with §2.1's hover reasoning above.
  - *Selected* (a chosen Track in `<TrackPicker>`, an equipped Character in `<CharacterGrid>`):
    `--df-border-width-emphasis` (2px) in place of the 1px hairline, no full color-fill swap — keeps
    the "paper/physical object" read intact rather than turning the whole card into a colored tile,
    per §1.5's "emphasis via weight, not a new color."
  - *Disabled/locked* (a locked cosmetic per wireframes §3.15: "a distinct locked visual state rather
    than hiding them"): desaturated preview render, `--df-elevation-0`, a small lock glyph drawn from
    the game's own iconography discipline (§2.7), never a generic padlock stock icon per §1.1's
    "stock icon packs used indiscriminately" tell.
  - *Focus*: same ring treatment as §2.1.
- **Anti-slop tie-back.** Directly implements wireframes §3.21's "preview art that actually shows the
  Track's own geometry/motion... impossible to mistake for a generic template."

### 2.3 Toggle — `<ReadyToggle>` and Settings switches

- **Construction.** Track: `--df-radius-standard` pill-free rectangle (not a fully rounded pill — per
  §1.4, this system varies radius by role rather than defaulting every control to the shadcn-style
  full-round switch), fill `--df-color-go` when on, `--df-color-surface-1` when off. Thumb: a
  slightly-raised square-ish block (`--df-elevation-1`), not a circle — a small, deliberate departure
  from the generic rounded-pill/circle-thumb toggle that is itself one of the most template-shaped
  controls in any UI kit (wireframes §3.6: "the single highest risk here is default
  browser-native-feeling toggle switches").
- **States.**
  - *Off → On*: `--df-motion-toggle-snap` (§1.7c) — the thumb travels and overshoots its resting
    position by ~8% before settling, the concrete spec for wireframes §3.6's "toggle that visibly
    'snaps' with a small overshoot."
  - *Hover*: `--df-elevation-1` → `--df-elevation-2` on the thumb only.
  - *Disabled*: 40% opacity, no snap motion on interaction attempts.
  - *Focus*: ring per §2.1.
  - *Remote/read-only* (another Player's Ready state inside `<LobbyPlayerList>`, not the local
    Player's own row): rendered **flatter** — `--df-elevation-0`, no hover state at all, since it
    isn't interactive for anyone but its owner. This is a direct, load-bearing application of
    wireframes §3.2's anti-slop point: "five uniform rows with a generic checkmark icon for 'ready'"
    is the tell; making the interactive-vs-read-only distinction *visually* real (not just logically
    real) is the fix.
- **Host-row asymmetry.** `<LobbyPlayerList>`'s host row additionally carries a `--df-color-host`
  marker (a small filled shape beside the nickname, not a generic crown-icon-pack glyph — see §2.7)
  and sits with a slightly heavier `--df-border-width-emphasis` divider beneath it, separating it
  visually from the plain-Player rows below — implementing wireframes §3.2's "visually anchoring the
  host's authority... instead of hiding it behind a tiny icon" as an actual layout rule, not a
  restated principle.

### 2.4 Slider — `<SensitivitySlider>`

Reused verbatim (wireframes §3.6) across `<ControlsPanel>` (mouse sensitivity), `<AudioPanel>`
(volume), and `<AccessibilitySection>` (camera-shake intensity, §3.24).

- **Construction.** Track: `--df-radius-sharp` (2px — a slider track is functional/dense chrome per
  §1.4's role table, not an object being "picked up" like a card), fill portion in `--df-color-go`
  from the origin to the thumb (reusing the "go/positive" role for "more of this setting," a
  legitimate secondary use since sliders have no Ready/Qualify meaning of their own to conflict
  with). Thumb: same raised-block treatment as the toggle thumb (§2.3) for internal consistency.
- **States.** Default / dragging (thumb takes `--df-elevation-2` for the duration of the drag,
  releasing back to `--df-elevation-1` on release with the press-release half of `--df-motion-press`,
  §1.7b) / disabled (40% opacity) / focus (arrow-key adjustable; focus ring per §2.1, plus the
  currently-focused value announced via the label, not color alone).

### 2.5 Row primitive — `<ResultsRow>`, `<LeaderboardRow>`, `<MatchHistoryRow>`, `<StatTile>`

Wireframes names this "the same 'ranked row' primitive recurring a third/fourth time" across §3.5,
§3.11, §3.22, §3.23 — the single most-reused non-button primitive in the catalog, and the one the
source material is most explicit should be "designed once, well, rather than once per Screen"
(wireframes §3.23).

- **Construction.** Columns: rank/position, primary label (nickname or Track name), primary stat
  (time/score, `--df-type-emphasis`, tabular numerals per §1.2), secondary stat
  (`--df-type-label`). `--df-border-width` hairline divider between rows, no per-row card chrome
  (rows are a list, not a stack of individually-elevated cards — elevation is reserved for the list
  container as a whole, `--df-elevation-1`).
- **Qualified vs. DNF — a real visual distinction, not a color chip.** Wireframes §3.5's anti-slop
  line is explicit and load-bearing: "these are not the same kind of row and shouldn't be styled
  identically with just a color swap." Concrete construction: a Qualified row shows its finish time
  in the primary-stat column; a DNF row shows, in the *same visual weight* (not grayed/deemphasized —
  the anti-slop point is explicitly against "quietly graying out losers"), the Checkpoint it last
  reached (`--df-color-checkpoint` accent on that value) instead of a time, plus its fall count
  rendered in `--df-color-fall`. The row *shape* is identical; the *data it foregrounds* differs,
  which is the actual distinction CONTEXT.md's own "Results" entry draws ("Qualified ordered by
  finish time and the rest by Track progress") — the visual design should track that same
  distinction, not paper over it with a uniform "rank + time" template that DNF rows have to fake.
- **Entrance.** Rows land with `--df-motion-land` (§1.7a), staggered ~40ms per row from top to
  bottom — **[proposal]**, extending the single-card landing spec to list-scale rather than having
  every row appear simultaneously (which would read as a static table snapping into place, the
  generic default this whole primitive is trying to avoid).
- **States.** Default / own-row-highlighted (a `--df-border-width-emphasis` left edge — not a
  decorative colored stripe per §1.5's explicit ban on that exact tell, but a *neutral-weight*
  emphasis border, since "this is your row" is functional information, not brand decoration) / hover
  (only where the row is actually interactive, e.g. a `<LeaderboardRow>` linking to a profile) /
  focus.

### 2.6 Overlay primitives — two constructions, not one

Wireframes' Countdown (§3.3), Bet (§3.8), and Spectate (§3.20) overlays share a "live, drawn over a
running game view" shape; `<ConnectionErrorScreen>` (§3.25) is the opposite case — "never a subtle
indicator for something session-ending." Collapsing these into one overlay component would erase a
distinction the source material treats as load-bearing, so this system specifies two:

- **Live overlay** (`<CountdownOverlay>`, `<BetOverlay>`, `<SpectateOverlay>`): content-only
  entrance via `--df-motion-land` on the numeral/panel itself; the backdrop stays clear or receives
  only a very light, flat (non-blurred, §1.6) scrim — wireframes §3.3's own reasoning: "fading in the
  game's already-live camera behind it rather than dimming it heavily — dimming would fight against
  the Character/camera already being 'live.'" `--df-elevation-3` on the content group so it still
  reads above a busy 3D scene without needing the backdrop itself to go dark.
- **Modal takeover** (`<ConnectionErrorScreen>`): `--df-motion-modal-takeover` (§1.7d) — fast,
  decisive, full backdrop opacity, `--df-elevation-3`, a single `<ReturnToMenuAction>`
  (`<SecondaryButton>`, §2.1). No overshoot motion anywhere in this construction (§1.7d's own
  reasoning: overshoot would undercut urgency). One component, four message variants per wireframes
  §3.25 ("`kind: 'local-disconnect' | 'server-full' | 'version-mismatch' | 'mid-round-disconnect'`"),
  not four visually distinct Screens.

### 2.7 Iconography discipline

Not a single component but a rule applied inside several of the above (§2.2's lock glyph, §2.3's
host marker): wireframes §1.2 draws the line precisely — "this project doesn't need custom
iconography for every glyph... but where an icon carries actual game meaning — a Checkpoint flag, a
Fall indicator, a Dash-cooldown pip — drawing it from the game's own Track-builder Module vocabulary
... rather than a generic pack is the concrete, low-cost version of 'custom iconography.'" Applied
rule: a **stock icon font/pack is acceptable for purely-functional chrome with no game meaning**
(a back arrow, a close "×"), but any icon standing in for a CONTEXT.md term (Checkpoint, Fall,
Qualification, Ready, host, Dash) is drawn bespoke, even simply, rather than reached for from a
generic set — the same "custom icon pack indiscriminately" tell named in §1.1 applied at glyph scale.

---

## 3. Cross-surface token sharing

### 3.1 The constraint, restated precisely

`screens-wireframes-and-components.md` §2.1 draws the line this document must not cross: "there is
**no shared component runtime** across the three surfaces," quoting ADR 0008 directly (the HUD
"stays plain DOM, drawn by the game itself... has no place in a component tree") and ADR 0034
directly (the Track builder "stays a standalone vanilla-TS app... no React. ADR 0008's
React-for-Screens decision covers `apps/client` only"). That file's own resolution, reused verbatim
as the mechanism this section makes concrete: of its three reuse buckets, "(a) Shared design
tokens — CSS custom properties... are just CSS values; nothing stops all three surfaces from
importing the same `tokens.css`... This is the single most legitimately shareable thing across all
three" (wireframes §2.1a).

### 3.2 The actual mechanism

Confirmed by direct read (`package.json` in each workspace, `apps/client/index.html`,
`apps/track-builder/index.html`): both `apps/client` and `apps/track-builder` already declare
`"@dont-fall/shared": "workspace:*"` as a real dependency, and `packages/shared`'s own `package.json`
already exposes a subpath map (`"exports": { ".": "./src/index.ts" }`). Neither app currently imports
any shared stylesheet — both apps' index.html files hand-roll their entire style block inline today.
That's the concrete gap this file's own tokens should fill, using infrastructure that already exists
rather than new plumbing:

1. **A single new file**, `packages/shared/src/design/tokens.css` — nothing but a `:root { ... }`
   block of the custom properties defined in §1 (`--df-color-*`, `--df-type-*`, `--df-space-*`,
   `--df-radius-*`, `--df-elevation-*`, motion durations/curves as `--df-motion-*-duration` /
   `--df-motion-*-easing` custom properties). **No classes, no selectors beyond `:root`, no JS.**
   This is the concrete guarantee that "only the token *values*, never component code, cross the
   boundary" (this file's own governing constraint) — there is no component to accidentally import,
   because the file contains nothing but variable declarations.
2. **Exposed via `packages/shared`'s existing `exports` map** — add
   `"./design/tokens.css": "./src/design/tokens.css"` alongside the existing `"."` entry. No new
   package, no new dependency for either app (both already depend on `@dont-fall/shared`).
3. **Imported once per app**, at the top of each app's existing entry point —
   `apps/client/src/main.ts` and the Track builder's own entry `.ts` file — as
   `import "@dont-fall/shared/design/tokens.css";`. Vite (both apps already run Vite, confirmed by
   each workspace's own `vite.config.ts`) resolves and inlines a CSS import from a JS/TS entry point
   natively, with no additional tooling. Each app's own `index.html` `<style>` block (or a promoted
   `.css` file, an implementation detail this document doesn't prescribe) then references the custom
   properties (`color: var(--df-color-fall)`) inside whatever markup/selectors that app authors for
   itself — React components' CSS in `apps/client`, hand-written selectors in `apps/track-builder`,
   and the HUD's own inline styles in `apps/client/index.html`'s `#hud` rule, all three consuming the
   same variables through ordinary CSS inheritance from `:root`, with zero coupling between them
   beyond that.

### 3.3 Compliance check against ADR 0008 and ADR 0034

- **ADR 0008 (HUD stays plain DOM).** Untouched. The HUD's `#hud` element still has its `textContent`
  reassigned wholesale every animation frame exactly as today (confirmed by direct read,
  `apps/client/src/main.ts`, cited in wireframes §2.2/§3.4) — nothing about importing a `:root`
  CSS-variables file changes that loop, introduces a component tree, or adds any per-frame cost
  (custom-property resolution is browser-native CSS, already happening for the scaffold's own
  hand-written hex values today; swapping a hex literal for `var(--df-color-fall)` is not a runtime
  change). The HUD "has no place in a component tree" (ADR 0008, quoted via wireframes §2.1)
  precisely because it never gains one — it gains only a shared vocabulary for the same static values
  it already hardcodes.
- **ADR 0034 (Track builder stays standalone, vanilla-TS).** Untouched for the identical reason:
  `tokens.css` has no JavaScript, no React, no build-step dependency beyond what Vite's native CSS
  import already does for the app's own existing inline styles. The Track builder gains a values
  file, not a runtime — it remains exactly the "standalone vanilla-TS app... no React" ADR 0034
  requires (quoted via wireframes §2.1), and nothing about §2's Card/Row/Toggle *specs* above implies
  shipping a component: wireframes §2.1(b)'s own rule stands unchanged — "the *idea* (proportions,
  motion curve, hover state) is specified once and *coded twice*... not shared code," and §2 above
  is written exactly that way (a spec each surface implements in its own markup, not a component to
  import).

### 3.4 What still doesn't cross, restated

Per wireframes §2.2, unchanged by this mechanism: the HUD's per-frame performance envelope, the Track
builder's own DOM lifecycle (`#palette`/`#inspector`/`#browse` panel toggling via the `hidden`
attribute, confirmed by direct read of `apps/track-builder/index.html`), and each Screen's own
React-internal state (auth, connection, lobby membership) all stay exactly where they are. Only
values — colors, sizes, curves — cross the boundary, and only in one direction (declared once in
`packages/shared`, consumed by all three, never written back).

---

## 4. Per-Screen application notes

Every Screen `screens-wireframes-and-components.md` §3 treats gets a wireframe/component/anti-slop
pass there already; this table's job is narrower — pointing each Screen at the specific §1/§2 tokens
and primitives it draws on, so implementation doesn't have to re-derive the mapping. "Wireframes §n"
below always means that file's own numbered subsection.

| Screen (status, inventory §) | Primitives used (§2) | Key foundation callouts (§1) |
|---|---|---|
| Main menu (confirmed, inventory §1) — wireframes §3.1 | `<PrimaryButton>`/`<SecondaryButton>` (2.1) | `--df-type-display` for Play; Wobble motion (1.7e) reserved candidate for a wordmark treatment; no `--df-color-accent` filled yet (§6) blocks a final visual pass here specifically, since this Screen "sets the palette for everything downstream" (wireframes §3.1). |
| Lobby (confirmed) — wireframes §3.2 | Row (2.5) + Toggle (2.3) for `<LobbyPlayerList>`/`<ReadyToggle>`; Card (2.2) for `<TrackPicker>`; Button pair (2.1) for `<HostStartButton>` | `--df-color-host` + `--df-border-width-emphasis` for host-row asymmetry (2.3); tabular numerals (1.2) on `<TimeLimitBadge>`. |
| Countdown overlay (confirmed, routing unsettled) — wireframes §3.3 | Live overlay (2.6) | `--df-type-hero` numeral; Wobble motion (1.7e), one of its two named uses; `--df-motion-land` on the numeral's entrance. |
| (HUD — not a Screen) — wireframes §3.4 | N/A (plain DOM) | Tokens (§1) still apply as raw CSS values inside the HUD's own inline styles per §3.2/§3.3 above; no component primitives, since there is no component tree. |
| Results (confirmed) — wireframes §3.5 | Row (2.5) for `<ResultsRow>`; Button pair (2.1) for `<BackToLobbyButton>` | The Qualified-vs-DNF distinction (2.5) is this Screen's single most load-bearing construction detail; `--df-color-fall`/`--df-color-checkpoint` on DNF rows. |
| Settings (named, unscoped, ship-blocking) — wireframes §3.6 | Slider (2.4) for `<SensitivitySlider>`; Toggle (2.3) shape reused for any binary Settings control | The toggle-snap motion (1.7c) is this Screen's named anti-slop defense against "default browser-native-feeling toggle switches" (wireframes §3.6). |
| Account/registration (named, unscoped) — wireframes §3.7 | Button pair (2.1) | No new primitive; per wireframes §3.7, deliberately unspecified beyond the two-path layout. |
| Bet screen (named, mechanic-gated) — wireframes §3.8 | Live overlay (2.6); Row (2.5)-family for `<CharacterPickList>` | Explicitly **not** the sports-book/odds-ticker visual convention (wireframes §3.8) — no new color role for "stakes," reuses `--df-color-go` sparingly if a "locked in" state needs one. |
| Tutorial/controls-intro (proposed) — wireframes §3.9 | None (HUD-shaped, per that section's own conclusion) | N/A — tokens only if it stays HUD-adjacent plain DOM. |
| Guest/nickname-only path (proposed, decision not new Screen) — wireframes §3.10 | Reuses §3.2/§3.7's own components | N/A — behavioral constraint, not new visual surface. |
| Profile/stats (proposed, mechanic-gated) — wireframes §3.11 | Row/Tile (2.5) for `<StatTile>` | Per wireframes §3.11's own anti-slop point, tiles should NOT be uniform-grid (the "stat banner rows" tell, §1.1) — vary tile size/weight by what's actually notable. |
| Friends/party (proposed) — wireframes §3.12 | Row (2.5)-family for `<FriendRow>` | Kept visually subordinate (small, corner-anchored) per wireframes §3.12 — low elevation, `--df-elevation-0`/`1` only. |
| Chat/quick-emote (proposed) — wireframes §3.13 | `<QuickEmoteWheel>` is HUD-adjacent (no §2 primitive); `<LobbyChatPanel>` is plain, low-risk chat UI | Emote glyphs follow the §2.7 iconography discipline directly — "an emote that's literally a stumble/wobble animation, not a generic emoji" (wireframes §3.13). |
| Private-lobby-via-code (proposed) — wireframes §3.14 | `<LobbyCodeDisplay>` uses Card's landing motion (2.2/1.7a) | Low color/radius risk; the code display itself is the one place a QR code needs to sit legibly against `--df-color-surface-1`. |
| Character/skin-select (proposed) — wireframes §3.15 | Card (2.2) for `<CharacterGrid>` | Locked state (2.2) explicitly, no invented "stat" iconography per wireframes §3.15's anti-slop line. |
| Cosmetics shop (proposed, mechanic-gated) — wireframes §3.16 | Card (2.2) reused near-verbatim; `<CurrencyBalance>` is a Badge (2.7-adjacent, not separately specced above — same construction as `<TimeLimitBadge>`) | `--df-color-accent` (once filled, §6) is the shop's own primary-CTA color; currency should be named/flavored per wireframes §3.16, not a generic "Coins" label — a copy decision, not a token. |
| XP/progression (proposed, mechanic-gated) — wireframes §3.17 | `<TierTrack>` is a horizontal Row (2.5) variant; `<CurrencyBalance>` reused from §3.16 | `--df-type-subdisplay` for tier numerals; same "tie to game vocabulary, not generic Level N" discipline as §3.16. |
| Matchmaking/server browser (proposed, minimal) — wireframes §3.18 | Button pair (2.1) for `<FindMatchAction>`; `<MatchmakingStatus>` shares the live-overlay (2.6) "transient, non-blocking" shape | Deliberately no data-grid component exists in this system — building one would itself be an anti-slop violation per wireframes §3.18. |
| Create/Join private match (proposed) — wireframes §3.19 | Reuses §3.14's components directly | N/A new. |
| Spectating in progress (proposed, mechanic-gated) — wireframes §3.20 | `<SpectateOverlay>` is a Live overlay (2.6); `<CharacterPickList>` per §3.8 | Recedes rather than competes for attention, per wireframes §3.20 — low elevation, minimal chrome. |
| Track browser/gallery (proposed) — wireframes §3.21 | Card (2.2) for `<TrackCard>`/`<FeaturedTrackHero>` | The strongest cross-surface Card case (§2.2) — same construction as `<TrackPicker>` and the Track builder's own `#palette`, at larger scale with more metadata. |
| Leaderboards (proposed) — wireframes §3.22 | Row (2.5) for `<LeaderboardRow>` | Tabular numerals (1.2) again; a visible time-boxed countdown (if TOTD-style rotation is adopted) uses the same tabular-numeral treatment as `<TimeLimitBadge>`. |
| Match history (proposed) — wireframes §3.23 | Row (2.5) for `<MatchHistoryRow>` | Identical construction to Results' row — the explicit point of wireframes §3.23 is *not* diverging here. |
| Accessibility settings (proposed) — wireframes §3.24 | Slider (2.4) reused, nested in `<VideoPanel>` | Same visual/motion quality as every other Settings control per wireframes §3.24 — not a visually second-class section. |
| Disconnect/error/reconnect (proposed, ship-blocking x2) — wireframes §3.25 | Modal takeover (2.6) | `--df-motion-modal-takeover` (1.7d) is the one motion token deliberately *without* an overshoot — read §1.7d before touching this Screen's motion. |
| Credits (proposed) — wireframes §3.26 | Row-like list using `--df-motion-land` (1.7a), staggered per §2.5's row-entrance pattern | Lowest-complexity Screen in the catalog; tokens only. |
| Changelog/patch-notes link (proposed) — wireframes §3.27 | `<ChangelogLinkAction>` — no new primitive, an external link styled as a `<SecondaryMenuRail>` item | N/A. |
| Legal link (proposed) — wireframes §3.28 | `<LegalLinkAction>`, shares a primitive with §3.27 per that section | N/A. |
| Round-type Results variants (proposed, mechanic-gated) — wireframes §3.29 | Additive to Results' own Row (2.5); `<TeamResultsGroup>` is a labeled wrapper, no new visual primitive | One row language across Round types, per wireframes §3.29's own consistency point. |
| Level-select/theme-select (proposed, undefined) — wireframes §3.30 | If it becomes a Screen at all, reuses Track browser's Card/Grid (2.2) | N/A — genuinely unscoped, per that section. |
| Final Race / Skyfall transition (proposed) — wireframes §3.31 | A `variant` prop on the Live overlay's Countdown construction (2.6), not a new component | The one moment where *not* applying the standard Countdown treatment is itself the correct move, per wireframes §3.31 — verticality should read through camera framing, not new UI chrome. |

---

## 5. What was tried and rejected (for the record, not as a source)

`docs/research/m4-screens-visual-design.md` remains in the repo as a dated artifact of a different
approach — deriving an entire palette and the Titan One display font from Fall Guys' own shipped
`fallguys.com` stylesheet and brand-guidelines PDF, down to exact hexes (`royal-purple #A643FA`,
`bean-pink #FF30A4`). Nothing in that file's §1 (palette), its font pairing, or its component
treatments is reused above. It is named here once, per this file's own task constraints, purely so a
future reader understands why this document starts from mechanics and CLAUDE.md/CONTEXT.md instead
of from a competitor's brand kit — not as a design input.

## 6. Open slots — decisions this document deliberately does not make

Per the task constraint this file is written under: where nothing in `screens-inventory.md`,
`screens-wireframes-and-components.md`, `CLAUDE.md`, or `CONTEXT.md` determines a specific value, that
value is listed here as open rather than invented and presented as settled.

1. **Every color hex value** (§1.1) — `--df-color-surface-*`, `--df-color-ink-*`,
   `--df-color-go`, `--df-color-fall`, `--df-color-host`, `--df-color-checkpoint`,
   `--df-color-border`. This document fixes their *roles* and *relationships* (which must be
   distinguishable from which, what register each implies — "cartoon uh-oh" not "system error" for
   Fall) but not their numbers.
2. **`--df-color-accent`** specifically — left open on principle, not just for lack of data (§1.1):
   filling it without a reason would be the single clearest way this document could itself become
   the thing §1.1 critiques.
3. **`--df-font-display` and `--df-font-body`** — no typeface is named anywhere in this document,
   matching wireframes §1.2's own explicit deferral of this exact decision to "its own short
   spike/ADR."
4. **Light vs. dark vs. themeable** — not decided by any sourced document; flagged rather than
   defaulted, since an undefended "permanent dark mode" is itself one of §1.1's four sources' named
   tells.
5. **The exact pixel values in the type scale (§1.2), spacing scale (§1.3), radius scale (§1.4), and
   shadow/elevation table (§1.6)** — the *shape* of each system (a deliberate, role-varying, single
   scale; contact shadows, not glow) is grounded in the sources cited inline; the specific numbers
   are this document's own construction, offered as a workable starting point for implementation
   rather than a value anyone has reviewed pixel-by-pixel.

Resolving 1–4 is naturally the next `/grilling`-session-shaped decision, the same way
`screens-inventory.md` §6 already frames its own prioritized shortlist as "raw material," not a
decision.

## 7. Sources consulted (by path)

`CLAUDE.md` (identity, design philosophy — "physical chaos and player interaction," "Easy to
understand. Hard to master. Hilarious when you fail," Fall Guys as match-structure-only reference);
`CONTEXT.md` (all cited terms: Fall, Checkpoint, Qualification, Elimination, Lobby, Ready, Wobble,
Results, Track, Module, HUD, Screen); `docs/research/screens-inventory.md` (Screen catalog, statuses,
priorities); `docs/research/screens-wireframes-and-components.md` (all of §1 anti-slop foundation,
§2 reusability architecture, and §3 per-Screen wireframes/components/anti-slop — the primary source
for nearly every derivation above); `docs/research/m4-screens-visual-design.md` (§5 above, negative
citation only — not a source for any value); `docs/adr/0008-react-for-screens.md` and
`docs/adr/0034-track-builder-free-placement.md` (both cited via their direct quotation inside
`screens-wireframes-and-components.md` §2.1, not independently re-read); `apps/client/index.html`,
`apps/track-builder/index.html`, `packages/shared/package.json`, `apps/client/package.json`,
`apps/track-builder/package.json`, `apps/client/vite.config.ts`, `apps/track-builder/vite.config.ts`
(confirmed by direct read for §3's cross-surface mechanism: existing workspace dependencies, existing
`exports` map, existing per-app inline styling, existing Vite tooling — technical facts only, not
design/style inputs, consistent with §0's treatment of these same files' current CSS values as
out of scope).

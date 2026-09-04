# Screens inventory — every Screen the game has, is named for, or will plausibly need

> Single consolidated research note under `docs/research/`, replacing the two separate files
> this was split across (`m4-screens-inventory.md` and `game-screens-full-lifecycle.md` — both
> superseded and removed, their content merged here so there is one place to read, not several).
> Parallel to `docs/research/m4-screens-visual-design.md` (a separate visual-design brief for the
> confirmed M4 set, owned by a different in-progress effort — referenced, not merged, since it's
> a different kind of document with its own owner). This file decides nothing; it's a catalog for
> an upcoming `/grilling` session. Written 2026-09.

## What counts as a Screen here

`docs/adr/0008-react-for-screens.md` draws the line precisely: "the out-of-match UI — menus,
lobby, settings, account/registration, results, the spectator Bet screen — is built with React.
React owns the top-level app shell and routing... the game's fixed-timestep loop never runs
through React." The **HUD** (in-Match overlay: tick/fps now, later the Round timer, dash
cooldown, Power-up, Checkpoint splits) is explicitly *not* a Screen — it "stays plain DOM, drawn
by the game itself... has no place in a component tree" (ADR 0008). `CONTEXT.md`'s "Presentation"
section gives the same boundary as glossary entries: **Screen** = "A full-viewport view shown
*outside* a running Round — main menu, lobby, settings, account/registration, results, the Bet
screen. Screens are React (ADR 0008)." `_Avoid_` for Screen: menu, page, view, route — this
report uses "Screen" throughout.

The **Track builder** (`apps/track-builder`) is explicitly out of scope: it is "a standalone
vanilla-TS app... no React. ADR 0008's React-for-Screens decision covers `apps/client` only"
(`docs/adr/0034-track-builder-free-placement.md`). Separate dev tool, not a player-facing Screen.

Every entry below is tagged **Status** (`confirmed` — named and scoped by an ADR/milestone doc;
`named, unscoped` — the architecture names it but nothing specifies its content; `proposed` — not
in any project doc, this file's own contribution) and, for anything not `confirmed`, a **Priority**
judgment call (`ship-blocking`, `nice-eventually`, `mechanic-gated`) that is explicitly this file's
own opinion, never sourced from a project document unless said otherwise.

## 1. The confirmed M4 flow

```
Main menu → Lobby → [Countdown overlay] → (in-Match: HUD only, not a Screen) → Results → back to Lobby
```

### Main menu — `confirmed`, content unspecified

- **For / when shown:** Entry point of the app once React is adopted. Routes into the Lobby.
- **Citations:** `docs/milestones/M4.md` "Screens" checklist: "Routes: main menu → lobby (...) →
  game → results." `docs/adr/0008-react-for-screens.md` lists "menus" generically as part of the
  out-of-match UI React owns.
- **Gap:** confirmed to exist and to route into Lobby — but nothing beyond that. No spec for what
  buttons/content it actually shows (Play? Create? Settings entry point?). A smaller version of
  the same gap Settings has below: Main menu at least has a *place* in the routing; its *content*
  is exactly as unscoped as Settings'.

### Lobby — `confirmed`

- **For / when shown:** "The gathering before a Round — nicknames, ready toggles, Track
  selection, host start. Ends when the host starts the Countdown." (`CONTEXT.md` "Lobby"). M4
  spec: "lobby (nickname label, ready toggles, Track dropdown from the track-service listing,
  host = first joiner starts when all ready)" (`docs/milestones/M4.md`).
- **Flow:** Main menu → Lobby → Countdown/game; also where Results loops back to ("both players
  return to the lobby and the host may start another Round on another Track" —
  `docs/milestones/M4.md`).
- **Scoped by:** ADR 0040 (transport: "Lobby interactions... travel the existing client↔server
  WebSocket. There is no lobby service and no new transport in M4") and ADR 0038 (Lobby "reads
  the Time Limit, never writes it"). Explicitly excludes for M4: matchmaking, instance
  orchestration, shareable lobby links, party codes/links, chat, private/public toggles.
- **Citations:** `CONTEXT.md` "Lobby"; `docs/milestones/M4.md` "Screens" and "Explicitly NOT in
  M4"; `docs/adr/0040-server-authoritative-phase-same-socket-lobby.md`; `docs/adr/0038-time-limit-lives-on-the-revision.md`.

### Countdown (overlay) — `confirmed`, routing boundary unsettled

- **For / when shown:** "The short delay between Start and the live Round. Characters are
  already spawned but their input is locked." (`CONTEXT.md` "Countdown"). M4 spec: "COUNTDOWN is
  3s from the server Tick: Characters spawned (join order → spawn offset), input locked, cameras
  live" (`docs/milestones/M4.md`).
- **Open question:** ADR 0040 calls it a "countdown overlay" in one line, then lists it alongside
  lobby/game/results as something "React routes read `phase` and render" in another — unresolved
  whether it's a separate routed Screen or an overlay drawn over `<GameCanvas>` (Characters are
  already spawned and cameras already live at this point, per M4.md, which leans toward "overlay
  on the game route" but isn't stated outright).
- **Citations:** `CONTEXT.md` "Countdown"; `docs/milestones/M4.md`; `docs/adr/0040-server-authoritative-phase-same-socket-lobby.md`.

### (In-Match — not a Screen, included only for flow completeness)

The HUD is the sole UI during a Round — "Round timer, Dash cooldown, Power-up held, Checkpoint
splits" (`CONTEXT.md` "HUD"), plain DOM, never through the Screen/React tree (ADR 0008). M4.md's
own HUD checklist: "Round timer from server time, Qualified n/2, personal banner... No live
standings / leadership indicator (deferred)."

### Results — `confirmed`

- **For / when shown:** "The Screen after a Round ends — rank with Qualified ordered by finish
  time and the rest by Track progress, and a way back to the Lobby." (`CONTEXT.md` "Results" —
  the one Match-structure glossary entry that uses the word "Screen" directly). M4 spec: "Results
  rank Qualified by finish time and DNF by checkpoint progress, show falls per player; both
  players return to the lobby and the host may start another Round on another Track; no
  auto-rematch timer."
- **Flow:** RUNNING → ROUND_END → RESULTS (ADR 0040's phase machine); loops back to Lobby.
- **Excludes for M4:** multi-Round advancement/Qualification carry-over, live standings,
  auto-rematch timer.
- **Citations:** `CONTEXT.md` "Results"; `docs/milestones/M4.md`; `docs/adr/0040-server-authoritative-phase-same-socket-lobby.md`.

## 2. Named by the architecture, zero content spec

These appear in ADR 0008 / `CONTEXT.md`'s own Screen list but have no milestone ticket, ADR
decision, or content spec anywhere.

### Settings — `named, unscoped` — **priority: ship-blocking**

- Named once, in ADR 0008's opening list and `CONTEXT.md`'s "Screen" definition (same list,
  verbatim). Not in `docs/milestones/M4.md` at all — not even in M4's own "Explicitly NOT in M4"
  exclusion list, unlike Account/registration and the Bet screen, which *are* explicitly called
  out as deferred. That asymmetry is itself notable: M4 bothered to say "not now" to two Screens
  but didn't even acknowledge this one exists.
- **Why ship-blocking (this file's judgment):** every reference game researched (§4 below) has
  *some* settings surface, and this project already has a fully-controllable Character with
  WASD, pointer-lock free-look, Dash, and (M3.6/M3.7) more input surface, with zero documented
  plan for key rebinding, sensitivity, or audio/video controls. Confirmed-real gap (named,
  unscoped) *and* universal across every researched reference game — the single most confident
  "must exist before real launch" call in this document.
- **Citations:** `docs/adr/0008-react-for-screens.md`; `CONTEXT.md` "Screen" entry.

### Account / registration — `named, unscoped` — **priority: nice-eventually, likely deferred past first ship**

- Named in the same ADR 0008 / CONTEXT.md list. ADR 0008 itself notes React is adopted "when the
  first Screen is built — the M4 match-structure ticket (lobby / results), **or earlier if
  accounts are pulled forward**" — accounts were an open possibility at the time of that ADR but
  were *not* pulled forward: M4.md's "Explicitly NOT in M4" lists "accounts / registration"
  outright. `docs/adr/0032-track-publishing-mocked-author-immutable-revisions.md` independently
  confirms accounts don't exist anywhere yet: "`authorId` is a single hardcoded constant for
  now... When a real Account system lands, this becomes a foreign key."
  `docs/adr/0024-player-identity-and-reconnect-shaping.md` covers *connection* identity (a
  Player id assigned on connect for netcode) rather than any account/registration Screen.
- **Why not ship-blocking (this file's judgment):** Golf With Friends (§4) is a shipped,
  successful party game with zero bespoke account system, relying entirely on platform identity
  — a real data point against the naive "every multiplayer game needs accounts" assumption. A
  nickname-only model (which M4's Lobby already has, per its "nickname label") may be sufficient
  for a long time.
- **Citations:** `docs/adr/0008-react-for-screens.md`; `docs/milestones/M4.md` "Explicitly NOT in
  M4"; `docs/adr/0032`; `docs/adr/0024`.

### The Bet screen (spectator betting) — `named, unscoped` — **priority: mechanic-gated**

- CONTEXT.md defines the mechanics it would serve but never calls Spectator Mode itself a Screen
  (it's a camera state during a still-running Round): "**Spectator Mode**: The camera state a
  Player enters after a Fall that eliminates them — they watch the remaining Players." and
  "**Bet**: A prediction an eliminated Player makes in Spectator Mode about who wins the Round,
  for XP / coins. Keeps eliminated Players engaged." Only the betting *screen* is named as a
  Screen (ADR 0008 / CONTEXT.md's "Screen" list). Explicitly excluded from M4 ("Bet screen and
  spectator betting"); a roadmap "later" item (CLAUDE.md: "Power-ups, Grab, Betting/Spectator,
  level themes, the Skyfall final").
- **Reference-game finding:** none of Fall Guys, Trackmania, or Golf With Friends (§4) has
  anything resembling spectator betting — this appears to be an original design element, not
  borrowed. No reference game's screen layout to crib from; would need to be invented from
  scratch or drawn from a non-cited genre (prediction-market/gambling-app UI patterns) if this
  gets designed.
- **Note:** `CONTEXT.md`'s "Bet" entry already commits to "for XP / coins" as the reward — which
  means an XP/coin *economy* is implied the moment Betting ships (see "Cosmetics shop /
  currency" below), even though no Screen for it exists yet.
- **Citations:** `CONTEXT.md` "Spectator Mode", "Bet"; `docs/adr/0008-react-for-screens.md`;
  `docs/milestones/M4.md` "Explicitly NOT in M4"; `CLAUDE.md` roadmap table.

## 3. Proposed — not in any project document, this file's own contribution

Everything in this section is `proposed`, reasoned from game-design first principles and the
reference-game research in §4. None of it is sourced to a project document unless stated, and
none of it is a decision — it's raw material for a `/grilling` session.

### First-run / onboarding

- **Tutorial / controls-intro Screen or in-Round overlay** — **mechanic-gated / nice-eventually**.
  CLAUDE.md's own design philosophy ("Easy to understand. Hard to master.") plus a growing input
  surface (Dash, Bump, Sliding, later Grab/Power-ups) suggests a cold player won't discover
  ground-only Dash or reduced-input Sliding on their own. Counter-evidence: neither Fall Guys nor
  Golf With Friends (§4) gate players behind a mandatory tutorial Screen — both drop players
  straight into a lobby/menu. A lightweight in-HUD hint may be enough; leaning toward keeping this
  thin.

### Identity

- **Guest/nickname-only play as a first-class, permanent path** — **ship-blocking** (M4 already
  effectively ships this via the Lobby's nickname label; flagging it as a Screen-adjacent
  *decision* worth making explicit — nickname collisions, no persistent profile — rather than a
  default reached by omission, not new work).
- **Profile / stats-summary Screen** — **mechanic-gated** on Account/registration shipping at all.
  Content would draw on `CONTEXT.md`'s own Fall/Qualification vocabulary (falls, wins,
  Qualification rate).

### Social

- **Friends list / party Screen** — **nice-eventually**. Evidenced by Fall Guys's "Lobbies &
  Friends list" and implicit in Golf With Friends' own name/Host-Join flow. M4's Lobby explicitly
  excludes "party codes/links, chat, private/public toggles" — confirmed *deferred*, not
  confirmed *unnecessary*.
- **In-lobby/in-match chat or quick-emote system** — **nice-eventually**, generic genre
  observation (not tied to one specific reference game's mechanic — labeled speculation).
- **Private-lobby-via-code Screen/flow** — **nice-eventually**. Evidenced by Fall Guys's Share-
  Code + Lobby-Code flow. Overlaps a previously-rejected idea: `docs/track-builder-proposal.md`'s
  Czech-language pre-ADR "share code" brainstorm (§15.3: a publish yields a code friends redeem
  into a custom lobby), which ADR 0032 rejected *for its original context* ("lobbies don't exist
  before M4, so there is nothing yet for a 'share code' to be redeemed into"). Now that Lobby is
  real (M4 confirmed), the door isn't closed for the reason it once was — not resurrecting ADR
  0032's decision, just noting the premise changed.

### Progression / economy

- **Character/skin-select Screen** — **nice-eventually**. Flagged as a genuine gap by the earlier
  research pass (nothing in `CONTEXT.md`'s "Character" entry or any ADR describes selectable
  characters/cosmetics at all). CLAUDE.md's own status log already mentions "a MushroomKing
  character model swap" — meaning more than one playable-looking model already exists in the
  codebase with no Screen to choose between them. Both Fall Guys and Golf With Friends (§4) treat
  visual self-expression as close to table-stakes for this genre.
- **Cosmetics shop / currency Screen** — **mechanic-gated**. Fall Guys's Show-Bucks/Fame-Pass
  model and Golf With Friends' "no microtransactions, all earned" model are both valid
  precedents; no evidence in this project's own docs that it intends to build an economy at all.
- **XP/leveling or Season-Pass-style progression Screen** — **mechanic-gated on Betting**. The
  one economy-adjacent Screen with actual textual grounding in this project's own docs (the
  "Bet" glossary entry's "for XP / coins"), not pure genre speculation. Overlaps the Bet screen
  as the "wallet" balance it would need to display.

### Session flow beyond M4

- **Matchmaking / server browser** — **ship-blocking eventually, but can stay minimal**. M4
  explicitly excludes this. Neither Fall Guys (queue-based, no server browser) nor Golf With
  Friends (flat Host/Join, no matchmaking) needed a traditional server-browser Screen — real data
  point against building one here either.
- **Create/Join private match Screen** — **nice-eventually**, distinct from Lobby itself: a step
  *before* Lobby where a host picks "create" vs. "join by code," mirroring Fall Guys's Share-Code
  flow and Golf With Friends' Host/Join split. Likely bundled with the friends/party work above.
- **Spectating a match in progress (a late-joining friend, or a pure non-participant observer)**
  — **mechanic-gated**, distinct from the already-named Spectator Mode (which is specifically the
  camera state an *eliminated* Player enters mid-Round). No camera/UI concept named anywhere for
  this case. Gated on reconnect/spectator-join being prioritized; M4 already defers mid-round
  rejoin entirely.

### Content browsing

- **Player-facing Track browser/gallery** — **nice-eventually, escalating once community Tracks
  outgrow the dropdown**. Distinct from the Track *builder* (a dev tool). M4's Lobby has "a Track
  dropdown from the track-service listing" — a *selection* control, not a *browsing* experience
  (no previews, filtering, curation). Trackmania's Track-Of-The-Day/Cup-Of-The-Day precedent and
  Fall Guys's Show Selector with Creator Round Playlists both suggest a flat dropdown stops
  scaling once there's enough player-authored content (M3's track-service + the Track builder's
  publish flow already produce this content).
- **Leaderboards** — **nice-eventually, higher-value than generic genre convention would
  suggest**. Neither a per-Track leaderboard nor a match-history/stats Screen exists anywhere in
  this project's docs. The Results Screen already computes finish time and Track progress per
  `CONTEXT.md` — a per-Track best-time leaderboard is a natural extension of data already
  computed at Round-end, closely echoing Trackmania's TOTD leaderboard model. This project is a
  Track-authoring game (M3) as much as a Fall-Guys-style Match game, making the Trackmania analogy
  stronger here than the Fall Guys one.
- **Match history Screen** — **nice-eventually, lower priority than leaderboards**. Pure genre
  speculation — none of the three reference games surfaced a dedicated match-history Screen
  distinct from a stats/profile Screen.

### Settings, expanded

- **Accessibility settings** (colorblind modes, subtitle/caption sizing, remap-only controls,
  motion/camera-shake reduction) — **judgment call, not confidently bucketed**. No reference
  game's researched material broke this out as a distinct sub-screen (may exist in all three but
  wasn't surfaced by the searches run — flagged as a gap in this file's own research coverage,
  not a confirmed absence). Given this game leans heavily on physical camera movement
  (spring-arm camera, free-look, ragdoll spins per CLAUDE.md's M1 status), camera/motion
  accessibility options are a plausible real need.

### Failure / edge states

- **Disconnect/error/reconnect Screen(s)** — **ship-blocking for two of three sub-cases**.
  Already an open question in the earlier research pass ("Is there an error/disconnect Screen?"
  — unanswered anywhere). Not one Screen but plausibly three distinct situations: (a) local
  client error/disconnect — bounce to main menu with a toast; **ship-blocking** the moment anyone
  outside the dev team plays. (b) "server full" or version-mismatch at join time; **ship-blocking**
  for the same reason. (c) mid-Round disconnect — M4.md already defines server-*behavior*
  ("Disconnect removes the Character and records DNF; no mid-round rejoin") without defining what
  the disconnected client's own screen shows; **nice-eventually**, since a plain "you were
  disconnected" toast may suffice initially.

### Meta

- **Credits Screen** — **nice-eventually**, pure genre convention, not strongly evidenced either
  way in the reference-game research, low cost, typically added late.
- **Changelog / patch-notes Screen or link** — **nice-eventually**, evidenced by both Fall Guys
  and Trackmania maintaining active, dated public patch-notes pages as their primary
  players-facing communication channel. Likely cheaper as a link to an external page than a
  built-in Screen.
- **Legal (ToS/Privacy Policy) Screen or link** — **ship-blocking only once personal data or
  commercial shipping is involved**. Not sourced to any of the three reference games directly
  (inferred they have one, not confirmed — flagged as inference). Not needed at the current
  dev-only stage; real the moment nicknames, accounts, or telemetry are collected from real
  external players.

### Game-specific / mechanic-driven

- **Round-type-aware Results variants** (Team Round grouping, Survival/Collect-specific stats) —
  **mechanic-gated** on Survival/Collect/Team Rounds shipping, which M4 already defers. No new
  reference-game sourcing here — Fall Guys would be the better analog to research next if this
  gets picked up (it wasn't researched for this specific question in this pass, since §4's
  reference-game research targeted Trackmania/Golf With Friends for *feel*, not Fall-Guys-style
  match-structure detail).
- **Level-select / theme-select Screen** — **mechanic-gated, possibly not a Screen at all**.
  "Level themes" (CLAUDE.md's roadmap "later" row) is undefined anywhere in the project's own
  docs; no basis to say whether this implies a Screen or is purely Module/Track art direction.
- **A "Final Race" / Skyfall transition moment** — **nice-eventually, presentation flourish, not
  necessarily a new routed Screen**. `CONTEXT.md`'s "Final Race" and "Skyfall" entries describe a
  mechanically distinct last-Round experience ("a tall vertical Track the last Players climb;
  first to the top wins"). Genre precedent from other elimination-format games (not sourced to
  any of the three reference games here, none of which have a comparable elimination-ladder
  structure) suggests this beat is often worth its own transition treatment — could be a Results
  variant or a Countdown-overlay variant rather than a wholly new route.

## 4. Reference-game research (primary sources, dated 2026-09-04)

Fall Guys (this project's own match-structure reference), Trackmania and Golf With Friends
(feel/control references per this project's own design conversations) were researched against
official sources; where an official source didn't surface a detail, a secondary source was used
and is flagged inline.

### Fall Guys

Sources: [Introducing Fall Guys Creative](https://www.fallguys.com/en-US/news/introducing-fall-guys-creative)
(fallguys.com, accessed 2026-09-04); Steam/crossplay feature summary via
[Fall Guys Season 6 Mid-Season Update: Crossplay](https://store.steampowered.com/news/app/1097150/view/3090035994582672609)
and [Fall Guys cross-platform progression](https://www.fallguys.com/news/fall-guys-cross-platform-progression-epic-games-accounts)
(fallguys.com, surfaced via search, not independently re-fetched — secondary-corroborated).

Has, that this project has nothing documented for: **Show/Creative browsing** ("Show Selector" —
Mediatonic Rounds plus community Rounds in "Creator Round Playlists"); **My Levels** (a creator's
own published Rounds with Share Codes); **Custom Show / private lobby via Share Code** (host
redeems a code for a private lobby up to 40 players, friends join via a separate Lobby Code);
**Season Pass / Fame Pass** (Show-Bucks-funded cosmetic-tier progression, separate from a shop);
**cross-progression via linked Epic Games Account**; **Lobbies & Friends list**.

Notably absent even in this mature, years-live game: no server browser (queue-based matchmaking
only); no spectator-betting mechanic of any kind — worth noting since Fall Guys is this project's
explicit match-structure reference and yet doesn't have the Bet-screen concept at all.

### Trackmania

Sources: [Differences between the accesses](https://doc.trackmania.com/general/differences-between-the-accesses/)
(doc.trackmania.com, accessed 2026-09-04); [Trackmania access chart](https://www.trackmania.com/access?lang=en)
(accessed 2026-09-04); [What is a Track Of The Day?](https://doc.trackmania.com/play/what-is-totd/)
(accessed 2026-09-04); [Watching Replays](https://doc.trackmania.com/play/watch-replays/) (via
search summary, accessed 2026-09-04).

Has, that this project has nothing documented for: **access-tier/subscription screen** (Starter
free vs. Club paid, gating campaigns/TOTD/COTD/cosmetics/hosting — not directly applicable to a
non-subscription game, but a concrete precedent for gating content behind an account tier);
**Club system** (a persistent social/organizational unit above a single Lobby); **Track Of The
Day / Cup Of The Day** (rotating featured community Track with its own 24-hour leaderboard and a
timed event — concrete precedent for a daily/rotating featured-Track screen); **replay/ghost
spectating** (load or watch a top player's ghost run — a cheaper "watch a replay" screen than live
match spectating); a **fully-integrated Track editor** inside the main game (contrast point
against this project's own ADR 0034 decision to keep the Track builder standalone).

Notably absent: no Season Pass or paid-currency cosmetic shop (subscription + car skins instead);
no spectator-wagering concept.

### Golf With Friends (Golf With Your Friends)

Sources: [Golf With Your Friends on Steam](https://store.steampowered.com/app/431240/Golf_With_Your_Friends/)
(store.steampowered.com, accessed 2026-09-04 — treated as primary since it's the
developer/publisher's own storefront copy); menu-structure detail cross-checked against
[the game's Fandom wiki](https://golf-with-your-friends.fandom.com/wiki/Golf_With_Your_Friends)
(secondary source, accessed 2026-09-04, used only because the Steam page didn't itself enumerate
the main-menu button layout).

Has, that this project has nothing documented for: a **notably minimal Host/Join/Options/
Customise main menu** (per the secondary wiki source; the general "host a lobby, join, options,
customise" summary is corroborated by the Steam-page fetch) — good precedent for how little a
chaotic party game's main menu needs, and a data point that this project's own confirmed
Main-menu-into-Lobby flow is directionally right, not under-scoped; an **in-lobby match-settings
screen** (time limit, stroke limit, ball shape configured inside lobby creation, not a separate
settings screen — precedent for folding per-Round-type rule toggles into Lobby once Round types
beyond Race exist); a **cosmetic customization screen** (ball skins/hats/trails, all earned,
explicitly no microtransactions — a concrete precedent for an entirely earned cosmetics model);
**Steam Workshop browsing** (community courses via the platform's own content system rather than
an in-game browser — more a "watch for later" than an actionable precedent, since this project
isn't shipping on a platform with a Workshop equivalent).

Notably absent: no ranked ladder, no Season Pass, no spectator mode of any kind, no accounts
beyond platform (Steam) identity — a strong signal that a small party game can ship indefinitely
on platform-identity alone with zero bespoke account/registration screen.

## 5. Open questions — searched for, not found anywhere

Searched `CLAUDE.md`, `CONTEXT.md`, every `docs/adr/*.md`, every `docs/milestones/*.md`,
`docs/research/*.md`, `docs/track-builder-proposal.md`, `docs/networking-model.md`, and
`.scratch/**` (grepped case-insensitively for `screen`, `lobby`, `menu`, `result`, `settings`,
`error`, `disconnect`, `character.?select`):

- **Countdown's routing boundary** — own routed Screen, or an overlay on `<GameCanvas>`? See §1.
- **Settings' actual content** — audio? video/graphics? key rebinding? Nothing implemented or
  planned yet in `apps/client`.
- **A character-select Screen** — no hits anywhere. The MushroomKing model swap is a completed
  asset change with no indication of player-facing choice; no ADR or `CONTEXT.md` entry describes
  selectable characters/cosmetics as a concept at all yet.
- **Does the Track builder ever fold into an in-shell "Create" Screen?** ADR 0034 raises this only
  to defer it ("...happens if/when M4 ships that shell, not before"). M4.md doesn't pick it up —
  the builder stays standalone through M4. Genuinely open, no shape yet.
- **What does a Team/Survival/Collect Round's Results Screen look like?** Both deferred past M4;
  no doc says whether they'd reuse the M4 Results layout unchanged or need a variant.
- **"Level themes"** — no definition anywhere beyond the bare CLAUDE.md roadmap phrase. Cannot
  determine whether this implies any UI Screen or is purely a Module/Track art-direction concept.
- **`docs/track-builder-proposal.md`'s "share code" / "custom lobby" idea (§15.3)** — a pre-ADR,
  Czech-language brainstorm doc predating the ADR sequence; ADR 0032 rejected it for its original
  context (lobbies didn't exist yet). Superseded/non-authoritative for current scope, but the
  only place in the repo that even gestures at a "join via code" lobby-entry Screen variant — see
  the "Private-lobby-via-code" entry in §3, which notes the premise for that rejection has since
  changed (Lobby is now real, per M4).

## 6. Prioritized shortlist — recommendation for where to start a `/grilling` session

Explicitly this file's own judgment, not a decision, not sourced from any project document:

1. **Settings, for real this time.** Already-named-but-empty in the architecture docs, universal
   in every reference game researched, and increasingly overdue given the input surface already
   in place (WASD, free-look, Dash, upcoming Sliding/ramp movement in M3.6).
2. **Disconnect / server-full / version-mismatch handling on the client.** Server-side behavior
   is already spec'd (M4.md); the client-side screen is the missing half, invisible in 2-browser
   dev testing but immediately visible the moment anyone outside the team plays.
3. **Character/skin-select.** Low mechanical risk (no netcode/physics implications), an existing
   asset precedent (MushroomKing), genre-standard self-expression per both reference games.
4. **A real Track browser**, once community Tracks outgrow the M4 Lobby dropdown — worth scoping
   the *trigger condition* now even if the Screen itself waits, since Trackmania's TOTD-style
   model is a strong, well-evidenced pattern to design toward.
5. **Everything else** — friends/parties, matchmaking, accounts, economy, Betting's wallet,
   leaderboards, credits/changelog/legal — treated as explicitly **not** first-wave: either
   mechanic-gated on features not yet built (Betting, Round types beyond Race), or genuinely
   deferrable the way Golf With Friends' account-free, economy-free model proves viable for this
   exact genre.

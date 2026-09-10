# `test_components` design screens — gap analysis before real wiring

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and `docs/milestones/`
> (specs) — see `docs/research/codebase-audit-m5.md` for the convention this follows. Read-only
> inventory; nothing here was implemented or reverted. Written 2026-09-10, against the working
> tree at commit `38b1870` plus the uncommitted `apps/client/src/App.tsx` / `main.tsx` edit and the
> untracked `apps/client/src/test_components/` and `.scratch/m8.1-free-roam/` directories.

## Summary

`apps/client/src/test_components/` is a self-contained React app — its own `App.tsx`, `main.tsx`,
a `ui/` component kit, a `screens/` folder, its own `styles/tokens.css` — dropped into the repo
whole. Its own `App.tsx:7` calls itself a "**Dev harness: pick a screen, see it fluid at any
width. Not part of the game shell**," and its `screens/index.tsx` is a flat catalogue of 24
mock IDs (`1a`…`1x`) cross-referenced against an external HTML spec, all marked `built: true`
meaning "ported from the mock," not "wired to anything." Every screen takes optional callback
props but defaults every value to hardcoded demo data and manages its own `useState` — there is
no shared app state, no data-fetching hook, and (checked) zero test files anywhere under the
directory. This is Figma-to-code output, not a partially-wired feature branch.

The real app already has a materially more advanced, and different-shaped, Screen layer than
`test_components` assumes: `LobbyScreen`, `StandingsScreen`, `LoadingScreen`, `MainMenuScreen`,
and `PracticeHud` are real, tested, server-driven React components wired through one typed
boundary (`GameCanvas.tsx`) into the game's own snapshot callbacks
(`onLobbyState`/`onStandings`/`onPracticeState`) and command methods (`handleRef.current.start()`,
`.setReady()`, etc.) — see `apps/client/src/components/GameCanvas.tsx:60-206`. `test_components`
was seemingly designed against an older or purely aspirational idea of the game (room codes,
lobby capacity, "AUTO-START" timers, per-round point deltas, XP/currency, friends, spectator
betting) rather than against this contract, and several of its mocked mechanics do not exist in
`packages/shared`'s simulation at all (multi-charge Dash, Hit combo/damage numbers, a mash-to-fill
get-up minigame, a Grab break-free struggle).

**Top-line risk:** the rough first-pass wiring attempt (uncommitted `git diff` on `App.tsx`/
`main.tsx`) replaces the real, working `/play` route — which already branches into either a real
Match connection or M8.1's local free-roam practice session — with a bare, prop-less
`<Lobby />` mock. That change does not "wire in" anything; it deletes the only place
`<GameCanvas>` (and therefore the whole simulation/render/network stack) ever mounts. Applied as-is
it breaks both real multiplayer play and the already-implemented free-roam practice mode
simultaneously, while introducing at least one direct, named architecture violation (a React
`RaceHUD`, contradicting ADR 0008's "the HUD stays plain DOM… never React"). None of this is a
reason not to use the visual designs — it is the reason the user's own framing ("wire this into
our backend... it will replace everything even in ADRs") needs to become real tickets, several of
which are ADR-superseding decisions, not component plumbing.

**A secondary finding, load-bearing for scoping:** `CLAUDE.md`'s own "Status" section is stale.
It says "**Next: M7**", but M7 (tickets 01–12) and M8 (asset-backed Modules, ADR 0050) are already
committed (`git log`: `e8624ed` through `38b1870`), and M8.1 (free-roam practice) is already
implemented in code (`apps/client/src/game/practice.ts`, `PracticeHud.tsx`,
`GameCanvas.tsx:60-162`) even though its own ticket files in `.scratch/m8.1-free-roam/issues/*.md`
still say `Status: planned`. Anyone scoping this work from `CLAUDE.md` alone will underestimate
how much real Screen infrastructure already exists and get M8.1's status backwards.

## Screen-by-screen inventory

All 24 `screens/index.tsx` entries, `apps/client/src/test_components/src/screens/`. "Status" is
this file's classification, not the source's own `built` flag (which only means "ported from the
mock," not "functional"). Every screen is 100% presentation — none differs enough on this axis to
need repeating per row, so it's stated once here: **all 24 use local `useState` for their own
interactive bits (tabs, toggles, sliders) and all data comes from prop defaults equal to hardcoded
demo objects; none reads any hook, context, or module-level store.**

| # | Screen | Real equivalent | Gap to close |
|---|---|---|---|
| 1a | `MainMenu.tsx` | `apps/client/src/screens/MainMenuScreen.tsx` (real, tested) | Real screen is one wordmark + tagline + Play button (`MainMenuScreen.tsx:6-25`). Mock adds player name/level/online count, a Survival/Build mode split, Discover/Leaderboards/Collection nav, and 3 stat tiles — all backend concepts that don't exist (see gaps below). |
| 1b | `RaceHUD.tsx` | `apps/client/src/hud/hud.ts` + `hudText.ts` (real, plain DOM) | **Not a Screen at all in the real architecture** — see ADR conflicts. Also invents fields the sim doesn't track: personal-best time, "position/field" ranking readout. |
| 1c | `Grabbed.tsx` | Grab exists in sim (`packages/shared/src/simulation/GrabController.ts`), no React/HUD surface for it today | Mock shows a mash-to-break-free progress meter; `GrabController.ts:18-33` has no escape/struggle mechanic at all — only a hold + post-release cooldown. The UI implies a mechanic that isn't built. |
| 1d | `SurvivalEndgame.tsx` | No real equivalent Screen; Survival Round state is real (`RoundType.ts`, `eliminated` boolean) | "Critical zone," alive-avatar strip, "started with N" are presentation choices with no wire data cited; would need real per-Round population/elimination-order data, which does exist server-side (`buildResults`, M7 ticket 02) but nothing client-side renders it live. |
| 1e | `Elimination.tsx` | No real equivalent; overlaps `StandingsScreen`'s "This Round" row (`fallCount`, `dnf`, `checkpointIndex`) | "Grabs broken," "beans left" have no backing fields. Real per-Player Round outcome is `ResultsRow` (`StandingsScreen.tsx:1,33-37`) — narrower than this mock assumes. |
| 1f | `Discover.tsx` | Partially: track-service's `/tracks` listing, consumed today only by the host's Track picker in `LobbyScreen.tsx:59-72` | Real listing is `{id, name}` (`TrackListing`, per `codebase-audit-m5.md` §3.3). Mock's ratings, play counts, "best time," author name, filter tabs (Trending/Survival/Race/New) are all unbacked. |
| 1g | `TrackBuilder.tsx` | `apps/track-builder`, a **separate standalone vanilla-TS app** (ADR 0034) | Direct architecture conflict, not just a missing-backend gap — see ADR section. |
| 1h | `SystemSheet.tsx` | None, and needs none — a design-token reference page | Lowest priority; harmless to keep as an internal dev artifact, never route it into the shipped app. |
| 1i | `Lobby.tsx` | `apps/client/src/screens/LobbyScreen.tsx` (real, tested, fully wired) | Real Lobby already has: player list with per-row ready state, host-gated nickname/track/round-type/match-length controls, per-Round-slot Track/type pick (M7 ticket 05), a server-supplied `startBlockedReason` (M5 ticket 07). Mock has none of that plumbing and invents unbacked concepts instead: room code (`WOBBLE-4471`), numeric capacity/"slots open," "INVITE FRIENDS," a "PRIVATE" chip, and an "AUTO-START IN 0:24" countdown — none of which exist in ADR 0040's lobby model (no matchmaking, no party codes, no private/public toggle — explicitly excluded, `docs/research/screens-inventory.md:62-63`). |
| 1j | `Spectator.tsx` | Spectator Mode is real (`apps/client/src/game/spectator.ts`, M7 ticket 07/08) but has **no Screen at all** today — `GameCanvas.tsx` never renders one while spectating | The follow/switch mechanic (`SpectatorController.nextSpectatorTarget`, `spectator.ts:44-51`) genuinely maps to the mock's Q/E switcher. Everything else — odds, stakes, "ALL IN," payout math, a running bean balance — is the **Bet** mechanic, explicitly unbuilt (`CONTEXT.md` "Bet"; `CLAUDE.md` roadmap "later" row) and confirmed absent from `apps/server/src` and `packages/shared/src` (no `bet`/`wager`/`odds` hits anywhere outside comments). |
| 1k | `BetweenRounds.tsx` | `apps/client/src/screens/StandingsScreen.tsx` (real, tested, ADR 0051-current) | Real Standings gates the next Round on a **per-Player Ready confirmation with a timeout ceiling**, no group timer (ADR 0051). Mock has a `ReadySwitch` wired to an "AUTO-START IN 0:14" countdown and no per-player confirmed indicator — the opposite of what ADR 0051 deliberately replaced (see ADR section). Also shows placement deltas ("moved +2") not present in `Score.ts`'s model. |
| 1l | `MatchOver.tsx` | Overlaps `StandingsScreen`'s `!roundsRemaining` state (winner banner, `winnerLabel`, `StandingsScreen.tsx:39-44,76-84`) | Real end-of-Match screen is the *same component* as between-Round Standings, just a different prop state, with one "Main Menu" action (ADR 0051). Mock is a separate 3-podium screen with a "COLLECT REWARDS" action implying an XP/currency system that does not exist. |
| 1m | `CharacterSelect.tsx` | None anywhere | Confirmed absent — see gaps below. |
| 1n | `Login.tsx` / `Auth.tsx` | None anywhere | No account system exists at all — confirmed absent, see gaps below. |
| 1o | `Settings.tsx` / `SettingsModal.tsx` | None; `docs/research/screens-inventory.md:105-118` already flagged Settings as "named, unscoped… ship-blocking" | Confirmed still true. No audio/video/key-rebind persistence anywhere in `apps/client`. |
| 1p | `Rewards.tsx` | None | Depends entirely on an XP/currency/cosmetics-unlock economy that does not exist (see gaps). |
| 1q | `Countdown.tsx` | Real Countdown is a plain-DOM banner drawn over the **live** `<GameCanvas>` (`hud.ts`'s `setBanner`, ADR 0040/0051's "only Countdown and Running ever show the live Match") | Mock is a full-screen takeover with grid spot, PB, per-round track/mode chips — none of which the real Countdown reads or the protocol carries (no personal-best tracking anywhere). |
| 1r | `FinishedOrOut.tsx` | Overlaps `StandingsScreen`'s per-row `ResultsRow` data | Two-beat "Finished" then "Knocked Out" sequence with points-off-PB — no PB tracking exists; "points" language predates ADR 0049's percentile Score model. |
| 1s | `HitFeedback.tsx` | Hit is real (`HitController.ts`, `CharacterController.ts:1278` `hitChargeMs`) | Mock invents a damage number, a combo counter, and a "stagger, one more and you ragdoll" meter. Real Hit has none of these — it is a single charge-fraction-scaled impulse (`RapierSimulation.ts:548`, `hitImpactMagnitude`) that either knocks down or doesn't; there is no persistent damage/HP or combo state anywhere in `packages/shared`. |
| 1t | `DashFeedback.tsx` | Dash is real (`DashController.ts`, `tuning.ts:173-201`) | Mock shows 2-of-3 stored "dash charges" that recharge independently. Real Dash is **one** charge on a single cooldown (`DASH_COOLDOWN_MS = 1500`, `DashController.ts:11-77`) — a materially different resource model, not just missing UI wiring. |
| 1u | `Ragdoll.tsx` | Ragdoll/GettingUp is real (`CharacterStateMachine.ts`) | Mock's "GET UP — MASH SPACE" is a player-input minigame. Real GettingUp is **uninterruptible and timer-driven** — `CharacterStateMachine.ts:25`: "`GettingUp → Controlled (after GETUP_TICKS — uninterruptible…)`". The mechanic the mock depicts doesn't exist. |
| 1v | `Profile.tsx` | None | Depends on account + persistent-stats systems that don't exist. |
| 1w | `Friends.tsx` | None | No friends/social graph anywhere — confirmed absent. |
| 1x | `FriendRequestAlert.tsx` | None | Same as above. |

## Backend/domain gaps

Grepped `apps/server/src`, `packages/shared/src`, `apps/track-service/src`, `docs/adr/*.md`.

- **Accounts / auth — does not exist.** No password/JWT/session/login code anywhere real.
  `apps/track-service/src/schema.ts:10`, `store.ts:12`, `db.ts:41` all say the same thing in
  different words: a Track's `authorId` is `DEFAULT_AUTHOR_ID`, a hardcoded constant, "until a
  real Account system exists." `apps/track-service/src/index.ts:67` calls itself a "dev-only,
  no-auth internal service." Player identity today is connection-scoped only: a server-assigned
  session id plus a `sessionToken` bearer credential for ADR 0024's reconnect-parking window
  (`packages/shared/src/net/protocol.ts:24-34,252`), not an account. `Login.tsx` and `Auth.tsx`
  need a system that has zero backing today — this is new scope, not wiring.
- **Friends / social graph — does not exist.** No hits for `friend`/`social`/`party` anywhere in
  `apps/server/src` or `packages/shared/src` outside unrelated comment usages ("party-game
  ceiling," `tuning.ts:932`). `Friends.tsx` and `FriendRequestAlert.tsx` are pure invention.
- **Rewards / XP / currency / cosmetics — does not exist.** `CONTEXT.md`'s own **Score** entry
  explicitly distinguishes Match-scoped Score from "XP and coins, which persist across
  Matches" — naming the concept as intended, unbuilt. `packages/shared/src/match/Score.ts` only
  computes the percentile, Match-scoped Score ADR 0049 defines; there is no XP, no currency, no
  unlock/cosmetic-ownership model anywhere. `MatchOver.tsx`'s "COLLECT REWARDS," `Rewards.tsx`
  wholesale, `CharacterSelect.tsx`'s locked/owned skins, and `Profile.tsx`'s badges/XP bar all
  depend on this. **New scope**, not a wiring task.
- **Spectator Mode — partially exists.** Real and wired at the sim/client layer: `spectators` set
  on the server (`apps/server/src/match/matchRuntime.ts:95`), `SpectatorController` client-side
  (`apps/client/src/game/spectator.ts`), M7 tickets 07/08 committed. **No Screen renders it** —
  `GameCanvas.tsx` has no spectator branch at all today (compare its explicit `LobbyScreen`/
  `StandingsScreen`/`PracticeHud` branches, `GameCanvas.tsx:164-196`, with nothing for spectating).
  `Spectator.tsx`'s follow/switch UI has a real backing mechanism to wire to; its betting UI (odds,
  stakes, payout, balance) does not — **Bet** is explicitly unbuilt (`CONTEXT.md`, `CLAUDE.md`
  roadmap "later").
- **Character selection / cosmetics — does not exist.** Every `skin` hit in `packages/shared/src`
  is either Rapier's physics contact-skin margin (`tuning.ts:232`, `RAGDOLL_CONTACT_SKIN`) or the
  `Avatar` initials rendering in `LobbyScreen.tsx` — nothing about a selectable player model or
  owned cosmetic. `docs/research/screens-inventory.md:204-209` already flagged this as a genuine
  gap in 2026-09; still true. `CharacterSelect.tsx` is new scope.
- **Matchmaking / server browser / Track discovery — mostly does not exist.** No matchmaking or
  browse code in `apps/server/src`. track-service's only listing consumer is the Lobby's host-only
  Track picker (`LobbyScreen.tsx:59-72`), a flat `{id, name}[]`
  (`docs/research/codebase-audit-m5.md` §3.3's `StoredTrack`/`TrackListing`) — not the richer
  ratings/plays/author/filter model `Discover.tsx` assumes.
- **Hit / Grab / Ragdoll replicated state — exists, partially.** `hitChargeMs`
  (`state/SimState.ts:59,230,269,296`) and `grabCooldownMs`-equivalent cooldown state are real and
  replicated, and `CharacterStateMachine`'s `Controlled → Stagger → Ragdoll → GettingUp →
  Controlled` machine (ADR 0006) is the real state a HUD element could read. But no React
  component reads any of it today (the real HUD renders none of this per-Character feedback — see
  `hud/hudText.ts`), and — separately from wiring — the *mechanics* `HitFeedback.tsx`/
  `DashFeedback.tsx`/`Ragdoll.tsx`/`Grabbed.tsx` depict (damage numbers, combo counters, multi-
  charge Dash, a mash-to-fill get-up bar, a Grab break-free struggle) do not match what
  `packages/shared`'s simulation implements (see table above, rows 1c/1s/1t/1u). Wiring these
  screens to real data would first require deciding whether to build the mocked mechanics for
  real, or redesign the screens around the mechanics that exist.
- **Track builder — exists, wrong app.** Real and complete (`apps/track-builder`), but ADR 0034
  places it outside `apps/client`/ADR 0008 entirely: "The Track builder stays a standalone
  vanilla-TS app... no React. ADR 0008's React-for-Screens decision covers `apps/client` only"
  (`docs/adr/0034-track-builder-free-placement.md:48-49`). `TrackBuilder.tsx` re-implements it as
  an `apps/client` React screen — an architecture conflict, not a missing-backend gap.

## ADR/architecture conflicts

- **ADR 0008 ("React for Screens, not for the HUD") vs `RaceHUD.tsx`.** ADR 0008: "The **HUD**
  (the in-match overlay… stays plain DOM, drawn by the game itself. It updates every frame and has
  no place in a component tree" (`docs/adr/0008-react-for-screens.md:10-12`). The real HUD is
  `apps/client/src/hud/hud.ts:1-11`, whose own docstring quotes this ADR verbatim: "plain DOM,
  drawn by the game itself, never by the Screen framework (ADR 0008)." `RaceHUD.tsx`
  (`apps/client/src/test_components/src/screens/RaceHUD.tsx:28-77`) is a routed React component
  (mounted at `/race` in the diff'd `App.tsx`) rendering exactly the per-frame telemetry ADR 0008
  says must never be a component — position, clock, checkpoint pips. This is a direct,
  unambiguous contradiction; adopting it as-is means either superseding ADR 0008 or redesigning
  `RaceHUD` as plain-DOM markup the game itself drives (closer to how `hud.ts`/`hudText.ts` work
  today).
- **ADR 0034 ("Track builder stays standalone") vs `TrackBuilder.tsx`.** Cited above
  (`docs/adr/0034-track-builder-free-placement.md:48-49`). `TrackBuilder.tsx` folding the builder
  into `apps/client` as a React route (`/builder` in the diff) is exactly the move ADR 0034
  explicitly declined to make. Not fatal — ADR 0034 leaves the door open ("folding Track-building
  into a React [shell]... happens if/when M4 ships that shell, not before," per
  `docs/research/screens-inventory.md:395-396`) — but it needs its own superseding decision, not a
  silent route addition.
- **ADR 0051 ("Standings gates on confirmation, not a timer") vs `BetweenRounds.tsx`/`Lobby.tsx`.**
  ADR 0051's whole second correction is dropping a bare server timer in favor of an everyone-
  confirms gate with a timeout ceiling as the safety net, specifically because "with
  `nextRoundReady` typically already true… the between-Round Standings phase lasts about one
  server tick" under a pure timer
  (`docs/adr/0051-screens-stop-riding-the-live-match-standings-gates-on-confirmation.md:58-61`).
  `BetweenRounds.tsx:31,50-53,120-128` reintroduces exactly that: a controlled `ReadySwitch` tied
  to a decorative `autoStart` countdown string ("AUTO-START IN 0:14") with no per-Player confirmed
  state shown. `Lobby.tsx:34,68,166-168` does the same for the pre-Match Lobby ("AUTO-START IN
  0:24") — the real Lobby has no autostart at all; it's host-gated on `allReady`
  (`LobbyScreen.tsx:278`, `allReady(lobby.players)`). Wiring these mocks in as-is would
  functionally revert ADR 0051's decision.
- **ADR 0051's `LiveOverlay`/`isSceneLive` retirement vs the diff's `main.tsx` change.** ADR 0051
  says "`LobbyScreen`, the new `LoadingScreen`, and `StandingsScreen` stop using the `LiveOverlay
  isSceneLive`… pattern" (consequences section) — `packages/ui/src/components/LiveOverlay` still
  exists as a component precisely for the Screens that *do* legitimately sit over a live scene
  (Countdown, Spectate). The diff'd `main.tsx` comments out
  `@dont-fall/shared/design/tokens.css` — the real design-token source every `@dont-fall/ui`
  component (`packages/ui/src/components/*`, thirteen components including `LiveOverlay`,
  `Screen`, `Modal`) is built against — in favor of `test_components`'s own, separate
  `styles/tokens.css`. This doesn't just risk visual breakage in the screens that stay real
  (`LobbyScreen`, `StandingsScreen`, `LoadingScreen`, `PracticeHud` all import `@dont-fall/ui`
  components styled by the retired tokens); it means two parallel, differently-named design-token
  systems and two component kits (`@dont-fall/ui`'s 13 components vs `test_components/ui/`'s 17)
  would coexist with no reconciliation plan.

## M8.1 free-roam impact

M8.1 (free-roam practice) is **already implemented**, not merely planned — `.scratch/m8.1-free-
roam/issues/01-practice-boot.md` through `04-*.md` all say `Status: planned`, but the code they
describe is real and already committed/working:

- `apps/client/src/App.tsx:44-72` (`PlayRoute`, `parsePlayParams`) already parses `?track=` and
  `?freeroam=1` and boots either a practice session or a Match connection through the same
  `<GameCanvas>`.
- `apps/client/src/game/practice.ts` (`startPracticeGame`) is a real, tested, server-free local
  session (`practice.test.ts:19`: "constructs no socket and imports no netcode — a practice
  session that reaches the server is a bug").
- `apps/client/src/components/GameCanvas.tsx:31,70-75,153-162` has a full `practice` branch:
  passes `practice: true` into `startGame`, wires `onPracticeState`, and renders `<PracticeHud>`
  instead of any Match Screen.
- `apps/client/src/screens/PracticeHud.tsx` is the real, tested (`PracticeHud.tsx` has a
  `.test.tsx` sibling) hint-bar-plus-toast UI M8.1 ticket 03 asked for.

**The diff'd `App.tsx` change deletes all of this from the routed path.** It replaces
`<Route path="/play" element={<PlayRoute />} />` with `<Route path="/play" element={<Lobby />}
/>` (the `test_components` mock, no props). `PlayRoute` itself is left as dead code in the file —
never referenced from `<Routes>` — so `<GameCanvas>` never mounts on `/play` at all:

- **Free-roam breaks completely.** `?track=X&freeroam=1` now resolves to a static Lobby mock with
  hardcoded demo players and no query-param awareness (`Lobby.tsx` has no `useSearchParams` call,
  no `trackId`/`practice` prop). The Track builder's own Playtest button (M8.1 ticket 04, already
  live) opens `/play?track=X&freeroam=1` expecting exactly the practice boot this route no longer
  performs — the author would land on a fake lobby with fabricated players instead of their Track.
- **Real multiplayer Match play breaks too, for the same reason** — not just practice. Since
  `<GameCanvas>` never mounts, no socket ever opens, `LobbyScreen`/`StandingsScreen`/`LoadingScreen`
  never render (they only render *inside* `GameCanvas`, driven by its `onLobbyState`/`onStandings`
  callbacks — `GameCanvas.tsx:167-196`), and nothing the mock `Lobby.tsx`'s "START MATCH" button
  does can start anything real, because it has no `onStart` wired to any handle.
- **No teardown discipline is violated by the change itself** (there's nothing to tear down — the
  game simply never boots), but this silently erases M4 ticket 01's teardown guarantees for every
  `/play` visit, since the component that owns them (`GameCanvas`) is no longer reachable.

Net: this isn't "the mock needs its data wired in" — the naive edit actively **removes a working,
already-shipped feature** (free-roam) and the entire real Match path along with it. Any real
integration has to reintroduce `PlayRoute`'s branching (or a `Lobby.tsx` that accepts the same
`LobbySnapshot`/callback contract `LobbyScreen` already does) rather than replace the route
wholesale.

## Proposed follow-up tickets

Titles + one-line scope + rough size + blocker, not full ticket bodies.

**Decisions (ADR-superseding) — must land before any component wiring starts:**

1. **Decide the HUD boundary for in-match reaction overlays** (Hit/Dash/Ragdoll/Grab feedback) —
   does ADR 0008's plain-DOM HUD rule extend to these, or do they get the Countdown/Spectate
   precedent ("content over a live scene," ADR 0051) as a carved-out React exception? — *Small
   (a decision + a short ADR), blocks tickets 6–9 below.*
2. **Decide whether `TrackBuilder.tsx` supersedes ADR 0034** or is dropped from scope — folding
   the builder into `apps/client` is a real architecture change, not a component port. — *Small,
   blocks ticket 10.*
3. **Reconcile `@dont-fall/ui` vs `test_components/ui/`** — pick one component kit and one design-
   token source (`packages/shared/design/tokens.css` vs `test_components/styles/tokens.css`), or
   define a migration path; today's screens (`LobbyScreen`, `StandingsScreen`, `LoadingScreen`,
   `PracticeHud`) depend on the former. — *Medium, blocks all Screen-wiring tickets.*
4. **Scope decision: which unbacked systems actually get built** (accounts, friends, XP/currency/
   cosmetics, Bet/spectator wagering, character select) **vs which mocks get cut or deferred** —
   this is a product-roadmap call, not an engineering one, but it gates tickets 11–16. — *Large
   (a scoping/grilling session), blocks the bulk of the backend tickets.*

**Component-wiring tickets (real backend already exists):**

5. **Wire `Lobby.tsx`/`BetweenRounds.tsx` visuals onto `LobbyScreen`/`StandingsScreen`'s real
   props** — reskin the tested, server-driven components with the new design rather than routing
   to the standalone mocks; drop the invented room-code/capacity/autostart fields. — *Medium,
   blocked by ticket 3.*
6. **Restore `PlayRoute`'s practice/Match branching** under whatever the new Lobby/route shape
   becomes — non-negotiable before `/play` can ship in any form. — *Small, blocked by ticket 5.*
7. **Reskin `MainMenu.tsx` onto `MainMenuScreen`**, dropping the mode tiles/nav items with no
   backend (Survival/Build/Discover/Leaderboards/Collection) until ticket 4 decides their fate.
   — *Small, blocked by ticket 4 for scope, otherwise unblocked.*
8. **Give Spectator Mode a real Screen**, wiring `Spectator.tsx`'s follow/switch UI to
   `SpectatorController`/`livingIds`/`nextSpectatorTarget` — the one `test_components` screen with
   a fully real, unused backend today. — *Medium, blocked by ticket 1 (overlay-vs-HUD decision).*
9. **Build the plain-DOM (or ADR-exempted) Hit/Dash/Ragdoll/Grab reaction overlays** against the
   *real* mechanics (single-charge Dash, no damage/combo, uninterruptible timed get-up, no Grab
   escape) — this is a redesign against real data, not a reskin of `HitFeedback`/`DashFeedback`/
   `Ragdoll`/`Grabbed`. — *Large, blocked by ticket 1.*
10. **Decide and implement the Track builder's design-system fate** per ticket 2's decision
    (reskin `apps/track-builder`'s own vanilla-TS UI to match, or formally fold it into
    `apps/client`). — *Large, blocked by ticket 2.*

**Backend tickets (new scope, only after ticket 4's product decision):**

11. **Accounts/auth** — needed by `Login`/`Auth`/`Profile`/`Settings`'s "log out," and as the FK
    target `track-service`'s `authorId` already anticipates. — *Large, blocked by ticket 4.*
12. **Friends/social graph** — needed by `Friends`/`FriendRequestAlert`. — *Large, blocked by 4
    and 11 (needs accounts first).*
13. **XP/currency/cosmetics-ownership model** — needed by `Rewards`, `MatchOver`'s "collect
    rewards," `CharacterSelect`'s locked/owned skins, `Profile`'s badges/XP bar. — *Large, blocked
    by 4 and 11.*
14. **Bet / spectator wagering** — needed by `Spectator.tsx`'s odds/stakes/payout panel; explicitly
    named-but-unbuilt in `CONTEXT.md` already. — *Large, blocked by 4, 11, 13 (wagers a currency
    that doesn't exist yet).*
15. **Character selection** — a selectable/equippable model, distinct from ticket 13's ownership
    data — needed by `CharacterSelect.tsx`'s turntable. — *Medium, blocked by 4 and 13.*
16. **Track discovery/browsing** — richer `track-service` metadata (ratings, plays, author,
    filters) beyond today's flat `{id, name}` listing — needed by `Discover.tsx`. — *Medium,
    blocked by 4; independent of the account tickets.*

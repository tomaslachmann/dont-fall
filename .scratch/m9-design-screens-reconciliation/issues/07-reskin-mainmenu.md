# 07 — Reskin `MainMenu.tsx` onto `MainMenuScreen`

**What to build:** Apply the new visual design to the real `MainMenuScreen`, dropping every nav
item/tile the mock adds that has no backend.

**Blocked by:** nothing — ticket 04 is decided (**ADR 0052**), all of these systems are in scope,
just not all built yet (see below).

**Status:** planned — scope resolved, ticket itself unstarted

## Decided scope (ADR 0052)

Every nav concept the mock adds is now real *eventual* scope, not cut — but most of the backend
tickets it depends on (11–16) aren't built yet, and this game is mandatory-login-gated once ticket
11 lands, which changes what "player name/level" even means here. Don't build ahead of the backend
tickets: player name/level and online count wait on tickets 11/13; Discover waits on ticket 16;
Collection waits on ticket 13; a Leaderboards concept has no ticket at all yet (raise it as a new
one if it's wanted, don't build it speculatively here). Render only what has a real ticket already
shipped by the time this lands; anything else stays off the menu rather than becoming a dead link
or a second "not implemented" stub alongside ticket 15's.

## Why

The real `MainMenuScreen` (`apps/client/src/screens/MainMenuScreen.tsx:6-25`) is one wordmark,
tagline, and Play button. `MainMenu.tsx` adds player name/level/online-count display, a
Survival/Build mode split, and Discover/Leaderboards/Collection nav — all of which depend on
systems ticket 04 decides the fate of (accounts for player name/level, Track discovery for
"Discover," an unbuilt Leaderboards concept, cosmetics for "Collection").

See `docs/research/test-components-design-screens-gap-analysis.md`, screen row 1a.

## What to change

- [ ] Apply the new visual design (wordmark, tagline, Play button, layout/motion) to
      `MainMenuScreen` in place
- [ ] Player name/level, online count, and every nav tile beyond Play render only for systems
      ticket 04 confirms are in scope — build the tile now with a real data source, or leave it
      out; never a hardcoded placeholder that looks live
- [ ] "Survival/Build mode split" — check whether this maps to something real (Round-type
      selection already lives in the Lobby per M5 ticket 07/M7 ticket 05) before adding a menu-
      level split; if it's just Lobby-level Round-type choice with new paint, it doesn't belong
      here at all

## Done when

- [ ] `MainMenuScreen`'s existing behavior (Play navigates to `/play`) is unchanged
- [ ] No UI element on the menu implies a system that doesn't exist
- [ ] Typecheck clean

## Watch out

- The mock's mode split and nav tiles are the biggest source of "looks done, isn't" risk on this
  screen — resist shipping visual affordances for features ticket 04 hasn't greenlit.

# 07 — Reskin `MainMenu.tsx` onto `MainMenuScreen`

**What to build:** Apply the new visual design to the real `MainMenuScreen`, dropping every nav
item/tile the mock adds that has no backend.

**Blocked by:** ticket 04, for scope only (see below) — the reskin itself is otherwise
unblocked.

**Status:** planned

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

# 09 — Screens stop overlaying the live Match

**What to build:** Lobby, Standings, and the new Loading screen (ticket 11) stop showing the live,
connected `<GameCanvas>` behind them. No replacement background yet — plain/blank is fine; what
goes there is explicitly undecided (ADR 0051), and stays that way for this ticket.

**Blocked by:** nothing. Pure rendering-layer change, independent of tickets 10-12.

**Status:** implemented — live verification pending

## Why

ADR 0051: this was never actually specified. `docs/research/screens-wireframes-and-components.md`
§3.3 names Countdown as the *one* Screen that must render over a live game view, precisely because
Characters are already spawned and cameras already live by then. Lobby (§3.2) and Results (§3.5)
say nothing about a live scene at all. The `LiveOverlay isSceneLive` "content over a live scene"
treatment on Lobby (since M4 ticket 07) and Results/Standings (since M4 ticket 08, carried into
ticket 06) was implementation drift, never a decision — confirmed live, and confirmed against the
design docs.

## What to change

- [x] `GameCanvas.tsx`/`game/index.ts`: the WebSocket connection and the simulation session keep
      running continuously for the whole Match exactly as today — unchanged by this ticket.
- [x] `LobbyScreen` and `StandingsScreen` drop `LiveOverlay`'s `isSceneLive`/"content over a live
      scene" treatment — swap for a new `<Screen>` (`packages/ui`), a plain, opaque, full-viewport
      surface. No new background content is added.

## Done when

- [x] `LobbyScreen.test.tsx`/`StandingsScreen.test.tsx` — unaffected (neither test suite asserted on
      `LiveOverlay`/`isSceneLive` directly; full suites green, 33 files / 302 tests in `apps/client`,
      5 files / 21 tests in `packages/ui`).
- [ ] **Live:** two browsers — during LOBBY and RESULTS, the live 3D scene is not visible or
      rendering-through behind the Screen. Not run this session (no browser harness available here).

## Implementation notes

New `<Screen>` component (`packages/ui/src/components/Screen`) — a full-viewport `position: fixed`
opaque surface (`background: var(--df-color-surface-0)`), replacing `<LiveOverlay isSceneLive=
{false}>` in both `LobbyScreen` and `StandingsScreen`. `<LiveOverlay>` itself is untouched — still
correct for Countdown/Bet/Spectate, which are genuinely content over a live scene. `Screen` doesn't
touch `<GameCanvas>`'s own mount/connection lifecycle at all; the canvas div is simply covered by
the new opaque sibling exactly the way `GameCanvas.module.css`'s own `.notice` (boot-error) surface
already covered it. No new component test written, matching the repo's own convention for a
presentational wrapper this thin (`Panel`/`LiveOverlay`/`Card` have none either).

## Watch out for

**Do not tear down the WebSocket connection or remount `<GameCanvas>` per phase.** That is exactly
the bug class ADR 0027/M5 ticket 08 already fixed once (a Track reload restarting the Tick epoch
under an already-seeded client, freezing the Lobby). This ticket changes visibility only.

# 08 — Give Spectator Mode a real Screen

**What to build:** A React Screen (styled on `Spectator.tsx`'s follow/switch design) that
`GameCanvas` renders while spectating, wired to the real `SpectatorController`. Betting UI (odds,
stakes, payout, balance) is excluded for now — Betting is decided scope (**ADR 0052**), but sequenced
after Accounts and XP/currency (ticket 14 is blocked on both); this ticket ships the follow/switch
Screen without it and ticket 14 adds the betting panel once its dependencies land.

**Blocked by:** ticket 01 (overlay-vs-HUD boundary decision — a live spectate view sits over the
running scene, same category question as the reaction overlays), ticket 03 (component kit).

**Status:** shipped 2026-09-11 (with ticket 14's betting panel BUILT, not cut — explicit user scope call overriding this ticket's "cut it, don't stub it").

What shipped: `onRunEnd` (once-per-Round verdict facts: outcome, placement, points, server-clock race/survived time) + `onSpectate` (following, runners, beansLeft, freeCam) game→shell events; finisher spectate (camera-only `spectateRequested` gate) + `spectateFollow/Next/Prev`, `setFreeCam`, `enterSpectate` on `GameHandle`; the FinishedOrOut verdict as a transparent overlay (SPECTATE on both outcomes per scope call, SCOREBOARD cut — no mid-Round table exists, LEAVE kept); the Spectator panel with bean switching, FREE CAM (frozen-pose hold), and the live betting board. Reference 1j/1r presentation kept: no full-bleed backgrounds in-Match, HUD chrome settles over the live feed. Still owed: real two-browser verification (sandbox can't listen).

## Why

Spectator Mode is real and wired at the sim/client layer — `spectators` set on the server
(`apps/server/src/match/matchRuntime.ts:95`), `SpectatorController` client-side
(`apps/client/src/game/spectator.ts`), M7 tickets 07/08 committed — but `GameCanvas.tsx` has no
spectator branch at all today (compare its explicit `LobbyScreen`/`StandingsScreen`/`PracticeHud`
branches, `GameCanvas.tsx:164-196`). This is the one `test_components` screen whose *core*
mechanic (follow/switch, `SpectatorController.nextSpectatorTarget`,
`apps/client/src/game/spectator.ts:44-51`) genuinely maps to real, unused backend — a pure wiring
ticket, not new scope.

See `docs/research/test-components-design-screens-gap-analysis.md`, screen row 1j and "Backend/
domain gaps" (Spectator Mode entry).

## What to change

- [ ] Add a `spectate` branch to `GameCanvas.tsx` alongside its existing Lobby/Standings/Practice
      branches, rendering the new Screen when spectating
- [ ] Wire the follow/switch UI to `SpectatorController`'s real target-switching (Q/E or
      equivalent), not a mock keypress handler
- [ ] Everything about odds/stakes/"ALL IN"/payout/balance is out of scope here — cut it from the
      shipped version of this screen entirely; ticket 14 adds it back once Accounts and
      XP/currency exist

## Done when

- [ ] Live-verified with two browsers: a spectating client sees the real Match, can switch
      between living Players, with the new visual design
- [ ] Typecheck clean; no new socket traffic beyond what `SpectatorController` already sends

## Watch out

- Don't half-build the betting panel "for later" — a visible odds/stakes UI that does nothing is
  worse than not having it; cut it, don't stub it.

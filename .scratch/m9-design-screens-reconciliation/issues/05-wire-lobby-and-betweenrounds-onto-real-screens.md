# 05 — Wire `Lobby.tsx`/`BetweenRounds.tsx` visuals onto the real Screens' props

**What to build:** Reskin the tested, server-driven `LobbyScreen` and `StandingsScreen` with the
new visual design, rather than routing to the standalone `test_components` mocks. Drop every
field the mocks invent that the real Lobby/Standings protocol doesn't carry.

**Blocked by:** ticket 03 (design-token/component-kit reconciliation).

**Status:** planned

## Why

The real `LobbyScreen` (`apps/client/src/screens/LobbyScreen.tsx`) already has: a player list
with per-row ready state, host-gated nickname/Track/Round-type/match-length controls, per-Round-
slot Track/type pick (M7 ticket 05), and a server-supplied `startBlockedReason` (M5 ticket 07).
`StandingsScreen` already gates the next Round on a per-Player Ready confirmation with a timeout
ceiling, deliberately replacing a group auto-start timer (ADR 0051). `Lobby.tsx`/
`BetweenRounds.tsx` invent unbacked concepts instead — a room code, numeric capacity/"slots open,"
"INVITE FRIENDS," a "PRIVATE" chip, and "AUTO-START IN 0:24/0:14" countdowns — none of which exist
in ADR 0040's Lobby model or ADR 0051's confirmation-gate model. Routing to the mocks as-is would
functionally revert ADR 0051.

See `docs/research/test-components-design-screens-gap-analysis.md`, screen rows 1i/1k/1l and ADR
conflicts §3.

## What to change

- [ ] Apply the new visual design (layout, typography, motion) to `LobbyScreen` and
      `StandingsScreen` in place — these keep their existing props/callbacks
      (`LobbySnapshot`-shaped data, `onReady`, `onStart`, etc.), only their rendering changes
- [ ] Drop room code, capacity/"slots open," invite-friends, private/public, and autostart-timer
      UI entirely — none of it is backed, and the last one contradicts ADR 0051 by design
- [ ] `MatchOver.tsx`'s visual design folds into the same `StandingsScreen` component at its
      `!roundsRemaining` state (ADR 0051: same component, different prop state, one "Main Menu"
      action) — not a separate screen/route
- [ ] Placement-delta ("moved +2") styling from `BetweenRounds.tsx` only survives if `Score.ts`
      already exposes that data (check `packages/shared/src/match/Score.ts`); if not, cut it
      rather than fabricate it

## Done when

- [ ] `LobbyScreen`/`StandingsScreen`'s existing test suites still pass unmodified in behavior
      (only rendering/markup changes)
- [ ] Live-verified with two browsers: Lobby join/ready/host-start and the between-Round
      confirmation gate both work exactly as before, with the new visual design
- [ ] Typecheck clean

## Watch out

- This is a reskin, not a rewrite — resist the urge to also change the state machine while you're
  in the file. If something about the real flow seems wrong, that's a separate ticket.

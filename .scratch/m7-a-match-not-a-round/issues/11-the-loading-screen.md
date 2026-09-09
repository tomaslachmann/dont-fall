# 11 — The Loading screen

**What to build:** A new `LoadingScreen`, shown once this Player has confirmed Ready on Standings
(ticket 10) but the next Round isn't showing yet — the wait between "I clicked Ready" and the next
Countdown actually starting.

**Blocked by:** ticket 09 (the non-live-canvas pattern this screen also uses), ticket 10 (the Ready
message this screen's own entry condition depends on).

**Status:** not started

## Why

ADR 0051's flow is `Lobby → Loading → Countdown+Running → Standings → Loading → ...`. Today that gap
is either invisible (server-side `nextRoundReady` resolving in about one tick) or, worse, a frozen
Standings Screen with nothing happening on it once this Player has already confirmed and is only
waiting on everyone else / the timeout.

## What to change

- [ ] **No new `MatchPhase` value.** The server stays in `RESULTS` until `roundsRemaining &&
      nextRoundReady && standingsConfirmed` (ticket 10) all hold, then jumps straight to
      `COUNTDOWN` — no replicated "loading" state. `LoadingScreen` is purely a **client**-rendered
      wait state: shown from the moment *this* client has sent its own Ready confirmation until
      `phase` actually becomes `COUNTDOWN`, covering both "waiting on other Players/the timeout" and
      the client's own local `loadTrack()` time. This matches ticket 06's own already-correct
      principle — "the Screen renders the wait, it does not time it" — it just didn't have a Screen
      to render it in.
- [ ] `GameCanvas.tsx`: once this client has sent its Ready confirmation (tracked locally, e.g. a
      `hasConfirmedReady` bit reset every fresh COUNTDOWN), render `LoadingScreen` in place of
      `StandingsScreen` until `phase` becomes `COUNTDOWN`.
- [ ] `LoadingScreen`: minimal — a spinner/label, non-interactive, same plain non-live surface as
      ticket 09's Lobby/Standings treatment.

## Done when

- [ ] Component test: `LoadingScreen` renders a non-interactive wait state.
- [ ] `GameCanvas.test.tsx`: after this client's own Ready confirmation, `StandingsScreen` unmounts
      and `LoadingScreen` mounts, and stays mounted until `phase` reports `COUNTDOWN`.
- [ ] **Live:** between Rounds, clicking Ready shows a Loading screen — not a frozen Standings, not
      a flash of the live game — until the next Round's Countdown actually begins.

## Watch out for

**The wait is not fixed-length**, same warning ticket 06 already carried: a slow client-side Track
rebuild or a slow other-Player confirmation must show Loading longer, never cut it short.

**Don't invent a server-replicated loading phase unless the no-new-phase approach turns out not to
work in practice.** The whole point is that this is client-only UI over an existing transition, not
a new piece of authoritative state (ADR 0040 — phase transitions are the server's, and this ticket
adds none).

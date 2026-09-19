# 02 — Between Rounds tells the truth

**What to build:** The BetweenRounds standings stop lying. ADR 0110.

**Blocked by:** 01

**Status:** done on tests (2026-09-19)

- [x] THIS ROUND gains and the move arrows come from the last `roundResults` entry (as
      `matchView.ts:138-147` does), not from `prevTotalsRef`, which is overwritten after the first
      render so every later render reads `+0` (`GameCanvas.tsx:213-218,397`)
- [x] Scores are rounded wherever they are drawn: BetweenRounds, the MatchOver podium and its gap
      note, the Scoreboard (`roundScore` is fractional)
- [x] SCOREBOARD no longer leaves the Match: it opens over the Lobby route instead of navigating
      to `/scoreboard`, which unmounts `LobbyRoute` and closes the socket
- [x] AUTO-START IN counts down to a deadline the server sends, not a client guess with the
      default `STANDINGS_READY_TIMEOUT_MS`
- [x] `n OF m READY` counts only Players still in the Match, not those who left or spectate
- [x] The next-up mode chip takes the Round type's tone (not a hardcoded `race`)
- [x] A random next pick shows what it is (the design's random card), not "EXISTING TRACK
      THUMBNAIL"
- [x] Tests for each

## As built

- Gains and climbs are `StandingsRow.gained` / `previousPlacement`, folds over `roundResults` (the
  total now less the total before the last Round; the rank before it). `prevTotalsRef` is gone.
  The table is built by a pure `game/standings.ts`.
- `SnapshotMessage.standingsDeadlineMs` is on the server's clock and fixed for the whole RESULTS
  phase, so an idle RESULTS stays idle (ADR 0057). The game moves it onto `Date.now()` through time
  sync (`localDeadline`) as `StandingsSnapshot.autoStartAtMs`; before sync there is no hint rather
  than a wrong one.
- SCOREBOARD renders `Scoreboard` over the canvas; BACK returns to the Standings.
- A random next pick shows the Lobby's `?` thumb and an ANY MODE chip.
- Not done here: MatchOver names one winner ("X TAKES THE CROWN") on a tie at the top. Its copy is
  the user's call.

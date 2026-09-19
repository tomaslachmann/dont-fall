# 01 — The Round number is the server's

**What to build:** The Lobby snapshot carries the Round number (`roundResults.length + 1`, the
number betting already keys on). The client reads it and stops counting COUNTDOWN edges
(`GameCanvas.tsx:138,180`). A Player who joins mid-Match or reloads sees the right Round, and a bet
goes to the right Round instead of Round 0 (a 404). ADR 0110, "Definitions".

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] `SnapshotMessage` carries `round`, set by the server from its own count
- [x] Countdown `ROUND n OF m`, BetweenRounds "ROUND n DONE", the Spectator's round label and the
      bet request read it
- [x] The local counter in `GameCanvas` is gone
- [x] Tests: a client that connects mid-Match reads the server's Round; a bet names it

## As built

- `MatchRuntime.round` is set on LOADING entry to `roundResults.length + 1` and held through RESULTS,
  so an abandoned Round (never pushed to `roundResults`) still reads as the Round it was. `0` in
  LOBBY, reset with every fresh Match. Betting's settle reads it too, so there is one number.
- The field rides `SnapshotMessage`, not `lobby`, beside `roundResults`; the client's `LobbySnapshot`
  projects it as `round`.
- The Round loader shows `round + 1` from a LOBBY or RESULTS snapshot (the Round about to load) and
  `round` from any other phase.

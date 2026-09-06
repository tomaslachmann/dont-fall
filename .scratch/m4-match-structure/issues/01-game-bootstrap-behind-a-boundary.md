# 01 — Prefactor: the game boots behind a single boundary

**What to build:** Nothing new for a player. The client's entry point stops being "a script that
starts a game" and becomes "a function that starts a game with a config and reports when the Match
ends or the Player exits". Everything renders, predicts and plays exactly as it does today.

This is prefactoring, done first on purpose: ADR 0008 requires React to own the app shell and mount
`<GameCanvas>` while the game loop never runs through React. That boundary is far easier to draw
while there is no React in the way, and it means ticket 06 introduces a framework rather than
introducing a framework *and* untangling a bootstrap at the same time.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The client's game bootstrap is reachable as one call taking a config in and reporting
      match-end / exit out, with a way to tear the game down cleanly (renderer, listeners, socket,
      pointer lock)
- [x] Starting and stopping twice in a row leaves nothing behind — no duplicated listeners, no
      orphaned animation frame, no leaked WebGL context. This is what makes routing away from the
      game and back again survivable later
- [x] No change to the simulation, prediction, interpolation or HUD — this ticket is invisible from
      the outside
- [x] `predictionRegression` and the rest of the suite stay green
- [x] Manually verified live: the game plays exactly as before, and a full teardown/restart in the
      same page session works

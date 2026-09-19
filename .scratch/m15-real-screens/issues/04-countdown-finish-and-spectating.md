# 04 — Countdown, finish and spectating tell the truth

**What to build:** The overlays around a Round show real values only. ADR 0110.

**Blocked by:** 01

**Status:** done on tests (2026-09-19)

- [x] Countdown: GRID SPOT is the Player's place among those on the line, never above the field
      (`joinOrder + 1` never compacts, so it can read `07/04`)
- [x] Countdown: the mode chip takes the Round type's tone; the CHECKPOINT row is not shown on a
      Survival arena (it reads `00 / 00`); the `+N` bubble only shows when N > 0; the PB line is
      passed from `usePersonalBest` on a Race
- [x] FinishedOrOut: NEXT ROUND IN became ROUND ENDS IN the Round's time left (the user's answer;
      the next start cannot be known while others still run); TIME is exact, `(finishTick − roundStartTick) × TICK_MS`,
      as Personal Bests use; no CHECKPOINT row in Survival
- [x] Spectator: PLACE reads `liveRace.places`; ALIVE FOR is the followed bean's own time alive
- [x] SurvivalHud: a Player who left mid-Round reads "X LEFT", not "X WAS ELIMINATED"
- [x] The "GAMEPLAY FEED…" captions on Countdown, FinishedOrOut and Spectator are deleted
- [x] Tests for the derived values
- [x] FinishedOrOut's third plate, from the design: OFF YOUR PB on a finish (against the Personal
      Best the Round started with), GRABBED / HURLED / HIT BY on a knockout (the user's answer)

## As built

- GRID SPOT is `1 +` the Players here with an earlier `joinOrder` (spawn slots follow join order).
- The Checkpoint row and pips are not drawn when there are none (a Survival arena passes 0); the
  PB line shows on a Race when one exists.
- Race time is `elapsed − (state.tick − finishTick) × TICK_MS`, where `elapsed` is the Time Limit
  less the snapshot's time left: exact to the finish Tick however late the snapshot arrives.
  `roundStartedAtServerMs` is gone.
- The Spectator's PLACE is `liveRace.places`, ALIVE FOR the server's Round clock in whole seconds
  (`MatchView.livePlaces` / `roundElapsedMs`).
- The Spectator's caption became an empty cell so its grid keeps its shape; FinishedOrOut's
  actions are pinned to their row for the same reason.
- Elimination credit (ADR 0110): `RapierSimulation.credit` records the last grab (refreshed every tick
  of a hold), Hurl, Hit, Character Bump, or swung/flying body; an eliminating Fall turns it into
  `eliminatedBy` if it is within `ELIMINATION_CREDIT_TICKS`. Synced from the server on reconcile like
  `eliminated`. The client names it through the roster, so a leaver is still named.

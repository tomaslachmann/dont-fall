# 10 — The voiced Countdown, Checkpoints, the finish and the Round's end

**What to build:** the Match speaks and plays jingles at its moments.
**ADR 0087.**

**Decided (user, 2026-09-17):** a voiced Countdown, "3, 2, 1, GO" (Kenney
Voiceover Pack).

**Blocked by:** 02

**Status:** done on tests (2026-09-17). Hearing the calls line up with the overlay is the user's check.

## How it behaves after

- **Countdown** (ADR 0040): "three", "two", "one" and "go", each on the
  server's clock: the client's estimate from `TimeSync`, not a local timer
  started on the phase change. A client that joins mid-Countdown only hears
  what is left.
- **The Round's last seconds:** "hurry up" once, at a fixed time left.
  "Time over" when the clock runs out.
- **Checkpoint** (your own): a short jingle when `checkpointIndex` rises.
- **Qualified / finish** (your own): a jingle when the local prediction first
  says you are in, the same moment the banner shows.
- **Round end:** a jingle on ROUND_END. **Results:** "you win" or
  "congratulations" for the Match winner, otherwise a neutral jingle.
- **Final round:** "final round" at the start of the Match's last Round (M7).

## What to change

- [x] The call schedule as a pure function of `(phase, serverTimeMs,
      countdownEndsAt, timeLeftMs)` → calls due since last frame, with tests
      (including joining late and a long frame)
- [x] Wiring in `game/index.ts` next to the Countdown overlay and the
      qualification banner, all on the ui bus
- [x] Tests: each call once, never twice after a Track reload (M5's live
      selectTrack), none while spectating except Round end and Results

## Notes

- Research §10.
- Voice lines are Kenney's male or female announcer. Which voice is the user's
  pick in 01.

## As built

- **`audio/matchCalls.ts`: `MatchCalls`**, pure. `update(frame)` returns the slots due this frame.
  - **Countdown:**
    - Calls are due at end − 3 s / 2 s / 1 s / 0. The end is `serverTimeMs + countdownMsLeft` from
      the latest COUNTDOWN snapshot. "Now" is `performance.now() + TimeSync.serverClockOffsetMs`.
      Without a clock estimate, nothing plays.
    - **Found here:** the first COUNTDOWN snapshot arrives a round trip *after* "three" was due.
      On the first frame of a Countdown, calls up to 400 ms late (`LATE_CALL_GRACE_MS`) still
      play. A client that joins later hears only what is left.
    - A frame longer than 400 ms plays only the latest call due.
    - "Go" still plays on the frame RUNNING has already begun.
  - **Hurry up:** once per Round, when `timeLeftMs` passes 30 s (`HURRY_UP_AT_MS`) while RUNNING. A
    Round of 30 s or less never says it.
  - **Time over:** on entering ROUND_END with the clock at 0, alongside the `round_end` jingle.
  - **Checkpoint:** a `RiseLatch` on the predicted `checkpointIndex`, heard only while RUNNING. A
    new Round's reset is adopted silently.
  - **Qualified:** the predicted `finishTick` turning set, once per Round. A replay that undoes
    it and sets it again is still one.
  - **Results:**
    - The Match is over and yours: `results_win`, then "you win" if you are the only winner, or
      "congratulations" if the win is shared.
    - Otherwise: the neutral `results`.
  - **Spectating:** only the Round's end and the Results are heard.
  - **The phase a client first connects into:** says nothing.
- **Final round, moved:** the Countdown's first second is "three", so "final round" can't open the
  last Round without talking over it. It plays on the Standings that come just before the last
  Round, 1.6 s after their jingle (`FINAL_ROUND_DELAY_MS`), when
  `roundsRemaining && roundResults.length === matchLength − 1`.
- **Wiring (`game/index.ts`):**
  - The snapshot handler keeps `countdownEndsAtServerMs`, and `resultsCall` (from
    `roundsRemaining` and `matchWinner`).
  - The frame loop feeds `MatchCalls` beside the banner and plays each call on `stage.sound` (the ui
    bus, unpanned).
  - `MatchCalls` lives for the game, not the Stage, so a Lobby Track reload replays nothing.
- **Practice:** has no Match phases, so no calls.
- `STAGE_SOUND_SLOTS` adds the `match.*` slots.
- **Tests:** `matchCalls.test.ts`: a late first snapshot, joining mid-Countdown, a long frame, no
  clock, spectating, hurry up, Checkpoints and a new Round, time over, results, the final round,
  and the first-connected phase.

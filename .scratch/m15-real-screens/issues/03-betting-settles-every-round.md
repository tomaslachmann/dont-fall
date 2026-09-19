# 03 — Betting settles every Round

**What to build:** No stake is ever stranded, and the board says what a stake would win. ADR 0110.

**Blocked by:** 01

**Status:** done on tests (2026-09-19)

- [x] A Round with no winner (abandoned, everyone out) settles as a refund: every stake goes back.
      Today it settles with `winnerIds: []`, the API answers 400 (`bets.service.ts:158`), and the
      pool stays open for good
- [x] WINS N includes your own stake in the pool it divides (`Spectator.tsx:83`)
- [x] The board stays open while at least two runners are still in the Round (the user's answer):
      the Match server closes it the Tick one is left
- [x] Tests: an abandoned Round refunds; the shown payout matches the settled one

## As built

- `settleBettingRound` accepts an empty `winnerIds`: that is `settlePayouts`' existing void round,
  which refunds every stake. Nothing else changed on either side.
- `stakePayout(stake, runnerPool, totalPool)` in `packages/shared/src/economy.ts` quotes WINS N
  with the stake already in both pools; the panel gets each runner's `pool` and the board's
  `totalPool`. A stake on an unbacked runner is quoted too (the whole pot plus itself).
- The open window became `BETTING_CEILING_MS` (longest Time Limit + 5 min), a backstop only. The
  Match server sends `POST /bets/rounds/close` once per Round when `runnersLeft` (neither out nor
  finished) drops to one; the API's close only ever moves `closesAtMs` earlier. The panel reads
  CLOSES AT 1 LEFT instead of a countdown.

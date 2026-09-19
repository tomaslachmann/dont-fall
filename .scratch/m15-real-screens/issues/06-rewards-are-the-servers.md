# 06 — Rewards are the server's

**What to build:** `POST /rewards/claim` derives a Player's rounds from the stored Match instead of
trusting the rows the client sends. The Rewards Screen shows every coin earned. ADR 0110.

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] The claim names only the `matchId`; the API finds the caller's Account in `match_results`
      and derives placement, field and score per Round. A caller who did not play is refused.
      The stale "sockets don't know Accounts" comment goes
- [x] The coin split shows MATCH and, when there were any, BET WON (payouts are credited at settle)
- [x] "UNLOCKED AT" shows the unlocked Hat's own `unlockLevel`
- [x] BACK TO LOBBY and PLAY AGAIN differ: the Lobby this Match ran in closed with it (ADR 0059), so
      BACK TO LOBBY is the choice of Lobby (`/play`) and PLAY AGAIN goes straight into a Quick Match
- [x] The results page finds "you" by the signed-in Account's seat in the stored Match; `?me=` only
      names a seat that had no Account, and what COLLECT pays never depends on it
- [x] Tests: a forged claim credits nothing; the split sums to the credited coins

## As built

- `POST /rewards/claim` reads only `matchId`. `roundsPlayedBy(result, accountId)` finds every seat
  the stored Match recorded under the Account and pays on those Rounds; a caller with none gets a
  403. The response carries the `rounds` and `betWinnings` beside the stored numbers, recomputed on
  a replay (the stored claim keeps only the credit).
- `betWinningsFor` recomputes each settled board with the same pure `settlePayouts` the settle
  credited; a void Round's refunds are not wins and are left out.
- The Rewards screen's JELLY BEANS total is the Match's coins plus BET WON; UNLOCKED AT names the
  unlocked hat's own `unlockLevel`.

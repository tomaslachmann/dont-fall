# 04 — The Match runs several Rounds

**What to build:** A Match that runs its configured number of Rounds without passing through the
Lobby, carrying the results as it goes.

**Blocked by:** ticket 03 (nothing to carry until a `RoundResult` exists).

**Status:** blocked

## Why

This is the milestone. Today `MatchPhase` is `LOBBY | COUNTDOWN | RUNNING | ROUND_END | RESULTS`
(`MatchPhase.ts:10`) and `RESULTS` is terminal: it sits there until the host sends `returnToLobby`.
The machine has no notion that another Round might follow.

`matchRuntime.ts:109` holds `dnf` for the current Round and `matchLoop.ts:112` clears it on every
fresh `COUNTDOWN`. Round results must live somewhere with the opposite lifetime — cleared when a
*Match* starts, not when a Round does.

## What to change

- [ ] The runtime gains Match length and the list of `RoundResult`s so far, both Match-scoped:
      cleared on a fresh Match, never on a fresh Round
- [ ] A finished Round appends its `RoundResult` before the phase leaves `ROUND_END`
- [ ] `RESULTS` stops being terminal. With Rounds remaining it advances into the next `COUNTDOWN`
      once the next Track has loaded; on the last Round it stays, as today, until `returnToLobby`
- [ ] The results list rides the snapshot alongside `lobby` and `dnf` (`matchLoop.ts:216`). Score is
      **not** sent — it is `matchScore` over this list, computed by whoever needs it (ADR 0049)
- [ ] `returnToLobby` becomes a Match-end action: valid in `RESULTS` on the final Round, refused
      otherwise with a readable reason, the way M5 ticket 07 refuses an unraceable Track

## Done when

- [ ] Server tests over a real socket: a three-Round Match runs start to finish on one connection,
      never entering `LOBBY`, and the snapshot carries three results at the end
- [ ] The phase machine's own tests cover "Rounds remain" and "this was the last one" as separate
      transitions out of `RESULTS`
- [ ] A Match started fresh from the Lobby has an empty results list — a second Match does not
      inherit the first one's Score
- [ ] **Live:** two browsers play a three-Round Match end to end without either client reloading or
      returning to the Lobby, and both agree on the results at every Standings

## Watch out for

**The Tick epoch.** M5 ticket 08 found that a Track pick restarted the Tick epoch under clients that
had already seeded their prediction tick (ADR 0027), freezing everyone in the Lobby. Loading Round
two's Track is that same operation, now on a hot path that every Match takes. Whatever M5 ticket 08
did to fix it is what Round loading must go through — do not re-derive it.

**`ROUND_END_MS` was sized for a Round that ends a session.** Between Rounds it is a beat before the
Standings, not a wind-down. Re-feel it; it may want to be shorter.

**Eliminated Characters are still in the world** (M5 ticket 04, ADR 0042) with colliders disabled.
Starting the next Round has to bring them back properly — this is exactly where M5 ticket 08 found
ghost Characters, and it is now three times as likely to happen.

**Phase transitions are the server's** (ADR 0040). Clients render `phase`; nothing here may let a
client decide a Round is over.

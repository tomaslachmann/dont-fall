# 08 — A disconnect does not corrupt the standings

**What to build:** A Player who drops keeps their Score in the standings and scores zero for the
Rounds they miss.

**Blocked by:** ticket 04.

**Status:** blocked

## Why

Today a mid-Round drop becomes a DNF entry (M4 ticket 05) and `rt.dnf` is wiped at the next
`COUNTDOWN` (`matchLoop.ts:112`). Over one Round that is right: leaving is not a result to rank
among the ones that were played out. Over a three-Round Match it means a Player who dropped in Round
two vanishes from the standings, and the Score they earned in Round one goes with them.

This ticket is deliberately narrow. It is **not** reconnection — `reclaim` exists in the protocol
(ADR 0024) and the server still "does not act on it yet". The point here is only that scoring does
not have to be redesigned when reconnection is eventually built.

## What to change

- [ ] A Player who drops mid-Match stays in the standings with the Score they had
- [ ] They score zero for Rounds they miss, which falls out of ticket 03's `matchScore` on its own:
      a Player absent from a `RoundResult` scores nothing for it. Verify that, do not re-implement it
- [ ] The Standings marks them as gone rather than showing a live Player on zero
- [ ] A Player who connects mid-Match spectates until it ends and plays from the next Match. They
      are in the Lobby's list, not in the Round
- [ ] `reclaim` is not touched

## Done when

- [ ] Server tests: a three-Round Match where one of three Players drops after Round one — the final
      standings list all three, and the dropper's total is exactly their Round-one Score
- [ ] The remaining Rounds are scored over the field that actually played them, not the field that
      started (the percentile form depends on this — ticket 03)
- [ ] Everyone dropping mid-Match ends the Match rather than leaving a server looping over an empty
      field — M5 ticket 08 already found ghost Characters left behind exactly this way
- [ ] **Live:** three clients, one closed mid-Match, and the other two see it stay in the standings
      with its earned Score for the rest of the Match

## Watch out for

**Two ideas of "gone" already exist**: `dnf` (Round-scoped, cleared at every Countdown) and
`eliminated` (a marked Character left in the world, ADR 0042). Score needs a third lifetime —
Match-scoped — and it must not be attached to either of those or it will be cleared with them.

**The host can be the one who drops.** M4 ticket 07 made start host-gated and M5 ticket 08 found the
last-Player-drops case the hard way. A Match whose host leaves mid-way still has to finish or end
deliberately; decide which and write it down.

**Do not let this grow into reconnection.** If it starts needing session tokens, it has escaped its
scope — stop and give reconnection its own milestone.

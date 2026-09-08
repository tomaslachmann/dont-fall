# 03 — Round results and Score

**What to build:** The scoring itself, as pure functions in `packages/shared` — with nothing wired
to them yet.

**Blocked by:** ticket 02 (a Survival Round has no placement to score until it can be ranked).

**Status:** blocked

## Why

ADR 0049: a Round pays Score by placement, percentile-normalised, plus a flat Qualification bonus.
Doing that first and alone keeps the formula testable without a server, a socket or a Rapier world —
the same shape `buildResults`, `qualificationPlacement` and `RoundRules` already have, and the
reason M4.5 exists at all.

Score is **derived, not stored** (ADR 0049). The server replicates the list of Rounds already
played; Score is a fold over it. That is what gives the Standings Screen its per-Round breakdown for
free, and it means a Player who connects mid-Match can be shown a correct total from the same data
everyone else has.

## What to change

- [ ] A `RoundResult` type: for one finished Round, who placed where and who Qualified. Built from
      `buildResults`, not alongside it — one ranking rule in the codebase, not two
- [ ] `roundScore(placement, playerCount, qualified)`: `(1 − (placement−1)/(N−1)) × MAX` plus the
      Qualification bonus, with `MAX` and the bonus as named constants in `tuning.ts`
- [ ] `matchScore(results)`: the fold, returning each Player's total. Players absent from a
      `RoundResult` score zero for it (ticket 08 relies on this; nothing here needs to know why)
- [ ] `matchWinner(results)`: highest total, ties broken by placement in the **last** Round
- [ ] Guard `N === 1`: the formula divides by `N − 1`. A one-Player Round pays `MAX`

## Done when

- [ ] Shared tests: first always takes `MAX` and last always zero, at N = 2, 4 and 12
- [ ] A Round played by four and a Round played by six pay the same currency — the property that
      makes a mid-Match disconnect harmless (ADR 0049)
- [ ] Shared placements (a tie inside a Round) pay the same Score
- [ ] A tie on total is broken by the last Round, and a tie there too is reported as a tie rather
      than silently ordered by map iteration
- [ ] Nothing outside `packages/shared` imports any of it yet — this ticket adds no behaviour

## Watch out for

**`N` is the Round's field, not the Match's.** Someone who dropped in Round two is not in Round
three's `N`. Getting this wrong is exactly the bug the percentile form exists to prevent.

**Do not put the formula behind a Round type branch.** ADR 0043 bought "a Round type is data the
step reads fields of, never a branch on the mode", and scoring is the first thing that has to treat
a Race result and a Survival result as the same kind of thing. If the formula needs to know which it
was, something upstream is wrong.

**`MAX` is a feel constant.** Pick a round number that makes the Standings readable at a glance
(100 is not obviously worse than 10) and leave the tuning note in `tuning.ts` saying so.

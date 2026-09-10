# 14 — Bet / spectator wagering

**What to build:** A wagering system for spectators — odds, stakes, payout — needed by
`Spectator.tsx`'s betting panel (odds/stakes/"ALL IN"/payout/balance UI, out of scope for ticket
08's real Spectator Screen).

**Blocked by:** ticket 04 (scope decision), ticket 11 (accounts), ticket 13 (wagers a currency
that has to exist first).

**Status:** planned — speculative pending ticket 04; do not start without its outcome.

## Why

**Bet** is explicitly named as a future concept in `CONTEXT.md` and listed under `CLAUDE.md`'s
roadmap "later" row ("Betting/Spectator") — the one system in this batch the roadmap already
anticipates, but confirmed absent from both `apps/server/src` and `packages/shared/src` (no
`bet`/`wager`/`odds` hits anywhere outside comments). Ticket 08 already gives Spectator Mode a
real follow/switch Screen without this — this ticket is purely the wagering layer on top.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Spectator Mode entry) and screen row 1j.

## What to change

*(Deliberately unscoped — placeholder until ticket 04 confirms scope and tickets 11/13 exist to
build on. This is likely the largest of the backend tickets: real-money-adjacent design questions
even with a play-currency stand-in, e.g. anti-abuse on odds.)*

## Done when

- [ ] Not yet scoped

## Watch out

- Don't start implementation from this ticket's current state. Even once greenlit, this warrants
  its own grilling session given the abuse-vector surface of any wagering system, however
  low-stakes.

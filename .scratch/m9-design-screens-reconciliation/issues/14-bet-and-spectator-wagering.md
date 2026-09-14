# 14 — Bet / spectator wagering

**What to build:** A wagering system for spectators — odds, stakes, payout — needed by
`Spectator.tsx`'s betting panel (odds/stakes/"ALL IN"/payout/balance UI, out of scope for ticket
08's real Spectator Screen).

**Blocked by:** ticket 11 (accounts), ticket 13 (wagers the coins ticket 13 mints/tracks). Per ADR
0052's build order, this is the third backend ticket, after Accounts and XP/currency, before
Friends.

**Status:** shipped 2026-09-11 (scope call: build now, grill waived by explicit user decision — the abuse-surface/compliance review this ticket demanded did NOT happen and is still owed before real-money-adjacent play or a public deployment).

What shipped: pari-mutuel, no house cut, exactly per the formula — `parimutuelOdds`/`settlePayouts` in `packages/shared/src/economy.ts` (shared by the API settle and the client preview); `BETTING_WINDOW_MS = 60_000` in shared tuning; `POST /bets`, `GET /bets/:matchId/:round`, service-token-guarded `POST /bets/rounds/open|settle` on the API (`SERVICE_TOKEN` env, dev default in `scripts/dev.sh` + `docker-compose.yml`); the match server opens each Round at its Countdown and settles it at RESULTS (fire-and-forget, a down API closes betting rather than breaking the Round); the Spectator panel polls the board every 2s and posts tickets. Deliberate deviations from the ticket's open questions: closes are time-based (Round start + window), not odds-threshold; no max-stake cap yet; settle retries are idempotent by recomputation. Still owed: the grill session's abuse review, real two-browser verification (sandbox can't listen), and the play-currency compliance sanity check from ADR 0052.

## Decided scope (ADR 0052)

- **Dynamic, pari-mutuel odds** driven by live stake volume: odds on a Player shorten as more
  coins are staked on them relative to the total pool — not a fixed/flat stake, and explicitly
  not informed by any persisted skill/win-rate rating (no ranked system is being built to feed
  this).
- **No house cut** — the pot is redistributed among winners in full.
- **Named risk, not a blocker** (ADR 0052's consequences): a coins-based wagering system, even
  play-currency-only with no house edge, is gambling-adjacent once real accounts and a real
  currency exist. Do a deliberate compliance sanity check before shipping this specific ticket —
  it doesn't block tickets 11–13 or 16.

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

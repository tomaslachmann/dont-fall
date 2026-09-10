# 13 — XP / currency / cosmetics-ownership model

**What to build:** A persistent progression system — XP, currency, and cosmetic-unlock ownership
that survives across Matches — needed by `Rewards.tsx`, `MatchOver.tsx`'s "COLLECT REWARDS,"
`CharacterSelect.tsx`'s locked/owned skins, and `Profile.tsx`'s badges/XP bar.

**Blocked by:** ticket 11 (needs accounts to persist progression against). Per ADR 0052's build
order, this is the second backend ticket to pick up, right after Accounts — it in turn blocks
ticket 14 (Betting spends the same coins).

**Status:** scoped, blocked on ticket 11.

## Decided scope (ADR 0052)

- **Two currencies, not one**: **XP** is a pure progression number — accumulates, never spent,
  shown on `Profile.tsx`'s XP bar. **Coins** are the one spendable currency, drawn down by both
  cosmetic purchases (`Rewards.tsx`, `MatchOver.tsx`'s "COLLECT REWARDS") and Betting stakes
  (ticket 14) — this ticket owns the coin ledger both of those spend from.
- Cosmetic-ownership records what a Player has unlocked/purchased — feeds ticket 15's Character
  Select once that leaves its stub state, but this ticket doesn't need to wait on new character
  art to build the ownership model itself.

## Why

`CONTEXT.md`'s own **Score** entry explicitly distinguishes Match-scoped Score from "XP and
coins, which persist across Matches" — naming the concept as intended, but never built.
`packages/shared/src/match/Score.ts` only computes the percentile Score ADR 0049 defines; there is
no XP, currency, or unlock/cosmetic-ownership model anywhere in the codebase.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Rewards/XP/currency/cosmetics entry).

## What to change

*(Deliberately unscoped — placeholder until ticket 04 confirms scope and accounts (ticket 11)
exist to attach progression to.)*

## Done when

- [ ] Not yet scoped

## Watch out

- Don't start implementation from this ticket's current state.

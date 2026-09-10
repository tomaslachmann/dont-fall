# 13 — XP / currency / cosmetics-ownership model

**What to build:** A persistent progression system — XP, currency, and cosmetic-unlock ownership
that survives across Matches — needed by `Rewards.tsx`, `MatchOver.tsx`'s "COLLECT REWARDS,"
`CharacterSelect.tsx`'s locked/owned skins, and `Profile.tsx`'s badges/XP bar.

**Blocked by:** ticket 04 (scope decision), ticket 11 (needs accounts to persist progression
against).

**Status:** planned — speculative pending ticket 04; do not start without its outcome.

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

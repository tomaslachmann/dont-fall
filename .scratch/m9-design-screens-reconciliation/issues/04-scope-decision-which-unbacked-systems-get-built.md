# 04 — Scope decision: which unbacked systems actually get built

**What to build:** A product-roadmap decision (grilling session, recorded outcome — not
necessarily an ADR) on which of the systems `test_components` assumes but this codebase doesn't
have — accounts/auth, friends/social, XP/currency/cosmetics, spectator Bet/wagering, character
selection, richer Track discovery — actually get built, in what order, versus which mocked
screens get cut or indefinitely deferred.

**Blocked by:** nothing (this is the decision itself), but gates tickets 7, 8, 11–16.

**Status:** decided — see **ADR 0052** (`docs/adr/0052-dont-fall-grows-a-persisted-identity-layer.md`).
All six systems get built, not cut: mandatory Discord-only login gating the whole app (including
Practice); two currencies (XP progression, spendable coins); dynamic pari-mutuel Betting, no house
cut; full Friends (presence + requests + list); Character Select ships as a stub now, real
selection waits on new character art (separate workstream); Track discovery gets browsing +
filters only, no ratings/author. Build order: Accounts → XP/currency → Betting → Friends; Track
discovery and the Character Select stub are unblocked immediately. `CLAUDE.md`'s roadmap and stale
status line are updated to match.

## Why

`CLAUDE.md`'s roadmap only names one of these ("later: ...Betting/Spectator...") — the rest
(accounts, friends, XP/currency, cosmetics, character select, rich Track discovery) appear
nowhere in the roadmap, any ADR, or `CONTEXT.md` as planned work. `test_components` assumes all
of them exist or will. This is not an engineering call — it's the user/product deciding what this
game actually is now (a small chaotic-physics party game vs. a game with accounts, friends,
progression, and betting). Every backend ticket below (11–16) is speculative and should not be
built out until this lands, since building any of them without a scope decision risks building
the wrong thing or over-building past what "DON'T FALL" is meant to be.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps" and the
summary's framing of the user's original ask ("it will replace everything even in ADRs").

## What to change

- [x] Grilling session: for each of accounts/auth, friends, XP/currency/cosmetics, Bet/wagering,
      character selection, Track discovery — build it, defer it, or cut the screens that assume
      it?
- [x] Record the outcome somewhere durable — **ADR 0052**, since "DON'T FALL becomes a
      persisted-identity game" is exactly the hard-to-reverse, surprising-without-context call
      this repo's working agreements say gets an ADR
- [x] Update `CLAUDE.md`'s roadmap table to reflect whatever gets decided, and fix its stale
      "Next: M7" status line while touching that file (M7/M8/M8.1 are already shipped)

## Done when

- [x] Each of the six systems has an explicit yes/no/deferred answer, not silence
- [x] `CLAUDE.md` roadmap reflects the decision and its own current-status line is accurate again
- [x] Tickets 11–16 unblocked with concrete scope (see each ticket)

## Watch out

- This is the highest-leverage ticket in the batch — everything else downstream of "what does
  this game become" sits behind it. Don't let component-wiring tickets (5–10) get blocked waiting
  on this; they don't need it. Tickets 11–16 do.

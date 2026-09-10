# 04 — Scope decision: which unbacked systems actually get built

**What to build:** A product-roadmap decision (grilling session, recorded outcome — not
necessarily an ADR) on which of the systems `test_components` assumes but this codebase doesn't
have — accounts/auth, friends/social, XP/currency/cosmetics, spectator Bet/wagering, character
selection, richer Track discovery — actually get built, in what order, versus which mocked
screens get cut or indefinitely deferred.

**Blocked by:** nothing (this is the decision itself), but gates tickets 7, 8, 11–16.

**Status:** planned

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

- [ ] Grilling session: for each of accounts/auth, friends, XP/currency/cosmetics, Bet/wagering,
      character selection, Track discovery — build it, defer it, or cut the screens that assume
      it?
- [ ] Record the outcome somewhere durable (a short doc, or per-system ADRs if a "yes, build it"
      answer is itself architecturally significant — e.g. account system shape)
- [ ] Update `CLAUDE.md`'s roadmap table to reflect whatever gets decided, and fix its stale
      "Next: M7" status line while touching that file (M7/M8/M8.1 are already shipped)

## Done when

- [ ] Each of the six systems has an explicit yes/no/deferred answer, not silence
- [ ] `CLAUDE.md` roadmap reflects the decision and its own current-status line is accurate again
- [ ] Tickets 11–16 either get unblocked with a concrete size/priority, or get closed as
      out-of-scope

## Watch out

- This is the highest-leverage ticket in the batch — everything else downstream of "what does
  this game become" sits behind it. Don't let component-wiring tickets (5–10) get blocked waiting
  on this; they don't need it. Tickets 11–16 do.

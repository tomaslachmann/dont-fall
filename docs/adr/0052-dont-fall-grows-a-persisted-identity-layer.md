# 0052 — DON'T FALL grows a persisted-identity layer: mandatory Discord login, a two-currency economy, dynamic pari-mutuel Betting, and full Friends

## Context

`docs/research/test-components-design-screens-gap-analysis.md` inventoried a dropped-in set of
design screens (`apps/client/src/test_components/`) and found six systems they assume that this
codebase has never had: accounts, friends, a persistent progression/currency economy, spectator
betting, character selection, and richer Track discovery. Every milestone through M8.1 has
protected a zero-account, "open the game, immediately play" entry point — there was no ADR, no
milestone doc, and no `CONTEXT.md` entry proposing any of the six. `CLAUDE.md`'s own roadmap named
only one, as a "later" row: "Betting/Spectator."

M9 ticket 04 (`.scratch/m9-design-screens-reconciliation/issues/04-scope-decision-which-unbacked-systems-get-built.md`)
existed specifically so this got decided deliberately instead of silently inherited from whatever
the mock screens happened to draw. It was settled in a grilling session (2026-09), across several
rounds, documented here per this repo's working agreement that a verbal decision isn't real until
it's written down (see ADR 0051's own opening paragraph for the same lesson learned once already).

## Decision

**DON'T FALL becomes a persisted-identity game.** All six systems the design screens assumed get
built, not cut:

1. **Accounts.** Discord OAuth (single provider for now — chosen partly because voice chat is
   planned as later scope, and Discord is where this game's players already are). Login is
   **mandatory to reach any part of `apps/client`** — there is no guest/anonymous path. This
   explicitly includes M8.1's free-roam Practice mode: reaching `/play?freeroam=1` requires being
   logged in first, same as reaching the Lobby. Practice's own contract — that the session itself
   opens no socket (`apps/client/src/game/practice.test.ts:19`) — is unchanged; what's new is a
   precondition on the *route*, not a change to what Practice does once you're in it.
2. **Currency — two, not one.** **XP** is a pure progression number: it only ever goes up, never
   spent, and is what `Profile.tsx`'s XP bar shows. **Coins** are the one spendable currency,
   drawn down by both cosmetic purchases (`Rewards.tsx`, `MatchOver.tsx`'s "COLLECT REWARDS") and
   betting stakes (`Spectator.tsx`).
3. **Betting — dynamic, pari-mutuel, no house cut.** Odds on a Player move with how many coins are
   staked on them relative to the total pool (more staked on a Player → shorter odds on them,
   classic pari-mutuel mechanics) — not a fixed flat stake, and not a skill-rating model (no
   ranked/ELO system is being built to feed it). The pot is redistributed among winners; the house
   keeps nothing.
4. **Friends — full scope**, matching `Friends.tsx`/`FriendRequestAlert.tsx` as drawn: presence
   status (Online / In Match / Idle), requests, and a list — not a requests-only first cut.
5. **Character selection — ships now as a stub.** The `CharacterSelect.tsx` screen gets wired in,
   but picking anything shows a "not implemented" message. Real selection waits on new character
   models, which are separate, already-in-progress art/pipeline work (rig + animation + ragdoll
   bone mapping per ADR 0047 for each new model) — disproportionate to bundle into this decision.
6. **Track discovery — browsing and category filters only.** No ratings, no play counts beyond
   what filtering needs, no author display. A lighter cut of `Discover.tsx`, not the full mock.

**Build order:** Accounts (gates everything else) → XP/currency → Betting → Friends. Track
discovery and the Character Select stub have no dependency on the others and can land in any
order once Accounts exists — Track discovery has no dependency on Accounts at all.

## Considered options

- **Guest-optional login** (an account is available for Friends/Betting/persistent XP, but never
  required just to run a Track) — proposed as the recommendation going in, rejected: overridden
  explicitly ("mandatory... its inside the app" — one app, one gate, no split entry points).
- **Single spendable currency** (XP itself spendable, no separate coins) — considered, rejected in
  favor of the two-currency split so progression (XP) and spend (coins) don't conflate.
- **Flat/fixed betting stakes with simple pot-split** (no dynamic odds) — proposed as a smaller
  first cut, rejected in favor of full dynamic pari-mutuel odds from the start.
- **Skill-rating-informed odds** (a persisted per-account win-rate feeding the odds model) —
  considered and rejected: odds are driven purely by live stake volume, not by any ranking system,
  which avoids building a whole separate ranked-matchmaking-shaped feature as a dependency.
- **Presence-less Friends first cut** (async requests + static list, live status later) —
  proposed, rejected: presence ships as part of the same initial build, matching the screen as
  drawn.
- **New character art/models now**, alongside the selection screen — rejected: character models
  are being built already, on their own timeline; this decision only covers the screen's wiring
  (a stub), not the art pipeline.

## Consequences

- **Supersedes the zero-friction entry point** every milestone through M8.1 protected. ADR 0040's
  "server-authoritative phase, Lobby on the same socket" design and M8.1's shipped free-roam
  practice boot both assumed reaching `/play` required nothing but opening the client. That
  assumption is gone for the app as a whole; it survives only as "once logged in, Practice still
  opens no socket of its own."
- **A new persistent identity store is needed.** Nothing in this codebase has ever stored a user
  across sessions — `track-service`'s SQLite (ADR 0029) is the only real datastore in the
  project, and it's Track-scoped (`DEFAULT_AUTHOR_ID`, per `apps/track-service/src/schema.ts:10`).
  Whether accounts live in a new service, or as a new set of tables track-service (or a renamed/
  broadened service) owns, is an implementation decision for M9 ticket 11, not settled here.
- **The connection/session model needs reconciling with real identity.** Today's session id +
  `sessionToken` reconnect credential (ADR 0024, `packages/shared/src/net/protocol.ts:24-34`) is
  connection-scoped, not account-scoped. It needs to carry (or be issued in exchange for) an
  authenticated user id once accounts exist — exact shape left to ticket 11.
- **`CONTEXT.md` needs new terms**: Account, Coin, XP, Bet, Friend — and an explicit line
  disambiguating XP (persistent, cross-Match) from the existing Match-scoped **Score** (ADR 0049,
  `packages/shared/src/match/Score.ts`), since the two are easy to conflate and only one of them
  exists in the simulation today.
- **A named risk, not a blocker:** a coins-based Betting system, even with no house cut and no
  real-money conversion, sits in gambling-adjacent territory the moment real persistent accounts
  and a real currency exist. Worth a deliberate compliance sanity check specifically before
  shipping Betting (M9 ticket 14) — this doesn't block Accounts, Currency, or Friends landing
  first.
- **M9 ticket fallout:**
  - Ticket 04 is decided; this ADR is its record.
  - Tickets 11–16 move from deliberately-unscoped placeholders to real scope (updated in place to
    reference this ADR).
  - Ticket 06 (restoring `PlayRoute`'s practice/Match branching) gains a new precondition: the
    route is only reachable once ticket 11's login gate exists, so ticket 06 is now blocked by
    ticket 11 as well as ticket 05.
  - `CLAUDE.md`'s roadmap needs new rows for the systems this ADR commits to building, and its
    stale "Next: M7" status line needs fixing regardless (M7, M8, and M8.1 already shipped before
    this session).

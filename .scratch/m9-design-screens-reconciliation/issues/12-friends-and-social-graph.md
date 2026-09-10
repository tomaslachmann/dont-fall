# 12 — Friends / social graph

**What to build:** A friends/social system — friend requests, a friends list, presence — needed
by `Friends.tsx` and `FriendRequestAlert.tsx`.

**Blocked by:** ticket 11 (needs accounts to attach friendships to). Per ADR 0052's build order
(Accounts → XP/currency → Betting → Friends), this is the last of the four sequenced backend
tickets — pick up ticket 13 first.

**Status:** scoped, blocked on ticket 11 (and ordering — see above).

## Decided scope (ADR 0052)

- **Full scope, not a requests-only first cut**: presence status (Online / In Match / Idle),
  friend requests, and a list — matching `Friends.tsx`/`FriendRequestAlert.tsx` as drawn.
- Presence needs a real online-status broadcast mechanism (who's connected, and what they're
  doing) — new server-side infrastructure, not just a data model. Exact transport (piggyback on
  the existing match socket vs. a separate presence channel) is this ticket's own design work.

## Why

No friends/social/party concept exists anywhere in this codebase — confirmed by grep across
`apps/server/src` and `packages/shared/src` (the only `party` hits are an unrelated tuning
comment, `tuning.ts:932`, about the "party-game ceiling" of concurrent players).
`Friends.tsx`/`FriendRequestAlert.tsx` assume a social graph this game has never had.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Friends/social graph entry).

## What to change

*(Deliberately unscoped — placeholder until ticket 04 confirms scope and accounts (ticket 11)
exist to build on.)*

## Done when

- [ ] Not yet scoped

## Watch out

- Don't start implementation from this ticket's current state.

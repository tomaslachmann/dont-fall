# 12 — Friends / social graph

**What to build:** A friends/social system — friend requests, a friends list, presence — needed
by `Friends.tsx` and `FriendRequestAlert.tsx`.

**Blocked by:** ticket 04 (scope decision), ticket 11 (needs accounts to attach friendships to).

**Status:** planned — speculative pending ticket 04; do not start without its outcome.

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

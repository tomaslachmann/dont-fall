# 12 — Friends / social graph

**What to build:** A friends/social system — friend requests, a friends list, presence — needed
by `Friends.tsx` and `FriendRequestAlert.tsx`.

**Blocked by:** ticket 11 (needs accounts to attach friendships to). Per ADR 0052's build order
(Accounts → XP/currency → Betting → Friends), this is the last of the four sequenced backend
tickets — pick up ticket 13 first.

**Status:** implemented 2026-09-14 (full vertical slice, vitest + tsc green), pending live
verification (sandbox blocks socket binds) and a transport follow-up decision (see below).
Built out of ADR 0052's suggested order on explicit request — ticket 13 (XP/currency) is still open.

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

- [x] Friend requests by code or account id, accept / decline / accept-all (`POST /friends/requests*`)
- [x] Friends list with presence — Online / Idle / In Lobby / In Match / Offline (`GET /friends`)
- [x] RECENT co-players from finished Matches with ADD (`GET /friends/recent`)
- [x] Lobby invites, friends-only, delivered once each (`POST /friends/invite`, surfaced on heartbeat)
- [x] JOIN a friend's Lobby through the broker by code or id (`GET /lobbies/:id`, client `resolveLobbyRef`)
- [x] `/friends` screen wired: tabs, requests, add-by-code, remove, notices; menu badge + request/invite toasts
- [ ] Live-verified with two browsers (blocked: sandbox denies socket binds — `EPERM` on `listen`)

## Transport decision (this ticket's own design work)

No broadcast socket was built. Presence rides three poll-shaped mechanisms: a 30 s heartbeat
(`POST /friends/heartbeat`, also the moment invites surface exactly once), a 15 s roster
re-poll (`GET /friends`), and live roster inversion on the server (the broker's `/status`
polls, never stored rows). Roster staleness caps at ~15 s, invites at ~30 s. A push channel
(piggyback on a socket vs. a separate presence channel) is a real follow-up — it needs an
API-side socket the HTTP-only Fastify service doesn't have — recorded here, not silently dropped.

## Deviations from the mock (all deliberate)

- Request notes only ever claim shared finished Matches (`PLAYED N MATCHES TOGETHER`); the mock's
  `GRABBED YOU 9 TIMES` / `FROM YOUR LAST LOBBY` have no server-side data and are never invented.
- The invite toast drops `N SLOTS OPEN` — no endpoint reports a single Lobby's occupancy; a JOIN
  into a filled Lobby fails with the broker's own 409 reason instead.
- REMOVE friend and invite-toast dismiss exist though the mock draws neither: without them a
  misclick is forever and a stale toast never leaves.
- INVITE needs a Lobby to invite to. `/friends` reads it from navigation state (the Lobby screen
  doesn't link here yet — follow-up); standalone, the buttons say to join one first.

## Watch out

- `GET /friends` invites are NOT included — invites surface on the heartbeat only, by design
  (each exactly once). Don't "fix" the overview to list them without retiring the heartbeat path.

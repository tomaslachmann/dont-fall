# 11 — Accounts / auth

**What to build:** A real account system — signup/login, session identity tied to a persistent
account rather than a connection-scoped session id — needed by `Login.tsx`/`Auth.tsx`, and as the
FK target `track-service`'s `authorId` already anticipates.

**Blocked by:** ticket 04 (scope decision — build this at all?).

**Status:** planned — speculative pending ticket 04; do not start without its outcome.

## Why

No account system exists anywhere today. `apps/track-service/src/schema.ts:10`, `store.ts:12`,
and `db.ts:41` all hardcode a Track's `authorId` to `DEFAULT_AUTHOR_ID`, explicitly "until a real
Account system exists." `apps/track-service/src/index.ts:67` calls itself a "dev-only, no-auth
internal service." Player identity today is connection-scoped: a server-assigned session id plus
a `sessionToken` bearer credential for ADR 0024's reconnect-parking window
(`packages/shared/src/net/protocol.ts:24-34,252`) — not an account, and not designed to become
one without real changes to that protocol.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Accounts/auth entry).

## What to change

*(Deliberately unscoped — this ticket is a placeholder until ticket 04 confirms it's in scope. A
real spec needs its own design pass: what identifies an account, how it relates to ADR 0024's
session/reconnect model, whether `track-service`'s `authorId` migration is part of this ticket or
a follow-up.)*

## Done when

- [ ] Not yet scoped — write real "Done when" criteria once ticket 04 confirms this is being
      built and a design pass has happened

## Watch out

- Don't start implementation from this ticket's current state — it exists to hold the size/
  dependency estimate, not to be picked up as-is.

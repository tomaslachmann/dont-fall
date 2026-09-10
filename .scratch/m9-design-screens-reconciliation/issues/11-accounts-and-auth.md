# 11 — Accounts / auth

**What to build:** A real account system — signup/login, session identity tied to a persistent
account rather than a connection-scoped session id — needed by `Login.tsx`/`Auth.tsx`, and as the
FK target `track-service`'s `authorId` already anticipates.

**Blocked by:** nothing — ticket 04 is decided (**ADR 0052**). This is now the first ticket to
build in the backend group; tickets 12–14 are blocked by it.

**Status:** scoped, ready to pick up.

## Decided scope (ADR 0052)

- **Discord OAuth, single provider.** No email/password, no other providers for this pass.
- **Mandatory, app-wide.** Every route in `apps/client` requires being logged in first — no
  guest/anonymous path. This explicitly includes `?freeroam=1` Practice: the session itself still
  opens no socket (`apps/client/src/game/practice.test.ts:19` is unchanged), but the *route* is
  now unreachable pre-login, same as the Lobby.
- Exact shape of the account/session store (new service vs. new tables on an existing one) and how
  it reconciles with ADR 0024's connection-scoped `sessionToken` reconnect credential
  (`packages/shared/src/net/protocol.ts:24-34`) is this ticket's own design work, not settled by
  ADR 0052.

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

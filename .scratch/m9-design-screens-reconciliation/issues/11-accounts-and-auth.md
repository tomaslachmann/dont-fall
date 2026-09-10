# 11 — Accounts / auth

**What to build:** A real account system — signup/login, session identity tied to a persistent
account rather than a connection-scoped session id — needed by `Login.tsx`/`Auth.tsx`, and as the
FK target `track-service`'s `authorId` already anticipates.

**Blocked by:** nothing — ticket 04 is decided (**ADR 0052**). This is now the first ticket to
build in the backend group; tickets 12–14 are blocked by it.

**Status:** phase 1 (track-service backend) done and code-reviewed. Phase 2 (client mandatory-login
gate + real Login screen, match-server socket integration) not started — see "What's left" below.

## Decided scope (ADR 0052)

- **Discord OAuth, single provider.** No email/password, no other providers for this pass.
- **Mandatory, app-wide.** Every route in `apps/client` requires being logged in first — no
  guest/anonymous path. This explicitly includes `?freeroam=1` Practice: the session itself still
  opens no socket (`apps/client/src/game/practice.test.ts:19` is unchanged), but the *route* is
  now unreachable pre-login, same as the Lobby.
- **Where accounts live: `apps/track-service`**, extended rather than standing up a new service —
  its existing SQLite/Drizzle database gets two new tables (`accounts`, `sessions`) alongside
  `tracks`. Chosen over a new `apps/account-service` to avoid a second always-on process for a
  hobby-scale project.
- Session tokens are opaque bearer tokens (`randomBearerToken`, `packages/shared/src/net/
  bearerToken.ts`) verified by DB lookup — ADR 0024's existing `sessionToken` shape, reused rather
  than introducing JWTs. `apps/server`'s own reconnect `sessionToken` now shares this same helper.

## Phase 1 — track-service backend (done)

- `apps/track-service/src/schema.ts` / `db.ts`: `accounts` (id, discordId, displayName, avatarUrl,
  createdAt) and `sessions` (token, accountId, createdAt, expiresAt) tables, additive migration
  (`CREATE TABLE IF NOT EXISTS`, matching the file's existing convention).
- `discordAuth.ts`: builds the Discord authorize URL; exchanges an OAuth code for the Discord
  identity it belongs to (`FetchLike` injectable — fully unit-tested with no real Discord app or
  network access).
- `accounts.ts`: `upsertAccountFromDiscord` (one atomic `INSERT ... ON CONFLICT DO UPDATE` — code
  review caught an earlier check-then-insert race and this replaced it), `createSession` /
  `getAccountBySessionToken` (lazy-expiry, opportunistically pruned) / `deleteSession`.
- `index.ts` routes: `GET /auth/discord/authorize` (302 + HttpOnly CSRF `state` cookie) →
  `GET /auth/discord/callback` (verifies state, exchanges code, upserts account, creates session,
  302s to `{clientAppUrl}/auth/callback#token=...` — the token rides the URL *fragment*, not a
  query param, so it never reaches server/proxy logs or a Referer header) → `GET /auth/me` /
  `POST /auth/logout`. Missing Discord config answers 500 on just the `/auth/discord/*` routes,
  never crashes the service.
- 17 new tests (104/104 track-service total), full typecheck clean. `/code-review` (medium) run;
  every finding either fixed (race condition, token-in-URL leak, two duplicated helpers) or
  explicitly documented in code as an accepted limitation (the state-cookie single-in-flight-
  attempt edge case; lazy-only session pruning, with an index added for a future batch-sweep).

## What's left (phase 2, not started)

- [ ] **Client mandatory-login gate**: every `apps/client` route redirects to `/auth` without a
      valid session (`GET /auth/me` check on boot). This is new work, not a reskin — `Auth.tsx`/
      `Login.tsx` in `test_components/` are email/password + Steam/Console/Guest, which doesn't
      match the Discord-only decision at all; the real Login screen is closer to a single
      "Log in with Discord" button than anything in the mock.
- [ ] Client's `/auth/callback` route: reads `#token=` off the URL fragment, stores it, strips it
      from the address bar (`history.replaceState`), redirects into the app.
- [ ] Match-server socket integration: `apps/server` calls `GET /auth/me` (or an equivalent) to
      resolve the account behind a connecting client, replacing/augmenting today's anonymous
      nickname-only identity. Exact shape (a new join-time message carrying the token; how it
      interacts with ADR 0024's own separate reconnect `sessionToken`) is undecided.
- [ ] Logout UI, and what "logged in as" looks like in the Main Menu (ties into ticket 07).

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

## Done when

- [x] Phase 1: track-service issues real Discord sessions, verifiable via `/auth/me`, tested
      end-to-end over real HTTP (no browser needed — confirmed in this sandbox)
- [ ] Phase 2: a fresh `/apps/client` visit with no session redirects to a real Discord login;
      completing it lands back in the app, logged in, reachable by every route including Practice;
      `apps/server` knows which Account a connecting Player is
- [ ] Typecheck clean, full suite green (both already true for phase 1; recheck after phase 2)

## Watch out

- `track-service/src/schema.ts:10`'s comment about `authorId` being mocked "until a real Account
  system exists" is now stale — Accounts exist. Migrating `DEFAULT_AUTHOR_ID` to a real FK is
  *not* part of this ticket (nothing asked for it, and Track authorship isn't blocking anything);
  raise it as its own small ticket if/when it's wanted.
- Phase 2's Login screen is a real design task, not a port — see "What's left" above.

# 11 — Accounts / auth

**What to build:** A real account system — signup/login, session identity tied to a persistent
account rather than a connection-scoped session id — needed by `Login.tsx`/`Auth.tsx`, and as the
FK target `track-service`'s `authorId` already anticipates.

**Blocked by:** nothing — ticket 04 is decided (**ADR 0052**). This is now the first ticket to
build in the backend group; tickets 12–14 are blocked by it.

**Status:** phase 1 (track-service backend) done. Phase 2a (client mandatory-login gate + real
Login/Signup screens + OAuth callback) done. Phase 2b (match-server socket integration) done —
see below. The remaining phase-2 items below not started.

## Decided scope (ADR 0052, corrected by ADR 0053)

- **Both Discord OAuth and email/password — not Discord-only.** ADR 0052's first pass recorded
  the grilling session's answer as OAuth-only; that was a misread of a one-word reply, corrected
  in ADR 0053 to what was actually asked for: both, together, with either usable on its own and
  the two linkable onto one Account in either order. No password-reset flow yet — deferred pending
  a transactional-email provider decision, tracked as its own follow-up.
- **Mandatory, app-wide.** Every route in `apps/client` requires being logged in first — no
  guest/anonymous path, regardless of which method. This explicitly includes `?freeroam=1`
  Practice: the session itself still opens no socket (`apps/client/src/game/practice.test.ts:19`
  is unchanged), but the *route* is now unreachable pre-login, same as the Lobby.
- **Where accounts live: `apps/track-service`**, extended rather than standing up a new service —
  its existing SQLite/Drizzle database gets two new tables (`accounts`, `sessions`) alongside
  `tracks`. Chosen over a new `apps/account-service` to avoid a second always-on process for a
  hobby-scale project.
- Session tokens are opaque bearer tokens (`randomBearerToken`, `packages/shared/src/net/
  bearerToken.ts`) verified by DB lookup — ADR 0024's existing `sessionToken` shape, reused rather
  than introducing JWTs. `apps/server`'s own reconnect `sessionToken` now shares this same helper.
  Passwords are hashed with `node:crypto`'s `scrypt` (random salt, timing-safe verify) — no new
  dependency.

## Phase 1 — track-service backend (done)

- `apps/track-service/src/schema.ts` / `db.ts`: `accounts` (id, `discordId` *nullable*, `email`
  *nullable*, `passwordHash` nullable, displayName, avatarUrl, createdAt — at least one login
  method always present, enforced in `accounts.ts` not the DB) and `sessions` (token, accountId,
  createdAt, expiresAt) tables.
- `password.ts`: `hashPassword`/`verifyPassword` (scrypt, random salt, timing-safe compare).
- `discordAuth.ts`: builds the Discord authorize URL; exchanges an OAuth code for the Discord
  identity it belongs to (`FetchLike` injectable — fully unit-tested with no real Discord app or
  network access).
- `accounts.ts`: `upsertAccountFromDiscord` / `createAccountWithPassword` (both one atomic
  `INSERT ... ON CONFLICT` / plain insert relying on the UNIQUE constraint, never check-then-
  insert), `verifyEmailPassword` (same 401 for "no such email" and "wrong password" — no
  enumeration), `linkDiscordToAccount` / `linkPasswordToAccount` (adds the second method onto an
  already-authenticated Account), `createSession` / `getAccountBySessionToken` (lazy-expiry,
  opportunistically pruned) / `deleteSession`.
- `index.ts` routes: `GET /auth/discord/authorize` (302 + HttpOnly CSRF `state` cookie; if called
  with a valid session, switches to **linking mode** via a second short-lived cookie) →
  `GET /auth/discord/callback` (verifies state; a fresh login upserts + creates a session and 302s
  to `{clientAppUrl}/auth/callback#token=...` — a fragment, never a query param, so it never
  reaches server/proxy logs or a Referer header; linking mode instead links onto the existing
  Account and redirects with `#linked=discord`, or `#error=discord-already-linked` if that Discord
  identity belongs to someone else) → `POST /auth/signup` / `POST /auth/login` (plain JSON,
  `{account, token}`) → `POST /auth/link/password` (requires an existing session) →
  `GET /auth/me` / `POST /auth/logout`. Missing Discord config answers 500 on just the
  `/auth/discord/*` routes, never crashes the service.
- 33 new tests (134/134 track-service total), full typecheck clean. Two `/code-review` (medium)
  passes: the first (Discord-only) fixed a race condition, a token-in-URL leak, and two duplicated
  helpers, and documented two accepted limitations in code (the state-cookie single-in-flight-
  attempt edge case; lazy-only session pruning, with an index added for a future batch-sweep). The
  second (after adding email/password + linking) fixed a real bug — `linkDiscordToAccount` was
  silently overwriting a Player's chosen `displayName` with their Discord username, asymmetric
  with `linkPasswordToAccount` never touching it the other way — restored the migration guard for
  `accounts` that the first pass had (correctly, at the time) dropped as unnecessary, since the
  Discord-only shape it guards against is now real committed history (commit 87b1426), and
  deduplicated the repeated parse-JSON-body-or-400 pattern into one `readJsonBody` helper.

## Phase 2a — client mandatory-login gate + real Screens (done)

- `apps/client/src/lib/auth.ts`: token storage (localStorage), `parseAuthCallbackFragment`,
  `signup`/`login`/`logout`/`fetchAccount`/`discordAuthorizeUrl` — thin fetch wrappers over
  track-service's `/auth/*` routes, no React.
- `apps/client/src/lib/useAccount.ts`: the gate's own state — resolves the stored token against
  `GET /auth/me` once per mount; a 401 clears the stale token, a network failure fails closed
  *without* clearing it (a transient blip isn't a real logout).
- `apps/client/src/components/AuthGate.tsx`: a React Router layout route wrapping `/` and `/play`
  — `checking` shows a wait state, `unauthed` redirects to `/auth`, `authed` renders the real
  route via `<Outlet/>`. Mounted once for the whole authed subtree, not re-checked per navigation.
- `apps/client/src/screens/AuthScreen.tsx`: the real `/auth` — a "Log in with Discord" button plus
  an email/password form with a login/signup toggle (signup also asks for a display name). Built
  fresh against the decided scope, not a port of `test_components`' `Auth.tsx`/`Login.tsx` (those
  show Steam/Console/Guest and a "remember me" model that were never decided).
- `apps/client/src/screens/AuthCallbackScreen.tsx`: `/auth/callback` — parses the fragment via
  `useLocation().hash` (not the global `window.location`, so it behaves identically under
  `BrowserRouter` and a test's `MemoryRouter`), stores a fresh token and lands on `/`, or routes a
  `linked=discord`/`error=...` back to `/auth`.
- `App.tsx`: `/auth` and `/auth/callback` are the only routes reachable without a session; `/` and
  `/play` (including `?freeroam=1` Practice — no exemption) sit behind `<AuthGate>`.
- 22 new/changed tests (331/331 client total), full typecheck clean (the pre-existing
  `test_components/` typecheck failures are untouched, confirmed unrelated before this pass too).

## Phase 2b — match-server socket integration (done)

- New `auth` client message (`{type:"auth", token}`) sent right after open; the server resolves
  it via the API's own `GET /auth/me` (injectable `AccountResolver`, betting-notifier posture:
  invalid/unreachable → anonymous seat + log, never a close — auth is enrichment, never a gate).
- `LobbyPlayer` + `DnfEntry` carry `accountId: string | null` (null until/unless bound);
  nicknames stay cosmetic. `GET /status` gains `accounts[]` (authed only) + current `round`
  for friends presence. `PersistedMatchResult` gains sparse `accountIds` (pre-2b rows default
  to `{}` on read) — what RECENT reads.
- ADR 0024 interplay resolved by absence: reconnect parking is unimplemented ("M2 defines the
  shape; the server does not act on it yet"), so there is no parked binding to restore —
  binding is per-connection.
- Covered by resolver unit tests, real-runtime binding tests (incl. departed-mid-resolution
  and re-auth), and two live `matchServer.test.ts` cases — the live two are written but
  unrunnable in this sandbox (bind denied), pending a live run.

## What's left (phase 2b done, remainder not started)
- [ ] A "link the other method" UI for an already-logged-in Player (calls `/auth/link/password` or
      the Discord authorize route with their existing session) — the backend endpoints exist
      (phase 1); no client UI calls them yet. Ties into ticket 07/Profile.
- [ ] Logout UI, and what "logged in as" looks like in the Main Menu (ties into ticket 07).
- [ ] Password reset (deferred — needs a transactional-email provider decision first).

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

- [x] Phase 1: track-service issues real sessions (Discord or email/password), verifiable via
      `/auth/me`, tested end-to-end over real HTTP (no browser needed — confirmed in this sandbox)
- [x] Phase 2a: a fresh `apps/client` visit with no session redirects to `/auth` on every route
      including Practice; logging in (either method) lands back in the app — proven by component
      tests (`MemoryRouter`, mocked `fetch`), not yet live-verified in a real browser (no browser
      automation in this sandbox, same limitation M8/M8.1 already noted)
- [x] Phase 2b: `apps/server` knows which Account a connecting Player is
- [x] Typecheck clean, full suite green for everything built so far

## Watch out

- `track-service/src/schema.ts:10`'s comment about `authorId` being mocked "until a real Account
  system exists" is now stale — Accounts exist. Migrating `DEFAULT_AUTHOR_ID` to a real FK is
  *not* part of this ticket (nothing asked for it, and Track authorship isn't blocking anything);
  raise it as its own small ticket if/when it's wanted.
- Phase 2's Login screen is a real design task, not a port — see "What's left" above.

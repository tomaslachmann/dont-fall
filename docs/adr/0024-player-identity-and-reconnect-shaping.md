# 0024 — Player identity is a public `playerId` plus a secret `sessionToken`; reconnect is protocol-shaped, not implemented

M2's `WelcomeMessage.id` is a per-connection `randomUUID()` — a transport-scoped alias.
ADR 0018 fixes the wire shapes as final, so a reconnect that needs a new field or message
later would be a protocol-version break. Reconnect itself stays out of M2 (roadmap), but its
*shape* is decided now.

## Decision

Split identity from credential:

- **`playerId`** — stable, public. Keys this client's Character in every snapshot; other
  clients see it. Not a credential.
- **`sessionToken`** — a bearer credential: 32 bytes crypto-random (`crypto.randomBytes(32)`,
  base64url ≈ 43 chars). **Not** a UUID (v4 carries only 122 bits of entropy). Sent only in
  the owning client's `WelcomeMessage`, never rebroadcast — a bearer credential must never be
  visible to other clients (OAuth: "any party in possession of the token can use it"). The
  client stores it and presents it in a `reclaim` message to re-attach to a parked
  Character.
- **Pure bearer, no transport binding** for M2 — recorded as an explicit accepted risk: a
  leaked token (dev tools, network log, XSS) allows Character takeover for the grace window.
  Acceptable for a non-competitive party game with a short-lived token; revisit if theft is
  observed (needs a stable client fingerprint we don't have over plain WS).
- **`GRACE_WINDOW_MS = 90_000`** — how long a disconnected Character is parked and the token
  stays valid (`disconnectedAt + GRACE_WINDOW_MS`). *Revised from a 45 s draft:* 45 s is the
  "a new player claims the freed slot" window; the returning-player hold is 60–120 s for
  co-op / party games, and 90 s sits inside that.
- The server must distinguish a **graceful disconnect** (client close frame) from a
  **silent drop** (timeout). A `reclaim` arriving before the old connection is detected dead
  must cleanly take over and discard the orphan connection — the "ghost session" (two
  parallel sessions for one player) is the most common reconnect bug class.

**M2 implements none of the reconnect logic** — the fields are issued, `reclaim` is a
no-op. The full flow is documented in `networking-model.md` §7 for M-later: *reconnect
token · grace window · slot hold · full-snapshot rehydration (never replay missed deltas) ·
idempotency*.

## Consequences

- `WelcomeMessage`: `id` → `playerId` + `sessionToken` + `config`. New `reclaim` client
  message (shape only).
- Every place that used `WelcomeMessage.id` as "my Character id" uses `playerId`; the value
  is now explicitly a stable player identity, not a transport handle.
- `GRACE_WINDOW_MS` and the reclaim flow interact with M4 Match structure (a parked
  Character occupies a slot); that coupling is noted, not resolved here.

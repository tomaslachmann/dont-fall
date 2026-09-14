# 0054 — A lobby broker, and multiple Lobbies live in-process, not as separate OS processes

## Context

Wiring `PlaySelect.tsx`'s private-lobby-with-code and Quick Match flows to a real backend exposed
a gap deeper than a missing endpoint: this project has never had more than one Lobby at a time.
`apps/server` is "one instance spun up on-demand per Match" (`CLAUDE.md`) — one `WebSocketServer`,
one `MatchRuntime`, one boot. There was no service that knew about more than one Lobby, no room
code, and no way for a client to discover or choose between several.

A private lobby needs a shareable join code; Quick Match needs a pool of public, joinable Lobbies
to match a Player into (or to create one if none exist). Both need something that outlives any
single Lobby and can list/create/resolve many of them — a broker, the same shape `track-service`
already is for Tracks.

## Decision

**A new always-on service, `apps/lobby-broker`** (`@dont-fall/lobby-broker`), mirroring
`track-service`'s own pattern: a small HTTP API (`POST /lobbies`, `GET /lobbies`,
`GET /lobbies/code/:code`, `POST /lobbies/quick-match`) backed by an in-memory registry
(`LobbyRegistry` — id, a 6-character join code for a private Lobby, port, idle-tracking; no
persistence, matching this project's own "don't build for scale not yet needed" convention already
established elsewhere, e.g. track-service's own un-paginated listing).

**Every Lobby the broker creates is a real, independent `MatchRuntime`/`WebSocketServer` pair —
`@dont-fall/server`'s own `startServer()` — called in-process, not spawned as a separate OS
process.** This is the one genuinely new, hard-to-reverse call this ADR exists to record:
`CLAUDE.md`'s "one instance spun up on-demand per Match" now means one `MatchRuntime` +
`WebSocketServer` pair, fully isolated simulation state, per Lobby — not necessarily one OS
process per Lobby. The isolation guarantee the original line protects (no Match ever shares
simulation state with another) is fully preserved; only the process boundary moved.

This was only the right call because of the same session's other change
(`phaseNeedsPhysicsStep`, ADR-adjacent — see `packages/shared/src/match/MatchPhase.ts`): an idle
Lobby (nobody connected, or everyone sitting in `LOBBY`/`RESULTS`) no longer pays for a Rapier
`world.step()` at all. Many concurrently-idle Lobbies sharing one Node event loop is now genuinely
cheap — before that fix, running several always-ticking physics worlds in one process would have
been the wrong trade.

**`apps/server` gained a `GET /status` route**, sharing the same port as its `WebSocketServer`
(a plain `http.Server` the `WebSocketServer` now attaches to via `{ server }`, instead of owning
its own bare port) — `{playerCount, maxPlayers, phase}`. This is the broker's only way to know a
Lobby's live occupancy without joining it as a Player; it exists purely for this, and works
identically whether the broker and the Match server end up sharing a process (today) or not
(if that ever changes).

**A private Lobby's "password" is the existing 6-character join code** (`PlaySelect.tsx` already
built this UI) — not a second, host-chosen secret. Confirmed directly with the user rather than
assumed: the colloquial "heslo" (password) in the ask turned out to mean the code already in the
mock, not a new field.

**Quick Match auto-creates a Lobby when no public one is open and joinable** (`LOBBY` phase, under
capacity) — never makes a Player wait in a queue for one to appear. Also confirmed directly:
matches `PlaySelect.tsx`'s own "~18s WAIT" framing (a short, bounded wait), not an open-ended one.

**Idle reaping**: the broker polls every tracked Lobby's `/status` on an interval and closes
(`MatchServer.close()`) any Lobby that has sat with zero connected Players for longer than a grace
period. A Lobby nobody ever joined and one that emptied back out are treated identically — both
just mean "no one has been here for a while."

## Considered options

- **Spawn a separate OS process per Lobby** (via `child_process.fork()`, IPC to learn the assigned
  port) — the more literal reading of "one instance per Match." Rejected for now: meaningfully more
  machinery (process lifecycle, port discovery, IPC, zombie-process cleanup) for no benefit once
  idle Lobbies are cheap in-process; revisit with a superseding ADR if real scale ever demands
  process-level isolation (a crash blast radius smaller than "the whole broker," true multi-core
  use).
- **A host-chosen password instead of a generated code** — rejected; confirmed directly with the
  user that the existing generated-code UI (`PlaySelect.tsx`) was already the intended mechanism.
- **Quick Match queues a Player until a public Lobby has room** — rejected; auto-creating a fresh
  Lobby keeps the wait bounded and matches the UI's own existing "~18s WAIT" framing rather than
  an unbounded queue, which is real additional machinery (a queue, real-time position updates)
  with no asked-for behavior behind it.
- **The broker inspects `MatchRuntime` state directly** (no HTTP `/status` round-trip, since broker
  and Match server share a process today) — rejected: it would couple the broker to
  `apps/server`'s internals in a way that breaks the moment a Lobby's isolation ever does move to a
  separate process, for a query that costs nothing extra as plain HTTP over loopback.

## Consequences

- `packages/shared` gains `DEFAULT_LOBBY_BROKER_PORT` (8082) and `MAX_PLAYERS` (10, configurable
  via env, same pattern as `PLAYERS_TO_START`).
- `WelcomeMessage.config` and `LobbySnapshot` both gain `maxPlayers`, read off the server's own
  configured value (ADR 0040: clients render the server's numbers, never a second guess).
- `apps/server`'s `WebSocketServer` construction changed from owning its own bare port
  (`new WebSocketServer({ port })`) to attaching to an explicit `http.Server`
  (`new WebSocketServer({ server: httpServer })`) so `/status` can share it. `close()` must now
  close both explicitly — `ws`'s own documented behavior is that closing a `WebSocketServer`
  created with an external `server` never closes that server.
- `apps/server`'s `package.json` gained `main`/`types`/`exports` (mirroring `track-service`'s
  shape) so `@dont-fall/lobby-broker` can import `startServer` as a normal workspace dependency.
- `apps/client`'s `PlaySelect.tsx`/`Lobby.tsx` still need wiring to this broker's API (out of scope
  here — this ADR covers the backend only). The connection they open once a Lobby is
  created/resolved targets that Lobby's own returned `port`, not `DEFAULT_SERVER_PORT` — a small
  but real change to how `apps/client` decides which Match server to talk to.
- `scripts/dev.sh` does not yet start `apps/lobby-broker` for local dev — a small follow-up, not
  covered here.

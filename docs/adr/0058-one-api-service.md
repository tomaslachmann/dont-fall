# 0058 — One API service: track-service + lobby-broker merge (Fastify, layered)

Two always-on HTTP services (`apps/track-service` on 8081, `apps/lobby-
broker` on 8082) both hand-roll `node:http` routing, CORS, and body parsing,
and both are one deployment too many for a cheap cloud: four Node processes
(client, match-standalone, + these two) before a single Match exists. Merge
them into one `apps/api` on a single port.

## Decision

- **One service, one port (8081).** All current routes move unchanged —
  `/health`, `/tracks/*`, `/tracks/generate`, `/assets/*`, `/auth/*`,
  `/lobbies/*` — same methods, paths, statuses, and bodies. `DEFAULT_API_PORT`
  replaces `DEFAULT_TRACK_SERVICE_PORT`/`DEFAULT_LOBBY_BROKER_PORT`; every
  consumer (client `Endpoints`, track-builder, match server env) points at
  the one origin. The ephemeral per-Match servers stay exactly as they are
  (ADR 0054, in-process instances owned by the lobbies module).
- **Fastify 5 + @fastify/cors.** The third hand-rolled router is not written:
  Fastify owns routing, JSON parsing, and CORS. A single error handler
  preserves the existing `{ error }` body shapes (including "invalid JSON
  body"), so the merge is invisible to every client. No JSON-schema
  validation layer — the hand-written validators (`validate.ts`, `isSegment`)
  stay the single truth, already pinned by tests; a second schema would be
  two opinions about the same gate.
- **Controller → Service → DAO per module**, under `apps/api/src`:
  `tracks/` (publish/list/fetch/generate + validation), `assets/` (GLB
  bytes), `auth/` (Discord OAuth, email/password, sessions), `lobbies/`
  (create/browse/by-code/quick-match + idle reaper), `db/` (Drizzle open +
  schema). Controllers are thin (parse → service → status+body); services
  own domain rules and orchestration; DAOs own persistence — Drizzle for
  tracks/accounts, the existing in-memory registry (unchanged rationale:
  match servers die with the process, so there is nothing durable to
  reconnect to) for lobbies. One SQLite file for everything durable.
- **Tests go through `app.inject()`, not ports.** The current suites bind
  loopback (unrunnable in a network-sandboxed shell, and slower everywhere).
  `buildApp()` is the seam: route tests inject requests, the lobbies service
  takes its match-server/s-status seams as constructor config (fakes in
  tests, real ones in production). Behavior assertions move verbatim; only
  the transport changes.
- **No behavior change, beyond the port.** Same seeds (M1, asset demo), same
  revision immutability, same CORS posture, same reaper cadences, same close
  reasons. Anything intentionally different gets its own note in the module,
  not a silent drift.

## Consequences

- `apps/track-service` and `apps/lobby-broker` are deleted; `TRACK_SERVICE_URL`
  becomes `API_URL` (server, broker-spawned lobbies, builder, client).
- `docker-compose.yml`, `scripts/dev.sh`, and the Dockerfile collapse to one
  service each. `DEV_PORTS` loses 8082.
- `fastify` + `@fastify/cors` are the project's first framework deps —
  contained to `apps/api`, never `packages/shared` (which stays dependency-
  free for the sim) and never the client bundle.

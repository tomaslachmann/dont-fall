# 03 — Match server fetches its Track from track-service

**What to build:** The Match server (`apps/server`) fetches a fully-resolved Track from
track-service at Round start (by ID, or "any") instead of importing hardcoded `PLAYGROUND_*`
constants, and assembles its authoritative simulation from the returned data. This is the
tracer-bullet checkpoint proving the whole new architecture end-to-end with zero player-visible
change: a live 2-browser session plays the same (still M1-identical) Track exactly as before, but
now sourced from the database via track-service instead of hardcoded imports.

**Blocked by:** 02 (track-service must exist and serve a real Track).

**Status:** done

- [x] Match server calls `GET /tracks/any` at startup and resolves it via `resolveTrack` against
      `MODULE_LIBRARY`; no more direct `PLAYGROUND_STATICS`/`PLAYGROUND_PROPS`/`PLAYGROUND_SPINNERS`
      imports for the live Track
- [x] The new runtime dependency is unmasked: `fetchTrack` throws a clear error naming ADR 0028 if
      track-service is unreachable or empty — `startServer` does not catch it
- [x] Verified live with real, separate processes (not just vitest): started track-service and the
      Match server as two real processes, connected a raw WebSocket client, confirmed the welcome
      spawn and a snapshot with the seeded M1 Track's 3 Props present
- [x] Existing server tests (`index.test.ts`, `tickAddressedInput.integration.test.ts`) start a
      real in-memory track-service instance per file (`TRACK_SERVICE_URL` env, read by
      `startServer`'s default) instead of relying on hardcoded constants — 13 server tests green,
      263 total across the monorepo

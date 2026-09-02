# 02 — track-service scaffold: SQLite schema + fetch/save API, seeded with the M1 Track

**What to build:** A new, separate, always-on Node service (`apps/track-service`) that is the
single source of truth for Tracks (ADR 0028). SQLite via Drizzle + `better-sqlite3` on a
Docker-mounted named volume (ADR 0029, `docs/research/m3-track-storage.md`). A minimal HTTP API:
save a Track, fetch a Track by ID, fetch any Track. Seeded at startup (or via a one-off script)
with the M1 Track from ticket 01, so there is a real, fetchable Track end-to-end from day one.

**Blocked by:** 01 (needs the Module/Track data shape the schema stores).

**Status:** done

- [x] `apps/track-service` runs as its own always-on process (`src/index.ts`, `startTrackService`),
      independent of the ephemeral per-Match `apps/server` (ADR 0002/0011 untouched)
- [x] SQLite schema (Drizzle, `src/schema.ts`) stores a Track as a JSON-serialized `Segment[]`
      (the shape is small/self-contained — no relational structure needed, per
      `docs/research/m3-track-storage.md`)
- [x] `POST /tracks` save a Track, `GET /tracks/:id` fetch by ID, `GET /tracks/any` fetch any
- [x] Data persists across a restart — WAL-mode SQLite file on disk (`TRACK_DB_PATH`), verified by
      a test that closes and reopens the service against the same file
- [x] Seeded with the M1 Track (`M1_SEED_TRACK_ID`) on first run only (idempotent); save→fetch and
      restart-persistence round trips are covered by tests (8 tests, all green)
- [x] `Dockerfile` (repo-root build context, native `better-sqlite3` compiler deps) + root
      `docker-compose.yml` with a named volume for local dev
- [x] Manually smoke-tested: real process start, `/health`, seeded-Track fetch all verified live,
      not just under vitest

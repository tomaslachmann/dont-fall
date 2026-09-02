# 02 — track-service scaffold: SQLite schema + fetch/save API, seeded with the M1 Track

**What to build:** A new, separate, always-on Node service (`apps/track-service`) that is the
single source of truth for Tracks (ADR 0028). SQLite via Drizzle + `better-sqlite3` on a
Docker-mounted named volume (ADR 0029, `docs/research/m3-track-storage.md`). A minimal HTTP API:
save a Track, fetch a Track by ID, fetch any Track. Seeded at startup (or via a one-off script)
with the M1 Track from ticket 01, so there is a real, fetchable Track end-to-end from day one.

**Blocked by:** 01 (needs the Module/Track data shape the schema stores).

**Status:** ready-for-agent

- [ ] `apps/track-service` runs as its own always-on process, independent of the ephemeral
      per-Match `apps/server` (ADR 0002/0011 untouched)
- [ ] SQLite schema (Drizzle) stores a Track as an ordered list of Module placements
- [ ] `POST` save a Track, `GET` fetch by ID, `GET` fetch any — no other operations yet
- [ ] Data persists across a container/process restart (Docker named volume, or local-dev
      equivalent)
- [ ] Seeded with the M1 Track; a save→fetch round trip is covered by a test
- [ ] Dockerfile / compose entry for local dev, matching the project's existing
      single-manually-started-process simplicity where possible

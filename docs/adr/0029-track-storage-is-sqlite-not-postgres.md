# 0029 — Track storage is SQLite (Drizzle + `better-sqlite3`, Docker volume), not Postgres

The track-service (ADR 0028) needs to persist Tracks — small JSON-shaped documents (an ordered
list of `{moduleId, position, rotation}` placements), no relational querying beyond "fetch by ID"
or "fetch any." Researched rather than assumed (`docs/research/m3-track-storage.md`): SQLite via
Drizzle ORM on a Docker-mounted named volume is the standard, sensible choice for a small,
low-write-concurrency, containerized internal service at this scale — matching this project's
established pattern of not pre-building for speculative scale (ADR 0002/0011's "validated at 2,
architected toward 12, not further"). A real account/Player system is planned but explicitly out
of M3's scope; **migrate to Postgres when that system actually lands**, not before — a store
holding hand-authored and algorithmically-generated Track documents with no per-user relational
structure yet has nothing Postgres would earn its operational cost for today.

## Consequences

- `apps/track-service` (or wherever the new always-on service lands) takes `better-sqlite3` +
  Drizzle as its DB dependencies; the SQLite file lives on a Docker named volume so it survives
  container restarts.
- This is a project first: no persistence layer has existed anywhere before M3. Revisit this ADR
  specifically (not silently work around it) if the future Account system's needs turn out to
  arrive sooner or heavier than expected.

# 01 — Drafts live in the API

**What to build:** New `track_drafts` table (drizzle schema + migration, same
discipline as `tracks`) holding the unfinished Track: id, name, round type
(`race`|`survival`), segments JSON, timeLimitMs, survivorTarget, environment,
createdAt/updatedAt. DAO + service + controller following the existing
tracks layering (controller → service → DAO): create (from scratch or from
track+revision), get, replace-segments, patch meta, delete. No validation of
course-completeness on write — a draft is allowed to be half-built (D5);
only shape validation (is-Track, known attachment fields). ADR 0114, D4+D9.

**Blocked by:** —

**Status:** done on tests (2026-09-20)

- [x] `track_drafts` table in `apps/api/src/db/schema` + migration path
- [x] DAO: save/get/replace-segments/patch-meta/delete draft
- [x] Service + controller routes (REST under `/drafts`), thin, status-code mapping only
- [x] Tests: full draft lifecycle; create-from-revision copies segments; unknown draft 404s

## As built

- `POST /drafts` upserts on explicit `id` (returns `{id, created}` so a
  reset reads as a reset, not a duplicate) and generates a UUID otherwise;
  `GET /drafts` lists without Segments; `PUT /drafts/:id/segments` replaces
  Segments whole; `PATCH /drafts/:id` patches publish metadata; `DELETE`
  discards with a 404 on unknown ids.
- Shape validation only (is-Track, attachment fields, known Modules, meta
  ranges, round type) — course-completeness stays out by D5.
- Found while testing: drizzle's `onConflictDoUpdate` chain never executes
  without a terminal — the upsert needed an explicit `.run()` (bare
  `.values()` runs on its own, which is why `saveTrack` never noticed).

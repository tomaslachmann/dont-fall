# 09 — The Environment on the Revision

**What to build:** a Revision stores which Environment it is drawn in, and the
game draws that one.

**Blocked by:** 02

**Status:** done (2026-09-16) — tests and typecheck.

## What to change

- [x] `apps/api`: `environment TEXT NOT NULL DEFAULT 'day'` on `tracks`, added
      the way `time_limit_ms` / `survivor_target` were (`db.ts` `ALTER TABLE`);
      old Revisions backfill to `day`
- [x] Publish validates with `invalidEnvironmentReason`; a typo is refused with a
      readable reason
- [x] `StoredTrack` gains `environment` (a sibling field, not in
      `TrackRoundDefaults`); `GET /tracks/:id` returns it
- [x] Client: `trackLoading.ts` → `game/index.ts` / `practice.ts` →
      `createStage`; an unknown id falls back to `day` with a dev warning, never
      an error
- [x] The Match server ignores it: not in `RoundRules`, not on the Snapshot
      (a test pins this)

## Notes

- ADR 0074, following ADR 0038. The `Segment[]` `data` envelope is unchanged.

## As built

- `apps/api/src/db/db.ts`: the `CREATE TABLE` has `environment TEXT NOT NULL DEFAULT 'day'`, and
  an existing database gets it through the same `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT`
  backfill `survivor_target` used. `schema.ts` has `environment: text("environment").notNull()`.
- `saveTrack` takes `environment?: EnvironmentId`, defaults it, and keeps it out of the content hash,
  like the time limit and survivor target (the same Segments under another sky are the same Track).
  `toStored` reads the column through `resolveEnvironmentId(...).id`, so a row holding a preset this
  build lacks (a newer API's, after a rollback) comes back as `day`, never as a bad id.
- `publishTrack`: absent means the default. Anything present must pass `invalidEnvironmentReason`,
  so a typo is a 400 with `environment must be one of day, sunset, night`. `null`, numbers, `""`
  and objects are refused too. Seeded and generated Tracks take the default.
- `StoredTrack.environment: EnvironmentId` is a sibling field, not in `TrackRoundDefaults`.
- Client: `TrackLoading.fetchTrack` returns `FetchedRevision { track, name, environment }`. It
  resolves the raw body with `resolveEnvironmentId`: unknown means `day` plus a
  `DON'T FALL: Track <id>: …` warning, and missing means `day` silently. `game/index.ts` (both the
  boot and the live Track swap) and `practice.ts` pass `ENVIRONMENT_PRESETS[environment]` to
  `createStage`.
- The pin: `apps/server/src/environmentBoundary.test.ts`. `trackSource.fetchTrack` given a body
  with `environment` returns exactly `id, revision, survivorTarget, timeLimitMs, track`. A source
  scan also finds no Environment identifier (`EnvironmentId`, `EnvironmentPreset`,
  `ENVIRONMENT_PRESETS`, `ENVIRONMENT_IDS`, `resolveEnvironmentId`, or `.environment`) in
  `apps/server/src` or in `packages/shared/src/{simulation,match,net,state}`.

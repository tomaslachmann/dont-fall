# 0078 — The builder places Assets only; one seed, the base race

## Context

By ADR 0073/0075 the builder's PROCEDURAL tab listed nothing: every procedural
Module was deleted or retired, kept in `MODULE_LIBRARY` only so Tracks stored
before the retirements still loaded. The builder still carried the tab, its
row previews, and a box-drawing path for procedural Segments.

The API seeded two code-owned Tracks: the procedural "M1 playground" and the
M8 "Asset demo" (two floors and the retired `finish` block). Neither is a
course anyone plays, and both kept tests and the builder's load placeholder
pointed at procedural content.

The user (2026-09-16): remove procedural from the builder entirely, since we
only have Assets now; delete every stored Track; build a Fall Guys-style race
that becomes the base — the only seed. Asked how far the removal goes, the
user chose the builder and the seeds, not the shared library. Asked about
length, the user wants it at least three minutes long and fun.

## Decision

- **The builder places Assets only.** `builderLibrary()` is
  `ASSET_PLACEMENT_MODULES`; the PROCEDURAL tab, its rows and palette grouping
  are deleted, and the viewport no longer draws procedural boxes, spinners,
  props or trigger markers — an Asset Segment whose bytes haven't landed draws
  nothing. Asset templates load when the palette mounts. Loading a stored Track
  that places a Module the builder doesn't know names it in the status and
  skips it, instead of the old retired-Module warning.
- **The shared procedural library stays** (`M1_MODULES`, `MODULE_LIBRARY`,
  `M1_TRACK`, `playground.ts`) as test fixtures, and the server, client and
  publish validation still compose it. Deleting it is a separate change: the
  netcode regression harness and many simulation suites stand on that world.
- **One code-owned seed: the base race** (`packages/shared/src/track/baseRace.ts`,
  id `base-race`). Built from Assets only, as data laid out section by section
  from a cursor: a start plaza, door rush, sweepers, a wrecking-ball bridge,
  moving platforms, spinning squares, a spring-and-fan climb, a belt climb with
  pusher walls, an ice slide with bumpers, hammer alley and the finish — seven
  Checkpoint arches between them. The M1 playground and Asset demo seeds are
  gone.
- **The seed owns its clock.** `syncSeedTrack` takes the seed's Time Limit (five
  minutes for the base race) and treats a changed clock as drift, like changed
  Segments (ADR 0073).
- **Stored Tracks were wiped** once, by hand, from the running dev database
  (tracks and their play counts; a backup was kept). This is an operation, not
  code: nothing deletes Tracks on boot.

## Consequences

- `baseRace.test.ts` resolves the race against the real files (no warnings, a
  Start, Checkpoints 1–7 with floors, one finish) and walks it end to end with
  every Motion stopped at rest: every gap, Spring, fan, belt and Checkpoint is
  proven reachable without a Fall. A straight walk takes about 2 min 10 s;
  timing the moving obstacles and falling is what makes a real run longer. The
  test cannot judge whether the obstacles' timing is fair — that is a play
  check.
- The seed is code-owned, so editing `base-race` in the builder and saving
  under the same id is undone on the next API boot (a new Revision with the
  code's content). Tune it in `baseRace.ts`, or save a builder copy under
  another id.
- Tests that relied on the old seeds moved to the base race; a Round draw
  against a procedural-only library can no longer resolve the seed, so tests
  that may draw it use the full asset library, as production does.
- Supersedes ADR 0073's "the procedural palette lists exactly one placeable
  Module" consequence and its note that the M1 seed self-heals — there is no M1
  seed.

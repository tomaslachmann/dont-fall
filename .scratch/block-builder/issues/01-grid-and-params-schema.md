# 01 — Grid units + `BlockParams` schema (shared + service validation)

**What to build:** The data-model floor everything else stands on: `GRID_XZ /
GRID_Y` constants with a `quantize` helper, the optional `params` field on
`Segment`, and server-side validation that accepts it without touching old
Revisions.

**Blocked by:** nothing. First ticket.

**Status:** planned

## Why

Every later ticket (geometry generation, snap points, builder UI) consumes
this shape. Landing it first — with tests pinning the integer-multiple rule —
means the geometry and UI tickets argue about behavior, never about the wire
format.

## What to change

- [ ] `GRID_XZ = 0.5`, `GRID_Y = 0.25` constants + `quantize(value, axis)`
  helper in `packages/shared` (near `track/Track.ts`); unit tests: multiples
  pass, `0.3` height / `0.6` width fail, negative/zero grid counts fail
- [ ] `BlockParams` type + optional `Segment.params` (`cuboid` | `wedge` only
  in this phase — `arc` arrives in ticket 06; the type may reserve the kind
  but `resolveTrack` must refuse it until then, not half-build it):
  `{ kind; lengthGrid, widthGrid, heightGrid: int; slopeAxis?: "x" | "z" }`
  — horizontal counts in `GRID_XZ` units, `heightGrid` in `GRID_Y` units
- [ ] `resolveTrack` passes param-less Segments through byte-identically
  (regression test over the M1 seed: same statics as before the change)
- [ ] track-service: extend `isSegment` with the optional `params` branch
  (mirror the optional-finite `pitch`/`roll` pattern); unknown `kind`/field
  rejected `Object.hasOwn`-style (mirror `unknownModuleIds`);
  reject-not-clamp, integer + MIN/MAX range style per `validate.ts`
- [ ] `POST /tracks` order unchanged (shape → module/param check → limits →
  save); new Revisions may carry `params`, old ones validate untouched

## Done when

- [ ] `packages/shared` grid/params unit tests green; M1-seed `resolveTrack`
  output unchanged
- [ ] track-service validation tests: valid cuboid/wedge params accepted,
  non-integer grid counts / unknown kind / `arc` (this phase) rejected with a
  readable 400 reason
- [ ] Full typecheck clean

## Watch out for

**`arc` must fail loudly this phase, not silently build.** A half-wired kind
that passes validation but generates no geometry is worse than a rejection —
it simulates as nothing. The 400 reason should say "arc ships in phase 2".

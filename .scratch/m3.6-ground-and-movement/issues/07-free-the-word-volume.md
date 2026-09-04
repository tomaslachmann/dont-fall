# 07 — Free the word `Volume`

**What to build:** A Checkpoint's detection region stops being called a volume, so that `Volume` can
mean what CONTEXT.md now says it means: a region that applies a force.

Worth landing before M3.7 introduces the second meaning, rather than after.

**Blocked by:** None — can start immediately, independent of everything else in this milestone.

**Status:** done

- [x] A Checkpoint's region is renamed to a trigger, across shared code, the server, the client and
      the Track builder — including the doc comment, which already calls it "a trigger volume"
      (ADR 0036)
- [x] It is part of the Module authoring shape, so confirm whether any published Revision serialises
      it; if it does, accept the old key on read rather than breaking existing content
- [x] No behaviour changes — Checkpoints activate exactly as before

## Implementation notes

Mechanical rename: `Checkpoint.volume: OrientedBox` → `Checkpoint.trigger: OrientedBox`
(`packages/shared/src/simulation/Checkpoint.ts`), with every read/write site following —
`Module`/`modules.ts`'s checkpoint literals, `Track.ts`'s `resolveTrack` (`placeBox(module.checkpoint
.trigger)`), `RapierSimulation.ts`'s containment check and `getCheckpoints()`, the Track builder's
`render.ts`, and the client's `scene.ts`. Doc comments that used "volume" to describe a Checkpoint's
own region (`Checkpoint.ts`, `Module.ts`, `box.ts`, and test `describe`/`it` titles) were reworded to
"trigger" too — the ticket's own example, `box.ts`'s "trigger volume" comment, was one of them.
`Checkpoint.ts`'s own doc comment now explicitly says *why*: a Checkpoint's region is detection-only,
never a Volume (ADR 0036 reserves that word for a region that applies a force).

**Confirmed no published Revision serialises this field, so no back-compat shim was needed.**
track-service's `tracks` table (`apps/track-service/src/schema.ts`) stores a Track's `data` column as
JSON-serialized `Segment[]` — and `Segment` (`packages/shared/src/track/Track.ts`) carries only
`moduleId, position, rotation, pitch?, roll?, manuallyPlaced?`. A Checkpoint's geometry lives entirely
on the `Module` definition in `packages/shared/src/track/modules.ts` (in-code, not persisted) and is
resolved fresh at runtime by `resolveTrack` — it never reaches the database. Grepped track-service's
and the Track builder's own test suites for `volume`/`trigger` to confirm neither has fixture data
depending on the old key; found none.

No behavior changes: the field rename touches type declarations and property accesses only, no
control flow. The full test suite (unchanged assertions, just renamed keys in fixtures) is the
verification — no new tests were needed for a pure rename, and no live-browser check either (nothing
here is observable to a player; the ticket's own checklist has no "manually verified live" item,
unlike every other ticket in this milestone).

## Code review findings and fixes

`/code-review medium` (a mechanical rename — plumbing, per CLAUDE.md) — no findings. Confirmed the
rename is complete across shared, server, client, and the Track builder, including checking
`playtest.ts` (which passes the `checkpoints` array through without destructuring the renamed field,
so it needed no change).

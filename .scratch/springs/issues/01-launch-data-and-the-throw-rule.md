# 01 — Launch data, and the throw rule that keeps your run

**What to build:** `Segment.launch` / `AssetModuleDef.launch` as shared data, the
height→speed conversion, and the change from "replace the whole velocity" to
"set vertical, add horizontal" (ADR 0069) — for every launch pad, not just
Springs.

**Blocked by:** nothing (first ticket).

**Status:** done (2026-09-15).

## What to change

- [x] `packages/shared/src/simulation/LaunchPad.ts`: document the split rule on
      `LaunchPadConfig.velocity` — the world-Y component is SET, the rest is
      ADDED. Contrast note against Quake's whole-vector `VectorCopy` stays, it
      is now a *deliberate* divergence, not the model we copy.
- [x] `CharacterController.triggerLaunchPad`: apply the split on the queued
      one-shot write instead of overwriting all three components. Still one
      write, still no decay state, still `Controlled` — no Impact, no knockdown.
- [x] `packages/shared/src/tuning.ts`: `LAUNCH_HEIGHT_MIN` (1), `LAUNCH_HEIGHT_MAX`
      (20), `LAUNCH_HEIGHT_PRESETS` (3 / 6 / 10, "a measurement, not a decision"),
      and `launchHeightToSpeed(height) = Math.sqrt(2 * Math.abs(GRAVITY_Y) * height)`
      with the derivation in the comment.
- [x] `Segment.launch?: { height: number }` in `Track.ts` — additive/optional in
      the `conveyor`/`motion`/`scale` house style, with the "every Track stored
      before this reads unchanged" note.
- [x] `AssetModuleDef.launch?: { height: number; trigger: Box }` in
      `assetModules.ts` — the Asset's default height and its trigger box. A
      Module with one resolves as a launch pad with no `Segment.launch` present.
- [x] `resolveTrack`: emit a launch pad for every Segment whose Module def
      carries `launch`, at `Segment.launch?.height ?? def.height`, velocity
      `{ x: 0, y: launchHeightToSpeed(h), z: 0 }` in the Module frame (rotated,
      never translated, by the existing code path). Trigger box scales with
      `segmentScale`; the height does not.
- [x] `resolveTrack(...).launchPadOwners: number[]`, index-aligned with
      `launchPads` — same bookkeeping as `staticOwners` / `trimeshOwners`.
- [x] `invalidLaunchReason` in shared (finite, inside MIN..MAX) + the API's
      Track validation (`apps/api/src/tracks/tracks.validation.ts`) rejecting a
      bad `Segment.launch`, beside the Conveyor/Motion validators.
- [x] A Segment with `launch` **and** a Motion resolves its trigger at the rest
      pose (ADR 0061's existing rule) and adds a `resolveTrack` warning naming
      it. Publish does not refuse.

## Tests

- [x] `launchHeightToSpeed` round-trips: a Character launched at height `h` from
      rest apexes within a tick of `h` under `GRAVITY_Y` (the number the author
      typed is the number they get).
- [x] The split rule: a Character running at `WALK_SPEED` onto a vertical pad
      keeps its horizontal speed and gets exactly the pad's vertical; the same
      pad hit while falling gives the *same* apex (the ADR's `bZOverride`
      property).
- [x] A tilted Spring (pitch via ADR 0034) sets vertical and adds sideways.
- [x] `launchPadOwners` matches the Segment each pad came from across a Track
      mixing Springs, procedural `launch-pad` Modules and neither.
- [x] `Segment.launch` overrides the def's default; absent falls back to it.
- [x] Scale: a 2× Spring has a 2× trigger and an unchanged apex.
- [x] Validation: non-finite / out-of-range heights are refused, old Tracks
      without the field still resolve.

# 03 — The builder sets the height, and shows where it throws you

**What to build:** a `LAUNCH` inspector section on Spring Segments — presets and
an exact number — plus the arc the Track author needs to see before playtesting
(ADR 0069).

**Blocked by:** 01, 02.

**Status:** done (2026-09-15).

## What to change

- [x] `apps/track-builder/src/components/LaunchPanel/LaunchPanel.tsx`: its own
      `InspectorSection` (id `launch`, summary `6.0 m` / `—`), rendered only
      when the primary Segment's Module def carries `launch`. Preset row
      (`LOW 3 m` / `MEDIUM 6 m` / `HIGH 10 m`) over a `Stepper` (1–20 m, Shift =
      fine) — the SIZE control's shape. Presets write the same `height`; no
      preset enum reaches the data.
- [x] A "reset to the Asset's default" affordance (the def's height), so
      clearing `Segment.launch` is reachable, not just overwriting it.
- [x] `engine.setSegmentLaunch(height | undefined)` + `stepLaunchHeight` — one
      undoable edit each, full rebuild (the arc redraws), in the
      `setSegmentConveyor` house style.
- [x] `apps/track-builder/src/track/trackEdit.ts`: `setSegmentLaunch`, pure, and
      carried by `duplicateSegment` like `conveyor`/`ice`/`mud`.
- [x] Viewport: draw the resolved launch arc from the Spring — the parabola
      under `GRAVITY_Y` from the trigger's top, apex marked with its height, in
      the Segment's own orientation (a tilted Spring draws a tilted arc). The
      "show exactly what the simulation will do" discipline ADR 0061 set.
- [x] Warn in the builder when a Spring Segment also carries a Motion (its
      trigger stays at the rest pose).

## Tests

- [x] The section only appears for Assets whose def carries `launch`.
- [x] Preset click and stepper commit both land one undoable `height`; undo
      restores the previous value, not the default.
- [x] Out-of-range entry clamps rather than storing an invalid Track.
- [x] The arc's apex height matches `launchHeightToSpeed` under `GRAVITY_Y`
      (pure function test, not a screenshot).

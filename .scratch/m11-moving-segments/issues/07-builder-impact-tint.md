# 07 — Builder: show where a Motion knocks players down

**What to build:** while a Motion plays, each moving surface is tinted by the
Impact a Character would take there at that moment — carries/pushes (green),
Stagger (yellow), Ragdoll (red) — and spiked surfaces are always red.

**Blocked by:** 01, 04 (thresholds must match the real rule), 05.

**Status:** done (2026-09-15) — tests and typecheck; checking it against a real knockdown is the user's.

## What to change

- [x] One shared function mapping a point speed to the outcome, used by the
      simulation's Impact and by the tint, so the two cannot drift
- [x] Shader tint from the body's linear/angular velocity and pivot uniforms
- [x] Toggle in the builder (`impact` in the Motion transport); a live check against a real knockdown is the user's

## Notes

- Shared: `movingSegmentImpactMagnitude`, `impactOutcome`,
  `MOVING_SEGMENT_STAGGER_SPEED`/`_RAGDOLL_SPEED`, `motionTwist` — the simulation
  delivers Impacts through the same magnitude function the tint's bands derive from.
- The tint assumes a Character standing still in the way (closing speed = the
  surface's own velocity along its normal); a Character running into it closes
  faster. Floor faces (normal.y > `SURFACE_GROUND_NORMAL_MIN_Y`) stay green.

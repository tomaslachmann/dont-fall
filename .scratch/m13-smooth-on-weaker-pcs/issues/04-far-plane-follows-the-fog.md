# 04 — The camera's far plane follows the fog

**What to build:** the game camera stops drawing what the fog already hides.
`camera.far` becomes the Environment preset's `fog.far` plus a small margin,
instead of a fixed 300 m.

**Decided (user, 2026-09-17):** yes ("Far plane = mlha").

**Blocked by:** —

**Status:** done on tests (2026-09-17). The horizon on all three presets is the user's visual check.

## How it behaves after

- On `day` / `sunset` nothing past ~160 m is drawn, on `night` nothing past
  ~180 m. It was solid fog colour before, so the picture should look the same.
- Track pieces beyond that are skipped by three.js's own frustum test. The
  cutoff centres on the camera, so it works for the Spectator free cam too.
- The sky dome and the cloud floor still reach the horizon. The dome's depth
  already sits at the far plane (`z = w`, ADR 0074) and must keep rendering.
  The cloud floor's far edge must still melt into the sky.

## What to change

- [x] `createStage` (`apps/client/src/render/scene.ts`) sets `camera.far` from
      the preset and updates the projection. A named margin constant.
- [x] Check every camera-far consumer: the sky dome (at the far plane by
      construction), the cloud floor (a 500 m plane), the cloud puffs' wrap
      radius, stars at `night`. Anything larger than the far plane must be
      clipped harmlessly or scaled to fit.
- [x] Tests: the camera's far follows each preset, and the dome still renders
      inside it (whatever the existing Environment tests can pin)
- [ ] Visual check of the horizon on all three presets (the user's)

## Notes

- Research: "Findings §1 → The far plane is the free distance cutoff",
  recommendation #3.
- The builder is out of scope: its preview runs without fog (ADR 0074), so
  its far plane must stay as it is.
- The gain is measured by 07 (`renderer.info` triangles in view).

## As built

- **The far plane.** `packages/render` `fogFarPlane(preset)` returns `fog.far` plus
  `FOG_FAR_PLANE_MARGIN` (20): 180 for `day`/`sunset`, 200 for `night`. `createStage` builds its
  camera with it, where it used to be 300.
- **What reads the far plane:**
  - The sky dome and the stars sit at the far plane by construction (`xyww`), whatever its value.
  - The cloud puffs past the fog are pure fog colour on a horizon-coloured sky; clipping them
    should not show.
  - The cloud floor (a 250 m plane) is the one piece whose clipped edge would show against the
    dome. `createEnvironment` therefore takes `farPlane`, and
    `cloudFloorFade(farPlane)` switches the floor to a fade measured from the camera
    (`FADE_FROM_CAMERA`). It is all sky 5 m before the far plane, however high the camera is:
    105 → 175 m on `day`. Without a far plane (the builder's preview) the floor fades across the
    plane as before, 150 → 250 m.
- **Visible change to check:** in the game, the floor now starts melting into the sky at ~105 m
  (was ~150 m horizontally), where the fog already hides most of it.
- **Tests:**
  - `farPlane.test.ts`: every preset, and the floor always clipped and faded;
  - `cloudFloor.test.ts`: the fade, the uniforms and the define reaching the shader;
  - `createEnvironment.test.ts`: `farPlane` reaches the floor.

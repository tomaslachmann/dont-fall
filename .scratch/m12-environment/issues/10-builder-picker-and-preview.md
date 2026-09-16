# 10 — Builder: Environment picker and preview toggle

**What to build:** the Track author picks the Environment beside the Time Limit
and can switch the viewport into a preview of it.

**Blocked by:** 03, 09

**Status:** done (2026-09-16) — tests and typecheck; the preview has never been drawn (no WebGL here). Visual check — the user's.

## What to change

- [x] A preset picker next to the Time Limit field; saved on the Draft, written
      on publish and on playtest
- [x] A "preview Environment" toggle in the viewport: off by default (the
      lavender canvas and grid stay the authoring view, ADR 0063); on, it
      calls `createEnvironment` with `fog: false`
- [x] Toggling off disposes it and restores the authoring background and lights
- [x] The picker updates a live preview without a reload
- [x] Thumbnails stay neutral
- [ ] Visual check — the user's

## Notes

- ADR 0074. The playtest boots the real client, so it shows the real fog.
- Shadows in the preview: see 07.

## As built

- **Engine** (`engine.ts`) holds the Draft's `environment` (default `day`) and `environmentPreview`
  (default off), with `setEnvironment` and `setEnvironmentPreview`. They live in the engine, not in
  the toolbar's local text fields, because the viewport's preview follows a pick live. Save and
  playtest send the pick (`api.ts`: `saveTrack(…, defaults, environment)` and
  `publishPlaytestTrack(…, defaults, environment)`, as their own argument since it is not a Round
  default). Load reads it through `resolveEnvironmentId`. An unknown preset loads under `day`, and
  the status says so (`loaded "id" (…) — unknown environment "aurora", drawing "day"`), separately
  from the retired-Module warning. A remounted viewport picks the preview back up.
- **UI:** `ENVIRONMENT` + a `DAY / SUNSET / NIGHT` pill `SegmentedControl` beside `LIMIT` and
  `SURVIVORS` in the toolbar. An `ENVIRONMENT` check-toggle in the viewport's Transport row, next to
  `IMPACT` (the other view toggle), with `aria-pressed` and a title. At medium width its label hides
  like IMPACT's.
- **Viewport** (`scene/viewport.ts`): `setEnvironment(preset | null)`. On, it hides the lavender
  background, ambient light, directional light and grid, and calls the game's own
  `createEnvironment` with `fog: false`, `detail: "full"` and **`shadows: false`** (the 07 decision:
  the 70-unit shadow box would end mid-Track in an orbit view framing a whole Track; the playtest
  shows the real ones). Off, it disposes it and restores all four. `render()` calls
  `update(camera, now, orbitControls.target)`, and `dispose()` frees it.
- **Cloud floor in the preview:** `scene/environmentPreview.ts`: `lowestSegmentY(groups, track)` is
  the same bound the Stage uses. Still groups use `lowestDrawnY`. Moving ones use `lowestMovingY` on
  their Motion node's `localBounds`, scaled by the Segment's scale, since the builder puts scale on
  the outer group and Motion on the inner node. `setTrack` and `retransformSegments` rebuild the
  Environment only when that moves the clamped floor. To share this, `packages/render` now exports
  `localBounds`, and `lowestMovingY` takes bounds instead of an object.
- Thumbnails are untouched: their renderer and scenes never see an Environment.
- Tests: engine (default, preview on and live follow and off, no canvas call while not previewing,
  remount, save and playtest bodies, load, unknown preset), the real screen (pick through the tab,
  toggle through the button), `lowestSegmentY` (empty, still, a scaled Slide at any clock), and the
  API client bodies.
- **Follow-up (user, 2026-09-16):** the toggle was hard to find: a check-box pill identical to IMPACT,
  whose label folded away on a narrow viewport. Asked where it should live, the user kept it in the
  viewport. It is now its own button: `☀ ENVIRONMENT OFF` in raised plastic, `☀ ENVIRONMENT ON` in
  brand purple, with a label that never hides and a title naming the picked preset.

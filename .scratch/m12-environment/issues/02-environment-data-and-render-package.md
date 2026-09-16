# 02 — Environment data and the `packages/render` package

**What to build:** the Environment as data in `packages/shared`, and a new
`@dont-fall/render` workspace package with the `createEnvironment` seam (empty
of visuals yet) that the client and the builder can import.

**Blocked by:** —

**Status:** done (2026-09-16) — tests and typecheck.

## What to change

- [x] `packages/shared/src/track/Environment.ts`: `ENVIRONMENT_IDS`
      (`day`, `sunset`, `night`), `EnvironmentId`, `DEFAULT_ENVIRONMENT_ID = "day"`,
      `EnvironmentPreset`, `ENVIRONMENT_PRESETS` (only `day` filled in for real;
      the other two may copy it until 11), `invalidEnvironmentReason`,
      `resolveEnvironmentId(unknown) → EnvironmentId` (fallback + warning flag)
- [x] Pure helpers with tests: `sunDirection(preset)`,
      `cloudFloorY(preset, killPlaneY, lowestSegmentY)`, `wrapAround(...)`
- [x] `packages/render`: `package.json` (`three` as a peer dependency, like
      `packages/ui` does with React), `tsconfig`, vitest, wired into the
      workspace and into `apps/client` / `apps/track-builder` dependencies
- [x] `createEnvironment(scene, renderer, preset, options) → { update, dispose }`
      skeleton: one root `Group`, idempotent `dispose`
- [x] `apps/server` and `apps/api` never import `@dont-fall/render` (a test or
      lint rule that fails if they do)
- [x] `CLAUDE.md` "Repo structure" lists `packages/render/` and its mandate

## Notes

- ADR 0074 (amends ADR 0007's layout). Shape: research §7.
- Hex colours are sRGB as authored; renderers wrap them in `THREE.Color`.
- Fog colour is always `sky.horizon`; the hemisphere ground colour is always the
  cloud floor's shade — no second field to drift.

## As built

- `ENVIRONMENT_PRESETS.day` is a starting palette (research §7's description, today's light
  direction and intensities); the palette call stays the user's, in 03. `sunset` and `night` point
  at `day` until 11.
- The preset follows research §7 without `backdrop` (ADR 0074: not in the first pass). The sun disc
  is `discRadiusDeg`, an angular radius, instead of the sketch's shader-space `size`. Azimuth is
  measured from +Z toward +X, the turn `yawQuat` makes. Winds are `{ x, z }` in units per second.
  Puff `bands` are heights relative to the cloud floor, so they follow the kill height with it; 06
  may reshape `puffs` once the cloud style is settled.
- `sunLightDirection(preset)` sits beside `sunDirection`: same azimuth, `lightElevationDeg` when set.
- `cloudFloorY` clamps to `CLOUD_FLOOR_MIN_CLEARANCE` (0.5) under the lowest drawn geometry;
  `lowestSegmentY` is `Infinity` for an empty Track.
- `resolveEnvironmentId` returns `{ id, warning }`: an unknown id falls back to `day` with a warning
  string for the caller's `console.warn`; a missing field falls back silently.
- `wrapAround(value, center, tileSize)` is per axis, half-open.
- The boundary test (`packages/render/src/boundary.test.ts`) checks `apps/server`, `apps/api` and
  `packages/shared`, both their `package.json` and every source import, for `three` and
  `@dont-fall/render`. The source scan is what matters: the root `package.json` lists `three`, so a
  bare import from the server would still resolve.
- ADR 0007 carries an "Amended by ADR 0074" section.

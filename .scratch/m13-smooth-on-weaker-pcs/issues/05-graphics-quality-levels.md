# 05 — Graphics quality levels in Settings → VIDEO

**What to build:** the player picks a graphics quality level (`high`,
`medium`, `low`) in the Settings screen's VIDEO pane. The game draws with it
from the next time it builds a Stage. **ADR 0079.**

**Decided (user, 2026-09-17):** the player picks it and nothing switches it
automatically ("Jen volba v nastavení"). The lowest level may turn shadows off.

**Blocked by:** — (the tuning of the numbers uses 03's baseline)

**Status:** done on tests (2026-09-17). The look of `medium` and `low` is the user's visual check; their numbers are starting points to retune against 07's runs.

## How it behaves after

- Settings → VIDEO shows one row, "Graphics quality", with three options,
  `high` selected by default. It replaces the pane's placeholder with the same
  row vocabulary as AUDIO.
- The choice is stored per device (`dontfall.graphics.v1` in `localStorage`)
  and read when the game builds its Stage.
- The levels (ADR 0079 table):

  | Level | Pixel ratio | Composer MSAA | Shadows | Cloud puffs |
  |---|---|---|---|---|
  | `high` | ≤ 2 | 4 | 2048², PCFSoft | full |
  | `medium` | ≤ 1.5 | 2 | 1024², PCF | full |
  | `low` | 1 | 0 | off | none |

  At `high` the game looks exactly as it does today.
- The simulation, the Snapshot and the server never see the level.

## What to change

- [x] A level table as named constants in the client, plus a pure reader of
      the stored value (unknown or corrupt → `high`, never throws), shaped like
      `bindingsStore.ts`
- [x] `createStage` takes the level: `renderer.setPixelRatio`, and
      `createSceneComposer(renderer, samples)` instead of the
      `COMPOSER_SAMPLES` constant
- [x] `createEnvironment`'s `shadows` option carries off, or a map size and a
      filter type (ADR 0079). The builder passes its current preview settings.
      `castSunShadow` takes the size.
- [x] `low`: no shadow map at all (`shadowMap.enabled = false`), and casters
      and receivers cost nothing extra
- [x] Confirm whether `WebGLRenderer({ antialias: true })` is redundant now
      that the frame renders into the composer's own target
      (`speedLines.ts` says so). If it is, drop it at every level.
- [x] The VIDEO pane in `Settings.tsx`, with a test. RESET returns it to `high`.
- [x] Tests pin each level's renderer, composer and shadow settings
- [ ] Visual check of `medium` and `low` (the user's)

## Notes

- Research: "Findings §1 → Resolution is the biggest GPU dial", "Shadow cost",
  recommendation #4.
- The numbers in the table are starting points. Retune `medium` against 03's
  and 07's measurements.
- Applying a change to a running Round is not required (ADR 0079). If it turns
  out cheap, it goes through the game handle the same way bindings do.
- Open: should the default stay `high` (ADR 0079 as written) or be `medium`?
  The user's call.

## As built

- **The level table.** `apps/client/src/lib/graphicsQuality.ts` holds the levels, the default,
  `GRAPHICS_QUALITY_SETTINGS`, and `readGraphicsQuality`/`writeGraphicsQuality` over
  `dontfall.graphics.v1` (unknown or unreadable reads as `high`, never throws).
  - It is three-free, so the Settings screen (menu bundle) reads it without pulling in the renderer.
  - The shadow filter is `"soft"`/`"pcf"`; `createStage` maps it to the three.js constants.
  - The default stays `high`, as ADR 0079 says (the question of `medium` instead is still open to
    the user).
- **The Stage.** `createStage({ graphics })`, default `high`:
  - `renderer.setPixelRatio(min(dpr, maxPixelRatio))`;
  - `createSpeedLines(…, composerSamples)` → `createSceneComposer(renderer, samples)`;
  - `createEnvironment` with `detail: cloudPuffs ? "full" : "low"` and the shadows below.
- **`antialias` on the canvas: dropped** (`antialias: false`) at every level. The scene renders into
  the composer's own targets, and the canvas only receives `OutputPass`'s full-screen copy, so
  canvas MSAA only cost memory and a resolve. `speedLines.ts`'s own doc already said so.
- **`packages/render`:**
  - `createEnvironment`'s `shadows` is `boolean | SunShadowSettings` (`{ mapSize, type }`), where
    `true` is `DEFAULT_SUN_SHADOW` (2048², PCFSoft). The builder and the fan prototype keep
    passing booleans.
  - `castSunShadow(sun, mapSize)`, and the texel snap uses `shadowTexelSize(mapSize)`.
  - Dispose restores the renderer only if the type is still the one it set.
  - At `low` the renderer's shadow map stays disabled; the casters' flags are harmless.
- **The flow.** `<GameCanvas>` reads the stored level once per mount and passes
  `GameConfig.graphicsQuality`. Match boot, the live Track swap and practice build their Stages
  with it, so a change applies from the next game entry. Nothing re-applies it live.
- **The Settings screen.** The VIDEO pane has one row, GRAPHICS QUALITY, with a
  HIGH/MEDIUM/LOW `Toggle`. The level is stored the moment it is picked, a sub-line says what the
  level trades and that it applies next game, and RESET returns it to `high`.
- **Tests:**
  - `lib/graphicsQuality.test.ts`: `high` is M12's values, each step is cheaper, only `low` drops
    shadows, and storage;
  - `render/speedLines.test.ts`: the sample count;
  - `packages/render` `createEnvironment.test.ts`: a level's map size, filter and texel snap;
  - `screens/SettingsVideo.test.tsx`: the pane, storing, a stored level, RESET.

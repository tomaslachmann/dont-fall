# 0079 — Graphics quality is a player setting, and its lowest level turns shadows off

## Context

ADR 0074 gave every Round real shadow maps (the user's explicit call, overruling
a blob shadow), a multisampled composer target, and pixel ratio up to 2. Its
Consequences left "a low-end path, if one is needed" for later.

`docs/research/gameplay-performance-culling-and-asset-loading.md` (2026-09-16)
names the GPU dials that matter most on a weaker PC: pixel ratio (2 is 4× the
pixels of 1), the composer's 4× MSAA half-float targets (two of them), and the
shadow pass (a 2048² `PCFSoftShadowMap`, re-rendered every frame because the
box follows the Character and 32 Segments move). It recommended quality levels
plus an adaptive rule that steps down after sustained slow frames, and asked
the user (open questions 2 and 6).

Settled with the user (2026-09-17), answering those questions:

- **"Jen volba v nastavení"** — the player picks the level; no automatic
  downgrade.
- The lowest level may turn shadows off (the option chosen said so explicitly,
  against "Auto, stíny nikdy vypnout").

## Decision

**Graphics quality is a named level the player picks in Settings → VIDEO. The
game never changes it on its own. The lowest level draws no shadows.**

### The levels

Three levels. The numbers are starting points, tuned against the measured
before/after numbers of M13, and live as named constants in the client:

| Level | Pixel ratio | Composer MSAA | Shadows | Cloud puffs |
|---|---|---|---|---|
| `high` | `min(devicePixelRatio, 2)` | 4 | 2048², `PCFSoftShadowMap` | full |
| `medium` | `min(devicePixelRatio, 1.5)` | 2 | 1024², `PCFShadowMap` | full |
| `low` | 1 | 0 | off | `detail: "low"` (none) |

- **`high` is today's look and the default.** The M12 look was tuned with the
  user and nothing chooses a lower level for them; a player on a weak machine
  lowers it once.
- A level changes how the frame is drawn, never what the simulation does:
  render-only, like the Environment (ADR 0074). Nothing about it reaches
  `packages/shared`'s step, the Snapshot or the server.
- The Environment still owns the sun's shadow (ADR 0074): `createEnvironment`
  takes the shadow settings (off, or a map size and filter) instead of a
  boolean, and the level supplies them. The Track builder keeps its own preview
  settings (shadows off there).

### Where the choice lives

- **Per device, in `localStorage`** (`dontfall.graphics.v1`), not on the
  Account. Unlike key bindings (M9, synced to the Account), the right level is
  a property of the machine: the same player on a desktop and a laptop wants
  two answers. An unreadable or unknown stored value reads as the default.
- The game reads it when it builds the Stage. Changing it in Settings applies
  from the next game entry; applying it to a running Round is not required.

## Considered options

- **Adaptive downgrade (the research's recommendation), alone or with a
  manual override** — rejected by the user. It changes the look under the
  player without asking, and its thresholds are one more thing to tune.
- **Shadows never off, only smaller** — rejected by the user: on the weakest
  GPUs the shadow pass is one of the few big savings left.
- **Stored on the Account** — rejected: a level that fits one machine is wrong
  on another.
- **Auto-detecting the GPU for the default** — not chosen; renderer strings are
  unreliable and it is the same "the game decides" the user declined.

## Consequences

- Amends ADR 0074's Shadows section: real shadows are the default, not
  unconditional. The shadow tuning constants in `packages/render` become the
  `high` level's values.
- A player with a weak PC who never opens Settings keeps today's cost; the
  VIDEO pane has to be findable.
- `createEnvironment`'s `shadows` option changes shape, and `createStage`,
  `createSceneComposer` and the renderer's pixel ratio take their values from
  the level instead of constants.
- The composer's sample count and the shadow map size become runtime values,
  so tests pin each level's settings, not one constant.

## Amended 2026-09-17: as built (M13 ticket 05)

- The canvas itself is no longer antialiased (`antialias: false`) at any level. Every Round renders
  into the composer's multisampled targets, and the canvas only receives their full-screen copy, so
  canvas multisampling cost memory for nothing. Antialiasing is the composer's sample count alone,
  so `low` has none.
- `createEnvironment`'s shadow option is `boolean | { mapSize, type }`. `true` stays the `high`
  map, so the builder's preview passes a boolean as before.

# 09 — Environment ambience per preset

**What to build:** every Environment (ADR 0074) has its own ambience, on the
environment bus. **ADR 0087.**

**Blocked by:** 02, 01 (the Freesound recordings)

**Status:** done on tests (2026-09-17). Hearing it, and the layer levels, is the user's check.

## How it behaves after

- `day`: `wind_day_loop` + `birds_loop`. `sunset`: `wind_day_loop` softer + `birds_loop` sparse
  (lower gain). `night`: `wind_night_loop` + `crickets_loop`.
- Unpanned loops, crossfaded in when the Stage starts and out when it is
  disposed.
- Wind swells with how far the camera is above the cloud floor, since the void
  below is the one thing always in view.
- A layer that failed to load leaves the rest playing.

## What to change

- [x] The preset → layers table (client), keyed by `EnvironmentId`, with a test
      that every id has an entry
- [x] Loops with a slow crossfade, long enough to hide their loop point
- [x] Wind gain as a pure function of camera height over the cloud floor
- [x] Tests: the table, the crossfade on start and dispose, the wind curve

## Notes

- Research §9. The recordings come from Freesound CC0 (01).

## As built

- **`audio/ambience.ts`:**
  - **`AMBIENCE`**, keyed by `EnvironmentId`:
    - day: wind 0.8, birds 0.6;
    - sunset: wind 0.55, birds 0.3;
    - night: night wind 0.8, crickets 0.7.
    - Each preset has exactly one wind layer.
  - **`windSwell(height)`** goes from 0.55 at the cloud floor to 1 at 40 u above it (smoothstep).
  - **`environmentIdOf(preset)`** finds the id by identity, because the Stage is handed the preset
    object. An unlisted preset has no ambience.
  - **`Ambience`** holds unpanned loops that fade in with a 1.2 s time constant
    (`AMBIENCE_FADE_SECONDS`, a few seconds to full). `update(cameraY)` sets the wind layer to
    base × swell. A layer whose file failed stays silent in the engine, and the rest play.
- **Engine:**
  - `loop(slot, options, fadeSeconds)` gives a loop its own fade time constant.
  - **`dispose()` now fades out:** the master ramps to 0 and every source stops at +0.4 s
    (`DISPOSE_FADE_SECONDS`). The graph is released after that (`defer`, `onReleased`). Nothing
    new plays from the call on.
    - The Stage hands `onReleased` the listener's own gain disconnect, which used to happen at once.
    - The effect: a Track swap crossfades the old Stage's ambience into the new one's.
    - This changes 02's "dispose stops everything", which is now "fades, then stops".
- **Stage:** builds `Ambience` from `environmentIdOf(environment)` and `cloudFloorY(...)`, the same
  floor the Environment draws, and updates it in `render()` before `sound.update()`.
- **Per-Track decoding:** `stageSoundSlots` takes the Revision's `environment`, and boot, practice
  and the Track swap pass it.
- **Tests:** `ambience.test.ts` (the table, the curve, the layers, and on a real engine the fade-in,
  a failed layer and the fade-out) and the engine's slow fades and fading dispose.

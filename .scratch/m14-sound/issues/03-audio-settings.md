# 03 — Settings → AUDIO: master, effects, environment, music, per device, live

**What to build:** the AUDIO pane's sliders set the engine's bus volumes. The
pane is stored per device and applied live to a running game. **ADR 0087.**

**Decided (user, 2026-09-17):** wire it up and adjust it ("Zapojit a upravit"):
MASTER, EFFECTS, ENVIRONMENT, MUSIC. The switches with no system behind them are
hidden.

**Blocked by:** 02

**Status:** done on tests (2026-09-17). Hearing the sliders act in a game is the user's check.

## How it behaves after

- Settings → AUDIO shows four sliders: MASTER, EFFECTS (was IMPACTS & GRABS),
  ENVIRONMENT (new) and MUSIC.
- VOICE CHAT and CROWD REACTIONS are gone. SCREEN SHAKE stays as it is (not
  sound).
- Values are stored per device (`dontfall.audio.v1` in `localStorage`), read
  like graphics quality: unknown or corrupt reads as the defaults and never
  throws.
- Moving a slider while a game is running changes what you hear at once. The change goes
  through the store's change event, not the game handle (see As built).
- RESET returns the pane to the defaults. At 0, a bus is silent and its loops
  stop creating voices.

## What to change

- [x] `lib/audioSettings.ts`: defaults, reader and writer, shaped like
      `graphicsQuality.ts`
- [x] `Settings.tsx` AUDIO pane: four sliders, stored on change, the dead
      switches removed
- [x] Live changes to the engine's buses, done with a store subscription instead of
      `GameConfig`/`GameHandle` (see As built)
- [x] Tests: storage, the pane (render, change, RESET), a live change reaching a
      bus gain

## Notes

- Slider values are perceptual (0–100). The gain curve is a squared ramp, so
  half-way sounds about half as loud.
- Defaults: the pane's current MASTER 78, MUSIC 42, and EFFECTS taking IMPACTS'
  92. ENVIRONMENT starts at 70, to be tuned by ear (the user's).

## As built

- **Live without the game handle.** `/settings` is its own route, so today it can't be open while a
  game runs. Changes therefore travel through the store, not `GameHandle`:
  - `writeAudioVolumes` dispatches `dontfall:audio-volumes` on the window;
  - another tab's write arrives as a `storage` event;
  - a running game subscribes with `subscribeAudioVolumes`.
  The same path serves a future in-game settings sheet and the Lobby's music (ticket 11), with
  nothing added to `GameConfig`.
- **`lib/audioSettings.ts`** (three-free, engine-free):
  - `AUDIO_CHANNELS` (master, effects, environment, music) and `DEFAULT_AUDIO_VOLUMES`
    (78, 92, 70, 42);
  - `readAudioVolumes`/`writeAudioVolumes` over `dontfall.audio.v1`: per-channel fallback,
    0–100 clamp, never throws;
  - `subscribeAudioVolumes`;
  - `volumeGain` (squared) and `applyAudioVolumes(engine, volumes)`.
- **The pane** (`Settings.tsx`): four sliders (MASTER brand, EFFECTS accent, ENVIRONMENT go,
  MUSIC danger), stored on every change. VOICE CHAT and CROWD REACTIONS are removed.
  SCREEN SHAKE stays as it was (still a mock). RESET stores the defaults.
- **The game** (match and practice): applies the stored volumes to `stage.sound` right after
  building the Stage, subscribes for the game's lifetime (unsubscribed on teardown), and
  re-applies after a live Track swap.
- **Tests:** `lib/audioSettings.test.ts` (defaults, round trip, fallback and clamp, same-page and
  cross-tab notification, unsubscribe, gain curve, apply) and `screens/SettingsAudio.test.tsx`
  (four sliders at defaults, dead switches gone, a move stores and notifies, a stored value
  shows, RESET).

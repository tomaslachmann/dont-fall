# 02 — The audio engine: one context, buses, loading, one-shots, panning, voice budget

**What to build:** the client's sound engine, proven end to end by one sound:
your own Character's landing. **ADR 0087.**

**Blocked by:** 01 (at least the landing's files)

**Status:** done on tests (2026-09-17). Hearing a landing in the game is the user's check.

## How it behaves after

- Entering a Match or practice, the Stage builds an `AudioListener` on its
  camera and an engine on three.js's shared `AudioContext`, with gain buses
  `master → effects, environment, music, ui`.
- The context resumes on the first user gesture (a Lobby button, or the click
  that locks the pointer). Before that nothing plays, and nothing queues up to
  burst out later.
- The Track's slots are fetched and decoded while the Stage is built (next to
  `Stage.warmUp`). A missing or undecodable file logs one warning and that slot
  stays silent. The game never fails to boot over a sound.
- Landing plays `character/land_*`: a random variant with a small pitch jitter,
  on the effects bus.
- `engine.play(slot, { at?, gain?, rate?, priority? })`:
  - without `at` it is not panned (your own Character);
  - with `at` it goes through a `PannerNode` with `equalpower` and `linear`
    distance, using the slot's `refDistance`/`maxDistance`.
- **The voice budget:**
  - a play whose estimated gain (distance model × slot gain × bus) is under a
    threshold creates nothing;
  - at most N one-shots at once, where a new play evicts the quietest
    lower-priority one or is dropped;
  - `engine.loop(slot, emitterId)` gives back a handle whose gain and rate follow
    each frame, and only the nearest *k* loops of a slot play.
- Disposing the Stage stops every source and disconnects the graph. The context
  stays, since three.js shares it.

## What to change

- [x] `apps/client/src/audio/`:
      - `slots.ts` (typed table: files, bus, priority, gain, distances);
      - `engine.ts` (graph, play, loop, budget);
      - `loadSounds.ts` (fetch and decode the slots a Track needs).
- [x] The Stage owns the listener, the engine's lifetime and loading. Nothing
      three.js-specific leaks into `audio/` beyond the listener handed in.
- [x] Resume on gesture, through the same listeners the pointer lock already uses
- [x] The landing detector, keyed by Character id, reading the same rule as
      `JumpSequences.land` (not under `LANDING_MIN_AIRBORNE_MS`), loudness scaled
      by fall speed
- [x] Tests against a fake `AudioContext`:
      - the budget (threshold, cap, eviction by priority, nearest-k loops);
      - variants and jitter within bounds;
      - equal-power and linear set on every panner;
      - a failed decode stays silent;
      - dispose stops everything.

## Notes

- Research §3 (three.js hard-codes HRTF on `PositionalAudio`), §4 (autoplay),
  §5 (decode ahead), §6 (the budget).
- The budget's numbers (threshold, N, k) are starting values. Ticket 13 tunes
  them with 12 Characters.
- The music bus is built here but fed in 11. The ui bus is fed in 12.

## As built

- **`apps/client/src/audio/`:**
  - `slots.ts`: `SOUND_SLOTS`, every slot of the library, with bus, gain, priority,
    `refDistance`/`maxDistance`, `pitchJitter` and `maxLoops` for loops. It also holds
    `STAGE_SOUND_SLOTS`, what a Stage decodes (today the landings; it grows ticket by ticket).
  - `soundBank.ts`: `loadSoundBank(context, slots)` fetches `/sounds/<file>` and decodes it.
    One decode per file per context (a live Track swap reuses it). A failed file warns once and
    stays silent, and loading never rejects.
  - `engine.ts`: `createSoundEngine({ context, destination, bank, listenerPosition })`.
    - `play(slot, { at, gain, rate })`, and `loop(slot, …)` returning `{ set, stop }`.
    - `update()` once a frame re-chooses the nearest `maxLoops`.
    - *Since ticket 09:* `dispose()` fades everything out over 0.4 s before releasing the graph,
      so a Track swap crossfades. Ticket 05 added `start()`, and ticket 06 a per-play `priority`.
    - `setVolume(bus | "master", gain)`, `stats()`, `dispose()`.
    - Budget: `MIN_AUDIBLE_GAIN` 0.02, `MAX_ONESHOT_VOICES` 24, eviction by (priority,
      estimated gain). Loops fade with `LOOP_FADE_SECONDS` 0.12.
    - Panners are `equalpower` + `linear`, rolloff 1. Nothing plays, or queues, while the
      context isn't running.
  - `landings.ts`: `Landings` (per id, the `LANDING_MIN_AIRBORNE_MS` rule, peak fall speed)
    and `landingSound` (heavy from 14 u/s; gain 0.35–1 by fall speed).
  - `unlock.ts`: `resumeOnFirstGesture(context, window)` (pointerdown/keydown/click, capture,
    keeps listening if refused).
  - `gameAudio.ts`: three.js's shared context, or `null` without Web Audio.
  - `fakeAudio.ts`: the test stand-in.
- **Stage** (`render/scene.ts`): `sounds?: SoundBank` in `StageConfig`. With it, an
  `AudioListener` rides the camera, and `stage.sound` is the engine (`update` in `render()`,
  disposed with the Stage). Without it, no audio graph at all. The local landing plays in
  `updateCharacterAnimation`; going down forgets the air time.
- **Boot** (match and practice): the bank decodes in the same `Promise.all` as physics and the
  model. The resume-on-gesture listener is registered on teardown. The live Track swap passes
  the same bank.
- **Tests:** `engine.test.ts` (graph, panning, audibility, suspended, failed load, jitter, cap
  and eviction, release, nearest-k loops, fades, dispose, volumes), `soundBank.test.ts`,
  `landings.test.ts`, `unlock.test.ts`, `slots.test.ts` (every slot's files ship and are
  credited).

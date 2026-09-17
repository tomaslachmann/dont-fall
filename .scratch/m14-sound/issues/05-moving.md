# 05 — Moving: jump, land, Dash, Sliding, Spring, Fall and Respawn

**What to build:** the sounds of getting around, for every Character.
**ADR 0087.**

**Blocked by:** 02 (the landing already exists there)

**Status:** done on tests (2026-09-17). Hearing it in a game is the user's check.

## How it behaves after

- **Jump:** a push-off when a jump sequence starts from a takeoff
  (`TAKEOFF_MIN_SPEED`). Walking off a ledge makes no sound.
- **Land:** already in 02, now with a heavy variant above a fall-speed threshold.
- **Dash:** a woosh when a burst starts, loudness and pitch following
  `dashSpeed`.
- **Sliding:** a scrape loop while `motionState` is `Sliding`, gain following
  speed, faded out on leaving.
- **Spring:** a boing when `launchPadEpoch` rises, at the pad.
- **Fall:** a falling whistle once a Character drops below the Track on its way
  to the kill plane (local only; a remote falling is seen, not heard).
- **Respawn:** a pop when `respawnCount` rises, at the Respawn point.
- **Bounce:** a thump on a bounce Surface's landing (from `BouncePresses`).

## What to change

- [x] Edge detectors per Character id, pure and tested: epoch rises, state
      entered/left, takeoff, landing (shared with 02)
- [x] Wire local (predicted) and remote (interpolated) Characters through the same
      detectors
- [x] Sliding and Dash as loop or one-shot handles on the engine
- [x] Tests: each trigger fires once per event, never on a reconciliation
      replay (reuse the epoch "last applied" idiom), never for an eliminated
      Character

## Notes

- Research §7.
- A reconciliation snap must not replay sounds. Detectors read the drawn
  Character, once a frame, never the replayed ticks.

## As built

- **`audio/riseLatch.ts`: `RiseLatch`**, the "last applied" idiom for a counter read once a frame.
  - It fires when the value passes the highest applied one. The first sight of an id is history.
  - A lower value is a fresh simulation (the next Round restarts every counter at 0). It is adopted
    silently.
  - An optional refractory window. **Found here:** `launchPadEpoch` and `respawnCount` are not in
    `ReconcileBase`, so a replay across the tick that raised them raises them *again*. "Last
    applied" alone would boing or pop twice. A second rise inside the window is adopted without a
    sound (`SPRING_REFIRE_MIN_MS` 400, `RESPAWN_REFIRE_MIN_MS` 500).
  - Ticket 06 reuses it for its Epochs.
- **`audio/movementCues.ts`: `MovementCues`**, per id, pure. Each frame gives takeoff, landing,
  `dashStarted`, `launched`, `respawned` and `falling`.
  - **Takeoff:**
    - the first airborne frame after a grounded one, at `TAKEOFF_MIN_SPEED` or faster;
    - or a coyote jump: a `RELAUNCH_KICK` rise within `COYOTE_MS` + a tick of leaving the ground;
    - never within 150 ms of a Spring firing (`LAUNCH_TAKEOFF_WINDOW_MS`).
    - It carries where the Character last stood.
  - **Landing:** 02's `Landings`, now owned here. A Respawn forgets the air time, so the fall
    before it is never the landing.
  - **Dash:** `dashing` turning on, at most once per `DASH_RESTART_MIN_MS` (0.8 × the cooldown).
    A replay that drops a burst for a frame stays silent.
  - **Fall:** capsule centre under `fallWhistleY(lowestSegmentY, killPlaneY)` (under the Track,
    never later than 3 u above the kill plane) while falling. It fires once, and re-arms on
    standing or a Respawn.
  - A knocked-down Character neither takes off, lands nor dashes. It can still fire a Spring,
    Respawn and fall.
- **`audio/characterSounds.ts`: `CharacterSounds`** (built as `MovementSounds`, renamed in 06 when
  fighting joined it) turns cues into sound.
  - **Placement:** your own sounds are unpanned. Anyone else's play at their position, ×
    `OTHER_PLAYER_GAIN` (0.7, now shared with footsteps, in `slots.ts`).
  - **Jump and landing:** a jump and a landing on a bounce deck are silent, because the deck's
    thump is their sound. Bounce decks always throw you (`minSpeed` 6), so a takeoff from one is
    the bounce.
  - **Spring:** the boing plays at the Spring (`springFiredBy`) for others. The fall whistle is
    local only.
  - **Dash:** `engine.start` plays a woosh at `dashLevel(dashSpeed)`: gain 0.4 → 1 and rate 0.85 →
    1.15 over the nitro build-up. It follows the build-up while `dashing`, then plays out on its own.
    Only a knockdown cuts it.
  - **Sliding:** an `engine.loop` scrape at `slideLevel(speed)` (gain 0.25 → 1 by 12 u/s, rate
    0.9 → 1.1). It stops (fades) on leaving `Sliding`.
  - **Bounce deck:** a thump for each `BouncePresses` landing on a bounce deck (gain by fall speed,
    as a landing).
  - **Silence:** an eliminated Character, or one that left, is silenced: loops stopped, cue state
    forgotten.
- **Engine:** `start(slot, options)` returns a `VoiceHandle` (`set`, `stop`). It is a one-shot
  under the same budget whose level, rate and place follow `set` (`VOICE_FOLLOW_SECONDS` 0.03).
  It keeps the jitter it started with.
- **`RenderCharacter`** now carries `dashSpeed`, `respawnCount` and `eliminated`, straight from
  `next`. They were already on the Snapshot, so this is no protocol change.
- **`BouncePresses.landings()`**: who stopped falling this frame, where, and how fast.
- **Stage:**
  - `applyCharacterSounds(characters, localId, nowMs)` (named `applyMovementSounds` until 06) is
    called after `applyBounceSheets` in the match loop and in practice.
  - The local landing moved out of `updateCharacterAnimation` into it.
  - The match loop feeds your own Character from its prediction while down. The server's copy drawn
    then lags counters the prediction already raised, so switching would repeat a sound.
- `STAGE_SOUND_SLOTS` adds jump, dash, slide, spring, fall and respawn.
- **Bounce thump overlap:** 08 also listed "a rubbery thump on a press". It is built here, because
  it is 05's "Bounce" line. 08 keeps the hums.
- **A Respawn's own drop:** a Respawn stands the Character a little above its Checkpoint. Its
  short drop lands like any other (quietly), after the pop.
- **Tests:** `riseLatch.test.ts`, `movementCues.test.ts`, `characterSounds.test.ts`, the engine's
  started one-shots, `BouncePresses` landings, and `interpolate.test.ts` for the new fields.

### Changed after (user, 2026-09-17)

- **Source:** the jump is now the user's own download, CCOUNTERFEIT's "JUMP SFX RANDOMISATION -
  HUMAN MADE" (<https://freesound.org/people/CCOUNTERFEIT/sounds/851416/>, the page URL exactly as
  the user gave it; the other Freesound rows use the short `/s/<id>/` form). Its licence, CC0, was checked on the page, and
  the file matches it: 1.253 s, 48 kHz stereo, dated 2026-04-21.
- **Raw file:** `assets/audio/freesound/jump-sound.wav`.
- **Cutting:** the take holds five jumps. They are cut at the gaps `silencedetect` (−35 dB) finds
  into `character/jump_0…4` (73–92 ms each), replacing moogy73's two wooshes.
- **The rest:** the slot's gain and pitch jitter are unchanged, and the library was rebuilt.
- **In the game:** the Credits Screen names CCOUNTERFEIT under WITH THANKS · CC0, with the title
  linked to that page. `Credits.test.tsx` holds it.

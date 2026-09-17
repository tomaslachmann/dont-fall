# Sound: the Character, moving Assets, the Environment, music and UI

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs). It feeds a design discussion. It is **not** a
> decision record: whatever is adopted gets recorded as an ADR the normal way.
>
> Written 2026-09-17, after the user asked: *"dát charakteru (a jeho animacím),
> environmentu a assetům (v pohybu) zvuky."* In English: give the Character
> (and its animations), the Environment and moving Assets sounds.
>
> **Already decided by the user in the same conversation, before this note:**
> sounds come from CC0 Kenney packs; the whole scope (Character, moving Assets,
> Environment, music and UI) becomes one milestone of tickets; other players
> are heard, spatially; the Settings AUDIO tab gets wired up and adjusted.
>
> **Settled (2026-09-17) as ADR 0087, milestone M14.** The §12 answers:
> Kenney packs downloaded here after the user confirms the files (1); every gap
> from **Freesound CC0 recordings, not synthesis** (2); `.ogg` only, Safari 18.4+
> (3); a voiced Countdown (4). Still open: which Music Loops (5), and the builder
> stays silent for now (6).
>
> Three.js facts are pinned to **r171** (`"three": "^0.171.0"`), checked
> against the installed `three@0.171.0` sources.

## Recommendation

1. **Sounds are presentation only**, like the renderer (ADR 0009). Every trigger
   the game needs already reaches the client: the Epochs, `grounded`,
   `motionState`, `dashing`/`dashSpeed`, the jump sequence's phases and the
   Moving Segment pose (a pure function of the Tick). Nothing new goes on the
   wire, and the server never loads audio.
2. **One `AudioContext`, three.js's own**, with a small mix graph of our own:
   `master → { effects, environment, music, ui }`. It is resumed on the first
   click, which also locks the pointer.
3. **Use three.js `AudioListener` on the camera, but not `PositionalAudio` as it
   ships.** It sets `panningModel = 'HRTF'`, which Mozilla's Web Audio
   performance notes call "**Very** expensive". Use `equalpower` (the Web
   Audio default, "rather cheap") for everything, or at most HRTF for the local
   player's own close sounds.
4. **One-shots are `AudioBufferSourceNode`s created per play from shared,
   decoded buffers.** They are cheap by design. Loops (spinners, fans, belts,
   wind) are long-lived sources whose gain and `playbackRate` follow speed.
5. **A voice budget of our own.** Web Audio has none. Cull by distance and
   priority *before* creating a node, cap concurrent one-shots, and keep loops
   only for the nearest few emitters of each kind.
6. **Footsteps come from the clips.** Each gait gets its foot-contact times,
   measured from BLIP's clips the way the knockdown's frames already are
   (`modelBones.test.ts`). A footstep plays when the action's `time` crosses
   one.
7. **Kenney covers most one-shots and all UI/voice, but not ambience or
   mechanical loops** (§2). Those come either from CC0 recordings on
   Freesound, checked file by file, or from Web Audio synthesis. That choice is
   an open question.
8. **Keep Kenney's `.ogg`.** Safari decodes Ogg Vorbis from 18.4
   (macOS 15.4 / iOS 18.4). Anything older needs MP3/AAC copies.

## 1. What exists today

- **No audio at all.** There is no `AudioContext`, no three.js `Audio*`, and no
  sound file anywhere in the repo.
- **The Settings AUDIO tab is a mock** (`apps/client/src/screens/Settings.tsx`).
  It has `MASTER`, `MUSIC` and `IMPACTS & GRABS` sliders plus `VOICE CHAT` and
  `CROWD REACTIONS` switches, all held in component state that is reset on
  every mount. The game has no voice chat and no crowd. Graphics quality
  (ADR 0079, `lib/graphicsQuality.ts`) is the per-device setting to copy.
- **Triggers the client already has**, per Character (local predicted, remote
  interpolated):

  | Trigger | Where it comes from |
  |---|---|
  | jump, land, air time | `grounded`, `velocity.y`, `JumpSequences` (`jumpSequence.ts`) |
  | footsteps | the gait clips `walk`, `run`, `sprint` (`selectLocomotion`) |
  | Dash | `dashing`, `dashSpeed` |
  | Sliding | `motionState === "Sliding"` |
  | Hit swing / Hit landed | `hitEpoch` / `hitReactEpoch` |
  | Grab attempt / hold | `grabEpoch` / `grabbingId`, `heldByGrabberId` |
  | knockdown / get-up | `ragdollEpoch`, `ragdollCause`, `motionState` `GettingUp` |
  | Respawn | `respawnCount`, plus `fallCount` for the Fall itself |
  | Spring (launch pad) | `launchPadEpoch`, `SpringSquashes` |
  | Surface underfoot | ice footing (ADR 0082), mud and bounce sheets |
  | Checkpoint / finish | `checkpointIndex`, `finishTick` |

- **Moving things:** Motion `spin` / `swing` / `slide` (ADR 0061), posed by the
  same pure function on both sides (`movingSegmentPose`); Spinners; Volumes
  and air columns (ADR 0075); Conveyors (ADR 0064); bounce sheets (ADR 0070).
- **Match flow:** `MatchPhase` is `LOBBY | COUNTDOWN | RUNNING | ROUND_END |
  RESULTS`. Screens are React (ADR 0008), the HUD is plain DOM.
- **Environment:** presets `day`, `sunset`, `night` (ADR 0074).

## 2. Where the sounds come from

Kenney's audio is CC0 ("Creative Commons CC0"), like the KayKit models.

**On kenney.nl today:** Impact Sounds (130 files), Interface Sounds (100),
Music Jingles (85), RPG Audio (50), UI Audio, Digital Audio, Casino Audio,
Sci-fi Sounds, Voiceover Pack and Voiceover Pack (Fighter).

**Not on kenney.nl as their own pages** (`/assets/music-loops` and
`/assets/foley-sounds` are 404), but part of Kenney's sound collection:
**Foley Sounds** (with a `Woosh` folder) and **Music Loops** (19 loops). The
listings below come from a third-party mirror (gamesounds.xyz). They show
what the zips contain. Download from an official Kenney source.

What each pack offers this game (files are `.ogg`, mostly 7–35 KB):

| Pack | Useful for | Files (from the listing) |
|---|---|---|
| Impact Sounds | footsteps, landings, hits, props | `footstep_{carpet,concrete,grass,snow,wood}_000–004`, `impactPunch_{medium,heavy}_*`, `impactSoft_{medium,heavy}_*`, `impactWood_*`, `impactMetal_*`, `impactPlate_*`, `impactPlank_medium_*`, `impactBell_heavy_*` |
| Foley Sounds › Woosh | Dash, swing obstacles, hammers | `woosh1–8` |
| RPG Audio | cloth for Grab, creaks, doors | `cloth1–4`, `creak1–3`, `doorOpen_*`, `doorClose_*`, `footstep00–09`, `metalLatch` |
| Retro Sounds 2 | a cartoon layer | `jump1–5`, `fall1–5`, `hit1–5`, `hurt1–5`, `coin1–5` |
| Digital Audio | cartoon pitch sweeps | `phaserUp*`, `phaserDown*`, `phaseJump1–5`, `powerUp1–12` |
| Interface Sounds | menus | `click_*`, `select_*`, `confirmation_*`, `back_*`, `toggle_*`, `switch_*`, `tick_*` |
| Voiceover Pack (Male/Female) | the Countdown and results | `1`–`10`, `ready`, `set`, `go`, `round`, `final_round`, `hurry_up`, `time_over`, `you_win`, `you_lose`, `congratulations`, `game_over`, `its_a_tie` |
| Music Jingles | qualify, round end, results | folders `Hit`, `Pizzicato`, `Retro`, `Saxophone`, `Steeldrum` (e.g. `jingles-hit_00–16`) |
| Music Loops | Lobby and in-Round music | e.g. `Wacky Waiting`, `Polka Train`, `Swinging Pants`, `Cheerful Annoyance`, `Mission Plausible`, `Farm Frolics` (105–600 KB each) |

**Gaps: Kenney has none of these.**

- **Ambience:** wind, daytime birds, night crickets.
- **Mechanical loops:** a fan's hum, a belt's rattle, a spinner's whirr.
- **A proper spring "boing"** (Digital Audio's `phaseJump`/`phaserUp` come close).
- **Mud squelch, ice skid, a bounce-sheet thump.**

Two ways to fill them:

- **Freesound, CC0 only, checked per file.** For example "AMBIENCE NIGHT FIELD
  CRICKET 01" by sengjinn is CC0, but it is a 60 s, 16.6 MB WAV. Recordings
  like that need trimming, loop-cutting and encoding to `.ogg`, and no audio
  tool is installed here (`ffmpeg`, `sox` and `oggenc` are all missing).
- **Web Audio synthesis.** Wind is filtered noise with a slow gain LFO. A fan is
  band-passed noise plus a low oscillator hum. A spring is an oscillator pitch
  sweep. These cost no files and follow speed exactly, but sound plainer than
  recordings.

## 3. three.js audio, r171

- **`AudioListener`** wraps three.js's shared `AudioContext` (created once in
  `audio/AudioContext.js`). It owns a master `gain` and is meant to be a child
  of the camera. Its `updateMatrixWorld` ramps the listener's position,
  forward and up with `linearRampToValueAtTime` over the frame's `timeDelta`.
- **`PositionalAudio`** adds a `PannerNode` in front of its gain and ramps its
  position the same way. **It hard-codes `panningModel = 'HRTF'`** in its
  constructor. It exposes `setRefDistance`, `setRolloffFactor`,
  `setDistanceModel`, `setMaxDistance` and `setDirectionalCone`.
- **Panning cost:** equal-power is "Rather cheap"; HRTF is "**Very** expensive.
  This node is constantly doing convolutions…" (padenot, Web Audio performance
  notes). The Web Audio default is `equalpower`.
- **Distance models** (MDN): `inverse` (the default) gives
  `refDistance / (refDistance + rolloff · (max(d, ref) − ref))`; `linear` gives
  `1 − rolloff · (d − ref) / (maxDistance − ref)`; `exponential` gives
  `(max(d, ref) / ref)^−rolloff`. `linear` reaches silence at `maxDistance`,
  which makes "beyond this, don't even create the node" consistent with what is
  heard.
- **`Audio`** wraps one source and one gain. Every `Audio` object is a node
  chain with state, which suits a loop. For many short one-shots, creating an
  `AudioBufferSourceNode` → (panner) → bus directly is lighter than pooling
  `Audio` objects.
- **Animation events:** `AnimationMixer` dispatches `loop` (with `loopDelta`) and
  `finished` (from `AnimationAction.js`). Nothing fires mid-clip, so foot
  contacts are read from `action.time` crossing measured contact times.
  `time` wraps to `[0, clip.duration]` while looping.

## 4. Starting audio in a browser

- **Chrome:** an `AudioContext` created before a user gesture starts
  `suspended`, and `resume()` has to be called after one. A click is the gesture
  Chrome recommends relying on.
- **Spec:** a user agent may allow the start only once the page has "sticky
  activation".
- **MDN:** create or resume the context from inside a user gesture.
- **For this game:** the Lobby's buttons and the click that locks the pointer
  are both gestures. Resume on the first of them, and until then play nothing,
  since a Lobby's first music bar would otherwise be lost silently.

## 5. Formats, loading and memory

- **Ogg Vorbis in Safari:** WebKit's Safari 18.4 notes add "Ogg container
  support for both Opus and Vorbis audio on macOS Sequoia 15.4, iOS 18.4,
  iPadOS 18.4, and visionOS 2.4". Chrome and Firefox have long supported it.
  Keeping Kenney's `.ogg` means Safari 18.4 is the floor; otherwise every file
  needs an MP3 or AAC copy.
- **`decodeAudioData`** takes a whole file, not fragments. The result is
  resampled to the context's rate. Decoding performance varies by browser:
  Gecko decodes in a thread pool, others serialize on one thread. Decode during
  Track loading (ADR 0080, and M13's warm-up), never on the first play.
- **Decoded buffers are raw PCM**, so a 10 KB `.ogg` one-shot becomes a few
  hundred KB in memory (not measured here). Music loops are the large ones:
  load only the one playing, and stream music through an `<audio>` element if
  memory matters. MDN recommends media elements for full-length tracks and
  buffers for short samples.
- **Size on the wire** is small: roughly 100 one-shots at ~10 KB is about 1 MB,
  plus one or two music loops at 150–600 KB.

## 6. One-shots, loops and a voice budget

- **One-shots:** `AudioBufferSourceNode` "can only be played once… these nodes
  are very inexpensive to create, and the actual `AudioBuffer`s can be reused"
  (MDN). The spec calls this approach "fire-and-forget". `playbackRate` and
  `detune` give per-play variation (±5% pitch, a random pick of variants
  `_000–004`), which keeps repeated footsteps from sounding mechanical.
- **Loops:** `loop = true` on a long-lived source, gain and `playbackRate`
  driven from the emitter's speed each frame (§8), faded out rather than cut.
- **Voice budget (design, not from a source; Web Audio imposes none):**
  - Before creating a node, estimate its audibility (distance-model gain × bus
    volume) and skip anything under a threshold.
  - Cap concurrent one-shots, for example ~24. When full, drop the quietest or
    lowest-priority one: a remote footstep loses to your own knockdown.
  - Loops: only the nearest *k* per kind (for example 4 spinners, 2 fans),
    re-chosen a few times a second.
  - Remote footsteps are quieter and pass a stricter audibility check. With 12
    Characters they are most of the traffic.

## 7. The Character

- **Footsteps:** measure left/right contact times per gait clip (`walk`, `run`,
  `sprint`) from BLIP.glb, pinned by a test like `modelBones.test.ts`. Play on a
  crossing of `action.time`, weighted by the action's effective weight so a
  crossfade doesn't double-step. Pick the surface variant from what is
  underfoot: mud, ice or bounce where known, a default deck otherwise
  (`impactSoft` or `footstep_concrete`).
- **Jump / land:** takeoff when the sequence starts from a push-off
  (`TAKEOFF_MIN_SPEED`); landing when it lands, scaled by fall speed and silent
  under `LANDING_MIN_AIRBORNE_MS`. That is the same rule that hides a tiny hop's
  landing animation.
- **Dash:** a woosh on the burst's start, its volume and pitch following
  `dashSpeed`.
- **Sliding:** a looped scrape while `Sliding`, gain following speed.
- **Hit:** a swing woosh on `hitEpoch`, stronger with charge; `impactPunch` on
  `hitReactEpoch`.
- **Grab:** cloth on `grabEpoch`, a grip on a hold's start.
- **Knockdown:** a thud keyed by `ragdollCause` (`WallImpact` heavier than
  `Bump`), then a soft settle on get-up.
- **Fall / Respawn:** a falling whistle when the Character drops below the Track,
  then a pop on `respawnCount`.
- **Spring:** a boing on `launchPadEpoch`.
- **Checkpoint / finish:** UI-style jingles, local player only.

All of these are edge-detected per Character the way the animations already
are (an epoch rising, a state entered), so remote Characters come for free.

## 8. Moving Assets

- **Swing (hammers, pendulums):** the pose is a function of the Tick, so its
  angular speed is known exactly. Play a woosh when speed peaks (the bottom of
  the arc), louder the faster the swing.
- **Spin (spinners, rotating bars):** a whirr loop with `playbackRate` following
  angular speed, positioned at the pivot.
- **Slide (moving platforms, doors):** a start/stop clunk at the ends of the
  slide (its `pause`), and a low rumble while it moves.
- **Fans and updrafts:** a hum loop at the fan, gain following the column's
  strength.
- **Conveyors:** a rattle loop along the belt, at the point of the belt nearest
  the listener.
- **Bounce sheets and Springs:** play on the press (`BouncePresses`,
  `SpringSquashes`).
- **Where the sound data lives:** per Asset definition, next to its visual
  (e.g. `trapAssetDefs`: hammer → `swing`), and per Motion kind as a default.
  A Track only loads the sounds of the Assets it places (like ADR 0080).

## 9. The Environment

- **Ambience per preset:** `day` gets wind and birds, `sunset` a softer wind,
  `night` wind and crickets. It plays on the environment bus with no
  panning.
- **Height:** more wind when the camera is higher above the cloud floor (it is
  the one thing the player looks down into).
- **Updraft columns (ADR 0075):** positional air noise at each column.
- **Source:** see §2's gaps. Recordings need editing tools that aren't
  installed. Synthesis needs none.

## 10. Music and UI

- **Music:** Kenney's Music Loops (Lobby / Round), on the music bus, fading
  between phases.
- **Countdown:** Voiceover `3`, `2`, `1`, `go` on the synchronous Countdown
  (ADR 0040), or Interface `tick_*` if a voice is too much.
- **Round end / qualified / results:** Music Jingles.
- **Menus:** Interface Sounds on React buttons. This is the one place sound
  touches Screens (ADR 0008), so a tiny hook in `packages/ui` or the client
  shell.

## 11. Mixing and settings

- **Buses:** `master`, `effects` (Character + Assets), `environment`, `music`,
  `ui`. Each is a `GainNode`, and the master is `AudioListener.gain`.
- **Settings AUDIO:** sliders for MASTER, EFFECTS, ENVIRONMENT and MUSIC,
  stored per device the way graphics quality is (ADR 0079). The voice-chat and
  crowd switches, which have no system behind them, get hidden.
- **Loud moments:** a `DynamicsCompressorNode` on master keeps twelve
  simultaneous knockdowns from clipping.

## 12. Open questions

1. **Download:** which packs, from where (kenney.nl for the eight listed there;
   Music Loops and Foley Sounds from an official Kenney bundle), and who
   downloads them.
2. **Gaps (§2):** Freesound CC0 recordings (someone installs `ffmpeg` to cut
   loops) or Web Audio synthesis for ambience, fans, belts and springs?
3. **Safari floor:** keep `.ogg` (Safari 18.4+) or ship MP3/AAC copies too?
4. **Countdown voice:** Kenney's announcer voice, or neutral ticks?
5. **Which Music Loops** fit the Lobby and a Round?
6. **The Track builder:** does its playtest play sounds too, or only the game?

## Sources

- Kenney audio category: https://kenney.nl/assets/category:Audio
- Kenney Impact Sounds: https://kenney.nl/assets/impact-sounds
- Kenney RPG Audio: https://kenney.nl/assets/rpg-audio
- Kenney Music Jingles: https://kenney.nl/assets/music-jingles
- Kenney pack listings (third-party mirror): https://gamesounds.xyz/?dir=Kenney%27s+Sound+Pack
- Freesound, "AMBIENCE NIGHT FIELD CRICKET 01" (CC0): https://freesound.org/people/sengjinn/sounds/175020/
- three.js `PositionalAudio`: https://threejs.org/docs/pages/PositionalAudio.html
- three.js `AudioListener`: https://threejs.org/docs/pages/AudioListener.html
- three.js `AnimationAction`: https://threejs.org/docs/pages/AnimationAction.html
- three.js r171 sources: `node_modules/three/src/audio/{AudioContext,Audio,PositionalAudio,AudioListener}.js`, `src/animation/AnimationAction.js`
- Chrome autoplay policy (Web Audio): https://developer.chrome.com/blog/autoplay
- Web Audio API spec: https://webaudio.github.io/web-audio-api/
- MDN, Web Audio best practices: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- MDN, `AudioBufferSourceNode`: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
- MDN, `PannerNode.panningModel`: https://developer.mozilla.org/en-US/docs/Web/API/PannerNode/panningModel
- MDN, `PannerNode.distanceModel`: https://developer.mozilla.org/en-US/docs/Web/API/PannerNode/distanceModel
- MDN, `decodeAudioData`: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- Web Audio performance notes (padenot): https://padenot.github.io/web-audio-perf/
- WebKit, Safari 18.4 features: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/

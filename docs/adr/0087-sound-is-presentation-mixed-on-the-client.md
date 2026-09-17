# 0087 — Sound is presentation, mixed on the client

## Context

The game has no sound at all: no `AudioContext`, no audio file, and a Settings
AUDIO tab whose sliders go nowhere. The user asked (2026-09-17) for sound on the
Character and its animations, on moving Assets, and on the Environment. Asked
about scope, they chose all of it, music and UI included, as one milestone of
tickets (M14).

Research: `docs/research/game-audio.md`. Decided with the user in the same
conversation:

- sounds come from **CC0 Kenney packs**, and everything Kenney lacks
  (ambience, mechanical loops, a spring's boing, mud, ice) from **CC0
  recordings on Freesound**, not synthesis;
- **other players are heard, spatially**;
- the **AUDIO tab gets wired up and adjusted**;
- Kenney's **`.ogg` files stay `.ogg`**;
- the Countdown is **voiced**: "3, 2, 1, GO".

## Decision

**Sound is presentation, like drawing (ADR 0009). The client derives every
sound from state it already has, mixes it in one Web Audio graph, and never
sends or receives anything for it.**

- **No protocol change, no server audio.** Triggers are the existing Epochs
  (`hitEpoch`, `hitReactEpoch`, `grabEpoch`, `ragdollEpoch`, `launchPadEpoch`),
  counters (`respawnCount`, `fallCount`, `checkpointIndex`), states
  (`grounded`, `motionState`, `dashing`), the jump sequence, the gait clips, the
  Moving Segment pose (a pure function of the Tick, ADR 0061) and `MatchPhase`.
  Each is edge-detected per Character id, like the animations, so local and
  remote Characters sound the same way.
- **One `AudioContext`: three.js's.** An `AudioListener` rides the camera. Under
  it sit five gain buses: `master → effects, environment, music, ui`. The
  context is resumed on the first user gesture (the Lobby's buttons, or the
  click that locks the pointer). Nothing plays before that.
- **Equal-power panning, linear distance.** Positional sources use a
  `PannerNode` with `panningModel = 'equalpower'`, not the `'HRTF'` that
  three.js's `PositionalAudio` hard-codes, which is the expensive one. They use
  the `linear` distance model, so a sound is silent at its `maxDistance`, which
  is also the distance past which it is never created. The local Character's own
  sounds are not panned.
- **Our own voice budget.** Web Audio has none. A one-shot whose estimated gain
  (distance × bus) is under a threshold is never created. Concurrent one-shots
  are capped: when the cap is hit, the lowest priority gives way (a remote
  footstep before your own knockdown). Loops play only for the nearest few
  emitters of each kind.
- **Buffers, decoded ahead.** One-shots are an `AudioBufferSourceNode` per play
  from shared decoded buffers, with a random variant and a small pitch jitter.
  Buffers are fetched and decoded while the Stage is built, never on first play.
  A Track decodes only the sounds of what it places, the same rule as ADR 0080.
  Music streams through a media element rather than being decoded whole.
- **Where the sounds live.** Curated runtime files are in
  `apps/client/public/sounds/`, named by slot (e.g. `character/land_heavy_0.ogg`).
  A typed slot table in `apps/client/src/audio/` maps a slot to its files, bus,
  priority and distances. Raw downloads stay under `assets/audio/`. Which
  Assets and Motion kinds make which sound is a client table keyed by Module id,
  not data in `packages/shared`, which the server loads and never needs this.
- **Every file's origin is written down.** Source URL, author and licence as
  checked when it was picked (CC0 only) go in `apps/client/public/sounds/CREDITS.md`.
  A test holds that every shipped file has a line there.
- **`.ogg` only.** Safari decodes Ogg Vorbis from 18.4 (macOS 15.4, iOS 18.4).
  Older Safari runs the game silently.
- **Settings are per device.** MASTER, EFFECTS, ENVIRONMENT and MUSIC sliders are
  stored like graphics quality (ADR 0079) and applied live to the running game.
  The VOICE CHAT and CROWD REACTIONS switches, with no system behind them, are
  hidden.

## Consequences

- The simulation, the Snapshot and the server are untouched. Sounds can only be
  as right as what the client draws: a remote knockdown is heard when it is seen,
  a render delay later.
- A voiced Countdown has to line up with the synchronous Countdown (ADR 0040):
  each call plays on the client's estimate of the server's clock, not on a local
  timer.
- Freesound originals need a logged-in account to download, so picking them is
  shared work. The recordings also have to be trimmed, looped and encoded, which
  needs `ffmpeg`, not installed on the dev machine today.
- Settings → AUDIO changes shape: IMPACTS & GRABS becomes EFFECTS, and
  ENVIRONMENT is new.
- A weak PC pays for decoded PCM in memory and for the one-shots it plays. The
  budget's caps are tuning values, checked with 12 Characters on the base race.

## Alternatives rejected

- **Web Audio synthesis for the gaps.** No files, and it follows speed exactly,
  but it sounds plainer than recordings. The user chose Freesound.
- **three.js `PositionalAudio` as shipped.** HRTF on every source is the costliest
  panner, and an `Audio` object per short one-shot is heavier than a bare source
  node.
- **MP3/AAC copies for older Safari.** Every file would need converting, and the
  client would need to pick a format per browser.
- **Replicating sound events.** Everything needed is already replicated or
  derivable. A message would only duplicate it.

## Amended (2026-09-17, same day, once the files were in)

Decided with the user when the downloads turned out not to be all CC0:

- **CC-BY is allowed, with attribution. Non-commercial (NC) never is.** A CC-BY file is credited by
  author and licence in `CREDITS.md` *and* on an in-game Credits screen (M14 ticket 14). The one NC
  pick (a spinner whirr) was dropped, not replaced. Spinners get no loop: a woosh plays when a bar
  sweeps past the listener (the user's call).
- **Music is generated by the game's author** (Suno and Stable Audio). It is credited as such. Its
  rights follow the author's own plan with those services, which this repo cannot check. It plays as
  shuffled playlists, never the same track twice in a row: the Lobby rotates its tracks, and a Round
  rotates its own.
- **Stand-ins where nothing fits yet.** The fall whistle is Kenney's `phaserDown`. (Night was first
  a lower, quieter wind with no crickets, until the user added a CC0 cricket recording the same day.
  Night is now that wind under crickets.) A sliding platform's rumble is the fan hum slowed down. Any of
  them can be swapped for a better file later without code changes.
- **`.ogg` means Vorbis or Opus.** Kenney's files are Ogg Vorbis and are shipped as they are. Files
  encoded here are Ogg Opus, because the dev machine's `ffmpeg` has no `libvorbis`. Safari 18.4 adds
  both.

## Amended (2026-09-17, M14 tickets 09 and 11)

Found while building, not a new choice of the user's:

- **Music is outside the Stage's buses.** The Lobby Screen plays music before any game module loads
  (ADR 0056), and the music outlives every Stage (a Track swap). The page therefore owns one
  three-free `AudioContext`, which the game hands to three.js. The music player has its own chain on
  that context and applies MASTER × MUSIC itself. It is still one context. The Stage's music bus is
  left unfed.
- **The Lobby's playlist is the app's music** (the user's call). It plays on every React Screen and in
  free roam, from the first gesture on. Only a Match's Round plays the Round's playlist, and leaving
  a Match crossfades back.
- **Disposing a Stage fades its sound out** (0.4 s) before releasing the graph, so a Track swap
  crossfades rather than cuts.

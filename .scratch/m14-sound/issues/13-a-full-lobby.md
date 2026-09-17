# 13 — A full Lobby: the voice budget with 12 Characters

**What to build:** the budget's numbers, settled against a worst case, and made
visible. **ADR 0087.**

**Blocked by:** 04, 05, 06, 07, 08

**Status:** done on tests (2026-09-17). Listening with 12 Characters, and the frame-time check on the throttled dev Mac, are the user's.

## How it behaves after

- The `?perf=1` overlay (M13) also shows voices playing, voices dropped by the
  budget this second, and decoded audio memory.
- A headless test drives the engine with a recorded base-race run of 12
  Characters (the M13 benchmark's inputs) and pins that one-shots never exceed
  the cap and nearest-k loops hold.
- The threshold, the one-shot cap and each slot's *k* are named constants tuned
  from that run.

## What to change

- [x] Engine counters: active voices, dropped, decoded bytes
- [x] The overlay's audio line
- [x] The headless budget test over a 12-Character run
- [x] Tuned constants, with the run's numbers written here

## Notes

- Listening with 12 Characters and the frame-time check on the throttled dev Mac
  are the user's (M13's stand-in for a weak PC).

## As built

- **Counters:**
  - `SoundEngine.stats()` now splits `dropped` into `inaudible` (never created: too far, or a muted
    bus) and `overCap` (refused or cut at the one-shot cap). At first sight they were one number,
    and the run below showed why they must not be: nearly all drops are distance, not the cap.
  - `soundBank.decodedBytes(context)` counts the decoded PCM (4 bytes × channels × frames) of every
    file any bank on the context has decoded.
- **The overlay (`?perf=1`):** a new line, for example
  `audio  7 voices · 3 loops · dropped/s 12 quiet, 2 over cap · 3.5 MB decoded`.
  - `formatAudioLine` in `hud/perfText.ts`.
  - `createPerfSession`'s new `audio` option gives the per-second rates from the counters, over a
    1 s window.
  - Match and practice pass the live Stage's engine and the context's decoded size.
- **The run (`audio/budget.test.ts`, about 2 s):**
  - **Setup:** the real base race (GLBs from `assets/`), 12 bots on the real shared step.
  - **Inputs:** the M13 benchmark's (`scriptedInput`, now in `scripts/benchInputs.ts` and imported
    by both).
  - **What plays:** everything a Stage drives, at 60 fps: `CharacterSounds`, `SegmentSounds`,
    `MachineSounds`, `Ambience`, the bounce landings, and footsteps every 0.4 s per running
    Character, standing in for the gait clips.
  - **The context:** a fake whose one-shots last as long as the real files do. Their lengths are
    read from each Ogg's last granule position.
  - **Layouts:**
    - `start`: everyone on the spawn grid, heard from the first bot, 30 s.
    - `spread`: a bot per Checkpoint, each waiting until the camera comes to it and then running
      its section. The camera stays 5 s per bot, 60 s in all.
  - **Pinned:**
    - one-shots never exceed the cap;
    - each loop slot never exceeds its k;
    - your own sounds of priority ≥ 4 are never refused;
    - the ambience always plays;
    - the fall whistle doesn't fire on every jump.
  - `DONTFALL_AUDIO_BUDGET=1` prints the numbers.
- **The numbers (2026-09-17):**

  | | start (30 s) | spread (60 s) |
  |---|---|---|
  | plays asked for | 1752 | 2446 |
  | never created, too quiet | 884 | 2130 |
  | refused or cut at the cap | 0 | 0 |
  | peak one-shots | 24 (8 frames of 1800 at the cap) | 16 |
  | peak loops (k) | ambience 1+1 | fan 2 (2), air rush 2 (2), belt 2 (2), slide rumble 2 (3), slide 1 (4) |
  | footsteps / jumps / landings | 502 / 228 / 161 | 497 / 159 / 135 |

- **Tuning: no constant moved.**
  - `MIN_AUDIBLE_GAIN` 0.02 turns away half of what the crowded start asks for: far hammers,
    far spinner passes, far Characters.
  - `MAX_ONESHOT_VOICES` 24 is reached only in the spawn-grid crush, and never refused a play.
  - Each machine's k is met exactly where two stand side by side (the climb's twin fans, the
    belt's two strips). Raising it would add nothing the listener could place.
- **Found by the run:** a Track that draws nothing has a lowest point of `Infinity`, and
  `fallWhistleY` then whistled on every jump's way down. It now falls back to the kill plane's lead.

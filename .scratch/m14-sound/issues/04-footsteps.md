# 04 — Footsteps from the gait clips, by surface

**What to build:** a Character's feet are heard when they touch the ground in
its walk, run and sprint clips, for your own Character and every other.
**ADR 0087.**

**Blocked by:** 02

**Status:** done on tests (2026-09-17). Hearing the steps is the user's check.

## How it behaves after

- While a gait clip plays, a footstep sounds each time the clip's `time` crosses
  a foot contact. Nothing plays in the air, while down, while Sliding, or
  standing still.
- Contacts are measured from BLIP.glb's `Walk`, `Run` and `Sprint` clips (where
  a foot's height bottoms out) and pinned by a test against the file, like the
  knockdown's frames in `modelBones.test.ts`.
- While two gaits crossfade, only the heavier one steps, so a gait change never
  double-steps.
- The surface picks the slot:
  - `footstep_default` on decks;
  - `footstep_mud` in mud;
  - `footstep_ice` on ice (from the ice footing, ADR 0082);
  - `footstep_bounce` on bounce sheets.
- Sprint steps are a little louder and brighter than a run's.
- Remote Characters step from their own rig's clips at their interpolated
  position, quieter, and under the budget's stricter threshold.

## What to change

- [x] Measure and pin contact times per gait clip (a pure table plus a
      `modelBones`-style test)
- [x] A detector over `(previous time, current time, loop wrap)` → contacts
      crossed, a pure function with tests (including a wrap and a long frame)
- [x] Local: in `updateCharacterAnimation`, from the active gait action
- [x] Remote: in the remote pool's `apply`, per rig
- [x] Surface lookup from what the Stage already knows (ice footing, mud and
      bounce decks). The default is otherwise.

## Notes

- Research §7.
- Wobble and Wobble_Walk (Stagger, ice) step too, if their clips have clear
  contacts. Otherwise they stay silent and that is written down here.

## As built

- **Contacts, measured:** all four stepping clips put a foot down at the same fractions.
  - Right foot at 0.49, left at 0.99, measured on 240 samples per clip as the frame a foot drops
    below 15% of its lift.
  - Clips: Walk (1.2 s), Run (0.8 s), Sprint (0.6 s) and Wobble_Walk (1.6 s).
  - `Wobble` (standing) has no lift and never steps.
  - Pinned by `modelBones.test.ts` against the real BLIP.glb: exactly two touchdowns, each within
    0.02 of `FOOT_CONTACTS`.
- **`render/footsteps.ts`:**
  - `FOOT_CONTACTS`, `steppingClip(action, actions)` (walk, run, sprint, wobbleWalk);
  - `contactsCrossed(previous, current)`, which handles the loop's wrap;
  - `Footsteps` (per id; a change of clip, or nothing stepping, starts counting afresh, so a
    crossfade or a reaction never double-steps);
  - `footstepSound(clip, surface, remote)`: the slot by surface, gain by clip (walk 0.6, run 0.8,
    sprint 1, with sprint also 1.08× rate), a bounce step at 0.35, another player at 0.7.
- **What a foot lands on:** `createDeckFooting` generalises `createIceFooting` to any sheeted
  deck. The Stage builds mud and bounce footings next to ice. Precedence is bounce, then mud, then
  ice, otherwise deck.
- **Local** (`scene.ts`): after the mixer advances, the feet count when nothing is posed, the
  Character is grounded, not Sliding, and moving or dashing. They are forgotten on going down and
  on a hit reaction. Steps are unpanned.
- **Remote** (`remoteCharacterPool.ts`): the same rule per rig, reported through
  `RemotePoolWorld.onFootstep(clip, centre)`. The Stage plays it positioned at the capsule centre.
  Forgotten when a rig goes down, reacts or leaves.
- `STAGE_SOUND_SLOTS` now also decodes `character.footstep` and `surface.mud`/`ice`/`bounce`.
- **Tests:** `footsteps.test.ts` (crossings and wrap, per-id, clip change, slot and gain) and
  `remoteCharacterPool.footsteps.test.ts` (a Run steps twice a stride at the Character's position,
  silent in the air, silent while Sliding, stops when standing).

# 02 — The fan's rotor spins

**What to build:** the rotor node from 01 turns about its own vertical axis in the game and in the
Track builder's preview. It is render-only, so the server never sees it.

**Blocked by:** 00 (speed), 01 (the rotor node).

**Status:** done on tests (2026-09-16). Speed decided: **14 rad/s** (the prototype default, the
user's pick).

## What changed

- [x] The mark lives in the asset: the rotor node carries `extras.spin` (rad/s about its own +Y),
      written by the converter. `GLTFLoader` puts it on `userData`, and clones copy it. The shared
      reader reads only `role`, `surface` and `shape`, so it never reaches collision.
- [x] `packages/render/src/spinningParts.ts`: `findSpinningParts` / `spinParts` are absolute on
      the wall clock and wrapped to one turn. `prefers-reduced-motion` parks the rotor.
- [x] Game: the Stage collects the rotors once (still pieces and Moving Segments alike) and turns
      them in `render()`.
- [x] Builder: the viewport turns them in `render()`, found each frame because the Track is being
      edited.
- [x] Tests: `spinningParts.test.ts`.
- [ ] The look (the user's).

## Notes

- The shared GLB reader (`packages/shared/src/track/asset.ts`) knows only the roles
  `visual` / `collision` / `solid`. A spinning part is visual. How the renderer finds it (a
  node-name convention, an `extras` field, or a def field) is this ticket's call. It must never
  reach collision.
- Wall-clock driven, like the cloud puffs: a fan tells the player nothing about sim time.
- Four blades strobe once a frame turns more than 45° (about 47 rad/s at 60 fps, about 23 rad/s
  at 30 fps). The prototype defaults to 14 rad/s.
- `prefers-reduced-motion`: slow it or park it, as the rings parked.

# 01 — Neutral tone mapping in both apps

**What to build:** the game and the Track builder both render with
`THREE.NeutralToneMapping` (Khronos PBR Neutral), so authored colours survive
and values above 1.0 (sun disc, reflections) roll off instead of clipping.
Lands first and alone, because it changes how every Asset and BLIP look.

**Blocked by:** —

**Status:** done (2026-09-16) — typecheck and the existing suites; the visual check is the user's.

## What to change

- [x] Client: set `renderer.toneMapping` in `createStage`; `OutputPass` already
      applies it to the whole composed frame (research §1a)
- [x] Builder: the same operator on the viewport renderer and the thumbnail
      renderer, so previews match the game
- [x] `toneMappingExposure` stays 1 here; per-preset exposure arrives with 02/03
- [ ] Visual check of every Asset family, BLIP, and the Checkpoint / Finish Zone
      markers — the user's

## Notes

- ADR 0074. Research §6: ACES and AgX desaturate the palette; Neutral leaves
  base colours up to ~0.8 untouched.
- `CharacterPreview` (Screens) is out of scope unless the user wants it to match.
- No new unit test: the change is one renderer assignment per renderer, and a
  test would only restate it. The two renderers that matter can't run under
  jsdom anyway (no WebGL). Ticket 02's `packages/render` is where the operator
  should become one shared constant; until then the builder's
  `GAME_TONE_MAPPING` (`scene/viewport.ts`) names the client's `createStage` as
  its source of truth.
- The builder's lavender `scene.background` is a clear colour, so tone mapping
  leaves it alone. Grid lines and every mesh material are tone-mapped.

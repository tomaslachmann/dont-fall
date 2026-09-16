# 08 — Multisampled composer target

**What to build:** the game scene is actually antialiased. Today it renders
into `EffectComposer`'s default target, created without `samples`, so the
renderer's `antialias: true` never reaches it.

**Blocked by:** —

**Status:** done (2026-09-16) — tests and typecheck. The browser confirmation of the original finding and the visual check are the user's.

## What to change

- [x] `speedLines.ts`: pass `EffectComposer` a `WebGLRenderTarget` with
      `samples: 4` (half-float, as today), resized with the composer
- [x] Dispose it with the composer
- [ ] Confirm the finding first in a real browser (it was read from source only)
      — the user's, per the no-unrequested-live-checks rule
- [ ] Visual check — the user's

## Notes

- ADR 0074, research §8. The multisampled buffer costs more GPU memory.
- `renderer.getPixelRatio()` still applies — check the target's size
  follows it.

## As built

- `createSceneComposer(renderer)` in `speedLines.ts` builds a `WebGLRenderTarget` at the drawing
  buffer's pixel size (`getSize × getPixelRatio`), half-float, `samples: COMPOSER_SAMPLES` (4), and
  hands it to `EffectComposer`. The composer clones it for its second buffer, so both are
  multisampled, and frees both in `dispose`, which `SpeedLines.dispose` already calls.
- **The pixel-ratio trap the note warned about is real.** A composer given its own target takes the
  target's pixel size as its CSS size. `addPass` would then size every pass at the pixel ratio
  squared, and the next `setSize` would too. `createSceneComposer` calls `composer.setSize(width,
  height)` before any pass is added. Tests pin both: the buffers follow the pixel ratio on resize,
  and an added pass is sized once.
- Cost: two 4× multisampled half-float buffers instead of two single-sampled ones. Only the scene
  pass needs the samples, but the second buffer is the composer's clone, and keeping one code path
  was worth more than the memory.

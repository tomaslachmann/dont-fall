# 02 — The game client shares identical textures across Assets

**What to build:** the client's visual loader (`apps/client/src/render/assetVisuals.ts`,
`parseAssetVisual`) resolves textures with identical embedded image bytes and
sampling to one `THREE.Texture` for the session and releases each duplicate's
decoded bitmap at once — the twin of the builder's `shareTextures`
(`apps/track-builder/src/assets/assets.ts`), pinned by the client's own tests
like the other twin pair (`extractVisualRoot`).

**Decided (user, 2026-09-15):** yes — with ticket 01.

**Milestone:** M13 (`docs/milestones/M13.md`), next with M13/06 (user, 2026-09-17), ahead of 01. It is
also an upload-hitch fix (M13/06 builds on it), not only a memory one.

**Blocked by:** M13/03. ADR 0066 (the first shared image map) has landed, so
check whether texture handling moved before starting.

**Status:** done (2026-09-17), tests and typecheck.

## Why

370 of the 456 GLBs embed the same 1024² texture, 86 the same 256² one. Parsed
separately that is ~4 MiB of decoded RGBA per file (≈5.3 MiB on the GPU with
mipmaps) for what is two images (`docs/research/memory-bloat-investigation.md`).

## How it behaves after

- **In a Match:** however many KayKit pieces a Track uses, the pack texture is
  decoded once and uploaded to the GPU once; each extra piece costs only its
  geometry.
- **Looks:** identical — only textures whose bytes *and* sampling (colour
  space, channel, flipY, wrap, filters) match are merged.
- **Disposal:** a Track swap disposes the stage's clones but never a shared
  texture (templates own them for the session), so the next stage doesn't
  re-upload.
- **With 01:** 01 bounds how many files are parsed; 02 bounds what each costs.
  Either alone helps; together a Match holds a few MB of Asset art.

## Checklist

- [x] Client twin of `shareTextures`, applied in `parseAssetVisual`
- [x] Tests: two files embedding the same image resolve to one texture; a
      differing sampling does not merge; the replaced bitmap is closed
- [x] ~~Stage dispose never disposes a shared texture~~: not needed, see As built

## Notes

- Open alternative, not decided: move the pack texture out of every GLB into
  one shared image map served like ADR 0066's ice sheet. Breaks ADR 0050's
  self-contained GLB rule, so it would need its own ADR; the load-time dedupe
  here needs none.

## As built

- **No twin.** `shareTextures(gltf, cache)` moved from the builder into `packages/render`
  (`src/assets/shareTextures.ts`), which ADR 0074 created for three.js code the game and the
  builder share. The builder's `assets.ts` and the client's `render/assetVisuals.ts`
  (`parseAssetVisual`) both call it, each with its own session cache (`SharedTextureCache`). The
  logic is the builder's, unchanged: content key plus sampling, and the duplicate's bitmap is closed
  unless another slot in the same file still draws from it.
- **Tests** (`shareTextures.test.ts`, Node) parse real KayKit GLBs with a stubbed
  `createImageBitmap` and `self`:
  - two files resolve to one texture and the duplicate's bitmap is closed,
  - a differing `wrapS` stays apart,
  - a lone file is left as it was.
- **Disposal.** A Stage's scene sweep still calls `dispose()` on these textures on a Track swap.
  That frees only the old renderer's GPU copy; every Stage has its own `WebGLRenderer`, so the next
  one uploads the shared texture again anyway, and the bitmap is never closed by `dispose()`. So no
  "never dispose" rule is needed.
- **Still costly:** every file is still fetched and its image decoded before sharing. Ticket 01
  (Track-only loading) removes that.

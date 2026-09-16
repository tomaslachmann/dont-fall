# 02 — The game client shares identical textures across Assets

**What to build:** the client's visual loader (`apps/client/src/render/assetVisuals.ts`,
`parseAssetVisual`) resolves textures with identical embedded image bytes and
sampling to one `THREE.Texture` for the session and releases each duplicate's
decoded bitmap at once — the twin of the builder's `shareTextures`
(`apps/track-builder/src/assets/assets.ts`), pinned by the client's own tests
like the other twin pair (`extractVisualRoot`).

**Decided (user, 2026-09-15):** yes — with ticket 01.

**Blocked by:** the builder/Track work in progress landing (ADR 0066 adds the
first shared image map; check whether texture handling moved first).

**Status:** planned

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

- [ ] Client twin of `shareTextures`, applied in `parseAssetVisual`
- [ ] Tests: two files embedding the same image resolve to one texture; a
      differing sampling does not merge; the replaced bitmap is closed
- [ ] Stage dispose never disposes a shared texture (test via the scene sweep)

## Notes

- Open alternative, not decided: move the pack texture out of every GLB into
  one shared image map served like ADR 0066's ice sheet. Breaks ADR 0050's
  self-contained GLB rule, so it would need its own ADR; the load-time dedupe
  here needs none.

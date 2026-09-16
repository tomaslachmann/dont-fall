# 04 — The builder frees its WebGL contexts and preview geometry

**What to build:** whatever ticket 03 confirms, from these suspects: the
viewport and the shared thumbnail renderer release their contexts
(`dispose` + `forceContextLoss`) on detach and on a Vite hot update
(`import.meta.hot.dispose`); `attachPreview`'s cleanup disposes a procedural
preview's own geometry/materials (asset previews share the template's and must
not); the builder's `sharedTextures` cache survives or is disposed across a hot
update instead of silently restarting.

**Decided:** not yet — proposal (option F), waiting on 03's numbers.

**Blocked by:** 03.

**Status:** proposal

## How it behaves after

- Leaving the builder open for hours, with or without files being edited,
  keeps the same number of WebGL contexts (two: viewport + thumbnails) and a
  GPU upload count that only grows when a new Asset is first drawn.
- Switching Procedural ↔ Assets repeatedly returns to the same counters.
- No visible change: previews and the viewport draw exactly as before.

## Checklist

- [ ] Only the suspects 03 confirmed
- [ ] Tests for preview cleanup disposal (procedural disposes, asset clone doesn't)
- [ ] Re-run 03's scenarios; counters flat

# 03 — Measure the idle builder's memory in a real browser

**What to build:** confirm or rule out where the builder tab's memory goes while
idle, before changing builder code (ticket 04 depends on the answer).

**Decided (user, 2026-09-15):** the live measurement is approved ("Ano, změř
builder") — builder only, in the in-app browser against the running API; no
Track publishing, no `/play`.

**Blocked by:** the builder edits in progress (paused at the user's request).

**Status:** started, paused

## How to measure

- Install WebGL prototype counters in the page (they apply to existing
  contexts): contexts seen / lost, live buffers + bytes, live textures + bytes,
  programs; plus `performance.memory.usedJSHeapSize` and canvas count; sample
  every 30 s.
- Scenario A — idle: open the Assets tab, wait for every tile, then leave it
  15 min. Expect flat counters if the frame loop is clean.
- Scenario B — hot update: `touch`/save `scene/viewport.ts` (and a component)
  a few times, sampling after each. Expect contexts and uploads to climb if the
  HMR suspicion holds.
- Scenario C — tab switches Procedural ↔ Assets a few times (preview attach/
  detach).

## First findings (2026-09-15)

- Before the Assets tab opened: 282 canvases already mounted, JS heap ~19 MB.
- **The page reloaded itself twice within about a minute** (navigation type
  `reload`) with no source file changed in the preceding three minutes — the
  counters were lost both times. Find out who reloads it (Vite full reload,
  the browser pane, the app) before measuring again; a reload loop re-downloads
  all 101 MB of Assets each time, which alone would look like bloat on both
  sides.

## Checklist

- [ ] Explain the self-reload
- [ ] Scenario A numbers
- [ ] Scenario B numbers
- [ ] Scenario C numbers
- [ ] Findings appended to `docs/research/memory-bloat-investigation.md`;
      ticket 04 scoped (or closed) from them

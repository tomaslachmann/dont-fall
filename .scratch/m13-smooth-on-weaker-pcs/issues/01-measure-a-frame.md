# 01 — Measure a frame: the dev performance overlay

**What to build:** a dev overlay in the game that shows, while you play, how
long frames take and what each one costs. It also produces one summary a run
can be recorded from.

**Decided (user, 2026-09-17):** measurement comes first ("Nejdřív měření").

**Blocked by:** —

**Status:** done (2026-09-17). Tests and typecheck pass; the overlay has not been opened in a browser yet (the user's run, ticket 03).

## How it behaves after

- `?perf=1` on `/play` (a Match, or free-roam `?freeroam=1`) shows a small
  corner panel. Without the flag nothing is created and nothing is sampled.
- The panel shows, over a rolling window:
  - frame time p50 / p95 / p99,
  - the count of frames over 33 ms and over 50 ms,
  - draw calls, triangles, geometries, textures and programs.
- It also shows the sim steps and the replayed ticks in the last frame and the
  worst recent one, and corrections per minute.
- A key (or a button on the panel) copies a JSON summary of the run so far:
  - the whole-run stats,
  - the same stats per 50 m of Track progress along the course, so the
    wrecking-ball bridge, hammer alley and the fan climb can be read apart,
  - load time (Track pick → first frame) and bytes fetched,
  - `devicePixelRatio`, the canvas size and the user agent.

## What to change

- [x] A pure frame-stats helper (a ring buffer, percentiles, over-budget
      counts, per-bucket stats), tested without a DOM
- [x] `renderer.info`: set `autoReset = false` and reset once per frame, since
      the composer renders several passes and `info` would otherwise only hold
      the last one
- [x] `PredictionLoop` reports how many ticks a `step` ran and how many a
      `reconcile` replayed; tested
- [x] Wire it in `game/index.ts`'s frame (both the Match and the practice
      paths), reading `NetMetrics` for corrections
- [x] The overlay is plain DOM (ADR 0008) under `apps/client/src/hud/`, with
      its text built by a pure function like `hudText`
- [x] Load timing and bytes: `performance.getEntriesByType("resource")` for
      the asset URLs, or counted in `trackLoading.ts`

## Notes

- Research: "Measurement plan → Client metrics".
- Keep the per-frame cost negligible: no allocation per frame, and DOM text
  updated a few times a second, not every frame.
- The overlay must not change what it measures. It does not render through
  three.js.

## As built

- **The flag.** `?perf=1` on any game route turns the overlay on and remembers it on this device
  (`dontfall.perf.v1`), so it survives `/play` → `/lobby?port=`. `?perf=0` turns it off and forgets.
  `lib/perfFlag.ts` `resolvePerfFlag`. `<GameCanvas>` reads it once per mount and passes
  `GameConfig.perf` (practice gets it too). Off, no perf object exists and nothing is recorded.
- **The histogram.** `packages/shared/src/timing/durationHistogram.ts` `DurationHistogram`: fixed-width
  bins instead of a ring buffer, so a whole run fits in fixed memory. Percentiles read a bin's upper
  edge (0.1 ms for frames). Mean, max and the over-threshold counts are exact. The server's tick log
  (02) uses the same class.
- **The monitor.** `game/perfMonitor.ts` `PerfMonitor` is pure (no DOM, no three.js). It keeps a
  2 s rolling window, reset in place, and the whole run. It groups frames into 50 m × 50 m X/Z cells
  around the camera's target (not per Track progress), since that works on any Track and for the
  Spectator free cam. On the base race the cells read as z bands. It records:
  - frame time, over 17, 33 and 50 ms,
  - CPU time of the prediction steps and of `stage.render()`,
  - sim steps per frame,
  - replayed ticks, charged to the frame after the reconcile,
  - reconcile time and corrections per minute.
- **`PredictionLoop`.** `step` returns the ticks it ran; `ReconcileResult.replayedTicks` is the
  replay length.
- **The Stage.** `renderer.info.autoReset = false`, reset at the top of `render()`, so the shadow
  pass and every composer pass are counted. `Stage.readRenderStats(into)` copies calls, triangles,
  geometries, textures and programs.
- **The panel.** `hud/perfOverlay.ts` is a bottom-right panel. `hud/perfText.ts` builds its text
  (pure, tested). The text is rebuilt 4× a second.
- **Copying a run.** The panel's **copy run** button (clickable once Esc has released the mouse), or
  F8, logs the JSON summary to the console and tries the clipboard. The button came after the first
  try: on a Mac, F8 without fn is the media play/pause key and the page never sees it. While the
  overlay is up, `window.dontfallPerfSummary()` returns the same summary, for a console or a
  scripted browser. The summary (`dontfall-perf/1`) holds:
  - the context: user agent, `devicePixelRatio`, canvas size, cores, JS heap where Chrome exposes
    it, and the asset files and bytes this session downloaded (`TrackLoading.fetchStats`, decoded
    bytes; cross-origin transfer sizes are not readable),
  - load: boot → first frame, and the last live Track swap,
  - the run, and the cells in the order first reached.
- **The glue.** `game/perfSession.ts` connects the monitor, the panel and the Stage. Both boots
  create it only on the flag.

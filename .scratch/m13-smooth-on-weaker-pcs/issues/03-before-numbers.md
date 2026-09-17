# 03 — Before numbers

**What to build:** the recorded baseline every later M13 ticket is compared
against, taken before any optimisation lands.

**Blocked by:** 01, 02

**Status:** started (2026-09-17). The benchmark numbers are recorded; the browser runs are the user's.

## What to record

In `docs/research/gameplay-performance-culling-and-asset-loading.md`, under a
"Results" section, each with commit, machine, browser and quality level:

- [x] **Benchmark (run here):** ticket 02's output for 1 / 4 / 12 Characters (research note, "Results")
- [x] **Browser, dev Mac (the user's run):** the base race in free-roam, start
      to finish, at pixel ratio 2. Record 01's JSON summary with and without
      DevTools CPU throttling 4×.
  - [x] without throttling: 60 s, up to z ≈ −400, recorded 2026-09-17
  - [x] with 4× CPU throttling: 69 s, up to z ≈ −400, recorded 2026-09-17 (not full length)
- [x] ~~**Browser, the weaker PC**~~: skipped, since the user has none (2026-09-17). The 4×
      throttled Mac run stands in for a weak CPU; a weak GPU stays unmeasured.
- [ ] **Spectator free cam (the user's run):** fly the full length once
- [x] **Load (the user's run):** Track pick → first frame, bytes fetched, JS
      heap after load. Taken from the same run: 4.7 s, 460 files / 35.5 MB,
      167 MB heap.

## Notes

- Scenarios and metrics: research "Measurement plan". CPU throttling does not
  slow the GPU, so GPU conclusions need the real weaker machine.
- The weaker PC: none available (user, 2026-09-17), so it is skipped.
- Browser runs are live checks, and live checks are the user's
  (no-unrequested-live-checks). This ticket closes when the numbers are in the
  file, whoever took them.

## How to take a browser run

1. Open `/play?track=base-race&freeroam=1&perf=1`; the flag is remembered afterwards, `?perf=0`
   clears it. Run the course start to finish.
2. Press **Esc** to release the mouse and click **copy run** in the panel (bottom right). **fn+F8**
   does the same without releasing the mouse; plain F8 on a Mac is the media key and never reaches
   the page. The summary is logged to the console as `DON'T FALL perf summary` and copied to the
   clipboard. `dontfallPerfSummary()` in the console returns it too.
3. For the throttled run: DevTools → Performance → CPU 4× slowdown, then run again.
4. Paste each summary (or its `run`, `load` and `cells` parts) into the research note under
   "Before — browser", with the machine, the browser and the quality level (`high`; ticket 05 is not
   built yet).

# 05 — Track builder: local single-player playtest

**What to build:** Inside the builder tool, a playtest mode spawns a controllable Character (the
same shared `packages/shared` Rapier simulation the live game runs — no networking, no auth) on
the Track currently being edited, so a developer can walk/jump/dash through it before saving.

**Blocked by:** 04 (needs the builder + a Track to test against).

**Status:** done

- [x] A "Playtest"/"Stop playtest" toggle button spawns a controllable Character on the
      in-progress Track using the exact shared `RapierSimulation` + `advanceFixed` the live game
      runs (`playtest.ts`) — same movement/jump/dash feel, driven by a local `KeyboardInput`
      (WASD/Space/Shift), fixed (non-camera-relative) controls with a simple follow camera
- [x] Playtest is local-only — no server connection, no multiplayer, no auth; only `initPhysics`
      (Rapier WASM) and the same shared sim module the Match server/client both already use
- [x] Leaving playtest returns to edit mode without losing the in-progress Track (the edit
      viewport's canvas is hidden, not disposed, while playtest runs; `currentTrack` is untouched)
- [x] Manually verified live in a real browser (Playwright + Chromium): loaded the M1 seed Track,
      entered playtest, held W for 1.5s — screenshots confirm the Character walked from the start
      platform, across the narrow bridge (uniform-footprint chaining holds — no gap/fall), right
      up to the checkpoint-spinner platform's Spinner bar and Props. Stopped playtest and
      confirmed a clean return to the 6-Segment edit overview. Zero console/page errors

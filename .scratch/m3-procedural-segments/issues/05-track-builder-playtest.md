# 05 — Track builder: local single-player playtest

**What to build:** Inside the builder tool, a playtest mode spawns a controllable Character (the
same shared `packages/shared` Rapier simulation the live game runs — no networking, no auth) on
the Track currently being edited, so a developer can walk/jump/dash through it before saving.

**Blocked by:** 04 (needs the builder + a Track to test against).

**Status:** ready-for-agent

- [ ] A "playtest" toggle spawns a controllable Character on the in-progress Track using the
      shared sim step, with the same movement/jump/dash feel as the live game
- [ ] Playtest is local-only — no server connection, no multiplayer, no auth
- [ ] Leaving playtest returns to edit mode without losing the in-progress Track
- [ ] Manually verified: place a few Modules, playtest, confirm collisions and the uniform
      footprint chain correctly (no gaps, no overlap seams)

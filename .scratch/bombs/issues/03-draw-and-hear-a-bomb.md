# 03 — Draw and hear a bomb

**What to build:** the client plays the bomb's clips from the Snapshot row — rest, Tick,
Tick_Fast, Explode with its 0.14 s lead, then nothing — in the game and at rest in the builder;
tick and explosion sounds; the carrier's panel says it is a bomb and how long is left.

**Blocked by:** 02

**Status:** done on tests (2026-09-23)

- [x] `packages/render`: a bomb look that plays the clips from `(state, seconds)`
- [x] Game: Prop visuals of a bomb driven by the row; hidden while spent after the clip
- [x] Builder / thumbnails: rest pose, effects hidden
- [x] Sounds: fuse tick, fast tick, explosion (stand-ins); `Blast` cause cases
- [x] `HoldingPanel`: YOU HAVE A BOMB with the fuse

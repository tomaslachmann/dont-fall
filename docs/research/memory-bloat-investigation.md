# Memory bloat — builder tab and the Docker API (2026-09-15)

Reported: after a while idle ("AFK") in the Track builder with the API running,
memory bloats both in the browser and in Docker; expected to hit the game too.
Tickets: `.scratch/memory-footprint/issues/`.

## Measured

### The shared simulation does not leak

A Node probe ran `RapierSimulation` for 36,000 ticks (20 min of play): a real
`trap_trapball` swinging 60°/2 s over a ground deck, four Characters walking and
jumping under it, `snapshot()` + `JSON.stringify` every tick like the server loop.
1,288 Falls and knockdowns (ragdolls created and torn down throughout).

| tick | RSS MB | heap MB | external MB |
|---|---|---|---|
| 0 | 161 | 21.2 | 8.5 |
| 3,000 | 267 | 19.0 | 5.4 |
| 18,000 | 260 | 19.0 | 5.4 |
| 36,000 | 125 | 19.1 | 5.4 |

Heap flat, no WASM growth (RSS falls back). Server and client physics are clean.

### Every loader holds every Asset

- `assets/`: 456 GLBs, 101 MB.
- The full collision library (`loadAssetLibrary`, all 456 defs): 358,757
  collision vertices, 473,984 triangles, **+61 MB of JS heap per copy**
  (78.8 → 139.9 → 201.0 MB for three copies), ~100–200 ms from disk.
- Who loads all of it: every Match server at boot (`apps/server/src/matchServer.ts`,
  `fetchAssetLibrary`) — so every in-process Lobby in the API holds its own copy —
  and the game client on every game entry (`apps/client/src/game/trackLoading.ts`,
  `loadLibrary` + `loadVisualTemplates` over all `ASSET_MODULE_DEFS`), whose
  `fetchedBytes` map also keeps all 101 MB of raw bytes for the session. A Track
  uses a handful of them.

### Textures: one image, 370 copies

Every GLB embeds its pack's texture. Only **2 distinct images** across 456 files:
a 1024² PNG (38.6 KB) in 370 files and a 256² PNG (6.2 KB) in 86. `GLTFLoader`
decodes a fresh bitmap per file, so a loader that parses all of them holds
370 × 4 MiB ≈ **1.45 GiB of decoded RGBA** (≈5.3 MiB each once uploaded with
mipmaps). The builder already dedupes (`shareTextures` in
`apps/track-builder/src/assets/assets.ts`); the client's `parseAssetVisual` does
not. (Arithmetic from the counted files; not measured in a browser.)

### Docker API

- Idle it is flat: 191–194 MiB from 15:03 to 15:08 (15 s samples).
- But it had sent **2.13 GB in ~40 min**. The jump 1.87 → 2.13 GB between 15:03:21
  and 15:03:53 coincides with the host's `apps/server` (`tsx watch`, started 14:24)
  restarting its child at 15:03:37: each restart re-downloads all 456 GLBs
  (101 MB) from the API. `tsx watch` restarts on any change in its import graph,
  i.e. every edit to `packages/shared` by anyone. Per file the API allocates the
  bytes twice (`readFile` → `new Uint8Array` → `Buffer.from`); under glibc
  (`node:22-slim`) repeated 100 MB bursts tend to leave RSS fragmented rather
  than returned — the likely Docker growth mechanism (hypothesis, not measured).
- The container runs four processes for one service: `pnpm --filter start`
  (122 MB RSS), `tsx` cli (47 MB), the node app (144 MB), esbuild service
  (24 MB); cgroup anon 182 MiB.

### Builder (unconfirmed)

- The idle frame loop (`engine.frame`: clock → Motion panel → viewport
  `setMotionTime` → `previews.frame` → render) allocates nothing that
  accumulates, by reading.
- Suspects: a Vite hot update re-evaluating `scene/viewport.ts` creates a new
  thumbnail `WebGLRenderer` (module-level singleton) and a new viewport
  renderer without `forceContextLoss`, so old contexts and their uploads live
  until the browser reclaims them; `attachPreview`'s cleanup never disposes a
  procedural preview's `buildModuleGroup` geometry/materials; the builder's
  module-level `sharedTextures` cache restarts on hot update. While agents edit
  files, an "idle" builder receives a stream of hot updates.
- Live measurement (user-approved) started: WebGL prototype counters for
  contexts/buffers/textures/bytes plus `performance.memory`, sampled every
  30 s. Interrupted — the builder page reloaded itself twice within a minute
  with no source file changed in the preceding three minutes (navigation type
  `reload`); cause not yet known. Paused while the builder is being edited.

### Host housekeeping

Stale watchers with no children: `apps/server` `tsx watch` from Sep 7 and two
from Sep 8, and an `apps/track-service` watcher from Sep 7 (that service no
longer exists, ADR 0058). ~13 MB each.

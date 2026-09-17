# 01 — The game and the Match server load only the Track's Assets

**What to build:** every loader of a Track stops loading all 456 Assets. The
game client and the Match server fetch, parse and keep only the Asset Modules
the current Track places, each id at most once per loader (cached), and fetch
more lazily when a Lobby Track pick or a Round draw needs new ones.

**Decided (user, 2026-09-15):** yes — with ticket 02, first of the fixes.

**Milestone:** M13 (`docs/milestones/M13.md`), after M13 tickets 01–03 took the
before numbers (user, 2026-09-17: "Nejdřív měření").

**Blocked by:** M13/03. The ice-sheet work (ADR 0066) this used to wait on has
landed. `game/index.ts` and `practice.ts` carry uncommitted changes in the
working tree (2026-09-17), so check them before starting.

**Status:** done (2026-09-17), tests and typecheck. The browser after-run (bytes fetched, boot time) is the user's.

## Why

`docs/research/memory-bloat-investigation.md`: a full collision library is
+61 MB of heap per copy, held by every Match server (each in-process Lobby) and
by the game client; the client also parses all 456 visual templates (up to
~1.45 GiB of decoded bitmaps, ticket 02) and keeps all 101 MB of raw bytes for
the session. A Track uses a handful.

## How it behaves after

- **Entering a Match / free-roam:** the client downloads only the GLBs the
  Track's Segments name (a typical Track: a few files, a few MB), builds
  collision and visuals for those, and drops the raw bytes once both halves
  have parsed them.
- **Lobby Track pick / next Round on another Track:** the server and every
  client fetch only the Assets that Track adds; ones already loaded are reused,
  never refetched. A Round can't start on a Track whose Assets haven't loaded
  (same gate as the Track fetch today) — no half-built world.
- **Consistency (ADR 0050's fetch-once-per-loader):** still once per id per
  loader — a server never refetches an id mid-Match, so an art edit on the API
  can't split it from the world it built. What changes is *when*: the first
  time a Track needs an id, not at boot. The documented mid-fetch-edit window
  gets wider (a later Round's new Asset may be a newer revision than a boot
  fetch would have seen); acceptable, recorded in an ADR amending 0050.
- **A Track naming an unknown Module** fails exactly as today (`resolveTrack`
  throws naming it), before anything is simulated.
- **Builder:** unchanged — the Assets tab still lists every Asset (it needs
  them all for tiles; see 03/04).

## Checklist

- [x] Shared: `assetIdsOf(track)` (the asset Module ids a Track places) and a
      loader cache keyed by id (`loadAssetLibrary` for a given id set, merging
      into what's loaded)
- [x] Client `trackLoading.ts`: `loadLibrary`/`loadVisualTemplates` take the
      Track; `fetchedBytes` releases bytes after both halves parsed
- [x] Client Track swap (`game/index.ts` `loadTrack`) and `practice.ts` load
      the new Track's ids before building the stage and prediction world
- [x] Server: `matchServer.ts` boots with the boot Track's ids; `MatchRuntime`
      loads ids on a Lobby Track pick and for each drawn Round before
      `startNextRound` (the `matchStructurePromise` / `nextRoundReady` seam)
- [x] ADR amending 0050: per-id lazy loading, the wider edit window
- [x] Tests: a Track with two Assets fetches exactly two files (client and
      server); a Track swap fetches only the difference; a Round never starts
      before its Assets are in the library
- [x] Measured again: heap of a Match server booted on the asset demo Track
      vs. the full library (61 MB)

## Notes

- Also cuts the dev-loop cost: the host `apps/server` under `tsx watch`
  currently re-downloads all 101 MB on every restart (every `packages/shared`
  edit).

## As built

- **ADR 0080** (amends 0050): fetch once per id per loader.
- **Shared** (`track/assetModules.ts`):
  - `assetIdsOf(track)`,
  - `missingAssetIds(track, library)`,
  - `createAssetLibraryLoader(fetchBytes, baseUrl, onWarning?)`, whose `.load(ids)` resolves to
    every Asset loaded so far. Each id loads at most once, concurrent loads share a fetch, a failure
    is forgotten, and non-Asset ids are ignored.

  Tests: `track/assetLoader.test.ts`.
- **Server:**
  - `track/assetSource.ts` is now `createServerAssetLoader(url)`.
  - `startServer` loads `assetIdsOf(bootTrack)` and hands the loader to the runtime
    (`MatchConfig.assets`).
  - `MatchRuntime.loadAssetsFor(track)` merges into `library`, which is no longer `readonly`.
  - It is awaited in three places, each inside the existing try/catch, so a failed load is a failed
    fetch:
    - the Playtest `?track=` reload, which closes the socket with 4002;
    - `lobby.ts`'s `selectTrack`, which warns and keeps the current Track;
    - `buildMatchStructure` after each draw. That also calls `resolveTrack` on the drawn Track, so
      one that cannot resolve is a failed draw and the Round replays the current Track.
  - The draw's `library` is `MODULE_LIBRARY` plus `ASSET_PLACEMENT_MODULES` (defs only, enough for
    `hasFinishZone`).
  - `buildSimulationFor` throws "…has not loaded: <ids>".

  Tests: `match/matchRuntime.assets.test.ts`, which mocks `drawRound`.
- **Client:** `TrackLoading.loadLibrary(track)` / `loadVisualTemplates(track)`.
  - One download per `.glb` is shared by both halves, and the cache lets go of it once both have
    taken it.
  - Failed downloads and failed parses are forgotten, so a later load retries.
  - Textures (ice, mud, bounce) download directly, since their own caches already hold them.
  - Callers: Match boot, the live Track swap (`loadTrack`), practice.

  Tests: `game/trackLoading.test.ts`, now in the Node environment.
- **Measured** (Node heap after parsing, from real files):
  - the full library, 457 files: +60.8 MB;
  - the base race's 33 Assets: +7.4 MB.

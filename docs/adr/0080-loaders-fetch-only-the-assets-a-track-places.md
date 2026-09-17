# 0080 — Loaders fetch only the Assets a Track places

## Context

ADR 0050 (as amended on 2026-09-09) has every loader fetch the whole Asset
library through the API: the Match server at boot, the game client at Track
load. Its in-Match consistency rule is "fetch once per loader". The library has
since grown to 457 GLBs (32.5 MB), while the only seeded Track, the base race
(ADR 0078), places 33 of them (4.9 MB).

`docs/research/memory-bloat-investigation.md` and M13's before numbers
(`docs/research/gameplay-performance-culling-and-asset-loading.md`,
"Results") measured the cost:

- **Client:** 460 files and 35.5 MB downloaded on every game entry, a boot of
  4.7 s, and 9.6 s with the CPU throttled 4×.
- **Server:** a full collision library is 60.8 MB of heap in each Match
  server, and each API-hosted Lobby is one (ADR 0054/0058). The base race's
  own Assets are 7.4 MB.

The user decided on 2026-09-15 to load only a Track's Assets
(memory-footprint ticket 01); it ships in M13.

## Decision

**A loader fetches and parses an Asset the first time a Track it loads
places it, and never again. ADR 0050's "fetch once per loader" becomes "fetch
once per id per loader".**

- **Shared.**
  - `assetIdsOf(track)` lists the Asset ids a Track places.
  - `createAssetLibraryLoader(fetchBytes, baseUrl)` loads ids on demand:
    - each id at most once;
    - concurrent loads share one fetch;
    - a failed id is forgotten, so the next load retries it.
  - `missingAssetIds(track, library)` names the placed Assets a library lacks
    geometry for.
- **Match server.**
  - It boots with the boot Track's Assets.
  - `MatchRuntime.loadAssetsFor(track)` grows the library. Every path that
    builds a world on a new Track awaits it first:
    - a Playtest `?track=` reload,
    - a Lobby Track pick,
    - each drawn Round, inside the Match-structure build, so a Round cannot
      start before its world can be built.
  - A drawn Round whose Assets fail to load, or whose Track still does not
    resolve, counts as a failed draw and replays the current Track, as a
    failed fetch always has.
  - The draw itself asks only whether a Track has a Finish Zone, so it reads
    Module defs (`ASSET_PLACEMENT_MODULES`) and never waits on geometry.
  - `buildSimulationFor` refuses a Track whose Assets are not loaded, naming
    them, rather than failing inside `resolveTrack` with "unknown Module".
- **Game client.**
  - `TrackLoading.loadLibrary(track)` and `loadVisualTemplates(track)` fetch
    per id, with one download per file shared by the collision and visual
    halves.
  - The byte cache lets go of a file once both halves have taken it.
  - A live Track swap downloads only what the new Track adds.
- **Track builder:** unchanged. Its Assets tab still lists, and loads, every
  Asset.

## Consequences

- **The mid-fetch edit window ADR 0050 accepted gets wider.** A later
  Round's first use of an id can see a newer revision of that file than a
  boot-time fetch would have. A running world never changes, because an id
  already loaded is never fetched again. Art edits are rare and
  revision-pinned art still belongs to the content-pipeline milestone, so
  this is accepted.
- **Per Track:**
  - a Match server holds only the Assets its Tracks have used, 7.4 MB on the
    base race;
  - a client downloads only the Track's files.
- **A Track swap or a drawn Round now waits on the network** for Assets it has
  not seen. The Round-start gate (`nextRoundReady`) already waits on the
  Match structure, and it now covers this too.
- **Out of scope:** Lobbies in one API process still each hold their own copy
  (memory-footprint ticket 06), and `/assets` still has no HTTP cache
  validators (ticket 05).

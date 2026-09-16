# 01 — The game and the Match server load only the Track's Assets

**What to build:** every loader of a Track stops loading all 456 Assets. The
game client and the Match server fetch, parse and keep only the Asset Modules
the current Track places, each id at most once per loader (cached), and fetch
more lazily when a Lobby Track pick or a Round draw needs new ones.

**Decided (user, 2026-09-15):** yes — with ticket 02, first of the fixes.

**Blocked by:** the builder/Track work in progress (ice sheets, ADR 0066) landing.

**Status:** planned

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

- [ ] Shared: `assetIdsOf(track)` (the asset Module ids a Track places) and a
      loader cache keyed by id (`loadAssetLibrary` for a given id set, merging
      into what's loaded)
- [ ] Client `trackLoading.ts`: `loadLibrary`/`loadVisualTemplates` take the
      Track; `fetchedBytes` releases bytes after both halves parsed
- [ ] Client Track swap (`game/index.ts` `loadTrack`) and `practice.ts` load
      the new Track's ids before building the stage and prediction world
- [ ] Server: `matchServer.ts` boots with the boot Track's ids; `MatchRuntime`
      loads ids on a Lobby Track pick and for each drawn Round before
      `startNextRound` (the `matchStructurePromise` / `nextRoundReady` seam)
- [ ] ADR amending 0050: per-id lazy loading, the wider edit window
- [ ] Tests: a Track with two Assets fetches exactly two files (client and
      server); a Track swap fetches only the difference; a Round never starts
      before its Assets are in the library
- [ ] Measured again: heap of a Match server booted on the asset demo Track
      vs. the full library (61 MB)

## Notes

- Also cuts the dev-loop cost: the host `apps/server` under `tsx watch`
  currently re-downloads all 101 MB on every restart (every `packages/shared`
  edit).

# 01 — New pieces build on the last platform

**What to build:** placing an Asset without Sockets in the Track builder builds on the Track instead
of dropping it beside the previous piece with a gap. A new platform continues the run flush; anything
else stands on the last platform.

**Blocked by:** —

**Status:** done (2026-09-16) — tests and typecheck. Feel check in the builder — the user's.

## Decisions (user, 2026-09-16)

Asked: *"když placnu obstacle tak ho chci dát na poslední položený platform doprostřed stejně i s
gatama atd. a když pokládám nový platform, chci ať se dá přesně za poslední platform bez mezery."*
Settled in a follow-up round:

- **A new platform** goes flush off the last platform's far face and **continues in whatever
  direction that platform is turned** (not always world −Z), taking its turn, with the two tops
  level.
- **Everything that is not a platform** (obstacles, gates, Springs, scenery) stands on the
  **middle of the last platform's top**, turned the same way.

## What to change

- [x] `trackEdit.ts`: the placeholder a new unchainable Segment starts at (`placementFor`) builds
      on the last `platform`-category Segment at or before the insert point
- [x] The engine passes each Asset's category (`assetCategoryById`) to `insertSegment`
- [x] Tests: flush and level at three turns, the last platform's own scale, a non-platform centred
      on top, skipping pieces placed after the platform, mid-Track insertion, the fallbacks, and
      Socket chaining still winning

## As built

- `insertSegment(track, modules, index, moduleId, categories = {})` and `appendModule(…, categories)`.
  Without categories, or with no platform at or before the insert point, the old fallback stands
  (clear of the previous piece along +X). `duplicateSegment` passes none, so a duplicate still lands
  beside its original rather than on top of it.
- Everything is measured from footprint bounds, the same boxes overlap and Socket-snap read, in the
  platform's own frame (its scale, its yaw), then turned into the world. A new platform's `+Z` face
  meets the last platform's `−Z` face, and their centres share one line across. A pitched or rolled
  platform is measured as if level, and only its yaw is copied.
- "Last platform" means the last one **at or before the insert point**, so with a Segment selected
  (placement inserts after the selection) it builds on the platform the selection is at or after, not
  on the end of the Track.
- Socketed pieces still chain by their Sockets: `rechainFrom` replaces the placeholder whenever the
  previous Segment has an exit and the new one an entry.

# 07 — After numbers, and the physics decision

**What to build:** the same measurements as 03, taken again once 04–06 and
memory-footprint 01/02 have landed. From them, one decision per deferred
lever: build it (a new ticket, and an ADR where noted) or close it as not
needed.

**Decided (user, 2026-09-17):** physics distance activation is designed only
if the numbers ask for it ("Až podle měření").

**Blocked by:** 03, 04, 05, 06, memory-footprint/01, memory-footprint/02

**Status:** ready for the after runs (2026-09-17). 03's before numbers are in, and 04, 05, 06 and memory-footprint 01/02 are built.

## What to record

- [ ] 03's benchmark and runs repeated. Browser runs are the user's, at
      each quality level on the dev Mac with 4× CPU throttling (no weaker PC is available,
      2026-09-17).
- [ ] Against the research's proposed budgets:
  - client p95 ≤ 16.7 ms at `high` on a mid machine,
  - the throttled Mac p95 ≤ 33 ms at `low`, with < 1 % of frames over 50 ms,
  - one client `tick()` ≤ 2 ms p95,
  - server tick p99 ≤ 10 ms with 12 Characters,
  - game entry on the base race ≤ 5 MB transferred.

## The decisions

- [ ] **Distance activation of Moving Segments** (research §3–§4,
      recommendation #9). The before numbers (03) already point to "not
      needed": at 12 Characters, moving vs still is ~0.1 ms of a ~1 ms tick,
      and the switching itself is ~0.01 ms. Open a design only if 02's numbers show that
      `world.step()` or the per-tick Moving Segment switching is a real share
      of a tick (or of a replay frame). The design needs an ADR: it touches
      the shared-step invariant and ADR 0003/0005/0061. If the switching
      alone is hot, try a cheaper mechanism first (recommendation #8).
- [ ] **`BatchedMesh` for still KayKit Segments** (recommendation #10), only
      if draw calls are the bottleneck after 02-textures
- [ ] **Raycasts through Rapier `castRay`** (recommendation #11), only if
      the camera arm or floor probe shows up in the profile
- [ ] **The Characters' own sweeps** (found by 03's benchmark, not in the
      research): at 12 Characters `beginTick` averages 0.4–1.4 ms per tick, the
      largest part of the whole tick (0.5–1.3 ms p50), and it grows faster
      than the Character count. Profile what inside the controller sweep
      costs (Character vs Character, ragdoll bones, trimeshes) and bring
      options to the user.
- [ ] **Snapshot serialisation** (03): twelve `JSON.stringify` calls of
      near-identical payloads cost 0.43–0.72 ms p95, about as much as the
      step. Serialising the shared part once is a candidate. It touches the
      Match loop only, not the protocol.
- [ ] Whatever is still over budget at `low`: name it from the numbers and
      bring it to the user. Don't pick a fix unasked.

## Notes

- A lever closed here is recorded in the research note's "Results" with the
  numbers that closed it, so it isn't re-proposed later.

## What the after runs should show (from what was built)

- **Load** (memory-footprint 01): `assetFiles` 33 GLBs plus the three sheet textures, instead of
  460. `assetBytes` about 5 MB, instead of 35.5 MB. `bootMs` below 4.7 s unthrottled and 9.6 s
  throttled, even though it now includes the warm-up.
- **Hitches** (06, memory-footprint 02): no frames over 50 ms in the first 100 m (4–6 before), and
  none where the belt climb first shows (93 ms before). `textures` in the overlay should drop well
  below 41 once the KayKit copies are shared.
- **Triangles** (04): the busiest frame should fall below 550 k, since nothing past 180 m is drawn
  any more.
- **Levels** (05): the same run at `medium` and at `low`, throttled, against the 17 / 33 / 50 ms
  counts.

## Progress (2026-09-17)

- [x] After run at `high`, unthrottled, whole course, in the research note ("After — browser").
  Load is 0.74 s with 36 files / 6.5 MB, p99 17.7 ms, one frame over 50 ms, 14 textures.
- [ ] `medium` / `low` with 4× CPU throttling
- [ ] Spectator free cam
- Found: the one remaining start hitch (166 ms) is likely content added after the warm-up, the
  account's hat and skin tint (unverified). A follow-up for 06, to bring to the user: warm up
  whatever the wardrobe puts on a rig.
- Measurement note: the overlay's "over 17 ms" count is dominated by 60 Hz vsync jitter
  (17.1–17.7 ms frames). A 20 ms first threshold would separate real misses; changing it breaks
  comparison with the before runs' counts.

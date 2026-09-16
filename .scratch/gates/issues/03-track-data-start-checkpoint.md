# 03 — Track data: Start, numbered Checkpoints, finish signs, respawn floors

**What to build:** `Segment.start` and `Segment.checkpoint { order, respawn? }`
with validators; `resolveTrack` emitting gate Checkpoints (sorted: retired
Modules in Track order, then gates by number), finish-sign Finish Zones, and
the default respawn found by probing still geometry under the opening;
`trackSpawn` on the Start; publish validation.

**Blocked by:** 01.

**Status:** done (2026-09-15) — tests; the live check is the user's

## How it behaves after

- **Start:** the spawn grid stands on the Start Segment's deck, turned with
  it; with no Start, the first Segment as today. A second Start, or a Start on
  a moving Segment, is refused at publish with the Segment index.
- **Checkpoint:** only on a gate Asset whose role is `checkpoint`, with a
  whole number ≥ 1; refused on anything else, on a moving Segment, or twice
  with the same number.
- **Respawn:** a chosen spot wins; otherwise the floor just in front of the
  gate, on the side runners arrive from (previous Checkpoint, else the spawn),
  and behind it when that side is a drop — never straight under (a hoop's
  post). No floor and no spot → the gate is left out of the Checkpoints with a
  warning naming it; the Track still plays.
- **Finish:** every placed finish sign is a Finish Zone; a Track with one is
  raceable (`trackHasFinishZone`). A finish sign with Motion is refused.

## Checklist

- [x] Types + `invalidStartReason` / `invalidCheckpointReason`; API validation
      (one Start, unique numbers, gate-only, no Motion on start/checkpoint/finish)
- [x] `resolveTrack`: gate checkpoints + finish zones, legacy ordering, warnings
- [x] Pure floor probe (ray vs oriented boxes and trimeshes of still Segments,
      excluding the gate's own)
- [x] `trackSpawn(track, index, modules)` on the Start (deck top), callers in
      server, client practice; spawn facing for the camera
- [x] Tests for each rule above

## Notes

- `trackSpawnYaw` is the camera's yaw (−the Segment's), set on the game's and
  free-roam's camera at boot and on a Lobby Track swap.
- The Countdown's checkpoint count now includes gate Checkpoints (asset
  placement halves joined to its library).
- A Start's spawn height is 1.2 above its highest collision (M1's own) — a
  Start on a hoop spawns on top of the hoop, which is the author's call.

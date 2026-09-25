# 02 — A bomb lights, goes off and comes back

**What to build:** the simulation half of ADR 0126 — a bomb Segment is a Prop, a pick-up
lights it, it goes off on its Tick (Characters get a `Blast` Impact with falloff, Props a
push), is spent and returns home; below the kill plane it goes out. The Snapshot carries
the non-lying bombs; the last holder is credited.

**Blocked by:** 01

**Status:** done on tests (2026-09-23)

- [x] Tuning (`tuning/fight.ts`): fuse, warn, return defaults; blast radius, impact centre/edge, Prop speed
- [x] `track/Bomb.ts`: def, timing, validation; the `bomb` Attachment in the registry
- [x] `resolveTrack`: a bomb Asset is a Prop; `PropConfig.bomb`
- [x] `simulation/Bombs.ts`: lying / lit / spent, lit and re-held on pick-up, blast, return, kill plane
- [x] `RagdollCause` `"Blast"` (throws, shoves); credit to the last holder, never to oneself
- [x] `SimState.bombs`; `PropSnapshot.live` on a bomb; a client applies the rows
- [x] Tests (shared)

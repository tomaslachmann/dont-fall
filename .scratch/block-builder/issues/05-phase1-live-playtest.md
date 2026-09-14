# 05 — Phase 1 live verification (cuboid + wedge track)

**What to build:** Nothing new — prove phase 1 in the real pipeline: a
playable Track built only from parametric blocks, authored in the builder,
walked in a real client against a real match server.

**Blocked by:** tickets 01–04.

**Status:** planned

## Why

M5 ticket 08, M6.1, and M4.5 all found their real bugs in live verification,
never in vitest. A parametric block that works in unit tests but desyncs
between predicting client and server is worse than no block builder.

## What to change

- [ ] No code. Author a test Track in the builder: stretched cuboids,
  side-by-side flush joints, a stacked column, a `<= 35°` wedge ascent, a
  `>= 60°` wedge wall (must block), a bare step-up at exactly
  `MAX_JUMP_HEIGHT` and one above it (warning check)
- [ ] Publish → load on match server → walk it in two real browsers:
  flush joints have no visible seams or hitches, stacking stands, wedge
  ascent walks without jumping, wall blocks, jumps match the measured height

## Done when

- [ ] Two-browser walkthrough of the block-built Track against one
  never-restarted server: no desync, no ghost overlaps, results screen
  reachable (raceable, if the Track carries a Finish Zone)
- [ ] Every bug found here is filed against the ticket that owns it (01–04),
  fixed there, and re-verified here — this ticket closes only on a clean run

## Watch out for

**"Verified" means the thing asked for works — not that everything around it
is healthy.** A pre-existing failure elsewhere (lobby, unrelated Module) is a
finding for its own ticket, not a blocker here. Record it, move on.

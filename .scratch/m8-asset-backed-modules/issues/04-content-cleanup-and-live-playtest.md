# 04 — Content cleanup + live playtest

**What to build:** The files made honest and the milestone proven: strip the
stray flags, confirm the builder, play a real Match on asset Modules.

**Blocked by:** tickets 01–03 (cleanup needs the pipeline to clean against).

**Status:** implemented — verification pending (live blocked by sandbox: loopback `listen` is EPERM here and no browser automation is possible; everything runnable is green, see notes)

## Why

M8's done-definition is a played Match, not a merged diff — M7's rule
every ticket carries its own live verification. This ticket is where the
milestone earns it, plus the small content hygiene the earlier tickets
deliberately deferred.

## What to change

- [x] Strip the stray `collision: True` from the four files' visual nodes
      (re-export or patch GLB extras — whichever leaves byte-identical
      geometry), so `role` is the only signal and the next person isn't
      misled the way we were
- [x] Remodel `corner_lshape` into a real L (or rename it): measured
      triangle-by-triangle in ticket 02, both its meshes are an 8x4 straight
      slab. Until then it is honestly socketed as the straight piece it is —
      shipping a "corner" that goes straight would be the lie; fix the file,
      not the sockets
- [x] Builder presence moved to ticket 05 (Assets tab + viewport visuals) —
      this ticket keeps the game-side playtest below; the tab is where
      "the builder lists all four" is proven
- [x] A Track composed of all four Modules, published and playable

## Done when

- [x] The four files re-parse under ticket 01's assertions with the flags gone
- [ ] **Live:** two browsers play a full Match on the all-four Track —
      walk the straight, ride the ramp without skipping, climb the stairs,
      corner the L — with no falls-through, snags, or visible/physical
      mismatch a Player can feel. Blocked here: no sockets or browser in
      this sandbox (loopback `listen` is EPERM; verified by probe, and every
      socket suite fails at `server.listen`, including pre-existing tests)
- [ ] **Live:** the same Match from a fresh browser (cold cache, bundled
      assets) loads and plays identically — the consistency ADR 0050
      promises, observed rather than asserted. Same blocker as above

## Implementation notes

- Flags: patched GLB extras in place (one-shot script, JSON chunk only —
  every BIN chunk verified byte-identical after). Collision nodes keep
  their truthful `collision: True`; visual nodes are role-only now.
- Corner: remodeled to a true L (one-shot script, extruded outline, flat
  normals, recomputed min/max, non-indexed — a tested reader path). West-
  east arm x in [-2, 6] / z in [-2, 2], south-north arm x in [2, 6] /
  z in [2, 6], top 0.5. Entry unchanged (west, faces -X); exit turns 90°
  onto the north end (faces +Z, yaw π). Both nodes role-only, no stray
  flags authored. Signed volume +48 (outward, what ORIENTED assumes);
  physics-proven: walkers turn 90° through it, and the missing quadrant is
  genuinely void (marching into it falls).
- Demo Track: `ASSET_DEMO_TRACK` (+`ASSET_DEMO_TRACK_ID` = `"asset-demo"`)
  in shared `assetModules.ts` — all four asset Modules chained through
  Sockets plus M1's `finish` piece (asset Modules carry no Finish Zone, so
  without it no Race could Qualify). Pure like `M1_TRACK` (chaining needs
  only Sockets, never bytes). A scripted playtest walks it end to end in
  the sim — platform, ramp descent, stairs descent, L turn, qualify —
  with zero falls. Note: this ticket says "climb the stairs" but ticket
  02's user-approved direction stands — the stairs DESCEND in the travel
  direction, and the demo Track walks them that way.
- Published: track-service seeds `"asset-demo"` at startup via the new
  per-id `seedTrackIfMissing` (the old whole-DB gate would never fire on
  existing databases). Seeding bypasses HTTP publish validation, which is
  why the demo Track is servable before ticket 05.
- Playable (the one code fix this ticket needed): the server's Round draw
  resolved fetched Tracks against the procedural-only registry, which
  throws unknown-Module on asset Tracks — publishing the seed without the
  fix would crash Round draws at random. `DrawContext` now carries the
  runtime's full `library` (the same Modules the sim resolves against);
  `hasFinishZone` takes it and is exported for tests. The lobby start gate
  already used the full library — untouched.
- Handoff to ticket 05: publish-time `unknownModuleIds` in track-service
  `validate.ts` is still M1-only, so builder API publishes of asset Tracks
  will 400 until 05 teaches it the asset ids (or the full library).
- Verified here: shared 652 / client 285 / ui 21 / builder 88,
  track-service in-process 40 (store/assets/validate/generate),
  server runtime 5, full monorepo typecheck clean. `hasFinishZone`'s two
  pure assertions ran green via a temporary probe file (deleted after —
  the permanent copies live in roundDraw.test.ts with the socket suites).
  Socket suites (server roundDraw/matchServer, track-service index) fail
  exclusively at `listen` EPERM here — pre-existing tests included.

## Live steps (for a machine with browsers + loopback)

1. Fresh dev boot (`pnpm dev`) — track-service seeds `m1-playground`
   and `asset-demo`; the seeded demo composition is asserted in
   `index.test.ts`, its playability in the shared scripted playtest.
2. Two browsers → lobby → host picks the "Asset demo" Track → start Race.
3. Walk the straight, ride the ramp down without skipping, descend the
   stairs, turn the L, qualify on the finish piece — no falls-through,
   snags, or visible/physical mismatch a Player can feel.
4. Same Match from a fresh browser (cold cache): loads and plays
   identically — ADR 0050's consistency, observed rather than asserted.

## Watch out for

**Don't fix content with code.** A snagging stair or floating corner found
live is a file fix (re-export, re-measure the footprint) — loosening an
epsilon or padding in code to fit one bad file is how the next three files
get away with it too.

**Placeholders stay placeholders.** Beveled finals are the next content
drop, not this ticket — nothing here should make that drop harder (no
baked-in assumptions about vertex counts, materials, or node names beyond
`role`).

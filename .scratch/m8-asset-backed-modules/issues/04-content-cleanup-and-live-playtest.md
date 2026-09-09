# 04 — Content cleanup + live playtest

**What to build:** The files made honest and the milestone proven: strip the
stray flags, confirm the builder, play a real Match on asset Modules.

**Blocked by:** tickets 01–03 (cleanup needs the pipeline to clean against).

**Status:** planned

## Why

M8's done-definition is a played Match, not a merged diff — M7's rule
every ticket carries its own live verification. This ticket is where the
milestone earns it, plus the small content hygiene the earlier tickets
deliberately deferred.

## What to change

- [ ] Strip the stray `collision: True` from the four files' visual nodes
      (re-export or patch GLB extras — whichever leaves byte-identical
      geometry), so `role` is the only signal and the next person isn't
      misled the way we were
- [ ] Remodel `corner_lshape` into a real L (or rename it): measured
      triangle-by-triangle in ticket 02, both its meshes are an 8x4 straight
      slab. Until then it is honestly socketed as the straight piece it is —
      shipping a "corner" that goes straight would be the lie; fix the file,
      not the sockets
- [ ] Builder presence moved to ticket 05 (Assets tab + viewport visuals) —
      this ticket keeps the game-side playtest below; the tab is where
      "the builder lists all four" is proven
- [ ] A Track composed of all four Modules, published and playable

## Done when

- [ ] The four files re-parse under ticket 01's assertions with the flags gone
- [ ] **Live:** two browsers play a full Match on the all-four Track —
      walk the straight, ride the ramp without skipping, climb the stairs,
      corner the L — with no falls-through, snags, or visible/physical
      mismatch a Player can feel
- [ ] **Live:** the same Match from a fresh browser (cold cache, bundled
      assets) loads and plays identically — the consistency ADR 0050
      promises, observed rather than asserted

## Watch out for

**Don't fix content with code.** A snagging stair or floating corner found
live is a file fix (re-export, re-measure the footprint) — loosening an
epsilon or padding in code to fit one bad file is how the next three files
get away with it too.

**Placeholders stay placeholders.** Beveled finals are the next content
drop, not this ticket — nothing here should make that drop harder (no
baked-in assumptions about vertex counts, materials, or node names beyond
`role`).

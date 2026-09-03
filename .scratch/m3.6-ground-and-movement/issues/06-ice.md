# 06 — Ice: a Surface you can't get a grip on

**What to build:** A Character accelerates slowly on ice and slides straight past the turn it meant
to make.

**Blocked by:** 01 (the Surface path this rides on) and 05 (before velocity persists there is
nothing for a grip scalar to multiply).

**Status:** blocked

- [ ] One scalar per Surface multiplies **both** acceleration and drag — the model Source uses,
      reading the value off the surface and scaling its friction and acceleration constants alike
- [ ] **Ice leaves top speed unchanged.** Near-zero acceleration, near-zero drag. Neither Quake nor
      Source alters max speed for slick surfaces; the feel of ice is carried by acceleration and turn
      authority. "Ice makes you faster" is the intuitive answer and it is the wrong one
- [ ] Mud (ticket 01) is re-expressed in the same one-scalar terms where it fits, so the two Surfaces
      are one mechanism rather than two special cases
- [ ] One demo Module, visually identical to existing floor pieces
- [ ] Manually verified live: a Character accelerates slowly and overshoots its turn on ice, on a
      hand-authored Track containing both ice and mud

# 02 — One Segment, several bodies

**What to build:** Parts become real: one placed Segment resolves into one body
per Part, with moving Parts posed by the Tick. Proven by the sweeper end to
end — a base that stands still and arms that sweep, authored as one piece,
ridden and hit by the rule M11 already has. ADR 0116.

**Blocked by:** 01

**Status:** done on tests (2026-09-21) — every visual and feel check is the user's

- [x] `AssetModuleDef.parts` is read by `resolveTrack`: `segmentBody` answers per
      Part, `resolveCollision` bakes the `still` Parts into the statics, and
      `resolveModuleBodies` emits one moving body per `moving` Part. A def with no
      Parts resolves byte-identically to today — hold that with a test over the
      existing Tracks
- [x] A moving Part's pose is the Segment's placement composed with the Part's own
      Motion in the Part's local frame, so a sweeper placed on a slope sweeps along
      the slope
- [x] The Segment's `motion` Attachment addresses its moving Parts, defaulting to
      the def's authored Motion. An unset Motion on a parted Asset still moves —
      placing a sweeper and pressing play is enough
- [x] The client draws a moving Part from the replicated pose exactly as it draws a
      Moving Segment today (the path ADR 0095 already shares with Props); the
      builder's viewport previews it the way it previews Motion
- [x] The builder's MOTION panel edits the Part's numbers when the selected Segment
      is a parted Asset, and the MCP `set_motion` tool reaches the same values
- [x] The overlap check (ADR 0106) reads the Parts' rest poses, so a sweeper placed
      through a wall is still caught
- [x] Tests (shared): a sweeper Segment resolves to one static body and one moving
      body; its rotor's pose at Tick *n* matches the authored rate; riding the base
      is unaffected by the rotor; an arm sweeping into a Character applies the M11
      Impact; every existing Track's resolve output is unchanged

## Notes

- The sweeper's arms pass at y 0.38–1.32 and a Character is 1.7 m tall: it can be
  neither ducked nor comfortably jumped (apex ~1.3 m, ADR 0092). That is the
  author's problem to solve with placement and rate, not the engine's — but it is
  worth saying out loud in the live check.
- "Mechaniku neměníme" (the user, 2026-09-21): an arm is an ordinary Moving
  Segment. No spiked flag, no new knockdown rule.

## As built

- **`segmentBodies(segment, module)`** is the one place the split is decided, in
  `resolveTrack.ts` beside `segmentBody`, and `resolveCollision` is a loop over what it
  answers. The client's still visuals and the overlap check read it too, so three places
  that must agree about what moves now ask the same function.
- **A `moving` Part with no Motion is still.** That one rule is what let ticket 01's
  shooter keep its declared Parts without pretending to aim: it resolves exactly as it
  did, and ticket 05 gives its pivots their sweep. It also gives an author a static
  sweeper by clearing its Motion, which nothing else would have.
- **An Asset with no moving Part resolves as one piece**, so a Motion attached to a
  fragile block still moves the whole tile — the behaviour every Asset had before Parts
  existed, held by its own test.
- **`assetPartSubtree` keeps a dropped ancestor's transform** as an empty node. Without
  that, a nested Part (a barrel inside its carriage) would be re-seated at the Asset's
  origin the moment its parent was not drawn — measured in its own test, before the
  shooter ever needs it.
- **The overlap check became per body**, which fixed two opposite bugs at once: an
  author's Motion on a sweeper used to swing its *base* through the scenery (false
  positives), and a sweeper running its Asset's own Motion was only ever posed at rest,
  so what its arms reach on the way round was never checked (false negatives). A pair of
  Segments is still reported once, at its deepest.
- **What the arm actually does, measured:** at the authored 1.246 rad/s a Character
  2.6 m out is *carried round the circle*, not knocked down — 3.2 u/s against
  `MOVING_SEGMENT_STAGGER_SPEED`'s 6.67. Turn it up to 6 rad/s and it knocks down. That
  is ADR 0061's speed-gated rule doing its job, and it makes the authored rate a feel
  question for the live check rather than a settled one.
- **Rough edge, deliberately left:** a deck Attachment (ice, mud, a belt) on a parted
  Asset parents to its first moving body, because the renderers find a carrier by
  Segment index. Nothing ships one; the four DF traps carry no decks.
- **Not built here:** nested moving Parts do not compose their poses yet — the shooter's
  barrel inside its carriage is ticket 05's, and nothing moves either of them until then.

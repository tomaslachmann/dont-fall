# 0106 — No authored piece sits inside another

## Context

The user, on 2026-09-18, about the two code-authored Survival arenas: their
pieces overlapped, "pak to glitchuje v renderu a není to hezké" (it glitches in
the render and isn't pretty), so redo them.

Both arenas had been built on overlap:

- Cog Arena's six petals each sank three metres into the hub, deliberately,
  so the floor would be continuous. Its two arms crossed through each other at
  the middle, and its pistons slid through the spiked wheels and bumpers.
- Sky Rings' spokes and outer bridges were long planks laid across the hub's
  and the rings' rims, and its bars swept through flags, balls and wheels.

Decks overlapping at the same height share a top face, and the two fight over
every pixel of it. Anything moving through something else clips visibly.
Measured, the arenas had 144 and 159 overlapping pairs, from 3 cm to 3 m deep.

## Decision

**A code-authored Track places no Asset inside another, at rest or anywhere
its Motion takes it.** `track/trackOverlaps.ts` measures this, and
`survivalArenas.test.ts` holds both arenas to zero.

- **What "inside" means.** Every Asset is measured as its authored solid
  parts (ADR 0065). A pair overlaps when one is sunk more than 10 cm into the
  other. The 10 cm belongs to the fit, not the placement: a solid box is
  fitted a few centimetres proud of its mesh (a `platform_4x2x1`'s runs 4 cm
  past each end), and the real overlaps ran from 30 cm to 3 m. Touching
  faces never count, so a deck butted against the next or a flag stood on a
  deck is fine.
- **Motions are walked.** A Segment with a Motion is posed at 60 instants,
  0.2 s apart. A bar that clears a piston at rest but clips it on the way
  round is caught.
- **Round floors come from the sized quarters.** `flatDisc` builds a disc from
  the ADR 0100 quarter pieces. It is a slab of constant thickness, so a
  straight deck can butt against its rim. Where a straight edge meets a round
  one, it touches at its middle and leaves a notch of a few centimetres at the
  corners, which is the price of not sinking into it.
- **Moving barriers ride 5 cm above the deck** instead of 2 cm. Their
  collision boxes run proud of the mesh too, and at scale that fit reached the
  deck.

The arenas were rebuilt to this rule. After a first pass left Cog Arena
under the "100+ Segments everywhere" brief, the user asked for both to be
redone properly: pretty, sensible for Survival and fun (2026-09-18).

- **Cog Arena** is a machine on three levels, so a shove is the start of a
  comeback and not only the end of a Round:
  - **The cog.** A round hub, with a tall bar through the middle that is
    never jumped and two metre-tall sweepers on its outer band that always can
    be (Jump Club's game). Around it, eight square teeth butted against its
    rim: the Start, ice, mud, bounce, two belts running outward into spiked
    wheels, and two plain ones. Pistons stand on five of them.
  - **The ledges.** Eight inflatable outcrops in the notches, 1.5 m down.
    Landing on one bounces you back toward the cog.
  - **The rim.** A ring of 24 planks, 2.5 m down, with two low bars running
    round it. It catches a Player thrown off a tooth's tip, and from anywhere
    on it a ledge is one jump up.

  Its Start tooth is the one place nothing moves, and so the place everyone
  fights over. That makes 103 Segments.
- **Sky Rings** keeps its wheel, now 132 Segments. The spokes and bridges run
  from rim to rim. Every bar on a spoke or a plain ring is a metre tall and can
  be jumped: the old 1.5 m ones could not be since ADR 0092's jump, whatever
  their comment said. The plain rings' single tall bar became two low halves
  end to end. The ice, mud and bounce rings get two spiked wheels and a bumper
  instead of a bar. The hub is the one floor nothing sweeps.

`survivalArenas.test.ts` also walks the loops that make them play, with every
Motion stopped. For Cog Arena: off a tooth's tip onto the rim, up a ledge and
back onto the hub. For Sky Rings: over a spoke's bar and a ring's pair. It
also holds both arenas to 100 Segments or more.

## Considered options

- **Measure the render meshes instead of the solid parts.** That would be
  exact, but meshes are open triangle soups: telling "inside" from "beside"
  needs a real mesh-intersection test. The solid parts are convex, Rapier
  answers penetration depth for them directly, and a tolerance of the fit's
  size makes up the difference.
- **Keep the overlaps and lift one deck by a few millimetres.** That trades a
  shared top for two tops a hair apart, which still flickers at a distance and
  leaves one deck's edge standing proud of the other.

## Consequences

- A bounce ledge hands you back up without being asked: landing on one
  rebounds you (ADR 0094), and the walk reached the hub from a ledge with no
  jump pressed at all. That is the design, and it also means the ledges throw
  people around. Whether it is fun or too much is the user's live check.
- The races are not held to the rule yet: Spin Cycle has 53 overlapping pairs,
  Slip Stream 42 and the base race 8 (10, 33 and 8 of them between still
  pieces). The same test can hold them once they are reworked.
- A seated piece, such as a Spring pad sunk into its deck until its top sits
  2 cm proud, is an overlap under this rule. None is left in the arenas. A
  race that seats one will need the rule to say so when it is held to it.

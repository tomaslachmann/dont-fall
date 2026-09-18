# 0095 — An Asset can be a Prop

## Context

From the user, after playing the four authored Tracks on 2026-09-18:

> s kuželama, balónama atd z assetů nejde hýbat, což by mělo jít

Every placed Asset was immovable. `resolveTrack` baked an Asset Segment's
collision into still trimeshes (or, with a Motion, into a kinematic Moving
Segment), and nothing in between: a traffic cone was as fixed as the deck under
it.

Dynamic Props were not missing — `Prop` has existed since M1 ticket 06, and M2
gave it the whole netcode path (ADR 0022/0026: replicated pose, sleep flag,
aligned-gated reconcile, client-side prediction for the Prop a local Character
is touching). What was missing was any way to *say* that a placed Asset is one.
`PropConfig` came only from `Module.props`, which only procedural Modules
author, and the builder has placed Assets only since ADR 0078.

## Decision

**A Segment can be a Prop: `segment.prop === true`.** Additive and optional,
exactly the shape `ice`/`mud`/`bounce` established, so every Track stored
before it reads unchanged.

**An attachment, not a property of the Asset.** The same ball is furniture on
one Track and a football on the next: the base race's ice-slide bumpers and Cog
Arena's rim bumpers are the same Module, and one has to stay exactly where it
was put. Making `kaykit_ball` always dynamic would have changed the seed.

**A Prop collides as its Asset's authored solid parts** (ADR 0065) — the same
shapes a Moving Segment collides as, for the same reason: a hollow trimesh on a
body that moves traps whatever ends up inside it. `PropShape` gains an `asset`
form carrying the parts plus the `moduleId` and `scale` the renderer draws it
with, and a `Prop` now owns *several* colliders rather than one, so a shove
landing on any part finds the whole thing. An Asset with no solid parts cannot
be one; `resolveTrack` says so in a warning and leaves it standing.

**Weight follows size.** `mass` is the footprint's own volume times
`PROP_ASSET_DENSITY`, clamped between `PROP_ASSET_MASS_MIN` and
`PROP_ASSET_MASS_MAX`. The procedural default of 4 for everything would have
made a two-metre ball skitter like a cone, and how heavy a thing looks is the
one thing a Player reads off it before touching it. Measured, a Character
walking into one for three seconds: cone 2.9 m, ball 3.1 m, bomb 3.7 m.

**A Prop is a body physics owns, so it is nothing else.** Publish refuses
`prop` together with a Motion (that is authored movement, not physics), a
Conveyor or ice/mud/bounce (those are decks), a launch height, the Start or a
Checkpoint. The Track builder says the same thing before the refusal: the
SURFACE panel grows a BODY choice (PLACED / PROP) which hides the deck and belt
while PROP is on, and explains itself instead of offering the choice when the
Segment is a Moving Segment, the Start or a Checkpoint.

**Drawn like a Moving Segment.** The client puts the Asset's template under a
group and writes the group's pose from the replicated `PropSnapshot` each
frame — the same one transform that already carries everything a Moving Segment
draws. `assetPlacements` skips a Prop for the same reason it skips a Moving
Segment: its visual is not a still one.

## Consequences

- The four authored Tracks use it where it adds a moment and nowhere it would
  break one: every traffic cone, Slip Stream's ice-arm bumpers, and both
  arenas' rim bumpers (6 / 14 / 24 / 24 Props). The carousels' and turntables'
  riding bumpers stay placed — they have to orbit with the disc — and the base
  race is untouched, seed and verification both.
- A Survival arena's bumpers can now be pushed off the edge over a Round. That
  is the trade taken deliberately: a ball you can shove at someone is worth
  more than a ball that is always there, and the mass floor keeps it from
  happening by accident.
- Props are replicated per snapshot, so a Track with hundreds of them costs
  bandwidth in a way a Track with hundreds of Segments does not. Nothing
  enforces a budget yet; the counts above are well inside what M2 sized for,
  and a limit belongs with the numbers that ask for one.
- `solidColliderDesc` moved from private in `MovingSegment.ts` to exported, so
  the kinematic and dynamic paths build the same shapes from the same code.
- **Whether a shoved cone is fun, and whether the arenas still have bumpers
  after three minutes, is the user's check.** What is proven here is that a
  Character walking into one moves it.

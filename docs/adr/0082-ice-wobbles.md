# 0082 — Ice wobbles

## Context

Ice (ADR 0066) takes away a Character's grip (`grip` 0.001), so it speeds up
and slows down slowly and slides. Until now nothing on the Character showed
that. It ran across ice the way it runs on any deck, and only the sheet under
it looked different.

The rig already has an unsteady pair, `Wobble` and `Wobble_Walk`, which ADR
0072 gave to the `Stagger` state. The user's call (2026-09-17): a Character
on an ice Surface uses them too. Mud stays as it is: it halves the speed, and
the Character runs through it (ADR 0081).

## Decision

**A Character standing on ice is drawn exactly like one in `Stagger`:
`Wobble` standing, `Wobble_Walk` moving.**

- **The same rule as `Stagger`, Dash included.** `selectLocomotion` takes
  `onIce` beside `wobbling` and treats the two the same. Standing, or sliding
  with nothing held, is `Wobble`. Moving or dashing is `Wobble_Walk`, so the
  Sprint doesn't show on ice. In the air it is still the jump, and the
  landing still plays when it touches down on ice.
- **"On ice" is worked out on the client, from position.** No new state is
  sent. This follows ADR 0077's updraft: the client already has each ice deck
  (the ones its sheets are drawn from) and every Character's capsule centre.
  A Character is on ice when its feet are inside a deck's footprint and within
  `ICE_FOOTING_REACH` (0.25) of its top, measured in the deck's own plane, so
  ramps count.
  - Each deck keeps an invisible frame under the same parent as its sheet,
    so ice on a Moving Segment moves with it.
  - The frames don't depend on the ice texture having loaded.
- **The whole footprint counts, like the sheet.** Physics reads the Surface
  per collider, and the sheet covers the deck of any piece that has ice
  anywhere (`moduleHasIceSurface`). The wobble goes with what the player
  sees. No Module mixes ice with other Surfaces on one deck today.
- **Local and remote read it the same way.** The local Character asks with its
  predicted centre, and a remote one with its interpolated centre.

## Consequences

- The Stage builds the footing (`iceFooting.ts`) next to the ice sheets and
  hands it to the remote pool through `RemotePoolWorld.onIce`, the same way
  it hands over `inUpdraft`.
- The sim decides grip from the ground collider one tick behind (ADR 0036).
  The drawn wobble can start or stop a frame or two away from the change in
  grip. It is drawn from position and never feeds back.
- Whether a Dash on ice should still show the Sprint is a live check for the
  user. Today it wobbles.

## Alternatives rejected

- **Sending the Surface under each Character on the snapshot.** Exact per
  collider, but it changes the protocol for something the client can already
  work out.
- **A ray against the drawn ice sheets.** It would find the ice the same way,
  but it would find none whenever the texture failed to load and no sheets
  were built.

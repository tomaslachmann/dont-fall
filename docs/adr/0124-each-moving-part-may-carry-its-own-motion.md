# 0124 — Each moving Part may carry its own Motion

## Context

`DF_sweeper_3_arms.glb` (2026-09-22) is a tower with **three independent
rotors**, one 5 m arm each. Read off its clips (and matching its own
`extras`):

| rotor | height | clip | at the arm's tip |
|---|---|---|---|
| Low | 0.89 m | −36°/s | 3.1 u/s: jumpable |
| Mid | 1.51 m | +72°/s | 6.3 u/s: too high to jump, must be timed |
| High | 2.13 m | −144°/s | 12.6 u/s: passes overhead, hits only a jumper |

ADR 0116 said a Segment's `motion` Attachment addresses its moving Parts.
With one moving Part (the two-arm sweeper) that was exact. With three, any
retune the author makes turns three different arms into three identical ones.

The user's call, 2026-09-23: each arm is tuned **on its own**, direction
included ("každé rameno se může točit nezávisle, svým směrem"). The direction
is fixed per arm: an arm does not reverse mid-Round.

## Decision

**A new Attachment, `partMotions`: a Motion per moving Part, keyed by the
Part's name.** What moves a Part is, in order:

1. `segment.partMotions[part]`: the author retuned this arm;
2. `segment.motion`: the author retuned the whole Asset (ADR 0116, unchanged);
3. the Part's authored default in its def.

Each entry is a whole Motion, including its own Ramp (ADR 0123), so three
arms can speed up on three schedules. A direction is the sign of a Spin's
`speed`; the MOTION panel's direction switch flips it.

- **An Attachment, not a new shape of `motion`.** A stored `motion` keeps
  meaning what it has always meant, and every reader of it stays correct.
  Tracks that predate this are byte-identical when resolved.
- **Publish refuses a key that names no moving Part** of the Segment's Asset.
  A stored Revision is immutable (ADR 0032), and a retune addressed to an arm
  that does not exist would be silently ignored forever.
- **The builder's MOTION panel gains a Part picker** when the selected Asset
  has more than one moving Part. It opens on the first Part, pre-filled with
  that Part's current Motion. MCP `set_motion` takes an optional `part`.
- A Shooter's aiming Parts still ignore every Motion (ADR 0119), and a
  `partMotions` entry for one is refused like any other non-moving name.

## Consequences

- One more Attachment in the registry (ADR 0099): the re-chain, Duplicate,
  and the Prop conflict rule pick it up with no list of their own.
- ADR 0116's sentence "a Segment's `motion` Attachment addresses its moving
  Parts" still holds, as the second rung of the ladder above.

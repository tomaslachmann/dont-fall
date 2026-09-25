# 0117 — A Trap Door is a hole on a clock

## Context

`trap-door.glb` (2026-09-21) is a fixed frame 5.33 × 3.93 with two leaves
hinged at x = ±2.16, each 2.11 × 2.82, their top face at y = 0.52. Its clip
runs 2.17 s: a ±2° shudder for the first 0.42 s, then an 88° fall away from
the middle, fully open at 0.83 s, held open 0.75 s, and a close. The leaves' own extras
name a hinge axis of Y; the clip rotates about **Z**, and the clip is right.

Two questions had to be answered before it could be built, and the user
answered both on 2026-09-21: it opens **on a clock, endlessly** (not on a
Character's weight), and a Character standing on it **just falls** — the
leaves do not carry it down.

## Decision

**The leaves are `gated` Parts (ADR 0116): collision exists only while they
are closed.** Their swing is a pure function of the Tick — period, phase and
how long they hold open, authored in the inspector beside a Motion's numbers
and defaulting to the clip's own — and the collision is a switch, not a
sweep. Closed is a floor at y = 0.52; anything else is a hole.

- **A Character on an opening door is not picked up and not pushed — the
  floor stops existing under it, so it falls.** This is the user's call, and
  it is what the game can honestly replicate: a leaf swinging 88° in 0.4 s
  moves its far edge at ~9 u/s, which a Ride (CONTEXT.md) would have to carry
  and a Bump would have to hit, both at a speed the Impact rule reads as a
  knockdown. A hole is legible; a flung bean is not.
- **A Character cannot land on a closing door either.** It falls through until
  the leaves are fully shut. Binary in both directions — a floor that half
  exists is the one thing worse than a hole.
- **The clip's shudder is the telegraph, and it is kept.** The first 0.42 s is
  a visible tremble with the floor still solid, so the trap announces itself
  before it takes anyone. Without it the only warning would be the drop.
- **The frame is a `still` Part** and stays solid throughout, so the piece
  always reads as a doorway rather than a disappearing slab.

## Consequences

- Drawn geometry and collision deliberately disagree for ~0.4 s each way
  (the leaves are visibly still swinging when the hole is already there).
  This is the first place in the repo where that is on purpose, so the
  telegraph above is not decoration — it is what makes the rule readable.
- The trap needs no replicated state: `(Tick, period, phase, hold)` gives
  every Player the same answer, predicted and authoritative alike.
- An author who wants a wave of doors sets the same period and staggered
  phases, exactly as with a row of hammers (ADR 0061).

## As built

- **The swing is the clip's own curve**, sampled into the def by `pnpm convert:df` and
  replayed by `trapDoorAngle` — not a re-modelled shudder-and-ease. The clips are still
  never played (ADR 0116's reason stands); their numbers are lifted instead, which is the
  authored motion with one source of truth.
- **"Shut" is `angle <= 0`**, exactly. The authored tremble lifts the leaf the opposite way
  before it drops, so the telegraph and the collision window are the same fact, with no
  threshold to tune.
- **A Ride had to be stopped explicitly.** `rideFor` reads a carrier's pose at `tick + 1`,
  which on a leaf's last shut Tick is already falling — measured: a Character was flung
  ~2 m along the arc. It now asks `MovingSegment.solidAt(tick + 1)` first. The remaining
  drift is the tremble's own, ~7 cm.
- **The author sets when, never how.** Period and phase are the Segment's (`trapdoor`
  Attachment); the fall, the hold and the tremble are keyframed. A period shorter than the
  swing is floored where it is set and again where it resolves.

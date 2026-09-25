# 0120 — An Asset may arrive with its Attachment

## Context

`DF_belt.glb` (2026-09-21) is a conveyor: a 2.5 × 1.2 × 5.2 m machine with
two rollers, side rails, direction arrows and 36 slats looping 10.9 m. Its
own extras name it — `gameplay_role: "conveyor_belt"`, `slat_count: 36`,
`belt_loop_length: 10.913`, `roller_radius: 0.4`.

The game has had belts since M3.6: a **Conveyor** is a Segment Attachment
(ADR 0064) that makes a deck carry whoever stands on it, drawn as chevrons on
the deck's own surface (ADR 0096). Nothing stops an author attaching one to
this machine — but nothing makes them, either, and a conveyor that does not
convey is a model lying about itself.

Every mechanic an Asset has carried so far lives in its **def** as a field of
its own: a Spring's `launch` (ADR 0069), a Gate's opening (ADR 0068), a Fan's
`volumes` (ADR 0075), a fragile floor's states (ADR 0118), a Shooter's muzzle
(ADR 0119). None of them is an Attachment an author could also have set by
hand; they exist only on the def. The belt is the first Asset whose mechanic
is something the Segment vocabulary *already* has a word for.

The user's call, 2026-09-21: **"Ano, položený pás už tlačí."**

## Decision

**An Asset def may name a default for an Attachment its placed Segments
carry, and the Segment's own value overrides it.** The belt's def says
`conveyor: { preset: "medium" }`; a placed belt runs at 4 u/s along its own
length, and the CONVEYOR panel an author already knows retunes it with the
presets it already has.

- **The default is not stored on the Segment.** A placed belt with no
  `conveyor` of its own resolves as if it had one — the same shape as a
  Spring's height (`Segment.launch` overrides `Module.launch`), a trap door's
  period and a Shooter's numbers. A stored Track therefore says nothing new,
  and an Asset whose default is retuned later moves every placement with it.
- **Only the Attachments an Asset can honestly promise.** A Conveyor is one:
  the machine is a belt, so it conveys. This is not a licence for a def to
  pre-attach ice, a Checkpoint or a Motion — an Asset says what it *is*, and
  the Attachments that describe where a Segment stands or what a Round does
  with it stay the author's alone.
- **Which way it runs is the model's.** The belt's own +Z is downstream, so
  turning the Segment turns the flow, exactly as a Conveyor's angle does
  today. The arrows printed on it point the same way by construction.

**The slats are drawn, never simulated** (the user's call): the deck is one
flat collision surface and the 36 slats scroll across it at the belt's own
speed, so what you see is what carries you. **The side rails are solid** —
they are what keeps a shoved Character on the belt.

## Consequences

- One more thing a def can say, in a family that already has five. The rule is
  narrow on purpose: a default for an Attachment the Asset *is*, never one
  describing the Track around it.
- The Conveyor's authoring, validation, drawing and physics are untouched.
  What changes is where the value comes from when the Segment is silent.
- A belt placed on a Track that predates this reads differently than it did:
  it now pushes. Nothing places one yet, so nothing changes under anyone.

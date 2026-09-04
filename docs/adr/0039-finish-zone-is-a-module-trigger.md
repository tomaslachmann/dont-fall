# 0039 — Finish Zone is a Module-level trigger entity

`CONTEXT.md` has always defined the Finish Zone (the area granting Qualification), but the code has
no such entity: a `Module` carries at most one `checkpoint` (trigger + respawn), and nothing marks
the end of a Race. M4 must detect "Character entered the finish" authoritatively on rotated and
tilted Segments, without inventing a second containment system.

## Decision

- A `Module` gains an optional Finish Zone: a detection-only trigger region shaped exactly like a
  Checkpoint's `trigger` (`OrientedBox`), with no respawn point. Detection reuses the
  `orientBox → pointInOrientedBox` pipeline Checkpoints already prove rotation-safe (ADR 0036).
- The server detects capsule-centre entry during RUNNING, records `finishTick` per Character, locks
  that Character's input, and leaves them spectating in the zone (grilling Q3).
- Typically authored on the last Segment of a Race Track, but the data does not require it —
  "finish" is wherever the trigger is.
- A Checkpoint never doubles as a finish, and a Finish Zone is never a Volume: it detects, it
  never pushes, it never respawns.

## Considered options

- **Last Checkpoint doubles as finish** — rejected: it couples two independent authoring decisions
  (where you respawn vs where the Race ends) and breaks on any Track with a Checkpoint past or
  before the intended finish.
- **Finish as a Track-level property** (an index or a world-space box) — rejected: a world-space
  box must still survive Segment rotation and tilt, which is exactly the pipeline the Module-level
  trigger already has; an index cannot express "the end of a Round stays chaotic and contested".

## Consequences

- Modules and the builder gain one optional trigger; all pre-M4 Modules resolve unchanged (no
  finish → not raceable until one is authored; seed content gets one as a data change).
- Launch-pad shortcuts that skip to the Zone stay legal by design (M3.7): policing shortcuts is a
  Round-rules matter, and the M4 rule is "entry counts".
- Qualification becomes a pure function of position + phase, derived identically on both sides,
  with nothing new on the wire beyond the `qualified` map (ADR 0040).

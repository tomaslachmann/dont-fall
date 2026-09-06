# 0042 — What a Fall does is the Round type's rule

Since M1 the project has asserted, in `CONTEXT.md` and in code comments, that **a Fall never
eliminates** — it costs time through a Respawn with a penalty (ADR 0010 makes that penalty the
ragdoll recovery). Survival, already named in the glossary and the next Round type to be built,
requires the opposite: falling off the arena is exactly what puts you out. One of the two has to
give.

## Decision

- **A Fall stays a simulation event, unchanged**: a Character's centre crossing the kill plane, a
  pure function of its own position, derived identically on both sides. This is not what varies.
- **What follows a Fall is a Round-type rule**, carried as data in `RoundRules` (ADR 0043): a Race
  respawns at the last Checkpoint, Survival eliminates.
- **Elimination decomposes across the authority line.** Losing control is simulation — it depends
  only on your own position, the same shape `finishTick` already uses (ADR 0039). "You are out of
  this Round" and "the Round is over" are **match authority**, because they depend on the other
  Characters, which ADR 0003 forbids clients from simulating.
- **An eliminated Character is marked, never removed.** Its entry stays in the Character
  collection and its body stays in the world with its collider disabled. It is not stepped: the
  per-Character work is skipped, so the cost is an iteration and a branch.

## Considered options

- **Remove the eliminated Character's body** — rejected. It varies the set of simulated bodies and
  the iteration order between client and server, which is the determinism hazard the Round-type
  research names first; and taking a rigid body out of the world mid-Round changes contact
  resolution for everyone still playing.
- **Leave the body colliding** — rejected: in Survival the whole contest is shoving, and a corpse
  left as a shovable obstacle on a small arena decides Rounds by accident.
- **Keep stepping eliminated Characters with idle input** — rejected as pure cost. The expensive
  part of a tick is the per-Character controller sweep, and an eliminated Character needs none of it.
- **A `Fall` that means different things in different Round types** — rejected as a vocabulary
  change: the event is the same event, and only its consequence differs. `CONTEXT.md` now says so.

## Consequences

- **This amends ADR 0010**, which is not superseded: the Respawn penalty remains the Race's answer
  to a Fall, and remains the reason a Fall costs something. It simply stops being universal.
- `CONTEXT.md`'s `Fall`, `Respawn`, `Round` and `Elimination` entries are already updated, and
  `Round type` / `Survivor Target` added.
- **M4 ticket 05's disconnect path has the flaw this ADR forbids**: it calls `removeCharacter`
  mid-Round. It is rare enough that nothing has noticed, and it is fixed as part of this work.
- Checkpoints become meaningless in a Round type with no Respawn. They are ignored, not forbidden —
  Tracks stay Round-type-agnostic (ADR 0041).

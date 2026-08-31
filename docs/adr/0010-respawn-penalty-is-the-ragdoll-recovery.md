# 0010 — The Respawn penalty is a ragdoll flop, not added clock time

CONTEXT.md defines a Fall as costing the Player a "short time penalty". In M1
that penalty is **the Ragdoll → GettingUp recovery** (ADR 0006, ticket 05): a
Fall teleports the Character to its Checkpoint, drops it there as a ragdoll, and
it has to flop and scramble back to its feet before the Player regains control —
roughly a second of lost time, and no dignity.

M1 has no Round timer or race clock to add seconds to. The felt recovery is the
only way to make a Fall hurt right now, and it matches the proposal's "2 seconds
penalty" and Fall Guys' respawn animation.

(Ticket 03 originally shipped this as a flat 2 s input freeze; ticket 05 replaced
the freeze with the ragdoll recovery once the state machine existed.)

## Consequences

- When the Round structure lands (M4) this may change or gain a second form —
  e.g. the recovery stays *and* the lost seconds count against the Time Limit.
  Revisit here then.
- The recovery goes through the normal `Ragdoll` / `GettingUp` states
  (ADR 0006); `motionState` reflects it and movement input is ignored until
  `Controlled`. There is no separate "respawning lockout" mechanism any more.

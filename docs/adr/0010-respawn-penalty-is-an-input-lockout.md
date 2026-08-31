# 0010 — The Respawn penalty is an input lockout, not added clock time

CONTEXT.md defines a Fall as costing the Player a "short time penalty". In M1
that penalty is implemented as an **input lockout**: after a Respawn the
Character is frozen at its Checkpoint for `RESPAWN_LOCKOUT_MS` (2s) — movement
input is dropped and no gravity accumulates.

M1 has no Round timer or race clock to add seconds to. A felt dead-stop is the
only way to make a Fall hurt right now, and it matches the proposal's "2 seconds
penalty" and Fall Guys' respawn delay.

## Consequences

- When the Round structure lands (M4) this may change or gain a second form —
  e.g. the lockout stays *and* the lost seconds count against the Time Limit.
  Revisit here then.
- The lockout is a full freeze, distinct from the ragdoll `Stagger`/`GettingUp`
  states (ADR 0006). It does not (yet) go through the Character motion-state
  machine — `motionState` stays `Controlled`, and `character.respawning` is a
  separate flag.

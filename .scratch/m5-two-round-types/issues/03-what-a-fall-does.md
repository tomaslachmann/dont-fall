# 03 — A Fall respawns you, or ends you

**What to build:** The first rule that actually differs. A Fall stays exactly what it is — a
Character's centre crossing the kill plane — and what *follows* it becomes a `RoundRules` field.

A Race respawns at the last Checkpoint with its penalty (ADR 0010, unchanged as the Race's answer).
Survival eliminates. Per ADR 0042 the two halves sit on opposite sides of the authority line:
losing control is simulation, because it depends only on your own position; "you are out of this
Round" is match authority, because it depends on everyone else.

**Blocked by:** 02.

**Status:** done

- [x] What follows a Fall is read from `RoundRules`, not hardcoded — `RoundRules.fallBehavior:
      "respawn" | "eliminate"` (its Track default is always the constant `"respawn"`; no Track
      carries a Round-type opinion, ADR 0041). `RapierSimulation.detectFall` reads it and passes
      either `progress.respawnPoint` or `null` into `CharacterController.fall`, which now queues a
      Respawn only when given a point — losing control (forced Ragdoll) happens either way, since
      the Fall itself never varies (ADR 0042)
- [x] The Race path is untouched behaviourally — Fall, Respawn, penalty, `fallCount`, all as they
      are. Every pre-existing "Fall & Respawn" test passes with no changed assertions; a new test
      pins an *explicit* `fallBehavior: "respawn"` RoundRules against the same behaviour
- [x] The client predicts the Round's own rule, so a falling Character does not respawn on one side
      and vanish on the other for half an RTT — needed no client-specific change: `detectFall`
      lives in the shared step both sides already run, and `roundRules` already rides the snapshot
      (ticket 02), so the client's own local prediction reads the identical `fallBehavior`
- [x] Checkpoints in a Round with no Respawn are ignored, not rejected — `updateCheckpoint` already
      tolerated an empty `checkpoints` array (the FinishZone precedent); a new test confirms a
      Checkpoint crossed before an eliminating Fall is tracked (`checkpointIndex` still updates)
      but never read (`respawnPoint` is simply never used)
- [x] (Found during implementation, not on the original checklist) An eliminating Fall with no
      queued Respawn had nothing to stop `detectFall` re-triggering every tick while the Character
      keeps falling through the void — `fallCount` would climb without bound and `fall()` would
      re-fire on an already-ragdolling Character indefinitely. Guarded with `isDownMotionState`,
      scoped to the `eliminate` branch only so Race's own guard (`hasPendingRespawn`) is untouched.
      A temporary, ticket-03-scoped fix — ticket 04's "marked, not stepped at all" is the permanent
      answer ADR 0042 actually calls for

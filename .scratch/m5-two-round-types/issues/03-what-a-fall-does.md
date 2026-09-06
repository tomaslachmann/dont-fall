# 03 — A Fall respawns you, or ends you

**What to build:** The first rule that actually differs. A Fall stays exactly what it is — a
Character's centre crossing the kill plane — and what *follows* it becomes a `RoundRules` field.

A Race respawns at the last Checkpoint with its penalty (ADR 0010, unchanged as the Race's answer).
Survival eliminates. Per ADR 0042 the two halves sit on opposite sides of the authority line:
losing control is simulation, because it depends only on your own position; "you are out of this
Round" is match authority, because it depends on everyone else.

**Blocked by:** 02.

**Status:** blocked

- [ ] What follows a Fall is read from `RoundRules`, not hardcoded
- [ ] The Race path is untouched behaviourally — Fall, Respawn, penalty, `fallCount`, all as they are
- [ ] The client predicts the Round's own rule, so a falling Character does not respawn on one side
      and vanish on the other for half an RTT
- [ ] Checkpoints in a Round with no Respawn are ignored, not rejected — Tracks stay
      Round-type-agnostic (ADR 0041)

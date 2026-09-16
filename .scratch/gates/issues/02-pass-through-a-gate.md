# 02 — Passing through a gate counts, in the simulation

**What to build:** the pass-through test (capsule centre crosses the opening's
plane inside the opening between ticks, either direction) and its two uses:
a gate Checkpoint moves the Respawn forward by number, a finish sign
Qualifies. Legacy trigger boxes keep detecting by containment.

**Blocked by:** 01, 03 (the resolved gate entries).

**Status:** done (2026-09-15) — tests; the live check is the user's

## How it behaves after

- Running under an arch switched to Checkpoint 2 sets your Respawn there; a
  Fall afterwards puts you on its floor. Running back through Checkpoint 1 does
  nothing. Jumping straight to 3 works.
- Going around the gate, over it, or touching it doesn't count. Walking back
  out the way you came in counts once, like walking in (either direction).
- A finish sign Qualifies on the tick you pass under it, ragdolling through
  included (ADR 0039's "entry counts").
- A Fall's Respawn teleport never triggers a gate it happens to jump across.
- The client predicts the same tick the server decides — no new snapshot field.

## Checklist

- [x] Shared `passesThroughGate(from, to, gate)` (plane crossing + mask lookup)
- [x] Pre-move positions captured per tick; checkpoint and finish checks use
      both; teleports (respawn) excluded
- [x] Tests: through counts both ways; around / over doesn't; (the pass is judged on the
      tick's whole movement, so speed can't tunnel past);
      numbered order only forward; finish sign Qualifies; legacy boxes unchanged

## Notes

- No test drives a Respawn teleport through an opening (the teleport starts
  below the kill plane, far from any opening); the rule is one guard,
  `tickStart.respawning`.
- Free-roam's finish toast judges a finish sign by the frame's movement too.

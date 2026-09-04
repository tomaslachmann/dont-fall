# 0033 — Playability validation stays manual (Test Mode), no `MovementSolver`/feasibility graph yet

`docs/track-builder-proposal.md` §9.5–9.6 specifies a shared `MovementSolver` (walk/jump/dash/drop
feasibility between surfaces) and a reachability graph search (start → every Checkpoint in order →
finish) as an automated "can this Track actually be completed" validation layer, reusing the same
movement tuning constants as the live game.

## Decision

**Not built yet — deferred as its own future project, not silently skipped.** A movement-
feasibility solver that stays honest with the real `CharacterController` (jump arcs, coyote time,
dash range/cooldown, ragdoll knockback) is a genuinely hard problem in its own right — the same
category as M2's time-sync/reconciliation work, which got its own dedicated research + ADR pass
rather than being bundled into a broader ticket. Building a half-faithful version now risks
exactly what §9.6 itself warns against: a second physics model that quietly drifts from the real
game. For M3-v2, playability is validated the way ticket 05's Test Mode already does it — a human
actually walks the real shared simulation. Structural and placement/Socket/Footprint/overlap
validation (ADR 0031) ship now; reachability does not.

## Consequences

- Publishing does not block on "is this Track completable" — only on structural/placement
  validity. A designer can publish an unbeatable Track; Test Mode is the only current safeguard.
- Revisit as its own dedicated grilling + research round (matching how time-sync/reconciliation
  were handled in M2) if manual Test Mode proves too slow or misses real published defects — not
  as a rider on an unrelated ticket.

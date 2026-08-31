# 03 — Platforms + Fall + Checkpoint respawn

**What to build:** A small playground you can fall out of. Basic platform geometry
with real edges you can walk or be pushed off. A kill-plane below the playground:
dropping past it is a `Fall`. A `Fall` triggers a `Respawn` at the Character's
last `Checkpoint`, and the Respawn costs a short time penalty so a Fall always
hurts. At least two Checkpoints so respawn location actually varies.

**Blocked by:** 02

**Status:** done

- [x] Playground of static platforms (start / cp1 / end at varying heights) joined by narrow bridges with walkable edges
- [x] Kill-plane (`killPlaneY`, default `DEFAULT_KILL_PLANE_Y`); `character.position.y < killPlaneY` registers a `Fall`
- [x] `Checkpoint` volumes (`pointInBox`); walking through one sets `checkpointIndex` + respawn point
- [x] `Fall` → `Respawn` at last Checkpoint (or spawn if none reached)
- [x] Penalty = `RESPAWN_LOCKOUT_MS` input lockout (frozen at checkpoint) — decided in grilling, no race clock in M1
- [x] Fall/checkpoint/respawn all run inside `RapierSimulation.tick`; `character.teleported` tells the renderer to snap not lerp

**Notes:** `SimState.character` gained `checkpointIndex`, `fallCount`, `respawning`,
`teleported`. Disabled Rapier snap-to-ground + added `GROUND_STICK_SPEED` to fix a
character-controller stall near platform edges (regression-tested). Manual browser
feel check pending.

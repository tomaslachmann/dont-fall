# 01 — Prefactor: RapierSimulation holds a collection of Characters

**What to build:** A pure internal reshape, no user-visible behaviour change. `SimState`,
`RenderState`, and `RapierSimulation` represent Characters as a collection keyed by
identity, rather than a single hardcoded field — so a later ticket can add or remove a
Character without another data-model rewrite. The single-player game and every existing
M1 test behave identically with exactly one Character in the collection.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `SimState`/`RenderState` carry a collection of Characters (keyed by an ID), not one
      hardcoded `character` field
- [ ] `RapierSimulation` can add and remove a Character by ID at runtime
- [ ] The full existing M1 test suite passes, adapted only where a single-Character
      access pattern becomes "the one Character in the collection" — no behaviour change
- [ ] The single-player client runs identically to before: same feel, same HUD, no
      regression
- [ ] Checkpoint/Fall/Respawn tracking, Impact/Ragdoll state, and Prop interactions all
      still resolve correctly per-Character with a collection of size one

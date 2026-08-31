# 03 — Platforms + Fall + Checkpoint respawn

**What to build:** A small playground you can fall out of. Basic platform geometry
with real edges you can walk or be pushed off. A kill-plane below the playground:
dropping past it is a `Fall`. A `Fall` triggers a `Respawn` at the Character's
last `Checkpoint`, and the Respawn costs a short time penalty so a Fall always
hurts. At least two Checkpoints so respawn location actually varies.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Playground of static platforms at varying heights with walkable edges
- [ ] Kill-plane below the playground; crossing it registers a `Fall`
- [ ] `Checkpoint` volumes; passing through one updates the Character's respawn point
- [ ] `Fall` → `Respawn` at last Checkpoint
- [ ] Respawn applies a short time penalty (a named tuning constant)
- [ ] Falling is driven by the sim, not a render-side trigger

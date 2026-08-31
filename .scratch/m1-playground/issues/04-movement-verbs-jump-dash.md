# 04 — Movement verbs: jump + dash

**What to build:** The two movement verbs beyond walking. Jump with variable
height (longer hold = higher, up to a cap), coyote time ~100 ms after leaving an
edge, and **no double jump**. Dash: a fixed-magnitude impulse in the direction of
movement (not the camera), usable both on the ground and in the air, on a
cooldown of ~1 s. Both run inside the shared sim step. Dashing into a wall has no
special consequence yet — that lands in ticket 06 once Ragdoll exists.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Variable-height jump with a height cap; input sampled per frame, applied at ticks
- [ ] Coyote time (~100 ms) as a named tuning constant
- [ ] No double jump
- [ ] Dash: fixed impulse along movement direction, ground and air
- [ ] Dash cooldown (~1 s) enforced and surfaced to the player (simple UI/indicator)
- [ ] All values live as named constants in `packages/shared`
- [ ] Can be developed in parallel with ticket 03

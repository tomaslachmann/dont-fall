# 06 — Spinner + physics props + impact reactions

**What to build:** Something to get whacked by and stuff to shove. One rotating
`Spinner` Obstacle (a constantly rotating bar) that knocks the Character on
contact. A handful of dynamic physics props the Character can bump and knock
around. Visible Impact Reactions (flinch / spin / knockdown) scaled to Impact
magnitude. Dashing into a wall or off an edge now transitions the Character to
Ragdoll (the deferred piece from ticket 04).

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] One `Spinner` Obstacle rotating at a constant rate; contact applies Knockback
- [ ] Spinner hit routes through the state machine → Stagger or Ragdoll by magnitude
- [ ] A few dynamic props (boxes/balls) the Character can push and knock over
- [ ] Impact Reactions visible and scaled to Impact magnitude
- [ ] Dash into a wall/edge → Ragdoll
- [ ] All interactions resolved inside the sim step

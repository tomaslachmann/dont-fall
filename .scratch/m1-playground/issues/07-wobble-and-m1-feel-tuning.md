# 07 — Wobble + M1 feel-tuning playtest

**What to build:** The final feel pass that closes M1. Add procedural `Wobble` —
a cosmetic lean/sway of the Character's visual mesh while `Controlled`, driven by
velocity and turning, that never touches collision. Then tune every M1 constant
(walk speed, jump height and hold curve, coyote time, dash impulse and cooldown,
fall penalty, Impact thresholds, GettingUp duration) against real play.

**Done when:** *"It's fun to walk, jump, bump, and fall."* — 30 minutes of
self-playtest and we're happy just shoving the Character off a ledge.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Procedural `Wobble` on the visual mesh while `Controlled`; zero effect on the capsule
- [ ] Wobble settles when idle, exaggerates on sharp turns / hard stops
- [ ] Every M1 tuning constant reviewed and set for feel, all named in `packages/shared`
- [ ] A short written note in `docs/milestones/M1.md` recording the final values and the playtest verdict
- [ ] M1 checklist in `docs/milestones/M1.md` fully checked

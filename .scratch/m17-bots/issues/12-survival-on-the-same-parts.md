# 12 — Survival on the same parts

**What to build:** the Survival goal as the tree's third slot. Stay on, keep away from edges
and from what sweeps, use the arena's levels (a shove is the start of a comeback on Cog
Arena), and shove others toward edges. Navigation, the ticket-06 rule, the profile and the
Fight branch are reused unchanged. Anything this ticket has to change in them is a seam in
the wrong place, and is written up.

**Blocked by:** 09

**Status:** planned

- [ ] Goal: a safe spot (far from edges and sweepers, weighed by the profile), re-chosen as the
      arena changes (bumpers taken, fragile floors broken)
- [ ] Fight weighting: an opponent near an edge is worth more in Survival (a rule on the
      Round's rules, ADR 0043, never a branch on the mode)
- [ ] Recovering up the inflatable ledges and the rim back to the hub (Cog Arena), across
      spokes (Sky Rings)
- [ ] Suite: 12 Bots on each arena at NORMAL. The Round ends on the Survivor Target or the
      clock, and every elimination has a cause other than ticket 06's rule
- [ ] **Fragile floors (moved from 07f by the user, 2026-09-24).** A fragile floor as the only way
      on is a Survival piece. 07f measured it (`trapHold.test.ts`, the skipped F1: `BOT_QUICK=1
      BOT_TRACK=F1`): under ADR 0118 an intact block carries two Bots and the third breaks it, and
      most Falls are the queue shoved into the hole, because a waiting Bot stands where its path
      ends, at the hole's edge. Decide here where a Bot waits for a broken floor and what the
      thresholds are.


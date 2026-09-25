# 17 — Retire the phase-3 crowd path from rides and holds

**Design:** ADR 0130's amendment, points 1 and 2. **Status:** planned. **After 16**, which uses the
holds switch once.

The phase-3 crowd path is `throughCrowd`/`crowdSteer` in `PathBot.ts`, the `positioning` mark's
routing through the planner, and `BOT_PLAN_CROWD_HOLDS` in `sweeperHold.ts`. It is off and must go:
a second authority over a script's heading is what the amendment forbids.

**Remove:**
- the two call sites;
- `BOT_PLAN_CROWD_RIDES` and `BOT_PLAN_CROWD_HOLDS`;
- the crowd terms in `LocalMotionPlanner`'s rollout (`bumped`, `crowd`, the half-overlap shove,
  the per-Bot side bias `BOT_PLAN_SIDE_BIAS`).

**Keep:**
- `neighboursOf`, `Fighter.targetId` and `voidEdgeDistance`: 19 and 20 reuse them;
- the `positioning` mark on `Steering`: 18 uses it to tell a slot walk from a script;
- the measuring columns in the scratchpad log.

Move the two crowd questions in `localMotion.test.ts` to 19's suite, or delete them.

**Target:** behaviour bit-identical to the switches-off tree on the 07m legs and seeds. The whole-Race
table must match ticket 14's last run to the Fall.

**Regression set:** as in ticket 14.

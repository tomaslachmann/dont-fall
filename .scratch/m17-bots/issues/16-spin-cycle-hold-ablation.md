# 16 — Spin Cycle: is it the hold's boundary? (a 2 × 2 ablation)

**Design:** ADR 0130, point 3 and the amendment's point 8. **Evidence:** ticket 14, "As built (phases
1–2)", "What remains". The hold stops 1–1.9 m short of the first blocked *sample*, which for a bar is
inside its disc. When the arm comes round, every candidate the planner has is bad, and the planner
takes the least bad one.

**Status:** planned. **After 15.**

## The experiment

Two switches, all four combinations. Same legs and seeds: Spin Cycle Start→Cp 0 and Cp 0→1, Slip Stream
Cp 1→2, at `holds:07m:<leg>:<level>:0` and `:1`, all three levels, 120 s, 12 Bots.

- **Hold boundary: off / on.**
  - **Off** is today's hold.
  - **On:** a hold stands *outside* the blocking body's swath (its disc for a spinner, its swept region
    for a slide). It stands at the swath's edge on the corridor, less `CAPSULE_RADIUS + BOT_HOLD_MARGIN_M`,
    and never inside the disc. If the corridor has no such point short of the Bot, it stands where it is.
  - Build this as its own small change behind a tuning switch.
- **Crowd: off / on.** Off is today. On is the smallest crowd term that exists, which is phase 3's
  `BOT_PLAN_CROWD_HOLDS`, only for this ablation.

## Measure, for each cell

- passed, stranded, step-offs;
- Stagger Falls, with spin-bar impacts split by the hook's output (hold stand, planner move, go);
- where each impact happened, relative to the swath boundary (inside or outside, and how far);
- the minimum TTC to an arm at a hold;
- think µs.

## Falsification

If Stagger Falls do not drop with the boundary on and the crowd off, the hold boundary is not the main
cause, and the diagnosis in ticket 14 is wrong. Record that, and do not build on it.

## Outcome

- Keep the boundary change if it wins with the crowd off.
- The crowd-on cells are there only to show whether the two interact. Do not keep the crowd on.
- Write the table into this ticket.

## Files

`sweeperHold.ts` (the boundary, behind a switch), `tuning/bots.ts`, and the 07m log from the
scratchpad (copied in only to run).

## Regression set

As in ticket 14.

Known reds that are not yours: the 14 in `RapierSimulation.test.ts`, the trapHold D/S wall-clock asserts, `difficulty.test.ts`, `races.test.ts`'s `ownFalls === 0`, `sweeperHold` base1's ordering, `deckRider`'s table-build times and the `think ≤ 40 µs` asserts under load (see ticket 14's As built lists).

# 19 — The open-floor crowd: a velocity-space solver

**Design:** ADR 0130's amendment, points 4, 6 and 8. **Status:** planned. **After 18.**

The scope is non-committed cruise on still floor only. Rides are 18's, and hazards are the phase 1–2
planner's.

## Build `bot/crowdAvoidance.ts`

- **Preferred velocity** comes from `PathFollower`, after the hazard planner has had its say.
- **Candidates:**
  - the preferred velocity, and the current velocity;
  - speeds 0, 0.25, 0.5, 0.75 and 1 of the local top speed, at headings within ±60° of the preferred
    velocity;
  - one refinement ring round the best, as Detour's adaptive sampling does it.

  Send a magnitude as `|moveDirection| < 1` (`walkWish` scales linearly). Nothing past 90° outside
  a **recover** state, entered only on a detected deadlock: no progress for `BOT_CROWD_DEADLOCK_TICKS`.
- **Hard constraints** reject a candidate outright:
  - a predicted step-off (`EdgeGuard`'s edges and inner lines, rolled out through `accelerate`);
  - a velocity outside what the Bot can reach in the horizon.
- **Continuous cost:**
  - w₁·|v − v_pref| + w₂·|v − v_current| + w₃·|v − v_last|;
  - w₄·(1 / TTC) against each neighbour, as a capsule-capsule time to collision at constant velocity;
  - w₅·corridor lateral error;
  - w₆·comfort spacing.
- **Uncertainty:** each neighbour's radius grows with its view's age × its reachable acceleration.
  - This applies on open floor only.
  - When uncertainty is high the solver prefers slowing to turning.
  - Toward a human, the Bot takes the whole correction.
- **Neighbours** come from `neighboursOf` within a reach, through a small proximity grid if the count
  asks for it.
- **The fight's target** is left out, via `Fighter.targetId`.

## Scenario tests (deterministic, new)

- **Head-on pair:** no change of passing side once the encounter starts.
- **Two alike side by side:** no periodic flipping of lateral velocity.
- **A slower Bot ahead:** the follower slows. No turn over 90°, and no overtake into an edge.
- **A 4-Bot and a 12-Bot pack into one corridor:** throughput no worse than cruise without the solver.
- **Stale views 0–16 Ticks:** the margin grows monotonically, and the Bot never freezes on a free floor.

## Metrics, on the crowd legs' still-floor stretches and a new open-floor section

- sign changes of lateral velocity per encounter;
- reversals over 90°;
- minimum TTC;
- corridor deviation;
- mean and p10 progress;
- think µs per decision.

## Falsification

If adding the reduced speeds and the follow candidate does not reduce heading change, reversals and
lateral error, the action space was not the problem. Record that before going on to 20.

## Files

The new `crowdAvoidance.ts` and its test, `PathBot.ts` (one call site, cruise only), and
`tuning/bots.ts`.

## Regression set

As in 18.

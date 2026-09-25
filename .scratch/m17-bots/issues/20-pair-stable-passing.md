# 20 — Pair-stable passing, with hysteresis

**Design:** ADR 0130's amendment, point 5. **Status:** planned. **After 19.**

## Build

- **An `Encounter` per pair of Characters,** kept by each Bot. It opens when TTC falls below a
  threshold, and closes when the pair has passed and their distance grows.
- **Side convention:**
  - head-on: pass on one fixed side in the path tangent's frame;
  - same way: the faster Bot yields lateral room, by a stable priority;
  - crossing: `hash(minId, maxId, encounterEpoch)` picks who yields and who keeps its velocity.
- **Hysteresis.** Keep the side and the role until the encounter closes, and at least
  `BOT_ENCOUNTER_MIN_TICKS`.
- **Bot and human.** The Bot takes the whole correction, and the side follows the convention.
- **Solver bias.** The encounter adds a directional bias to 19's solver, a cost on the wrong side's
  velocities. It never removes the TTC constraint.

## Test

- On the head-on scenario, the lateral-velocity sign flips go down.
- A late view (8 Ticks) on one side of the pair does not bring the dance back within a normal passing
  distance.

## Falsification

If the flips do not go down, the oscillation comes from late-state asymmetry or from the cost, not from
the side choice. Record that.

## Files

`crowdAvoidance.ts`, `tuning/bots.ts`.

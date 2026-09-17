# 0084 — The ground under the footprint, not every contact

## Context

Since the builder places Assets only (ADR 0078), every floor is a trimesh with
rounded, chamfered rims. The user saw two glitches in play (2026-09-17): a
walking Character flips to `Sliding` for about 100 ms, and a dashing one flashes
into the jump's apex pose.

Measured headless against the real simulation, both come from the contact
normals Rapier's character controller hands back, not from the animation:

- **Airborne for one tick mid-Dash.** A sweep that starts resting on the floor
  sometimes resolves against a normal a few degrees off vertical — seen as
  `(−0.01, 0.988, 0.15)` on a perfectly flat two-triangle floor. Rapier slides
  the whole step along it, and at Dash speed (0.63 per tick) that lifts the
  capsule about 0.1 clear of the floor. Rapier's own snap-to-ground only pulls
  down a sweep that went *down*, so `computedGrounded()` is false for that
  tick, and the renderer starts the jump. 35 of these across 17 lanes of a flat
  trimesh, 38 across the base race's butted decks. `TriMeshFlags.FIX_INTERNAL_EDGES`
  changes nothing (it fixes contact manifolds, not the controller's shape casts),
  and a larger controller offset only thins them out.
- **`Sliding` on a step's edge.** Walking onto a deck a little higher or lower
  than the one before, the capsule's rounded bottom touches the rim's chamfer or
  edge at 45–60°. That contact is the steepest floor-like one of the tick, so it
  became the ground normal and read as too steep to walk. Over steps of ±0.05–0.3
  this gave 1–2 tick episodes mostly, 3–5 ticks (the 100 ms seen in play) on a
  0.2 step, and up to 16 on a 0.3 one. A plain box step does it too. A timer
  before entering `Sliding` can't separate these from a real slope without
  delaying every real slide by longer than the longest blip.

## Decision

**Whether a Character is on the ground, and whether that ground is too steep,
is judged by the ground under it — not by whichever contact the sweep reported.**

- **A lifted sweep goes back down.** When the sweep reports no ground but the
  Character was grounded last tick, has no jump this tick and no upward speed
  (a launch, a bounce or an updraft all give it one), it casts its capsule down
  up to `GROUND_SNAP_DISTANCE`. If it finds standable ground (normal Y above
  `WALL_NORMAL_MAX_Y`), it moves down onto it and counts as grounded. This is
  the cast Rapier's own snap makes, for the one case it skips.
- **A steep contact has to be confirmed underfoot.** `Sliding` needs the ground
  contact to be too steep *and* no walkable ground under the footprint: five
  downward rays, from the capsule's centre and a radius out along each axis,
  reaching `GROUND_SNAP_DISTANCE` below the feet. On a real slope every ray lands
  on the slope. On a rim, at least one lands on a deck, because a chamfer on
  these Assets is narrower than the ring. The rays are cast only when the contact
  is already too steep.
- Both queries skip Characters: another Character is never the floor.

No replicated state is added. Both are pure functions of position and the
world, so client prediction and the server agree as they did before (ADR 0037).

## Consequences

- Measured after: 0 airborne ticks and 0 `Sliding` episodes across every probe
  above, including the base race's route. The existing Sliding tests (a real 45°
  ramp) and the netcode integration statistics are unchanged.
- The regression tests live in `RapierSimulation.test.ts`: a Dash across a flat
  two-triangle trimesh, and walking over a 0.1 box step and a 0.2 chamfered
  trimesh step.
- A walk that runs over a crest now stays on the ground wherever ground is within
  `GROUND_SNAP_DISTANCE` below. It still leaves the ground over a real gap or a
  drop deeper than that.
- Still open, and not addressed here: a Dash across a trimesh's *inner* edge
  (the diagonal between two triangles of one face) sometimes gets a nearly
  horizontal contact and takes it as a wall, knocking the Character down with
  `WallImpact` (about 4% of 100 m runs on a flat two-triangle floor, before and
  after this change).
- The ground contact is still used as-is for `slopeSpeedMultiplier` while
  walking, so crossing a rim can still change walking speed for a tick or two.

## Alternatives rejected

- **A timer before entering `Sliding`.** The rim episodes reach 3–5 ticks, and
  some 16. A timer long enough to hide them delays every real slide by as much.
- **`TriMeshFlags.FIX_INTERNAL_EDGES`.** Measured: no change to either glitch.
- **Hiding it in the renderer** (holding the ground pose through a short
  airborne span). The simulation would still be airborne for that tick. That
  also affects Dash, Surfaces and coyote time, and every remote Character would
  still see the flicker in replicated state.

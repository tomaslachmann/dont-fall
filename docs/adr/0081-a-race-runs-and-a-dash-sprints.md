# 0081 — A race runs, and a Dash sprints

## Context

BLIP v7 (`BLIP_Animated_v7.glb`, supplied 2026-09-17) is v6 with its gaits
reworked: `Walk` and `Run` now share one stride, and there is a new `Sprint`.
In all three, the left foot lands in front at the start of the clip and the
right foot halfway through. `Run` grew from 0.67 s to 0.8 s. Sprint is 0.6 s
and Walk stays at 1.2 s. The rig's notes say the other 48 clips, the model and
its materials are unchanged. Compared against the v6 file before the swap, the
node names and every other clip's length are the same, and `Sprint` is the
only new name.

Until now a moving Character played `Walk`, and a Dash played `Run`. The
user's call (2026-09-17): this is a racing game, so the ordinary gait is the
**Run**. `Walk` is only for the slow end, while a Character is still getting up
to speed. `Sprint` is the Dash.

The rig came with its own adapter (`BLIP_Locomotion_v7.js`). It blends all
four clips by the body's speed and changes their pace so the feet don't slide.
Its speeds are the clips' own, in rig units. BLIP is drawn at
`CHARACTER_VISUAL_HEIGHT` (2.05 of its 3.52 units, a scale of about 0.58), so
in world units:

| | clip speed at 1× | the game |
|---|---:|---|
| Walk | 0.40 u/s | |
| Run | 1.20 u/s | `WALK_SPEED` is 6 |
| Sprint | 2.31 u/s | a Dash peaks at `WALK_SPEED + DASH_SPEED`, 21 |

## Decision

**A moving Character runs. It walks only below a speed, and a Dash is the
Sprint for its whole burst.**

- **The gait follows speed, with hysteresis.** `selectLocomotion` now takes
  the Character's horizontal speed. From a standstill it walks, and it runs
  once the speed reaches `RUN_FROM_SPEED` (0.35 × `WALK_SPEED`, 2.1 u/s). Once
  running, it walks again only below `WALK_BELOW_SPEED` (0.25 × `WALK_SPEED`,
  1.5 u/s). The gap stops a speed that sits on the boundary from switching
  clips every frame. An interpolated remote velocity can do that, and so can
  a Character slowing down on ice. The local Character reads its own predicted velocity, and a
  remote one reads its replicated velocity. The protocol is unchanged.
- **Where that leaves `Walk`.** On ordinary ground a Character reaches
  `WALK_SPEED` in a single tick (ADR 0035's saturating factors), so it never
  shows there. It shows on the first metres on ice, on a slow pad, and while
  pushing against a wall. Mud runs: half of `WALK_SPEED` is 3, and still
  about 2.27 up the steepest walkable slope, above both thresholds. That has
  to hold from a standstill too, where the first frame has no speed yet and
  walks, so the walking threshold is the one that decides.
- **`Sprint` covers the whole Dash**, from its first tick, even before the
  build-up has any speed and with no direction held. That keeps the old
  `Run` rule. Airborne it is still the jump, and while staggering it is still
  `Wobble_Walk` (ADR 0072).
- **A change of gait keeps its step.** `crossfadeLocomotion` starts the
  incoming gait at the point of the stride the outgoing gait had reached,
  instead of on its own first frame. Every Dash starts mid-Run. Restarting the
  Sprint on its left foot while the Run is on its right would blend opposite
  legs for the length of the fade. The shared stride is pinned against the
  real file (`modelBones.test.ts`), not taken from the rig's notes.
- **Every gait still plays at its authored pace.** At the clips' own
  calibration, a Run with no foot slide would play at 5× (12 steps a
  second), and a Sprint at a Dash's peak at 9×. The game moves far faster
  than the clips were measured for, so the feet slide. That is the trade.

## Consequences

- `CharacterActions` gains `sprint`. `actionFor("sprint")` falls back to
  `run`, then `walk`, for a rig without one.
- The rig's adapter is not used. Its crossfade takes over all four clips'
  weights and times every frame. Here one action is current, and the
  jump, the Grab and the knockdown crossfade over it. Running the adapter
  would mean replacing that on both the local Character and every remote one.
- Whether the Run should speed up with the Character (at a pace short of no
  foot slide) is open. So are the two thresholds. They are live checks for
  the user, and render-only constants in `locomotionAnimation.ts`.

## Alternatives rejected

- **Walking for a fixed time at the start of every move.** The request was a
  speed ("walk only up to a certain acceleration"), and the game has no
  acceleration on ordinary ground. A timed walk would draw a slow start the
  body isn't making.
- **Foot-locked pacing.** Rejected for the numbers above.
- **One threshold.** A remote Character's velocity is interpolated, and on
  the boundary it would switch between two gaits every frame.

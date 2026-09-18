# 0102 — Ice takes your feet on any crash, mud on the run

## Context

The user asked for two Surface hazards on 2026-09-18:

> 1 - na ICE surface narážka do čehokoliv = ragdoll
> 2 - na MUD surface šance na slip->ragdoll

ADR 0101 had already said where each one goes: a crash is asked of
`SurfaceController.crashMinSpeed`, and a slip while running is a new hazard on
`SurfaceController`, asked from the capsule tick. It left one question open,
whether "anything" includes other Characters. Asked on 2026-09-18, the user
answered:

- **Ice, what counts:** everything, **other Characters included**. The one
  run into still takes only its ordinary Bump.
- **Ice, how fast:** a closing speed of **~1 u/s**. Any real movement into
  something counts, and standing against it does not.
- **Mud, when:** all three triggers offered: **running, a hard landing, and a
  sharp turn**.
- **Mud, how often:** **~3% per second** of running.

## Decision

**Both hazards are Surface fields, read by `SurfaceController`.** `SURFACES.ice`
gains a `crashKnockdown`, and `SURFACES.mud` gains a `landingKnockdown` (the
ice field from ADR 0092) and a `runningSlip`. The numbers are named constants in
`tuning/surfaces.ts`.

### Ice: any crash

- **`crashMinSpeed(intoCharacter)`** returns `ICE_CRASH_MIN_SPEED` (1) on ice for
  anything. On every other Surface it returns `WALL_IMPACT_MIN_SPEED` (9) for a
  wall and `undefined` for a Character, so a Bump stays one-sided there (M2
  ticket 04). The knockdown uses the wall-Impact rule's own knockback and cause
  (`"WallImpact"`), because it is that rule with the Surface lowering the
  threshold.
- **A crash counts only at arrival.** Ice's grip lets velocity keep building
  against whatever blocks the Character, because the velocity model never took
  out what a wall stops. Measured: a Character standing against a wall on ice
  and pressing toward it went down after ~0.25 s without moving. On a Surface
  with a crash rule, a touch too slow to count now removes the velocity into
  that surface (`MovementController.stopAgainst`). At full grip this would
  change nothing, since the next tick rebuilds velocity from the wish, so it is
  applied only where a crash rule exists.
- **A crash into another Character is detected from the world, not from the
  sweep.** Rapier's character controller (0.20) can stop one capsule against
  another without reporting the contact. On ice this happened in 3 of 50
  run-ups: in each, the runner then pushed the other Character across the ice
  with no crash at all. A wall went down in 50 of 50. `crashIntoCharacters`
  therefore asks `intersectionsWithShape` with the capsule widened by
  `CHARACTER_TOUCH_MARGIN` (five skin widths), filtered to Character capsules.
  The normal runs between the two capsules' nearest points, so a Character
  standing on another's head is not a side-on crash. It runs before the sweep,
  once velocity is final. With the probe, all 50 run-ups crashed.

### Mud: running, turning, landing

- **Running:** at or above `MUD_SLIP_MIN_SPEED` (half of mud's top speed,
  1.2 u/s) there is a draw each tick at the per-tick share of
  `MUD_RUN_SLIP_CHANCE_PER_SECOND` (3%). Speed is measured against the floor:
  the belt underfoot is subtracted, so standing still on a mud belt is not
  running. A Staggering Character (0.84 u/s in mud) can never slip.
- **Turning:** if the direction changes by more than `MUD_TURN_SLIP_MIN_ANGLE`
  (120°) from one tick to the next, with both speeds at or above the minimum,
  the draw is instead a coin flip (`MUD_TURN_SLIP_CHANCE`, 0.5). A 90° strafe is
  ordinary steering. Because mud has full grip, a turn on the keys turns the
  velocity within the same tick. The turn is judged from the velocity the
  Character brought into the tick to what the movement model made of it,
  *before* a shove, a launch or a Volume is added. After a correction, the
  velocity brought into the tick is `ReconcileBase.velocity`, so the check
  needs no new replicated or reconciled state.
- **Landing:** mud gets ice's `landingKnockdown` shape, with
  `MUD_LANDING_KNOCKDOWN_MIN_SPEED` 11 and a 0.5 chance. Only a real drop
  qualifies, never a hop.
- The sprawl follows the Character's own momentum: along the old heading on a
  turn, along the run otherwise. Every slip uses `SLIP_IMPULSE`, which is
  `ICE_LANDING_KNOCKDOWN_IMPULSE` renamed now that ice no longer has the only
  slip. The cause is `"Slip"`.
- **One draw per tick.** Every hazard that depends on chance reads the same
  `slipRoll(id, tick)` (ADR 0092), so the client predicts it. If two hazards
  fire on the same tick, they still produce one knockdown, because only the
  strongest queued Impact counts.

## Consequences

- **A crash into a Character is server-only**, like a Bump (ADR 0012). The
  client's world holds only its own Character, so the runner learns of the
  knockdown from the snapshot, one round trip late, and snaps into it (ADR
  0013). Walls, Props and Moving Segments are predicted as before.
- `SurfaceController.reconcile` clears both new hazards, like the other
  Surface fields. A replay's first tick reads the default Surface, which has no
  hazard.
- **The authored Tracks still walk.** The scripted walker slipped twice on
  Slip Stream's mudflat (63 m, ~26 s at mud pace). It got up at
  `RAGDOLL_MAX_TICKS` and finished. None of the four Tracks' walks crashed on
  ice.
- Measured over 60 s on a mud floor: standing, 0 slips; running a circle, 3;
  reversing every second, 16; strafing 90° every second, 3 (these come only
  from running).
- **Waiting on the user:** whether 1 u/s on ice and 3%/s, 120° and 0.5 in mud
  play right. Ice rails and bumpers (Slip Stream's ice river, Cog Arena's and
  Sky Rings' ice) now knock down on any real contact, which is the rule as
  asked but worth feeling. One more thing needs a live check: whether being
  dragged sharply by a Grab across mud reads as fair when it triggers the turn
  slip.

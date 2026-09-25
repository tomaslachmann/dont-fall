# 0128 — A Prop is Lifted and Tossed as the rig does it

## Context

The user, on 2026-09-24, dropped `BLIP_Carry_v1`: our own
`blip_with_coliders.glb` (every collider, node and older clip byte for byte the
same) plus three clips for carrying a Prop (ADR 0125):

| Clip | Length | What it is |
| --- | --- | --- |
| `Pickup_Ground` | 1.8 s | Bends down, the hands meet the Prop at **0.8 s** (`pickup_contact`), stands up holding it. Its last frame is the hold. |
| `Carry_Walk` | 1.2 s, loop | Walking with the Prop held at the belly, in step with `Walk`. |
| `Throw_Item` | 1.2 s | Wind-up and throw from the hold; the Prop leaves the hands at **0.4 s** (`item_release`), then back to `Idle`. |

Until now a pick-up and a Toss happened on one Tick, and the carrier held the
Prop at arm's length in `Grab_HoldOut`'s pose. The new clips hold it closer and
lower: at the game's scale the hands are 0.45 ahead of the capsule's centre and
0.03 above it (they were 0.88 and 0.52), and 0.6 apart.

Settled with the user in three question rounds the same day.

## Decision

### A Lift takes time, and the Prop comes up at the touch

Grab at a Prop starts a **Lift**: `Pickup_Ground` played **1.5× as fast**
(`PROP_LIFT_SPEEDUP`), so 1.2 s. The user found 1.8 s too long. The carrier
stands where it is for the whole of it: it does not walk, turn, jump, Spin or
let go. The Prop lies where it was until the hands reach it. That is 0.8 s into
the clip, 0.53 s into the Lift. Only then is it picked up, the moment ADR 0125
used to pick it up at: it turns kinematic, its colliders go off, and a Bomb
lights. A carrier knocked down or grabbed before the touch picks up nothing.
A Prop that has rolled out of reach by then is not picked up either.

A Prop that is **flying** when Grab reaches for it is caught straight into the
hold, with no Lift. That is one moving at `HURLED_BODY_MIN_SPEED` or faster,
such as a Shooter's bomb (ADR 0127) or a ball knocked off a ledge. A 1.2 s bend
to the ground would never catch anything in the air, and catching a bomb to
throw it back is the point of ADR 0127. This was not asked. It is the side
that keeps ADR 0127 working.

### A Toss has a wind-up, and the Prop leaves at the release

A tap of Hit starts `Throw_Item`. The carrier stands, and the Prop leaves its
hands **0.4 s later**, straight ahead. What remains of the clip (0.8 s) is drawn only, and walking cuts it
short.

### The server knows times, not curves

The server and the carrier's own prediction know only when things happen: the
Lift's length and its touch, and the Toss's release, all read from the GLB's own
clip events, and the grip (where the hands are while holding). **No hand curve
is copied into the simulation.** The Prop is at the grip from the touch on, and
leaves from the Toss's release point, both measured once, as ADR 0125 measured
the old grip.

What moves the Prop *between* those points is the drawing. **Every client draws
a carried Prop in its carrier's hands as the rig has them that frame**, between
the two hand bones, on every carrier and not only its own. That covers the rest
of the Lift, the wind-up and a Spin's crossfades with nothing to keep in step.
This was the user's own call ("aby to bylo udržitelnější"), over replaying the
clips' hand curves on the server. It replaces ADR 0125's `carriedPropPose`
rebasing. Physics keeps using the grip, which only a swung Prop's reach reads.

### A Spin, a Hurl and a put-down are what they were

A held Hit that becomes a Spin still spins with the arms out (`Grab_HoldOut`),
and the Prop is at that pose's grip while it does. Hurling and putting down play
what they did, with no new clip. Everything else with a Prop in hand is the new
hold: `Carry_Walk` while walking, and `Pickup_Ground`'s last frame while
standing or in the air.

### A big Prop is held higher, so part of it is between the hands

A Prop narrower than the hands' spread sits between them. A wider one is held
the way a person holds a big ball. Its middle goes up and forward from the
hands, far enough that its cross-section at hand height is exactly as wide as
the hands are apart. It is tilted as high as it can go while still clearing the
carrier's body, and pushed further out only if even straight ahead is not
enough (`propGripOffset`). The user's ask: "nemůžeme větší prop výše zvednout,
ať se vždy vleze část mezi ruce?" The same rule places it on the server, from
the measured grip, and on every client, from the drawn hands.

### Replicated as a start and a count

`CharacterSnapshot.liftStartTick` is the Tick a Lift started, and
`CharacterSnapshot.tossMs` how far into its wind-up a Toss is. Both are `null`
otherwise. Every client plays the clip from where they put it, and the
carrier's own prediction stands still over exactly the Ticks the server does.
JSON carries them, so the protocol only gains two fields.

## Consequences

- `blip_with_coliders.glb` is replaced by the drop. `BLIP.glb`, which the game
  loads, gains the three clips grafted in by `pnpm graft:blip`. Its own 51
  clips, their extras, the skin UVs and the material stay as they are.
- A pick-up now costs 1.2 s standing still, and a Toss 0.4 s. Those are real
  commitments in a chaotic Round. Whether they play right is the user's live
  check, along with the look of the attach at the touch. The Prop jumps from
  where it lay into the hands, as far as `GRAB_RANGE` allows.
- `PROP_GRIP_REACH`/`PROP_GRIP_LIFT` now measure `Pickup_Ground`'s last frame.
  Their old values move to `PROP_SPIN_GRIP_*` for the Spin. `modelBones.test.ts`
  holds all of them, and the clip timings, to the real file.
- The seams between the new clips do not meet bone for bone, although the
  README says they do. The hands meet: end of `Pickup_Ground`, start of
  `Carry_Walk` and start of `Throw_Item` all put them at the same point. The
  arm joints differ by up to 89°. The 0.15 s crossfade covers it, and the
  Prop is drawn from the hands, so it cannot slip.

## As built

- **A Toss's wind-up is the carrier's own, and predicted.** The tap is
  decided in `InteractionController`, which counts the wind-up
  (`CharacterSnapshot.tossMs`, in `ReconcileBase` like `spinMs`). The carrier's
  client stands still on its own tap, not a round trip later. `GrabHolds`
  only lets go when told (`takeToss`). Its release faces the way the carrier
  does then. The first ticks of a Spin turn it slightly, so a Toss goes where
  the body is drawn facing, not where it faced when Hit was pressed. A Lift is
  the server's (`liftStartTick`) and reaches the carrier's prediction through
  `syncOwnHold`. `liftHolds` decides, the same on both sides, which Ticks it
  stands still for.
- **The wire carries a start and an elapsed time, and the drawing a time.**
  `RenderCharacter.liftMs` is counted from the drawn sub-tick, so the clip
  does not step at 30 Hz. The local body is drawn from the server's row for the
  Lift and the Toss, where the Prop is, and from the prediction for a Spin and
  for its own stillness.
- **A Prop is drawn from its carrier's hands** (`CarriedPropPlacer`,
  `Stage.holdCarriedProps`). The Stage calls it after every rig has been
  animated. It reads the two hand bones and hangs the Prop at
  `handsOffset(radius, grip)`. It moves between the carry's grip and a Spin's
  over the gait crossfade's 0.15 s, as the arms do. `carriedPropPose` now only
  turns the local carrier's Prop with its drawn facing.
- **The rule for a big Prop rarely lifts anything with this pose.** The
  carry's hands are on the belly (0.45 ahead, and the body's front at that
  height is 0.44). Every Prop wider than a centimetre is too wide to fit
  between them and clear the body, so it goes out in front at hand height,
  with the hands against its back. That is what a person holding a big ball
  does. The rule lifts a Prop only for poses with more room. The tests hold
  the rule for any grip.
- **A flying catch is `lengthVec3(velocity) ≥ HURLED_BODY_MIN_SPEED`.** A
  Prop flying from somebody's throw still cannot be caught, as in ADR 0125.

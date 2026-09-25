# 0125 — A Prop can be carried and thrown

## Context

The user, on 2026-09-23: Props (ADR 0095) should be grabbable, so that you can
walk around with one or throw it away ("aby se assety co mají prop dají grabnout
a chodit s nima nebo zahodit").

Today a Prop can only be shoved. You walk into it and it takes part of your
velocity (`Prop.shove`). Grab (ADR 0093, ADR 0104) reaches only for Characters:
`nearestInCone` looks at Characters only, and `GrabHolds` knows only a held
Character. A Character is a kinematic capsule, so it is an infinitely heavy
wall to the physics. A dynamic body flying into one bounces off, and the
Character feels nothing. That is why the Shooter's ball needs its own rule to
knock anyone down (`resolveProjectileContacts`, ADR 0119).

The Props the four authored Tracks place weigh 1.5 (a cone), 5.5 (a 1.4 m
ball) and 11.7 (a 1.8 m ball). A Prop's mass is the volume of its footprint
times `PROP_ASSET_DENSITY`, clamped to 1.5–40.

Settled with the user in two question rounds the same day:

- **Up to a limit, and weight slows you.** A Prop above `PROP_CARRY_MASS_MAX`
  cannot be lifted and is only shoved, as today. Below that limit the carrier
  walks and turns slower the heavier the Prop is.
- **Both ways to throw.** A tap of Hit tosses it straight ahead. Holding Hit
  Spins and letting go Hurls, the same vocabulary as a held Character. Grab
  puts it down.
- **A thrown or swung Prop hurts by momentum**: speed times weight, "the way
  physics would". A heavy ball knocks a Character down even when slow, and a
  cone only nudges even when fast.
- **Jumping, up to a weight, and lower the heavier it is.** No Dash while
  carrying anything.
- **Being knocked down drops it.** There is no stealing: a Grab aimed at a
  carrier catches the carrier, as it does today.

## Decision

### Grab reaches for a Prop

Grab's targeting finds the nearest Character in its cone. **Only if there is
no Character does it take the nearest liftable Prop in the same cone.** A
Survival Round is about grabbing people, and a cone lying beside a person must
not steal the catch. (This priority is not the user's call. It is the side
that keeps ADR 0104 unchanged.)

A Prop is liftable if it is an ordinary Prop (not a Projectile), weighs at
most `PROP_CARRY_MASS_MAX`, is not already carried, and is not flying from a
throw. Being carried is `GrabHolds`' business, like a held Character: one hold
per grabber, and it is either a Character or a Prop.

### A carried Prop is posed by its carrier

While carried, the Prop **stops being a dynamic body**. It turns kinematic, is
put at its carrier's carry point every Tick, and **its colliders are off**, the
same way a held Character's capsule is. The carry point is the held body's
(`carryPoint`), moved further out by the Prop's own horizontal half-size so a
1.8 m ball does not sit inside its carrier. Nothing carried can be shoved,
Bumped, or pushed through a wall. When let go it turns dynamic again, with the
carry's velocity.

A carry has no window: a Prop does not struggle and does not wake up, so it is
carried until it is put down, thrown or dropped. There is no Grab immunity for
a Prop.

### Weight shows in everything the carrier does

`w = mass / PROP_CARRY_MASS_MAX`, from 0 to 1. Each effect runs linearly
between its light end and its heavy end:

- **Walking**: `PROP_CARRY_SPEED_LIGHT` → `PROP_CARRY_SPEED_HEAVY` times the
  walking pace.
- **Turning**: `PROP_CARRY_TURN_LIGHT` → `PROP_CARRY_TURN_HEAVY` times the turn,
  clamped on the server the same way a held Character's turn is (ADR 0104).
- **Jumping**: only with a Prop of at most `PROP_JUMP_MASS_MAX`, and at
  `PROP_CARRY_JUMP_LIGHT` → `PROP_CARRY_JUMP_HEAVY` of the jump speed, measured
  against that limit.
- **Dash: never.** Hit is taken by the throw, and Grab by the let-go.
- **Throwing**: a toss and a Hurl leave at their own speeds times
  `PROP_THROW_LIGHT` → `PROP_THROW_HEAVY`. A cone flies further than a ball.

### Tap to toss, hold to Spin

With a Prop in hand, Hit counts ticks exactly as with a Character (ADR 0104).
Released within `PROP_TOSS_TAP_TICKS`, it is a **toss**: straight along the
facing the Spin started from, at `PROP_TOSS_SPEED`, with an upward lift. Held
longer, it is a Spin and letting go is a Hurl. The speed comes from the wind-up
within `HURL_MIN_SPEED`–`HURL_MAX_SPEED`, and it is aimed by the tangent pulled
toward the steer (ADR 0104). Holding on past the overspin makes the carrier
dizzy, and the Prop flies off wherever the roll sends it, as a held Character
would. The first few ticks of a Spin barely turn, so a tap is not a turn.

### A thrown or swung Prop hits by momentum

A Prop in flight after a toss or a Hurl, or swung in a Spin, hits Characters by
**the Shooter ball's rule times its weight**. The closing speed goes through
`movingSegmentImpactMagnitude`, is multiplied by `mass / PROJECTILE_MASS`, and
then goes through the ordinary Stagger/Ragdoll thresholds. A Prop as heavy as a
Shooter ball hits exactly like one. Each Character counts once per flight or
pass, as ADR 0104 learned. The flight lasts until the Prop slows below
`HURLED_BODY_MIN_SPEED` or `HURLED_BODY_FLIGHT_TICKS` run out. A knockdown is
credited to the thrower (ADR 0110), with the cause `"Hurl"`.

This is about thrown Props only. A Prop rolling because someone shoved it hurts
nobody, as today. Making every moving Prop hurt would change how the existing
Tracks play, and nobody asked for that.

### Everything that ends a carry

- **Grab again**: set down in front, with the carry's velocity.
- **Toss, Hurl, dizzy**: thrown, and in flight.
- **The carrier goes down, is grabbed, takes a Respawn or leaves**: dropped
  where it is, with the carry's velocity.

### Replicated like a held Character

`PropSnapshot.carriedBy` names the carrier. On every client a carried Prop is
pinned to the snapshot like any other Prop, **with its colliders off**, so the
carrier's own prediction does not walk into what it is holding. The carrier's
own client draws the Prop the way it already draws a Character it holds
(`carriedPose`): its place relative to the carrier in the server's world,
rebased onto the carrier as drawn. Hands and Prop then stay together during a
Spin. The carrier's `grabbingId` stays a Character id. A Prop hold travels as
the carrier's new `carryingProp` (the Prop's index), so what the HUD and the
animations read about a held Character does not change.

## Consequences

- One hold per grabber, of two kinds. `GrabHolds` gains a second map and a
  second path through `updateGrabs`. The Spin, the Hurl's aim, the dizzy spell,
  the swing and flight checks, and credit are shared, not copied.
- A Prop you can pick up is one more reason to walk into a Survival arena's
  bumpers. The limits are first guesses taken from those Tracks: every Prop
  they place can be lifted, and the 1.8 m balls cannot be jumped with.
- Every number is a first guess in `tuning/fight.ts`. How they play is the
  user's live check.

## As built

- **One hold per grabber, two maps.** `GrabHolds.propHolds` sits beside
  `holds`. A carrier is `grabbing` in `InteractionController` with a
  `carriedMass`, and every weight-scaled effect reads that (`propCarry.ts`, pure
  functions of the mass). The Spin, Hurl aim, dizzy roll and swing re-hit window
  are the Character hold's own.
- **A carrier is not "in a hold" for anyone else.** Grab's targeting and a swung
  or hurled body now ask `inCharacterHold`, so a carrier can still be grabbed and
  hit, and drops its Prop when it is.
- **Only the authority picks up** (`liftableProps` is empty on a client). A
  client learns a carry from `carryingProp` and `carriedBy`. It then switches the
  Prop kinematic with its colliders off (`followCarrier`) and never predicts it,
  even one it was just pushing, because a dynamic body with no colliders would
  fall through the floor.
- **A Prop is reached at its near side**, not its middle, so a big ball is caught
  by the arms that touch it.
- **It is held where the arms are.** The first cut put it just clear of the
  capsule, at the held Character's lift, and the user saw the hands miss it
  (2026-09-23). `Grab_HoldOut` never moves its hands, so where they are is a
  measurement: `PROP_GRIP_REACH` ahead and `PROP_GRIP_LIFT` up, held to the real
  clip by `modelBones.test.ts`. A Prop's middle sits at that height, sunk half
  its depth past the hands (`propCarryReach`), and a big one further out so it is
  never inside its carrier. Free-roam drew no hold at all (a literal `NO_HOLD`,
  written when there was nothing solo to catch) and now reads its own snapshot.
- **A flight is hit through contact**, as the Shooter's ball is
  (`resolveThrownPropContacts`). A swing is hit by distance, because a carried
  Prop has no colliders to touch anything with.
- **Measured, not tuned:** with the first-guess numbers, a Toss of a Prop at the
  carry limit Staggers a Character standing in its way, and a cone thrown the
  same way does less. What knocks down is the user's to tune.
- The carrier's panel is `HoldingPanel` in a Prop form: `YOU HAVE A CONE`, TAP
  TOSS · HOLD SPIN, PUT DOWN, no Struggle bar, no timer.


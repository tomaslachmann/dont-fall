# 0127 — A Shooter can fire Bombs

## Context

The user, on 2026-09-23, right after Bombs (ADR 0126): a Shooter (ADR 0119)
should be able to fire bombs. A Shooter's balls are Projectiles: ordinary
Props parked in the cannon, fired on a Tick both sides compute and taken away
when their lifetime is up. A Bomb is a Prop with a fuse, lit by a pick-up and
spent by its blast.

Settled with the user in two question rounds the same day:

- **Fired lit.** A shot bomb leaves the barrel burning and goes off when its
  fuse runs out, wherever it is. Anyone quick enough can catch it and throw
  it back (hot potato, ADR 0126).
- **3 s of fuse by default**, the last 1.5 s fast. The author changes it on
  the Shooter.
- **A direct hit knocks down like a ball.** A shot bomb hits by the ball's
  rule (ADR 0119) on the way in, and then it goes off as well.
- **As many as balls.** The Shooter fires on its own period, up to the same
  in-flight cap (`SHOOTER_MAX_IN_FLIGHT`).
- **Always bomb A**, black (ADR 0126).
- **Set per placed Shooter**, as its ammunition: BALL or BOMB, in the SHOOTER
  panel and in MCP's `set_shooter`. A Track that does not say so fires balls,
  as before.

## Decision

**`ShooterTiming.ammo` is `"ball"` (the default) or `"bomb"`.** With bombs,
the Shooter's `lifeSeconds` is the fuse. A ball's life ends when it is taken
away, and a bomb's ends in its blast, so the one number the in-flight budget
is already measured by (`ceil(life / period)`) still measures it. A Shooter
with bombs and no life of its own burns `SHOOTER_BOMB_FUSE_SECONDS`.

**The shot bombs are that Shooter's Projectiles, and Bombs besides.** Each one
is a bomb A Prop (`projectile: true` and a `bomb` of the Shooter's fuse),
parked in the cannon until fired, exactly as a ball is. What changes:

- **Firing lights it.** The Shooter tells the Bombs it fired, and the fuse
  counts from that Tick. It has no last holder until someone catches it. A
  blast nobody held is credited to nobody: it is the Track's.
- **The blast takes it away, not its lifetime.** The Shooter never parks a
  bomb when its life is up, because the fuse is the life. A spent shot bomb
  does not return where it was placed. It waits, parked where it went off,
  until its Shooter fires it again.
- **It is shown going off before it is reused.** A Shooter keeps
  `ceil((life + BOMB_SPENT_HOLD_SECONDS) / period)` bomb bodies, so the one it
  fires next has finished its explosion where it went off. This is one or two
  bodies more than it keeps balls. The in-flight cap still counts the ones in
  the air.
- **It can be picked up**, unlike a ball. Catching it neither relights it nor
  puts it out.
- **Below the kill plane it goes out** (ADR 0126), and it waits for its Shooter
  like a spent one.

A Track that fires bombs needs bomb A's file, so `assetIdsOf` names it for
any Segment whose Shooter fires bombs. Without the file (a builder that has
not loaded it), the Shooter fires balls and the resolve warns.

## Consequences

- A Survival arena's cannons can now clear a platform on their own. How often,
  how far and how long are the author's numbers, and the user's to play.
- The Snapshot's spent bomb row carries its blast Tick. A shot bomb has no
  return Tick, so the explosion cannot be timed from one.

## As built

- **One flag, read in four places.** `ShooterTiming.ammo` / `ShooterDef.ammo`
  (`track/Shooter.ts`) are read by `shooterDefOf` (the default fuse),
  `shooterBodies` (the extra bodies), `resolveShooters` (bomb A Props, sized so
  the bomb is as wide as the ball it replaces) and `assetIdsOf` (bomb A loaded).
- **`Shooters` tells, `Bombs` lights.** `Shooters` gets an `onFired` hook and
  skips a bomb when a ball's life would park it. `RapierSimulation` passes the
  hook to `Bombs.fired` on the authority only. Spent rows now carry `blastTick`,
  because a shot bomb has no `returnTick` to time its explosion from.
- **Measured on the way.** A bomb is taller than the ball, so the barrel
  clearance is now its own reach (`Prop.radius`), never less than the ball's. A
  bomb is fired with its middle at the muzzle point, not its foot
  (`Prop.fire`). With the barrel held level, a shot bomb knocks a Character down
  on arrival exactly as a ball does (`Obstacle`), before any blast.
- **Caught, then thrown**, it hits by the thrown Prop's rule alone.
  `resolveProjectileContacts` skips a Prop a Player threw, so one throw is
  never two Impacts.
- **The builder** has AMMO · BALL / BOMB in SHOOTER. Switching resets the life
  to that ammunition's own (a ball's roll is not a fuse), and the life's label
  reads FUSE for bombs. MCP `set_shooter` takes `ammo`.

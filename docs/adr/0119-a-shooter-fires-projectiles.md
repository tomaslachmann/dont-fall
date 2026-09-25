# 0119 — A Shooter fires Projectiles

## Context

`DF_shooter.glb` (2026-09-21) is a cannon 2.29 × 1.9 × 2.51 on three nested
pivots: `Shooter_YawPivot` (±35° over 3.75 s), `Shooter_PitchPivot`
(−5°…+25°, so ±15° about a rest of +10°), `Shooter_RecoilPivot` (0.18 m back and settle), plus two
`MuzzleFlash` spheres that step from scale 0 to 1 for 0.17 s.

`CONTEXT.md` has defined **Projectile** since M3 — "a dynamic physics body
spawned at runtime by an Obstacle, with an initial velocity, that threatens
the Character on contact and despawns after its lifetime" — and has carried
"full spawn/replication design deferred (post-M3)" ever since. Every body in
a Round today exists from the moment the world is built.

The user's calls on 2026-09-21: it fires a **physical ball**, it **shoots
where it points**, the sweep range is the author's ("máme na to i animace,
tak budeme stříhat jejich rozsah"), the cadence is a **period in the
inspector** and each ball **lives a fixed time**, and a hit knocks down
**when it is above the Impact speed** — the rule the game already has, not a
new one.

## Decision

**A Shooter is an Asset that spawns a Projectile every `period` seconds, and
everything about the shot is a function of `(Segment, Tick)`.**

- **Aim is a pure function of the Tick.** The yaw and pitch sweeps are
  Parts (ADR 0116) moving on author-set ranges and periods, defaulting to the
  clip's own; a range of `0` is a cannon that stares one way. The shot leaves
  along the barrel's direction **at the Tick it fires**, so what the player
  reads off the muzzle is where the ball goes.
- **A Projectile's birth needs no message.** Both sides compute the same
  spawn Tick, position and velocity from the Segment and the Tick, exactly as
  both sides compute a Moving Segment's pose. Its *flight* is a dynamic body
  and replicates like a Prop (ADR 0095's pipeline, unchanged).
- **The ball is `kaykit_ball`'s shape**, spawned with an author-set speed and
  despawned after an author-set lifetime — never on a hit, so a ball that has
  done its work keeps rolling around and being in the way.
- **A hit is an ordinary Impact.** Above the closing-speed threshold (ADR
  0037) it knocks down; below it, it shoves. A fresh shot is always above it;
  a leftover rolling across the deck is a nuisance, not a knockdown. No new
  rule, and a slow Shooter is therefore a gentle one.
- **The number of Projectiles alive is bounded before the Round runs**:
  `ceil(lifetime / period)` per Shooter. Publish validation refuses numbers
  that put more than `SHOOTER_MAX_IN_FLIGHT` in the air at once, so no Track
  can quietly cost a Round its frame budget.
- **The recoil and the muzzle flash are presentation**, driven off the same
  spawn Tick on each client. The flash is two authored spheres scaling for
  0.17 s, which is what the file already does.

## Consequences

- Projectile stops being a deferred word in `CONTEXT.md` and becomes an
  entity a Round actually holds, with a bounded population.
- A Shooter's difficulty is three numbers an author can read: how often, how
  fast, how wide it sweeps.
- A Projectile lands on the same Impact rule as everything else, so nothing
  new has to be tuned to make a shot feel fair — but a ball that outlives its
  usefulness is deliberately left in play, because clutter on a narrow deck is
  the interesting half of the trap.

## As built

- **The two aiming axes are the Shooter's own, not a Motion** (the user, mid-ticket: "je na
  2 osách a musí být independentní"). A `SegmentMotion` is *one* movement, so expressing a
  cannon's yaw and pitch as two Motions on two Parts tied them to one authoring surface
  where an author's Motion would have overridden both with the same thing. `ShooterDef`
  carries a `yaw` and a `pitch` sweep instead, each with its own range, period and phase,
  and the Parts that collide follow them. Their default periods are deliberately different
  (3.75 s and 2.6 s) so the muzzle covers an area rather than retracing the one line the
  clip's matching 3.75 s would have given it.
- **A Projectile is a recycled Prop, not a new body.** Each Shooter's balls exist from the
  moment the world is built — `ceil(life / period)` of them — and are fired and parked
  rather than created, which keeps `SimState.props` a fixed array the client's whole
  prediction pipeline already indexes by position. `live` on the snapshot is what tells a
  renderer (and the interpolator) that the flag flipping is a teleport, not a journey.
- **Three measurements changed the numbers.** A ball born exactly at the muzzle overlaps
  the cannon's own collider and the solver shoves it out — it left at 15.7 u/s instead of
  24, so a shot is born a few radii clear. A ball read *after* the step has already bounced
  off the capsule it hit, so its arrival speed is remembered before the step. And a shot at
  18 u/s arriving six metres out closes at only 10.5 along a contact normal that is rarely
  square: it Staggered and never knocked down, which is why the default speed is 24 —
  where a square hit closes at 17 and a glancing one at 13.6, so the gate does real work.
- **Continuous collision detection, on Projectiles only.** At 24 u/s a 0.5 m ball covers
  0.8 m in a Tick and stepped straight through a Character before this.
- **The ball is a plain ball**, not `kaykit_ball`'s art: its shape is what the ADR named,
  and using the KayKit file would make every Track with a cannon load an Asset nothing
  places. The radius fits the authored muzzle ring.
- **The recoil and the muzzle flash are read off the balls**, not off a new field: the Tick
  a ball turns live *is* the shot, so `ShooterEffects` watches that edge and drives the
  authored `Shooter_RecoilPivot` and the two scale-0 flash spheres. Nothing new on the wire.
- **The publish bound is checked where it can be.** Both numbers on the Segment are
  measurable against `SHOOTER_MAX_IN_FLIGHT` and refused; one alone leans on its Asset's
  other half, which a publish cannot see, so `shooterDefOf` caps the lifetime instead.

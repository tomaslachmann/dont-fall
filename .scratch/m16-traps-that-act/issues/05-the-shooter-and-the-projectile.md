# 05 — The shooter and the Projectile

**What to build:** A cannon that sweeps on its own clock and fires a ball along
its barrel, and the Projectile it fires — the first body a Round spawns at
runtime. ADR 0119.

**Blocked by:** 02

**Status:** done on tests (2026-09-21) — every visual and feel check is the user's

- [x] The yaw and pitch pivots are moving Parts on author-set ranges and periods,
      defaulting to the clip's, which `dfAssetDefs.ts` holds as `SHOOTER_*` (yaw
      ±35° over 3.75 s; pitch ±15° about a rest of +10°, the pose baked into the
      file). A range of `0` is a
      fixed cannon
- [x] A `shooter` Attachment: firing period, muzzle speed, Projectile lifetime.
      Publish refuses a combination whose `ceil(lifetime / period)` exceeds
      `SHOOTER_MAX_IN_FLIGHT`
- [x] A Projectile spawns at the muzzle with the barrel's direction **at the Tick it
      fires**, derived identically on both sides from `(Segment, Tick)` — no spawn
      message. Its flight replicates as a dynamic body, the pipeline Props already
      use
- [x] The ball is `kaykit_ball`'s shape, its mass following its size as a Prop's
      does (ADR 0095)
- [x] It despawns at the end of its lifetime, never on a hit — a spent ball keeps
      rolling and being in the way
- [x] A hit is an ordinary Impact (ADR 0037): above the closing-speed threshold it
      knocks down, below it, it shoves. Nothing new to tune
- [x] The recoil and the two muzzle-flash spheres are drawn off the same spawn Tick
      on every client; presentation only, and a test holds that line
- [x] Authoring: a SHOOTER panel in the builder's inspector and an MCP setter; the
      builder's viewport previews the sweep, not the firing
- [x] Tests (shared): the spawn Tick, position and velocity are identical on two
      independently stepped worlds; a fresh shot knocks down and a rolled-out one
      does not; the population never exceeds the bound; a Projectile is gone at its
      lifetime; publish refuses an over-budget Shooter

## Notes

- `CONTEXT.md`'s **Projectile** entry loses "full spawn/replication design deferred
  (post-M3)" here.
- Deliberately not built: a Shooter that tracks a Character (the user weighed it and
  did not take it).

## As built

See ADR 0119's own "As built" for what building it settled. In short: the two aiming axes
became the Shooter's own data rather than two Motions (the user's call, mid-ticket, and the
right one — a Motion is one movement); a Projectile is a recycled Prop so the protocol and
the client's prediction pipeline are untouched; and three measurements moved the numbers —
a ball born inside its own barrel, a ball read after the solver had already bounced it, and
a muzzle speed that only ever Staggered.

- **Nested Parts compose now** (`under`, ADR 0116), which ticket 02 had left: the barrel
  pitches inside a carriage that is turning, and its body is posed and collided where the
  model has it. The builder's preview composes the same chain.
- **What the live check is for:** whether a cannon sweeping an area is readable or just
  unfair; whether 24 u/s is the right line between a shove and a knockdown; whether balls
  rolling about a deck are fun or clutter; and how the flash and the kick look, which no
  test here can say.

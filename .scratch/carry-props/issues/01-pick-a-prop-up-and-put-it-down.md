# 01 — Pick a Prop up and put it down

**What to build:** Grab takes the nearest liftable Prop in its cone when no
Character is there, and the carrier walks, turns and jumps as slowly as its
weight says, with no Dash. Grab again puts it down, and being knocked down
drops it. ADR 0125.

**Blocked by:** —

**Status:** done on tests (2026-09-23)

- [x] Tuning (`tuning/fight.ts`): `PROP_CARRY_MASS_MAX`, `PROP_JUMP_MASS_MAX`, the
      light and heavy ends of speed, turn and jump
- [x] Targeting: a Character first, then the nearest liftable Prop in the same cone
      (not a Projectile, not over the limit, not carried, not in flight)
- [x] `Prop.carry` / `Prop.release`: kinematic, colliders off, posed at the carry
      point pushed out by the Prop's half-size; released dynamic with the carry's
      velocity
- [x] `GrabHolds`: a Prop hold with no window, ending on Grab, a knockdown, being
      grabbed, a Respawn or leaving
- [x] The carrier: `carryMultiplier` by weight, a turn clamp, jump only up to
      `PROP_JUMP_MASS_MAX` and lower by weight, no Dash
- [x] Snapshot: `PropSnapshot.carriedBy`, `CharacterState.carryingProp`; a client
      pins a carried Prop with its colliders off, and the carrier's own client draws
      it in its drawn hands (`carriedPose`)
- [x] Tests (shared): pick-up priority and the weight limit; walking/turning/jumping
      by weight, no Dash; put down and dropped on a knockdown; a carried Prop cannot
      be shoved and does not collide

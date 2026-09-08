# 01 — A Hit with weight

**What to build:** Make a Hit's force depend on how well it was thrown, so a solid connect knocks a
Character down and a glancing one does not.

**Blocked by:** nothing.

**Status:** ready-for-agent

## Why

`RapierSimulation.resolveHit` applies a flat magnitude:

```ts
target.applyImpact(scaleVec3(direction, HIT_IMPACT_MAGNITUDE), "Hit");   // HIT_IMPACT_MAGNITUDE = 6
```

against `IMPACT_STAGGER_MIN = 4` and `IMPACT_RAGDOLL_MIN = 9`. Every Hit in the game is therefore
the same Hit: always a Stagger, never a knockdown, with no difference between catching someone
square while sprinting and tapping them while standing still.

## What to change

- [ ] The magnitude is derived, not constant. The obvious source is the one the codebase already
      uses for exactly this question — closing speed, as `wallImpactKnockback(normal, closingSpeed)`
      does for a wall, and as `resolveBump` already does for Character-to-Character contact
- [ ] Nothing new decides "was this good": feed the magnitude into `applyImpact` and let
      `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN` do what they already do for every other Impact
- [ ] A Hit thrown from a standstill must stay a Stagger. If a stationary Hit can knock down, Hit is
      strictly better than a Bump and Dash stops being worth the cooldown
- [ ] Bounds are named constants in `packages/shared`, and the ceiling is deliberate — a Dash-fed
      Hit should knock down, not launch someone off the arena for free

## Done when

- [ ] Shared tests: a standing Hit Staggers, a committed one Ragdolls, and the threshold between
      them is the existing `IMPACT_RAGDOLL_MIN` rather than a new constant
- [ ] `HitReact` still fires on every connect, hard or soft — it is the "you got hit" tell, not the
      "you got knocked down" one
- [ ] The existing M6 ticket 03 tests still pass unchanged, or their expectations move deliberately
      with a note saying why

## Watch out for

**Survival balance.** A knockdown in Survival is close to a kill — you cannot steer while down, and
the arena has edges. Whatever the ceiling ends up being, it wants feeling in a real Survival Round
before it is called done, not only in a unit test.

**This is replicated.** `resolveHit` is shared and runs on both sides; client prediction and server
authority must derive the same magnitude from the same inputs.

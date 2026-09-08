# 01 — A Hit with weight

**Superseded by ticket 04 (hold-to-charge and the Dash lock).** Live play found the design below
let a swing be thrown *from* a Dash, which fought the Punch/HitReact animation for the mixer and,
separately, was never the intent — Dash was meant to lock out Hit and Grab entirely until it
finishes. `HIT_MOMENTUM_SCALE`/the approach-speed derivation described here no longer exist; a
Hit's weight now comes from holding the button before releasing it instead. Kept here for the
historical record of why the magnitude/threshold table below was shaped the way it was — ticket
04's own table is sized to match it.

**What to build:** Make a Hit's force depend on how well it was thrown, so a solid connect knocks a
Character down and a glancing one does not.

**Blocked by:** nothing.

**Status:** done (live tuning pass carried to ticket 03) — superseded, see above

## Why

`RapierSimulation.resolveHit` applies a flat magnitude:

```ts
target.applyImpact(scaleVec3(direction, HIT_IMPACT_MAGNITUDE), "Hit");   // HIT_IMPACT_MAGNITUDE = 6
```

against `IMPACT_STAGGER_MIN = 4` and `IMPACT_RAGDOLL_MIN = 9`. Every Hit in the game is therefore
the same Hit: always a Stagger, never a knockdown, with no difference between catching someone
square while sprinting and tapping them while standing still.

## What to change

- [x] The magnitude is derived, not constant. The obvious source is the one the codebase already
      uses for exactly this question — closing speed, as `wallImpactKnockback(normal, closingSpeed)`
      does for a wall, and as `resolveBump` already does for Character-to-Character contact
- [x] Nothing new decides "was this good": feed the magnitude into `applyImpact` and let
      `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN` do what they already do for every other Impact
- [x] A Hit thrown from a standstill must stay a Stagger. If a stationary Hit can knock down, Hit is
      strictly better than a Bump and Dash stops being worth the cooldown
- [x] Bounds are named constants in `packages/shared`, and the ceiling is deliberate — a Dash-fed
      Hit should knock down, not launch someone off the arena for free

## Done when

- [x] Shared tests: a standing Hit Staggers, a committed one Ragdolls, and the threshold between
      them is the existing `IMPACT_RAGDOLL_MIN` rather than a new constant
- [x] `HitReact` still fires on every connect, hard or soft — it is the "you got hit" tell, not the
      "you got knocked down" one
- [x] The existing M6 ticket 03 tests still pass unchanged, or their expectations move deliberately
      with a note saying why

## Watch out for

**Survival balance.** A knockdown in Survival is close to a kill — you cannot steer while down, and
the arena has edges. Whatever the ceiling ends up being, it wants feeling in a real Survival Round
before it is called done, not only in a unit test.

**This is replicated.** `resolveHit` is shared and runs on both sides; client prediction and server
authority must derive the same magnitude from the same inputs.

**Done.** `hitImpactMagnitude(approachSpeed)` in `HitController.ts` — the striker's own approach
along the line to the target, scaled and capped. Not the *closing* speed `resolveBump` measures: a
target running onto a stationary fist is already a Bump, and counting it here would pay the striker
twice for standing still.

Sized against the Dash's measured ramp, which starts at `WALK_SPEED` and climbs to about `20` over
0.8 s rather than snapping to `DASH_SPEED`:

| approach | magnitude | outcome |
|---|---|---|
| standing (`0`) | `6` | Stagger — exactly the M6 Hit |
| full walk (`6`) | `7.8` | Stagger, with margin |
| Dash, ~⅓ s in (`10`) | `9` | knockdown |
| wound Dash (`20`) | `12` | knockdown |

So a knockdown costs a genuinely committed Dash, not a tapped one — the margin is what keeps Hit
from being strictly better than a Bump. **No M6 ticket 03 expectation moved**, because a stationary
Hit is unchanged.

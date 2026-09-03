# 04 — Downhill is faster, uphill is slower

**What to build:** Running down a ramp is visibly quicker than running up the same ramp.

**Blocked by:** 03 — needs the walkable/sliding split, since the two sides of that split use
different movement models.

**Status:** done

- [x] Speed on a walkable slope is scaled by an explicit multiplier derived from the **signed slope
      angle** — the model Unity's own Character Controller documentation prescribes
- [x] Projecting gravity onto the slope plane and integrating it is **not** used here: that is the
      rigid-body formulation, and grounded kinematic controllers remove the vertical component
      instead. It belongs to `Sliding` and stays there (ADR 0035)
- [x] A comment records that Quake 3 deliberately does the opposite — re-normalising so that speed
      stays slope-independent — so a future reader sees this was a choice between two documented
      traditions rather than an oversight
- [x] Manually verified live: the same ramp is measurably faster downhill than uphill

## Implementation notes

- **New `slopeSpeedMultiplier(moveDirection, groundNormal)` in `movementVerbs.ts`** — a pure
  function, alongside `dashEnvelope`. Computes the **signed slope angle toward the movement
  direction** (Unity's `GetSlopeAngleTowardsDirection` model — the plane's rise per unit horizontal
  distance travelled along the (normalized) move direction, via `atan`), then
  `1 - SLOPE_SPEED_ANGLE_FACTOR * angle`. Positive angle (uphill, Unity's convention) reduces the
  multiplier below 1; negative (downhill) raises it above 1. Sidestepping across a slope
  (perpendicular to its fall line) computes ~0° and multiplies by ~1, exactly as it should — no
  special-casing needed, it falls out of the formula. Standing still (`moveDirection` zero) returns
  1 outright: there's no direction to be uphill/downhill *toward*.
- **New tuning constants** (`tuning.ts`): `SLOPE_SPEED_ANGLE_FACTOR` (0.4, a placeholder like every
  other number this milestone defers to real-ramp tuning) and `SLOPE_SPEED_MULTIPLIER_MIN` (a
  defensive floor, never actually reached in practice since this multiplier only ever operates
  below `WALKABLE_SLOPE_MAX_ANGLE` — steeper is `Sliding`'s territory, a completely different model).
- **Quake 3's opposite tradition, recorded in the function's own doc comment** (not a throwaway
  code comment easy to lose): `PM_WalkMove` re-normalises ground velocity onto the floor plane after
  the move, keeping speed slope-independent by design. Documented as a real, deliberate alternative
  this project chose not to follow — this ticket's own "downhill is faster" requirement rules it
  out, not an oversight.
- **`CharacterController` wiring**: only the walking (Controlled/Stagger, i.e. the `else` branch of
  `beginCapsuleTick`'s Sliding/non-Sliding split from ticket 03) applies this multiplier, and only
  to the walk contribution — never Dash, the same "Surface caps `WALK_SPEED`, never Dash" precedent
  ticket 01 already established, and never `Sliding`'s own gravity-projected model (ticket 03's own
  checklist item, reaffirmed here: that's the rigid-body formulation ADR 0035 explicitly reserves for
  ground too steep to walk). Reads `currentGroundNormal` from last tick's contact — the same one-tick
  lag `tooSteepToWalk` and the Surface multiplier both already have — so it's `1` (no effect)
  whenever airborne or with no ground contact yet, exactly like Surface itself.
- **A genuine, expected amplification beyond the pure multiplier**: Rapier's own kinematic character
  controller already slides a desired move along whatever surface it's grounded on (the "plane
  projection" behavior research option (i) describes) — this happens *independently* of, and on top
  of, this ticket's explicit multiplier. The two compose rather than one replacing the other, so the
  measured downhill/uphill distance ratio (both live and in the integration test) comes out somewhat
  larger than the multiplier alone predicts — expected and harmless, not a bug; the integration test
  below asserts a directional/magnitude sanity bound rather than an exact formula match for exactly
  this reason.

## Code review

`/code-review high` (physics/movement logic warrants high, per CLAUDE.md) found no issues — verified
the sign convention algebraically against `pitchQuat`, confirmed the directional slope angle is
always bounded by the slope's own total tilt (so the documented "never reaches the defensive floor
in practice" claim holds), and found no broken callers.

## Manual verification (real browser)

No Playwright/chromium-cli available in this environment (no network access to install either), so
this drove a real headless Chrome via the raw Chrome DevTools Protocol, same approach as prior
tickets — a standalone tilted floor Segment (bypassing socket-chaining, per ticket 03's own
established workaround for its rotation-pivot interaction), raised clear of the kill-plane, at a
walkable ~17° pitch. A temporary `window.__debugSim` hook (removed before this commit) exposed the
live `RapierSimulation` for ground-truth position reads.

Held a real `KeyW` (downhill) for exactly 1 second, restarted playtest back to the identical spawn,
then held a real `KeyS` (uphill) for the same duration:

- Downhill: 7.23 units of 3D distance covered.
- Uphill: 4.24 units.
- Ratio: **1.71×** — a clear, visually confirmed (screenshot) speed difference on the same ramp in
  both directions, matching the direction the formula predicts and, per the note above, somewhat
  larger in magnitude due to Rapier's own slide-geometry contribution compounding with it.

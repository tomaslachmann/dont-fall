# 06 — Ice: a Surface you can't get a grip on

**What to build:** A Character accelerates slowly on ice and slides straight past the turn it meant
to make.

**Blocked by:** 01 (the Surface path this rides on) and 05 (before velocity persists there is
nothing for a grip scalar to multiply).

**Status:** done

- [x] One scalar per Surface multiplies **both** acceleration and drag — the model Source uses,
      reading the value off the surface and scaling its friction and acceleration constants alike
- [x] **Ice leaves top speed unchanged.** Near-zero acceleration, near-zero drag. Neither Quake nor
      Source alters max speed for slick surfaces; the feel of ice is carried by acceleration and turn
      authority. "Ice makes you faster" is the intuitive answer and it is the wrong one
- [x] Mud (ticket 01) is re-expressed in the same one-scalar terms where it fits, so the two Surfaces
      are one mechanism rather than two special cases
- [x] One demo Module, visually identical to existing floor pieces
- [x] Manually verified live: a Character accelerates slowly and overshoots its turn on ice, on a
      hand-authored Track containing both ice and mud

## Implementation notes

`SurfaceConfig` (`packages/shared/src/track/Surface.ts`) gained a second field, `grip`, alongside
ticket 01's `topSpeedMultiplier` — one scalar multiplying **both** `MOVE_ACCEL_FACTOR` and
`MOVE_FRICTION_FACTOR` together (Source's own model: one number moves both knobs, not two
independent ones). `default` and `mud` both keep `grip: 1` (full grip — mud's whole effect stays
confined to `topSpeedMultiplier`, exactly ticket 01's original design, just re-expressed in the new
vocabulary). `ice` is `{ topSpeedMultiplier: 1, grip: 0.001 }`.

Wiring mirrors ticket 01's `topSpeedMultiplier` plumbing exactly: `CharacterController` gained a
`surfaceGrip` field + `setSurfaceGrip` setter (defaulting to 1, reset to 1 in `reconcileTo` alongside
`surfaceTopSpeedMultiplier`), and `RapierSimulation`'s per-tick Surface resolution now calls both
setters from the same resolved `SurfaceConfig`. `accelerateVelocity`'s call site in
`beginCapsuleTick` multiplies `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` by `this.surfaceGrip` —
no new call sites, no branching on "is this ice."

**Tuning `grip` was the real work, and it needed an empirical pass, not a hand-derived guess** — the
same lesson ticket 05 already learned about `accelerateVelocity`'s formula. A first attempt used
`grip: 0.08`, chosen to "feel small." It wasn't: `accelFactor * wishSpeed * TICK_DT` (the raw,
uncapped per-tick step) is `1000 * 0.08 * 6 / 30 = 16`, still comfortably larger than the entire
0→6 gap it's supposed to be closing gradually — meaning at `grip: 0.08` both Friction() and
Accelerate() still fully saturate in a single tick, exactly like `grip: 1`. The threshold below
which a genuine multi-tick ramp exists at all is `grip < TICK_RATE_HZ / MOVE_ACCEL_FACTOR = 0.03` —
above that, "near-zero grip" is numerically indistinguishable from full grip given how large
`MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` (1000) were tuned to be for ticket 05's saturating
default. Caught by the two new `RapierSimulation.test.ts` tests below `grip: 0.03`, not by hand
math — same discipline ticket 05's own flat-step bug was caught by. Landed on `grip: 0.001` after
empirically retracing the actual per-tick numbers (a throwaway inline trace, not shipped) until both
the "measurably below half speed shortly after starting from a standstill" and "reaches full
WALK_SPEED eventually" tests passed together.

**A discovery worth recording, found only by watching the live browser run, not derivable from the
unit tests alone**: because `MOVE_ACCEL_FACTOR` and `MOVE_FRICTION_FACTOR` are equal and `grip`
scales both identically, a Character that is *already* moving at `wishSpeed` and keeps holding the
same direction is completely unaffected by how low `grip` is — Friction()'s drop and Accelerate()'s
refill are computed sequentially within the same tick and exactly cancel at the fixed point
`speed == wishSpeed`, regardless of grip. Grip only ever matters the instant the wish direction
diverges from the current velocity (a new key pressed, a turn) — that's precisely when `addSpeed`
stops being small and grip's cap on `accelFactor * wishSpeed * TICK_DT` becomes the bottleneck, not
a coincidence but the direct consequence of using the same accel/friction magnitudes for both terms.
This is *why* a Character can cross an ice Module at full, unchanged speed while going straight (as
the milestone's own "ice leaves top speed unchanged" requirement demands) and still slide helplessly
past a turn on the very same patch of ice — one mechanism, not two.

Added the `ice` Module to `M1_MODULES`/`MODULE_LIBRARY` (`packages/shared/src/track/modules.ts`),
geometrically identical to `bridge`/`mud` (ticket 01's own precedent: the property is the deliverable,
the look is not), `surface: "ice"`.

## Manual verification (real browser)

Same approach as tickets 01/05: no Playwright/chromium-cli available in this environment, so this
drove a real headless Chrome (`Google Chrome.app --headless=new --remote-debugging-port`) via the
raw Chrome DevTools Protocol over a plain WebSocket (Node's built-in global `WebSocket`, no `ws`
package needed this time — it's available in the Node version installed here). A temporary
`window.__debugSim` hook in `playtest.ts` (removed before this commit) exposed the live
`RapierSimulation` for ground-truth position reads; a temporary driver script (not committed) placed
real Modules via real clicks on the actual palette entries, started **Playtest** with a real click,
and drove movement via real `Input.dispatchKeyEvent` key down/up (held keys, not simulated
auto-repeat).

**Scenario A — straight walk through `start → ice → start → mud → start`, holding `KeyW` the whole
way, no turning:**

```
start:  ~6.0 u/s                    (WALK_SPEED, unchanged)
ice:    ~6.0 u/s                    (top speed genuinely unchanged, confirmed live — matches
                                      the "ice makes you faster/slower" myth being wrong in both
                                      directions, per the discovery above: already at wishSpeed,
                                      grip is invisible while going straight)
start:  ~6.0 u/s                    (back to full)
mud:    ~3.0 u/s                    (half — matches topSpeedMultiplier = 0.5, ticket 01, reconfirmed)
start:  ~6.0 u/s                    (back to full)
```

**Scenario B — build speed on `start`, cross onto `ice`, then release `KeyW` and press `KeyD`
(a hard 90° turn) for a short 400 ms burst, still standing on ice the whole time (`y` held constant
at 0.66 throughout — never fell off):**

```
Δt      |Δz| (old direction, still sliding)   |Δx| (new direction, actually turned)
100ms   0.561                                  0.039
200ms   1.068                                  0.132
300ms   1.525                                  0.275
400ms   1.938                                  0.461
```

The Character moved ~4× farther in the direction it was already going than in the direction it was
now pressing, for the entire measured window — sliding straight past the turn it meant to make,
exactly the ticket's own acceptance criterion. Confirmed visually too: a screenshot taken mid-turn
shows the capsule visibly off the centerline of the (visually plain, undecorated) ice Module, having
slid sideways off the straight path while the input said "turn," not "keep going" — and the ice/mud
Modules render identically to every other straight floor piece, exactly as `mud`'s ticket 01
precedent established.

An earlier version of this scenario held the turn for 800 ms instead of 400 ms — the Character
actually slid off the (narrow, 4-unit) ice floor entirely and fell, which is itself completely
consistent with "slides past the turn" (an even stronger demonstration, arguably), but made for a
messier, harder-to-read trace. Shortened to 400 ms so the same behavior is visible without leaving
the module.

## Code review findings and fixes

`/code-review high` (physics/simulation logic warrants high, per CLAUDE.md) — no functional
correctness findings. The reviewer hand-traced `accelerateVelocity`'s Friction()/Accelerate() shape
against `docs/research/slope-and-surface-movement.md`'s own Source `gamemovement.cpp` pseudocode and
confirmed it matches exactly, including that `MOVE_STOP_SPEED` is correctly left unscaled by
`surfaceGrip` while `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` are scaled together (Source's own
`m_surfaceFriction` semantics); re-verified `MOVE_VELOCITY_CAP`'s margin over worst-case
walk+slope+dash; confirmed no orphaned `SurfaceConfig`/`surfaceConfig` call sites; confirmed `ice` is
picked up automatically via `MODULE_LIBRARY = M1_MODULES`; and re-ran the full `packages/shared` and
`apps/client` suites (including `predictionRegression.harness.test.ts`) plus a full monorepo
`tsc --noEmit` — all green.

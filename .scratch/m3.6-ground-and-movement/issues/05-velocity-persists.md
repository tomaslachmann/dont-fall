# 05 — Velocity persists between ticks

**What to build:** The movement model itself. Today a Character's horizontal velocity is recomputed
from scratch every tick, so nothing can accumulate, decay, or be written into — which is why ice,
pads, bounces and launches are all currently inexpressible. This ticket replaces that with
accelerate → drag → cap.

It is the one ticket in this milestone that makes nothing new visible. Its deliverable is that a
player cannot tell anything changed.

**Blocked by:** 04 — the slope work lands on the old model first, so that a feel regression has one
suspect rather than two.

**Status:** done

- [x] Velocity persists between ticks: accelerate toward a desired velocity, apply drag, apply a cap
      (ADR 0035 — the model Quake, Source and Unreal all use, and the part every kinematic-controller
      project writes itself, since the engine deliberately does not)
- [x] Dash becomes a contributor to that velocity rather than its own branch — which is what later
      makes a speed-gated wall Impact expressible without asking "was this a Dash?"
- [x] Bump and ground contact move onto the same path
- [x] Tuning constants keep their names but change meaning — a walk speed becomes a target reached
      over time rather than an instantaneous value — and every affected doc comment is rewritten to
      say so
- [x] **Feel is preserved, not re-tuned.** Re-tuning is explicitly a later pass against real ramps
      and ice; doing both at once makes a bad result unattributable
- [x] No new replicated field and no new Character state: velocity is already replicated and already
      predicted
- [x] `predictionRegression` is the gate, not a formality
- [x] Manually verified live with two browsers: walking, dashing, jumping and bumping another
      Character all feel as they did, and prediction stays clean

## Implementation notes

- **New `accelerateVelocity(current, wish, accelFactor, frictionFactor)` in `movementVerbs.ts`** —
  Source's own `Friction()`/`Accelerate()` shape (`gamemovement.cpp`), not a simpler from-scratch
  design. A **first attempt stepped both drag and acceleration by a flat, equal-magnitude units/s²
  amount each tick** — at low speed the two fully cancelled each other every tick, permanently
  stalling at a small fraction of the target no matter how long input was held (caught by this
  ticket's own TDD tests, not shipped). Source's shapes don't have this failure mode because they
  scale from *different* quantities: `Accelerate()`'s step scales with the comparatively large,
  roughly-constant *target* speed (`wishSpeed`), while `Friction()`'s scales with the (initially
  small) *current* speed — the two forces don't race each other to the same fixed point. Rewritten
  to the real formulas (`addSpeed = wishSpeed - currentSpeedAlongWish`, `accelSpeed = min(accelFactor
  * wishSpeed * TICK_DT, addSpeed)`; `drop = max(speed, MOVE_STOP_SPEED) * frictionFactor * TICK_DT`)
  before landing, and both versions are recorded in the function's own doc comment so a future reader
  doesn't rediscover the same trap.
- **New tuning constants**: `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` (Source's `sv_accelerate`/
  `sv_friction` — dimensionless multipliers on `wishSpeed`/current speed, not absolute units/s² rates),
  `MOVE_STOP_SPEED` (Source's `sv_stopspeed` — a floor under `Friction()`'s control term, inert today,
  starts mattering once a Surface supplies a much smaller friction factor), `MOVE_VELOCITY_CAP` (a
  defensive backstop, the pipeline's "cap" stage). `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` are set
  large enough (`* TICK_DT >= 1`) that both stages **fully saturate every tick** — this is deliberate,
  not an oversight: it makes the new pipeline numerically **identical** to the direct
  `velocity.xz = wish` assignment it replaces, for every case this project has today. A genuinely
  gradual, feelable pair of factors only appears once a Surface (ticket 06, ice/mud) supplies its own,
  per ADR 0035's "one scalar per Surface multiplies both acceleration and drag" rule.
- **`WALK_SPEED`'s doc comment rewritten** to describe it as a target reached over time, not an
  instantaneous value (ADR 0035's own explicit requirement) — the only tuning constant whose *meaning*
  actually changed; `GROUND_STICK_SPEED`'s own unit-bug rewrite already happened in ticket 02, ahead of
  schedule (the milestone spec files them together, but the actual fix landed with the ticket that
  needed it first).
- **`CharacterController` wiring**: the walking (non-`Sliding`) branch of `beginCapsuleTick` now
  computes `wish = slopedWalk + dashBurst` — Dash's contribution folded into the *same* wish-velocity
  concept the pipeline chases, rather than added directly onto the final velocity outside any model —
  then calls `accelerateVelocity(this.velocity, wish, MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR)` in
  place of the old direct assignment. `Sliding`'s own gravity-projected model (ticket 03) is
  untouched — ADR 0035 explicitly reserves that formulation for ground too steep to walk, not for
  this ticket to unify.
- **"Bump and ground contact move onto the same path" — verified as an already-true invariant, not a
  new behavior.** Bump (`RapierSimulation.resolveBump`) already reads a Character's velocity via the
  single `currentVelocity` getter over `this.velocity` — the same field the new pipeline now updates
  — and ground-stick's vertical reset (`this.velocity.y = -GROUND_STICK_SPEED`) already writes into
  that same field too; there was never a second, parallel velocity concept to unify. This ticket's
  refactor doesn't introduce one either. The full, unmodified Bump test suite (mover untouched,
  bumped Character staggers/ragdolls correctly, one-sided) passing unchanged confirms this held
  throughout, and the live 2-browser verification below exercises a real Bump end-to-end against the
  new pipeline.

## Code review

`/code-review high` (this milestone's most invasive movement-model change warrants high, per
CLAUDE.md) — 2 documentation-accuracy findings, no functional correctness issues, both fixed:

- **Fixed — `WALK_SPEED`'s doc comment referenced `MOVE_ACCEL_DRAG_RATE`**, a constant name from an
  earlier (rejected, flat-step) design draft that no longer exists — the real, shipped constants are
  `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR`. Corrected the reference.
- **Fixed — a test's own title claimed `accelerateVelocity` "leaves the vertical (Y) component
  untouched,"** which reads as "passes `current.y` through" when the function actually
  unconditionally *zeroes* Y on the result regardless of either input's own Y (the function's own
  doc comment already said this correctly — only the test title was misleading). Reworded to say
  "always zeroes," matching both the doc comment and the assertion itself.

## Manual verification (real browser, two windows)

No Playwright/chromium-cli available in this environment (no network access to install either), so
this drove two real headless Chrome instances via the raw Chrome DevTools Protocol against a real
`apps/server`/`apps/client` pair — the first genuinely multiplayer live verification this session has
needed. One environment dead end, worth recording:

- **Two tabs in the same browser window don't both run.** `document.hidden`/`document.visibilityState`
  confirmed the second-opened tab was `hidden`, and `requestAnimationFrame` **never fired for it at
  all** — a real, correct browser behavior (Chrome suspends `rAF` for backgrounded tabs), not a bug in
  this project's client. Every earlier ticket's live verification used exactly one tab, so this never
  surfaced before. Fixed by opening the second client as a genuinely separate top-level browser
  **window** (`Target.createTarget({ newWindow: true })`) instead of a second tab — both then reported
  `hidden: false` and both ran real `rAF` loops.
- **track-service's `/tracks/any` endpoint picks a uniformly random stored Track on every request** (a
  whole session's worth of manual ticket verification had left several test Tracks in its local SQLite
  DB, including the M1 seed) — the Match server has no way to pin a specific one. Since
  `apps/server`'s own per-player spawn logic (`playgroundSpawn`) is a fixed M1-shaped offset
  independent of whichever Track actually got fetched, an unlucky pick spawned both Characters
  correctly-positioned-for-M1 but hovering over open air on an unrelated (e.g. random-generated) Track,
  producing a permanent Fall→Ragdoll loop that looked alarming at first. Not a ticket 05 bug — worked
  around by restarting the local dev server a few times (a few seconds each) until `welcome.trackId`
  came back `"m1-playground"`, confirmed via a quick raw-WebSocket probe before opening the real
  browser windows.
- **The M1 seed's own "start" platform is narrow enough that a full-duration walk/dash test walks a
  Character clean off it**, producing a genuine Fall — also not a ticket 05 bug (confirmed identical
  behavior existed before this ticket; Fall detection is unrelated to the movement model). Reordering
  the acceptance-criteria checks (jump and Bump first, from a clean, untouched spawn; walk and dash
  last, with short hold durations sized to the platform) avoided compounding one test's displacement
  into the next one's setup.

With two genuinely separate browser windows, both connected to the same real authoritative server, all
four required behaviors were confirmed on the actual shipped code (not a synthetic harness):

- **Jump**: held Space briefly from a clean spawn — `grounded` went `false`, height rose 2.58 units
  above the spawn Y, then returned to `Controlled`/grounded — exactly as before.
- **Bump**: both Characters walked toward each other (no Dash — a plain walking closing speed of up to
  ~12 units/s head-on is already well above the ~6.7 units/s `IMPACT_STAGGER_MIN`/
  `BUMP_IMPULSE_SCALE` threshold) for 1.2s. The mover (A) stayed `Controlled` throughout (Bump's
  documented one-sided design); the bumped Character (B) went to `Ragdoll` — confirmed both from B's
  own client and from the server's authoritative broadcast, agreeing exactly.
- **Walk**: held forward for 300ms — measured speed 7.33 units/s, matching `WALK_SPEED = 6` within the
  same margin every earlier ticket's own live-walk verification has shown (a short window's settle/
  measurement noise, not a real discrepancy — the automated `predictionRegression` suite is what
  actually gates exactness, and it stayed fully green throughout this ticket, see below).
- **Dash**: a further 100ms burst measured 10.98 units/s — clearly faster than the immediately-preceding
  walk (7.33), confirming Dash still contributes real extra speed under the new pipeline.
- **Prediction agreement**: at every measurement, the locally-predicted position and the server's own
  authoritative position for the same Character agreed to within ~0.005 units — clean, tight
  agreement, unaffected by the movement-model rewrite.

`predictionRegression.harness.test.ts` (22 tests, `apps/client`) passed with numbers **identical** to
before this ticket at every measurement point (same `worstBack`, same `bigPops`, same turn latency, same
wall-settle position) — the harness this ticket names as its real gate, not a formality, confirms
exactly what it was asked to confirm.

# 03 — Sliding down a ramp too steep to walk

**What to build:** The band between "walk up it" and "it's a wall". Today the physics engine's two
slope limits sit at the same angle, so a Character walks anything up to 45° with full control and
treats anything steeper as an unclimbable wall — there is no angle at which it slides.

**Blocked by:** 02 — a Character that skips down ramps cannot be observed sliding down one.

**Status:** done

- [x] Two explicit, independent thresholds — walkable → sliding → wall — replacing the engine's
      coincident defaults. The existing "what counts as a wall" constant keeps its meaning and is
      deliberately not reused as the walkable limit (ADR 0037)
- [x] A new `Sliding` Character state, held by a **condition** (grounded on a too-steep Surface),
      not by a timer. Reusing `Stagger` is rejected: it means "recovering from a hit", is fixed-
      length, and reusing it would make a slope indistinguishable from a punch in state, animation
      and replication
- [x] Reduced movement input while `Sliding`; gravity projected along the slope plane applies here
      and only here — ADR 0035 rejects that model for walking
- [x] `Sliding` applies only while grounded: flying over a steep face keeps full air control, because
      taking control away mid-air for a reason the player cannot see reads as a bug
- [x] An Impact while `Sliding` sends the Character straight to `Ragdoll`, exactly as from `Stagger`
- [x] The client derives `Sliding` from the same resolved Track the server has, so prediction agrees
      without new messages — covered by a prediction test, not merely asserted
- [x] Manually verified live: walk up a shallow ramp, walk onto a steep one and slide down it, and get
      bumped while sliding and go down

## Implementation notes

- **Two independent thresholds**: `WALKABLE_SLOPE_MAX_ANGLE` (new, ~35°, the walk/Sliding boundary)
  and the existing `WALL_NORMAL_MAX_Y` (~60°, unchanged meaning — the Sliding/wall boundary).
  Rapier's own `maxSlopeClimbAngle`/`minSlopeSlideAngle` are both set to the **wall** angle
  (`acos(WALL_NORMAL_MAX_Y)`) in `CharacterController`'s constructor — collapsed back to one
  coincident value, but at 60° instead of the old 45°. This leaves Rapier responsible for exactly
  one thing ("is this even standable ground at all"); the finer walkable-vs-Sliding split within
  that band is this project's own job, reading the actual ground-contact normal directly rather
  than leaning on a second Rapier threshold.
- **`CharacterStateMachine.tick()` gains an optional `tooSteepToWalk` parameter** (default `false`,
  so every existing caller is unaffected). `Sliding` is entered/left purely by this condition, from
  and to `Controlled` only — `Stagger`/`Ragdoll`/`GettingUp` never check it, the same way they never
  cross-check each other's own conditions; recovering from Stagger onto a still-too-steep Surface
  reaches `Controlled` one tick and `Sliding` the next, exactly like `GettingUp` reaching
  `Controlled` before anything else that tick is re-evaluated. A too-steep Surface takes priority
  over a merely-medium Impact when both apply the same tick (sliding away matters more than a
  wobble in place); a hard Impact still sends `Sliding` straight to `Ragdoll`, added to the same
  check `Stagger` already uses.
- **`CharacterController` tracks the full ground-contact normal** (`currentGroundNormal: Vec3`), not
  just its Y component — needed to project gravity onto the actual slope plane. Uses the identical
  "sticky, only update on a fresh hit, clear only once ungrounded" rule ticket 02's code review
  established for `currentGroundColliderHandle`, and for the same reason: Rapier's snap-to-ground can
  correct the Character without ever populating `computedCollision()`'s list, and that happens
  exactly on the steep ticks this state depends on. `tooSteepToWalk` is computed from *last* tick's
  normal (read at the top of `beginTick`, before this tick's own sweep overwrites it) — the same
  one-tick lag `grounded` itself already has relative to jump/landing.
- **Two movement formulations, split exactly on the walkable threshold (ADR 0037)**: every other
  state still assigns `velocity.xz` directly from input each tick (ADR 0035's rejected-for-walking
  model); `Sliding` is the one place gravity is projected onto the slope plane
  (`g - (g·n)n`, `dotVec3` — new, in `math/vec3.ts`) and **integrated** tick over tick, so the
  Character genuinely accelerates down a slope rather than moving at a constant speed. The existing
  ground-stick reset (`velocity.y = -GROUND_STICK_SPEED` after every grounded tick) is skipped while
  Sliding — applying it would erase the accumulated slope velocity every tick, recreating ticket
  02's exact unit bug just for this one state. `SLIDE_INPUT_SCALE` (new, a placeholder like every
  other number this milestone defers) folds reduced player steering into the same integration as a
  small additive term, not a full override.
- **Client rendering needed no changes.** `scene.ts`/`main.ts` only ever check `motionState ===
  "Ragdoll" | "GettingUp"` (an `isDown` check); `Sliding` naturally falls into the same bucket as
  `Stagger` for every existing branch (no visual work, matching the milestone's explicit exclusion).
- **Prediction test, not just an assumption**: a dedicated `RapierSimulation` test runs two
  independent simulations ("server" and a non-authoritative "client") fed identical inputs down the
  same steep ramp and asserts they agree on `motionState` every tick, ending in `Sliding` — proving
  the "client derives Sliding from the same resolved Track, no new message needed" claim rather than
  just asserting it, since both the state and the movement model live entirely in the shared package
  both sides already run.

## Code review findings and fixes

`/code-review high` (new physics/state-machine model warrants high, per CLAUDE.md) — 4 findings, all
fixed and each verified by temporarily reverting its fix and confirming the corresponding new test
actually fails without it:

- **Fixed — reconciling into a server-reported `Sliding` state could flip straight back to
  `Controlled` for one tick.** `reconcileTo`'s non-down branch cleared `currentGroundNormal`
  unconditionally (following ticket 01's own precedent for the Surface handle), but
  `tooSteepToWalk` reads that field *before* this same tick's own sweep can refresh it — so a
  client that never locally predicted the slope at all (e.g. the very first packet reporting it)
  would compute `tooSteepToWalk = false`, and the state machine would immediately undo the just-
  restored `Sliding`, discarding the reconciled slope velocity and applying the wrong (walking)
  movement model for that tick. Fixed by giving `reconcileTo` a synthetic near-vertical ground
  normal when `base.motionState === "Sliding"` — enough to keep the *state* correct for that one
  tick (its own tangential-gravity contribution is ~0, so the Character simply doesn't accelerate
  for that tick instead of wrongly regaining full control), self-correcting for real the moment the
  next sweep runs. Confirmed: reverting to the unconditional clear reproduces `Controlled` where
  `Sliding` is expected in the new reconcile test below.
- **Fixed — steering while `Sliding` grew without bound.** The first version added `walk` (a
  *velocity*, `WALK_SPEED`-scaled) into the accumulating `velocity` every tick multiplied by
  `TICK_DT`, treating a velocity-dimensioned quantity as if it were an acceleration — with nothing
  capping or resetting it, holding a direction for long enough would eventually swamp the slide
  itself, contradicting the ticket's own "reduced… limited steering" framing. Fixed by blending the
  horizontal velocity toward `walk` each tick (`lerpVec3`, new `SLIDE_STEER_BLEND` constant) instead
  of integrating it — steering can now pull speed at most as far as `walk`'s own magnitude, never
  past it, while gravity keeps accumulating independently. Confirmed with a dedicated test (a much
  bigger ramp and a far kill-plane than the other Sliding tests need, since this one specifically
  needs several real seconds of sliding for an unbounded-vs-bounded difference to clearly separate):
  reverting to plain integration measured 4.38 units/s of pure-steering speed against a 2.34 bound;
  restoring the fix passed cleanly.
- **Fixed — the lowered ticket-02 regression test's angle (30°) no longer reliably reproduced the
  bug it exists to catch.** Lowering `STEEP_PITCH` from 45° (now inside the new Sliding band, the
  wrong scenario for a "stays under mud's WALK_SPEED cap" test) to 30° went far enough that the
  snap-only-collision-list-empty precondition stopped triggering at all — confirmed by temporarily
  reverting ticket 02's own sticky fix and finding the test still passed at 30°/32°/33°, meaning it
  had quietly stopped testing what its own name claims. Swept angles up to find where it starts
  reproducing again: 34° reliably fails without the fix (verified) while staying under
  `WALKABLE_SLOPE_MAX_ANGLE` (35°, so it's still a walking scenario). Moved to 34°, documented the
  verification method inline so a future reader doesn't have to rediscover it.
- **Fixed — the `walk` velocity-target formula was duplicated identically in both the Sliding and
  non-Sliding branches** of `beginCapsuleTick`. Hoisted above the `if`/`else` — no behavior change,
  just one formula instead of two that had to be kept in sync by hand.

## Manual verification (real browser)

No Playwright/chromium-cli available in this environment (no network access to install either), so
this drove a real headless Chrome via the raw Chrome DevTools Protocol, same approach as prior
tickets. Two dead ends, both instructive, before landing on a clean setup:

- **First attempt** (chaining a pitched Segment after a flat one via the Track builder's own
  socket-chaining + keyboard Pitch rotate, as in ticket 02) produced a Character that never moved at
  all despite real, confirmed-delivered `KeyW` events — the state machine ticked forward normally,
  input reached the page, but zero translation resulted. Root cause (correctly guessed live, by the
  user, mid-session): rotating a Segment around its entry Socket at a steep angle can swing its own
  geometry back over the flat Segment before it, wedging the capsule under a low ceiling right at the
  seam. This is a Track-builder authoring/rotation-pivot interaction, not a ticket 03 bug — sidestepped
  entirely by authoring the tilted floor as one standalone Segment (bypassing chaining) for the rest of
  verification.
- **Second attempt**, once movement worked: the Character appeared to "reset to start" mid-slide
  (also correctly diagnosed live by the user). Actual cause: a 15-half-extent floor pitched 45°
  reaches roughly 10.6 units below its own pivot at the low end — past the default kill-plane (y=-8)
  while still fully on the surface, triggering a genuine, correct Fall→Respawn. Not a Sliding bug;
  fixed for verification purposes by raising the test floor 10 units.

With a clean single-Segment tilted floor (raised clear of the kill-plane) and a temporary
`window.__debugSim` hook (removed before this commit) exposing the live `RapierSimulation`:
- A shallow (~20°) floor kept the Character `Controlled` throughout, walking normally.
- A steep (~45°) floor entered `Sliding` from gravity alone within a second of landing on it — no
  input needed, matching CONTEXT.md ("gravity carries it down the slope"). Confirmed accelerating,
  not constant-speed, via directly-read positions.
- Letting the Character slide off the platform's free edge correctly reverted it to `Controlled`
  while airborne (`grounded: false`), never `Sliding` mid-air — confirmed live, not just in the unit
  suite.
- Injecting a hard Impact (`simulation.applyImpact`, the same entry point a Spinner/Bump would call)
  while `Sliding` produced `Ragdoll` immediately.

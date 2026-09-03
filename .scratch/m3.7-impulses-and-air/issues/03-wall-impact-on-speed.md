# 03 — A wall hurts because you were fast, not because you dashed

**What to build:** Any Character moving fast into any object goes down, whatever gave it the speed. Today
the rule is wired to Dash specifically, so a Character fired into any object by a launch pad hits it and
feels nothing.

**Blocked by:** 02 — a launch pad is what makes this observable without dashing.

**Status:** done

- [x] The rule is re-expressed as a **speed** threshold rather than "is this Character dashing", so a
      bounce, a launch pad or an updraft all qualify (ADR 0037)
- [x] Impact magnitude scales with closing speed instead of being a constant — which also fixes
      today's behaviour, where hitting a wall is equally hard however fast you were going
- [x] A second, parallel rule for launched states is explicitly not added: two rules for one event
      drift apart under tuning, and then neither can be blamed
- [x] What counts as a wall keeps its existing definition, kept separate from the walkable limit for
      exactly this reason (M3.6 ticket 03)
- [x] Dashing into a wall feels as it did — Dash is now simply one source of speed among several
- [x] Manually verified live: a launch pad fires a Character into a wall and knocks it down

## Implementation notes

`RagdollCause`'s `"DashWall"` is renamed to `"WallImpact"` (`SimState.ts`) — the cause names what
happened (hit a wall hard), not what caused it, matching `"Bump"`/`"Fall"`/`"Spinner"`'s own naming.

`CharacterController.resolveCollisions()` no longer takes a `dashSpeed` parameter. The wall check now
reads the Character's own `velocity` directly and computes **closing speed** — the projection of that
velocity onto the collision normal (`-dot(velocity, normal)`) — rather than "was Dash active, and how
fast was the dash envelope." This is the whole point of the ticket: closing speed is a property of the
collision, not of any one verb that produced the velocity. A bounce, a launch pad, an updraft, or a Dash
all feed the same `velocity` field, so all of them now qualify through the exact same code path — no
per-verb gating anywhere in `resolveCollisions()`.

`wallImpactKnockback(normal, closingSpeed)` (renamed from `dashWallKnockback`) replaces the old flat
`DASH_WALL_IMPACT_MAGNITUDE` with `closingSpeed * WALL_IMPACT_SCALE`, where `WALL_IMPACT_SCALE = 14 /
DASH_SPEED` — chosen so a full-strength Dash into a wall lands at exactly the same knockback magnitude it
always did (continuity with the old feel), while any other closing speed now scales proportionally instead
of always producing the same fixed pop. `WALL_IMPACT_MIN_SPEED = DASH_SPEED * 0.6` is the same numeric
threshold the old `DASH_WALL_MIN_SPEED_RATIO` produced, just re-expressed as a standalone absolute speed
instead of a Dash-relative ratio (there's no "Dash" to be relative to anymore).

### Two test failures that turned out to be correct, more-accurate behaviour, not bugs

Both were found by empirically tracing real simulation output tick-by-tick (throwaway `_probe_*.test.ts`
scripts, always deleted afterward) rather than guessing from the diff:

1. **The 60° approach-angle sweep test.** Its 60° case started producing a nonsensical near-spawn `fall`
   position instead of a wall knockdown. Tracing it tick-by-tick showed the Character's velocity component
   *perpendicular to the wall* never exceeds `WALL_IMPACT_MIN_SPEED` while actually in contact with the
   wall's face (a 60°-incidence hit is mostly *sliding along* the wall, not *into* it) — by the time that
   component does exceed the threshold, the Character has already slid past the wall's z-extent and is no
   longer touching it at all. It then keeps walking, falls off the test ground's own edge, and the
   "Ragdoll" the old assertion caught was that unrelated Fall's own flop animation. This is exactly the
   improvement the ticket asks for — a glancing hit no longer forces Ragdoll just because the Character
   happened to be moving fast in some direction unrelated to the wall. Fixed by narrowing the sweep to
   `[0, 15, 30, 45]°` and adding a dedicated test that asserts the glancing-hit slide-past directly.

2. **The client/server dash-wall desync test (ADR 0015).** Removing the Dash-specific gate initially looked
   like it reintroduced the exact misprediction the 2026-09 playtest bug report described (client shows
   `Controlled` while the server is already `Ragdoll`). An exhaustive sweep of ~990 parameter combinations
   (latency, dash timing, wall distance) found **zero** reproductions of that original scenario under the
   new formula — because closing speed is derived from the Character's own real `velocity`, which
   reconciliation already keeps client and server in agreement on, the new rule is strictly *more*
   consistent than the old "was Dash active" flag ever was. The test's invalidated assertion was removed
   and its documentation rewritten to explain why; the genuine ADR 0015 invariant (the client eventually
   comes down with the server) is still asserted and still passes.

A new regression test in `RapierSimulation.test.ts` proves the ticket's core requirement directly: a launch
pad — `dashing: false` throughout — fires a Character into a wall and knocks it down with
`ragdollCause: "WallImpact"`. The pad sits flush against the wall's own contact line, which matters for a
subtle reason verified while writing this test: a purely-horizontal launch SET only survives the *one* tick
it's applied on. `CharacterController`'s `accelerateVelocity()` pipeline runs every tick regardless of
grounded/airborne state, and at today's saturating friction factor it fully re-derives horizontal velocity
from the current input each tick — so a launch's horizontal component decays to at most `WALK_SPEED`
(matching input) or 0 (no input) starting the very next tick. The wall hit has to land on the same tick the
SET fires, which placing the pad immediately adjacent to the wall guarantees.

## Manual verification (real browser)

Verified live through the actual `apps/client` render/prediction/network pipeline (not track-builder's own
flat preview), per this session's "official" testing requirement:

- Temporarily added one throwaway Module (`verify-launch-wall`: a floor matching `start`'s own footprint,
  a wall, and a launch pad aimed point-blank at it) to `packages/shared/src/track/modules.ts`, and posted a
  one-segment Track using it directly to a locally-running track-service via `POST /tracks`.
- Restarted the real match server (`apps/server`) against track-service's `/tracks/any` until it happened
  to serve that Track (ADR 0028 has no "pick this exact one" override — same restart-until-it-comes-up
  pattern used for every prior ticket's live verification this session).
- Ran the real Vite dev server for `apps/client`, drove it with headless Chrome over raw CDP, and walked the
  Character east into the pad using two small temporary debug hooks in `main.ts`
  (`window.__debugSim`/`__debugMyId` and a `window.__debugMoveOverride` input override — the same
  temporary-hook pattern used in every prior ticket, all removed before commit).
- Result, read directly from the real client's own predicted `CharacterSnapshot`:
  `motionState: "Ragdoll"`, `ragdollCause: "WallImpact"`, `dashing: false`, `launchPadEpoch: 1` — the
  Character never dashed, and the in-game HUD and a screenshot both showed the ragdoll crumpled against the
  wall face at the moment of impact.
- Cleaned up afterward: the temporary Module, the temporary debug hooks, and all scratch/`_verify_*`/
  `_probe_*` scripts were removed (`grep -rln "__debug"` across `apps/client/src`, `apps/server/src`,
  `packages/shared/src`, `apps/track-builder/src` returns clean); the leftover Track row in
  track-service's local (gitignored, not committed) SQLite data file was left in place, matching the many
  other stray scratch tracks already there from earlier sessions.

## Code review

Reviewed at **high** effort (CLAUDE.md's rule for intricate physics/netcode logic). One finding, fixed:

- **Dead zone between the wall-Impact gate and the Ragdoll threshold.** `WALL_IMPACT_SCALE` is calibrated
  off `DASH_SPEED` so a full-strength Dash reproduces its old flat knockback magnitude exactly
  (`DASH_SPEED * WALL_IMPACT_SCALE === 14`). That calibration, on its own, meant a closing speed only just
  at `WALL_IMPACT_MIN_SPEED` (9) produced a knockback magnitude of only ~8.4 — below `IMPACT_RAGDOLL_MIN`
  (9). `resolveCollisions()` would decide this qualified as a wall hit, but the resulting impulse only
  Staggered the Character instead of forcing Ragdoll, directly contradicting the ticket's own stated
  invariant ("any Character moving fast enough into a wall goes down"). No existing test exercised a
  closing speed in that narrow dead zone (all wall-hit tests used either a full Dash or a fast launch pad).
  Fixed by flooring `wallImpactKnockback`'s magnitude at `IMPACT_RAGDOLL_MIN` — the floor only engages
  below ~9.6 units/s closing speed, so the proportional scaling and full-Dash-speed continuity above it are
  unaffected. Added a dedicated regression test (`CharacterController.test.ts`) asserting a hit at exactly
  `WALL_IMPACT_MIN_SPEED` still meets `IMPACT_RAGDOLL_MIN`.

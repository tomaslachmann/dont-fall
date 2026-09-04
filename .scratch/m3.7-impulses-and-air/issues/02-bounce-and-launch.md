# 02 — Bounce Surfaces and launch pads

**What to build:** Surfaces that throw a Character into the air — bounce from one to the next across
a gap.

**Blocked by:** 01 — same one-shot latch, established there.

**Status:** done

- [x] Launch velocity is **set**, not added, so it stays idempotent under prediction replay —
      following Quake 3's jump pad, whose launch velocity is precomputed and whose code lives in the
      shared module both client and server run
- [x] Landing after a launch stays harmless: no fall-damage rule exists today and none is added
      (ADR 0037). What hurts is what a Character hits on the way
- [x] Leaving the play volume remains the only height-related failure
- [x] Shortcuts created by launches are a deliberate outcome. Policing them needs a concept of
      finishing a Round, which does not exist until M4 — do not invent one here
- [x] Manually verified live: bounce from one pad to another across a gap, through the real
      `apps/client` frontend

## Implementation notes

Two mechanisms, matching the research doc's own split (`docs/research/surface-and-volume-mechanics.md`
§1.4/§1.5) — a launch pad is a **trigger** (one-shot on entry, like ticket 01's speed pads), a bounce
Surface is a **per-Surface landing property** (a Surface config field, like mud/ice), never the other
way around:

**Launch pad** (`packages/shared/src/simulation/LaunchPad.ts`, new): `LaunchPadConfig { trigger:
OrientedBox; velocity: Vec3 }` — velocity authored in the owning Module's own local space, rotated
(never translated — a direction/magnitude, not a point) into world space by `resolveTrack`, the same
treatment a Spinner's `initialAngle` gets. Rising-edge detection reuses `RapierSimulation`'s
`findTriggerIndex` helper ticket 01's own code review extracted specifically anticipating this reuse.
`CharacterController.triggerLaunchPad` queues a `pendingLaunchVelocity`, consumed at the very start of
the next `beginCapsuleTick` by unconditionally overwriting the ENTIRE velocity (not just the
horizontal wish velocity a speed pad's boost touches) — placed after the Sliding/non-Sliding branch
computes its own velocity, so a launch always wins over gravity, Sliding's slope integration, Dash, and
Surface grip alike, matching Quake's "your incoming speed is discarded" taken to its logical
conclusion. A `launchPadEpoch` (CONTEXT.md's Epoch idiom, a fourth example) mirrors `speedPadEpoch`
exactly, including never being restored during reconciliation (re-derived independently from position
on both sides) — a launch pad needs no decay-curve restoration alongside it at all, since (unlike a
speed pad) its whole effect already lives in the ordinary `velocity` field once fired.

**Bounce Surface** (`packages/shared/src/track/Surface.ts`): `SurfaceConfig` gained an optional
`bounce?: SurfaceBounceConfig` (`{ restitution, minSpeed }`) — absent on every Surface but `bounce`
itself. Lands in the EXACT branch the research doc points to (`beginCapsuleTick`'s ground-stick check):
`velocity.y = max(minSpeed, peakFallSpeed * restitution)` instead of the ordinary
`-GROUND_STICK_SPEED` clamp, gated by the same `!sliding` condition that already exists there. No new
Epoch, no new Snapshot field — a bounce is fully derived from existing Surface/velocity/position state,
exactly like mud/ice.

**A genuine bug, caught only by watching the actual numbers (not hand-derived), that took two attempts
to fix correctly**: a first implementation read `-this.velocity.y` directly at the ground-stick check,
but `surfaceBounce` (like every Surface field) is resolved from the PREVIOUS tick's ground contact —
and on a fast fall, Rapier's own snap-to-ground correction can report `computedGrounded() === true` for
MULTIPLE consecutive ticks without ever producing a `computedCollision()` entry (`resolveCollisions`'s
own pre-existing, documented caveat from M3.6), meaning the ground handle — and therefore
`surfaceBounce` — can stay unresolved for more than the usual single tick. By the time it finally
resolved, the ordinary (non-bounce) clamp had already run on the intervening ticks, destroying the real
impact velocity down to `-GROUND_STICK_SPEED` (2 units/s) — so a fall from any height bounced back at
exactly `minSpeed`, never more. A first fix attempt deferred the ground-stick clamp itself until the
ground handle resolved, which DID fix bounce but rippled into every OTHER landing in the game (the
clamp's own timing shifted by a variable number of ticks depending on descent speed), breaking several
of ticket 01's own already-passing, frame-exact regression tests. Reverted that in favor of a
narrower, fully decoupled fix: a new `airbornePeakFallSpeed` field tracks the true peak fall speed
independently every tick (reset the instant `velocity.y` is next non-negative — a jump/bounce/launch
apex), read by the bounce branch instead of the instantaneous (possibly-already-clamped) velocity.
This changes *nothing* about the ordinary clamp's own behavior or timing for every non-bounce
landing — it just gives the eventual bounce decision, whenever it runs, access to the real number.

## Manual verification (real browser, through `apps/client`)

Same approach as ticket 01: the real game frontend (full Three.js render, real camera/HUD, real
client-server netcode), not the Track builder's own flat preview. Built a Track (`start(z=10)` →
`launch-pad(z=4)` → `bounce(z=-3)` → `start(z=-9)`) via track-builder, with `bounce` and the final
`start` deliberately pulled far enough from `launch-pad` to leave a genuine gap of open air between
them (no floor at all from the launch-pad's trailing edge to the bounce Surface's leading edge) — sized
against the launch pad's own authored vector `(0, 16, -6)`, whose time-of-flight (`2×16/22 ≈ 1.45s`)
covers `≈8.7` world units, placing `bounce` under the real landing point rather than a guessed one.
Restarted the real Match server (retrying — track-service's `/tracks/any` random pick, the same
established dead end) until it loaded this Track.

Drove the real `apps/client` dev server via headless Chrome (raw CDP), holding `KeyW` and sampling the
local predicted+reconciled snapshot every 100ms:

```
t=0.1-0.7s   z: 9.90->6.30   vel=(0,-2,-6)      grounded=true   state=Controlled  (ordinary walk, pre-pad)
t=0.8s       crosses into launch-pad           epoch: 0->1      vel SET to (0,16,-6) exactly
t=0.8-2.2s   first arc, z: 5.70->-2.70, y: 1.38 up to 6.93 back down to 1.71       (real parabola)
t=2.3s       lands on "bounce" Surface         grounded=true    vel=(0,-2,-6)      (one-tick lag clamp)
t=2.4s       BOUNCES                           grounded=false   vel=(0,+12.98,-6)  (a genuine second launch)
t=2.4-3.6s   second arc, z: -3.90->-11.10, y: 1.05 up to 4.66 back down to 0.35    (real parabola, again)
t=3.7s       lands on the final "start" platform (ordinary Surface — plain clamp, vel=(0,-2,-6),
             confirming bounce is Surface-specific, not universal)
t=3.7-4.7s   continues walking, runs off the platform's own far edge, falls into the void beyond the
             track's short demo length, hits the kill plane, Fall+Respawn (falls: 0->1) — expected,
             same "ran off the short demo track" ending ticket 01's own live check hit
```

Confirmed both numerically (the exact velocity SET on launch; the clean `-2 → +12.98` discontinuity at
the bounce, matching `peakFallSpeed(~14.8) × restitution(0.85) ≈ 12.6`, plus a touch more from the
one-tick lag's extra gravity tick; the ordinary clamp on the non-bounce landing afterward) and visually
via two screenshots: one mid-first-arc (`pos 0.6, 1.4, 5.7`, airborne over the launch pad) and one
mid-second-arc (`pos 0.6, 2.2, -4.5`, airborne again over the bounce platform, visibly below/behind
it) — the MushroomKing model and real scene geometry confirmed in both, exactly the "bounce from one
pad to another across a gap" the ticket asks for.

## Code review findings and fixes

`/code-review high` (physics/netcode logic, per CLAUDE.md) — 1 finding, verified by the reviewer via a
throwaway repro against the real `RapierSimulation`/`CharacterController` (not committed) and fixed:

- **Fixed — `airbornePeakFallSpeed` was only ever reset when a bounce actually consumed it, never on
  an ordinary (non-bounce) landing, so a stale peak from a long-past, unrelated fall could survive
  indefinitely through continuous ordinary walking.** Empirically reproduced by the reviewer: a
  Character falls a real distance once, lands normally, walks completely flat for well over a
  minute, then steps onto an actual bounce Surface with zero net fall behind it — and launches to the
  ORIGINAL fall's full bounce height anyway, directly contradicting `SurfaceBounceConfig`'s own
  documented intent ("a small fall gives a small bounce"). The fix can't simply reset the peak on
  *every* ground-stick tick unconditionally — that reintroduces the ticket's own original bug, since
  `surfaceBounce` (and the ground handle it's derived from) can still be unresolved for the first
  tick or more after a fast landing, and resetting before it resolves would throw away the real
  impact speed before a genuine bounce ever reads it. The correct condition resets the peak once the
  ground handle has genuinely resolved — `this.surfaceBounce || this.currentGroundColliderHandle !==
  undefined` — covering both "consumed by an actual bounce" and "resolved to an ordinary Surface,"
  while still leaving a not-yet-resolved landing's peak untouched. Added a regression test
  reproducing the reviewer's exact scenario (two adjacent same-height floor pieces, a real fall onto
  an ordinary one, a flat walk onto a bounce one) — confirmed it fails without the fix (bounced at the
  original fall's ~18.7 units/s) and passes with it (bounces at essentially `minSpeed`, no real fall
  behind it).

Re-verified afterward: full monorepo typecheck clean; full test suite green (317 shared — 1 new
regression test, plus all 12 bounce/launch pad tests from the first review pass — / 68 track-builder /
32 track-service / 78 client / 16 server, 511 total).

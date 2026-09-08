# 03 — Hit

**What to build:** Pressing the Hit input swings at whoever is directly in front of you within
melee range. Landing it knocks them back — or down, if hard enough — exactly like running
into them today, and cancels a Dash either of you had in progress.

**Blocked by:** 01 — Character facing

**Status:** done

- [x] A new input triggers Hit, on its own cooldown — usable again only once it expires,
      mirroring Dash's own cooldown idiom (including HUD display)
- [x] Hit only connects with a Character within short range, in front of you (using your
      replicated facing) — reuses Bump's existing contact/Impact pipeline rather than a new
      hitbox system
- [x] Connecting produces an Impact on the target, exactly as forceful contact already does
      today (Stagger or Ragdoll, by the existing magnitude thresholds)
- [x] Connecting cancels an in-progress Dash for both the striker and the target
- [x] Behaves identically whether the Round is a Race or a Survival Round — no Round-type
      branching (`resolveHit` reads no `RoundRules` field at all; a striker's own input is
      already filtered through the same `matchLocked`/eliminated/finished gate every other move
      goes through, upstream of Hit ever being considered)
- [x] Covered by shared-package tests: connects within range/facing, misses outside it, applies
      an Impact, cancels both Characters' Dash, respects its own cooldown, and survives a
      reconciliation replay without double-firing

## Implementation notes

**A user correction reshaped this ticket's own code organization mid-implementation**: Dash and
Hit's cooldown bookkeeping (tick-counting, ms↔ticks conversion) is identical, so a shared
`CooldownController` base class was extracted (new file), with `DashController` and
`HitController` each moved into their own files extending it — rather than the original draft's
inline duplication inside `movementVerbs.ts`. `HitController.beginTick(hitPressed): boolean`
is the base with nothing added beyond the fire decision (no burst, unlike Dash); Dash keeps its
own `restoreCooldownMs` (needs an extra `stillDashing` param the base intentionally doesn't
declare, avoiding an override-signature conflict) built on the base's shared
`cooldownTicksFromMs` helper.

**The mechanic**: `SimInputs.hitHeld` (held state, like `jumpHeld`/`dashHeld` — the sim derives
the press edge itself). `CharacterController.beginCapsuleTick` gates it on `fullControl` only
(no `grounded` requirement, unlike Dash — a punch doesn't need to be grounded), which already
excludes Sliding/Stagger/Ragdoll/GettingUp for free (`inputScale < 1` in all of them). Firing
sets a per-tick `pendingHitFired` flag (reset unconditionally at the top of every `beginTick`,
so it's never stale across a tick where `beginCapsuleTick` doesn't run at all).

**Cross-Character resolution lives in `RapierSimulation.resolveHit`**, since only it can see
every Character's position — `CharacterController` only ever answers "may I swing," never "did
it land on anyone." Resolved in a new loop **after every Character's `beginTick` has run this
tick but before `world.step()`** — deliberately the same pre-step timing Bump's own
`resolveBump` gets "for free" from firing inside `beginTick`'s own collision sweep, so a Hit's
target mutation never lands out of order relative to any Character's post-step bookkeeping
(`updateCheckpoint` etc.) the way inserting it post-step could have.

Targeting: nearest other Character within `HIT_RANGE` (1.8 units) and within `HIT_FACING_COS_MIN`
(0.5 → a 120°-wide forward cone) of the striker's own replicated `facing` (`CharacterController`
gained a public `facing` getter for this — the private field was renamed `currentFacing` to
avoid the name clash). A fixed `HIT_IMPACT_MAGNITUDE` (6, between `IMPACT_STAGGER_MIN`=4 and
`IMPACT_RAGDOLL_MIN`=9 — one Hit always Staggers, never solo-Ragdolls) feeds the exact same
`applyImpact` pipeline Bump already uses, tagged `RagdollCause: "Hit"` (new union member).
Connecting calls the new `CharacterController.cancelDash()` (→ `DashController.cancelBurst()`,
which zeroes the burst but deliberately leaves the cooldown untouched — no free early re-dash)
on **both** the striker and the target, unconditionally, per CONTEXT.md's own Hit/Grab
definition — not left to ride along with whatever motion-state transition the Impact happens to
cause.

**Reconciliation**: `hitCooldownMs` joins `CharacterSnapshot`/`ReconcileBase` (restored via
`HitController.restoreCooldownMs`, unconditionally on every reconcile, mirroring
`dashCooldownMs`) — its own regression test (mirroring the Dash suite's "reconcile-then-replay"
shape) confirms a client reconciled to an older snapshot and replayed forward lands on the exact
same `hitEpoch`/`hitCooldownMs` the undisturbed ground truth has, never double-firing.

**Two new Epochs** (`hitEpoch` — this Character's own swing fired; `hitReactEpoch` — this
Character was just hit), added after the user pointed out MushroomKing's rig already has
`Punch`/`HitReact` clips. Both follow the established Epoch idiom exactly (CONTEXT.md), neither
is in `ReconcileBase` (same reasoning as `ragdollEpoch`: authoritative outcome state, not
something a client restores and replays through — `hitEpoch` is re-derived identically by
replay since it's purely a function of the striker's own replayed inputs, and `hitReactEpoch` is
never predicted at all, exactly like Bump's own knockback).

**Client rendering**: new `render/hitReactionPlayer.ts::HitReactionPlayer` (TDD'd against real
`THREE.AnimationMixer`/`AnimationClip`/`AnimationAction` instances — no WebGL needed, the
animation system is plain JS) drives the Punch/HitReact one-shot overlays from the two epochs,
taking priority over ordinary locomotion while playing. Deliberately seeds its first-ever
observed epoch pair as a baseline rather than reacting to it — the same cold-start bug class
code review caught twice for Ragdoll/GettingUp in ticket 02, built in proactively this time
instead of needing a third review pass to catch it. `characterModel.ts` gained `punch`/
`hitReact` action slots (`clampWhenFinished: false`, unlike Death — they hand back to locomotion
the instant they finish rather than freezing) and `isOneShotFinished`. Wired into both
`scene.ts` (local, reading the raw local snapshot's epochs directly — the existing pattern
`dashCooldownMs`/`dashing` already use, no interpolation needed for one's own Character) and
`remoteCharacterPool.ts` (reading `RenderCharacter.hitEpoch`/`hitReactEpoch`, added there
uninterpolated like `dashing`/`grounded`).

**Input**: `KeyF` (`KeyboardInput.hitHeld()`), and a `hit [##########] ready` HUD bar mirroring
the dash bar exactly (`hudText.ts`), per this ticket's own explicit ask.

Every other `SimInputs`/`ReconcileBase` object literal across the test suites needed the usual
mechanical `hitHeld: false`/`hitCooldownMs: 0` additions.

Full monorepo typecheck clean; full `pnpm -r test` green across all 6 packages (989 tests) —
shared 525 (7 new Hit-specific cases in `RapierSimulation.test.ts`, plus
`HitController.test.ts`/`DashController.test.ts` from the reorganization), client 208
(`hitReactionPlayer.test.ts`, `hudText.test.ts` extended, `input.test.ts` extended), server 80.
Three transient failures seen on one parallel `pnpm -r test` run (a different server test each
time — track-service retry timing, the M6-ticket-01 reload regression test, and a real-timer
network-quality integration test) all passed individually and on a clean re-run of the whole
server suite — pre-existing real-timer/real-network flakiness under parallel load, the same
pattern already documented in ticket 01, not a regression from this ticket.

## Code review findings and fixes

`/code-review medium` — 2 findings, both fixed:

- **Fixed — `resetMovementControllers` reset Dash's cooldown on every knockdown but never
  Hit's**, so a Character with time left on its Hit cooldown stayed locked out for whatever was
  left of it after getting up from a Fall/Bump/Impact, while Dash always came back instantly in
  the exact same situations — a real inconsistency between two verbs the ticket's own text says
  are built the same way. Fixed with one line (`this.hit.reset();`, alongside `this.dash.reset()`).
  Verified as a genuine regression before fixing (temporarily reverted, watched a new test go
  red, restored it) rather than trusting the diagnosis alone. New regression test forces Ragdoll
  via a direct `reconcileCharacter` (exercises `beginRagdoll`'s `resetMovementControllers` call
  deterministically, without needing realistic Bump/Dash-speed timing) and confirms
  `hitCooldownMs` reads 0 immediately, exactly like `dashCooldownMs` already does.
- **Fixed — `HitReactionPlayer.update()` starting Punch then HitReact in the same call (a mutual
  exchange: this Character's own swing lands on someone the same tick it's also hit) started
  Punch, then immediately faded it back out to start HitReact — right by accident of check
  order, not by design; a later reordering would have silently flipped which one wins.** Made
  the priority explicit: HitReact (the forced, urgent reaction) wins outright when both change
  together, and Punch is never started at all in that case — confirmed via a `vi.spyOn` on
  `punch.play` (my first attempt at this regression test passed against the *unfixed* code too,
  since the final active-action value already happened to be correct by coincidence; the spy is
  what actually distinguishes "never started" from "started then instantly faded").

Re-verified afterward: full monorepo typecheck clean; full `pnpm -r test` green (991 tests).

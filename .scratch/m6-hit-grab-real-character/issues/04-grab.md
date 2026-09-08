# 04 — Grab (Hold)

**What to build:** Pressing the Grab input latches onto whoever is directly in front of you.
While held, both of you move at a fraction of normal speed and the grabber can't run freely;
the held Player breaks free by moving away, or is automatically released if the grabber holds
on too long. Either Character having a Dash in progress gets cancelled the instant the grab
connects.

**Blocked by:** 01 — Character facing

**Status:** done

- [x] A new input triggers Grab, on its own cooldown after release, targeting the Character
      directly ahead within range (using replicated facing) — mirrors Hit's own targeting
- [x] While held, both the grabber and the held Character move at a greatly reduced pace; the
      grabber cannot Dash or otherwise move freely while holding
- [x] The held Character struggles free by moving away from the grabber for a sustained moment
- [x] If neither struggling free nor the grabber releasing happens, the grab ends on its own
      after a fixed maximum hold duration
- [x] Connecting cancels an in-progress Dash for both Characters, exactly like Hit
- [x] Behaves identically whether the Round is a Race or a Survival Round — no Round-type
      branching (same reasoning as Hit: `resolveGrabInitiation`/`updateGrabs` read no
      `RoundRules` field at all)
- [x] Covered by shared-package tests: latching on, the reduced-pace effect on both Characters,
      struggling free, the hold-limit timeout, Dash cancellation for both, cooldown after
      release, and a reconciliation replay that neither double-latches nor double-cancels

## Implementation notes

**Grab is structurally different from Hit**: Hit is a one-shot event with no state after the
tick it fires. Grab creates an ongoing, multi-tick *relationship* between two Characters —
who's holding whom, how long it's lasted, whether the held Character is currently struggling —
that neither `CharacterController` alone can own (it's cross-Character), so it lives entirely in
`RapierSimulation` as a new `activeGrabs: Map<string, ActiveGrab>`, keyed by the grabber's own
id (`{ heldId, holdTicksLeft, struggleTicks }`). `CharacterController`'s own `GrabController`
only ever answers the single-Character question "may I initiate a grab this tick" — identical
shape to `HitController`, except the cooldown does **not** start on press: CONTEXT.md's own
Grab definition says "cooldown after" (release), so `GrabController.release()` is a separate
method, called by `RapierSimulation` only once a hold actually ends, however it ends.

**Targeting reuses Hit's exact shape** — literally the same code, extracted into a new shared
`findNearestInCone(fromId, fromPos, facing, range, facingCosMin, exclude)` on `RapierSimulation`
(a small, well-justified reuse: Hit and Grab want the identical "nearest Character within range
and forward-facing cone" search). Grab's own `exclude` filters out anyone already part of
another hold (`isGrabEngaged`) — a Character can only ever be grabbing or held by one Character
at a time.

**Resolved in two passes**, both new: `resolveGrabInitiation` runs in the same pre-step slot as
`resolveHit` (after every Character's `beginTick`, before `world.step()`) — creates the
`ActiveGrab` entry and cancels both Dashes, the instant the hold starts. `updateGrabs` runs in
the existing post-step per-Character loop's aftermath (right after Surface/Volume resolution,
which already resets every Character to a neutral default each tick — `setGrabSpeedMultiplier(1)`
joins that same reset) and does the ongoing maintenance: counts down the hold's own timer, checks
struggle, releases (timeout or struggle-free), and re-applies `GRAB_SPEED_MULTIPLIER` to both
participants for every hold still active. The one-tick lag between a hold starting and the speed
multiplier actually taking effect matches Surface/Volume's own established precedent exactly.

**The struggle-free check** reads the held Character's own `moveDirection` straight from the
`inputs` record `RapierSimulation.tick` already has in scope — no new `CharacterController`
exposure needed, since `moveDirection` is already world-space (ADR 0009) with no camera rotation
to undo. Struggling requires the held Character's own input to point mostly *away* from the
grabber (a cosine threshold, `GRAB_STRUGGLE_DOT_MIN`) for `GRAB_STRUGGLE_FREE_TICKS`
consecutively — resets to 0 the instant it isn't, not merely paused, so standing still or
drifting with the grabber never quietly accumulates toward an unnoticed escape.

**Applied learning from ticket 03's own code review, built in proactively this time rather than
waiting for a reviewer to catch it a third time**: `resetMovementControllers` resets Grab's
cooldown (and drops this Character's own `grabSpeedMultiplier` back to 1) on every knockdown,
exactly like Dash and Hit already do — and `updateGrabs` itself checks for either participant
going down (Ragdoll) or disappearing (disconnect) and ends the hold outright from
`RapierSimulation`'s own side too. `removeCharacter` also proactively drops any `activeGrabs`
entry referencing the departing id, rather than waiting for `updateGrabs`'s own next pass to
self-heal it.

**Deliberately out of scope**, none of them asked for by this ticket's own text:
- **No HUD cooldown bar** — unlike Hit's ticket, this one never asked for "(including HUD
  display)"; `grabCooldownMs` is still replicated (needed for reconciliation correctness,
  regardless of whether anything displays it), just not shown.
- **No new animation/Epoch hook** — MushroomKing's rig has no Grab/Hold/Catch clip to drive (the
  full list: Death, Duck, HitReact, Idle, Jump, Jump_Idle, Jump_Land, No, Punch, Run, Walk, Wave,
  Weapon, Yes), so inventing an unused epoch here would repeat the exact "speculative, never
  consumed" mistake ticket 02's own code review already caught with the original `dashSpeed`.
- **No forced repositioning/dragging** — neither CONTEXT.md's definition nor this ticket
  describes the grabber physically dragging the held Character around; ordinary Bump-style solid
  collision between the two, both slowed, is what keeps them physically near each other.

**A known limitation, flagged for ticket 06's live verification rather than silently accepted**:
Grab's speed reduction is authoritative-only, resolved by `RapierSimulation` from *both*
Characters' positions — exactly like Bump/Hit's own Impact effects (ADR 0012's own precedent),
which the LOCAL player's own prediction sim structurally cannot see coming (its own prediction
sim only ever contains its own Character, never a real second one to be grabbed by). Unlike a
one-shot Impact, though, Grab's mismatch between "what the client predicted" and "what actually
happened" is *continuous* for up to `GRAB_HOLD_MAX_MS` (3s) rather than a single brief pop — a
held player's own client may show persistent reconciliation correction/rubber-banding for the
whole hold, since the existing decaying-offset smoothing (ADR 0026) was designed around
occasional corrections, not a continuously-growing one. A proper fix would replicate the
multiplier and feed it into the local prediction sim's own `setGrabSpeedMultiplier` before each
predicted tick (the same shape Surface/Volume already use, just server-sourced instead of
locally re-derivable) — real, non-trivial new `PredictionLoop` plumbing, deliberately not
built speculatively before ticket 06 confirms whether it's actually needed.

**Client**: `KeyG` (`KeyboardInput.grabHeld()`), wired into `sampledInput` alongside Hit.

Every other `SimInputs`/`ReconcileBase` object literal across the test suites needed the usual
mechanical `grabHeld: false`/`grabCooldownMs: 0` additions.

Two of the new Grab tests were caught giving false confidence during writing — one ("cannot grab
a Character already engaged") had the third Character positioned behind its own facing, so its
grab attempt would have missed for geometric reasons regardless of the exclusion logic being
tested; its assertion also checked `grabCooldownMs`, which never starts on press either way
(only release) so could never have caught anything. Both fixed (correct geometry, and asserting
on the third Character's own post-attempt walk speed instead) and verified by temporarily
reverting the corresponding source logic and watching each go red before restoring it — the same
discipline applied to ticket 03's own code-review fixes, this time self-applied before ever
shipping the test.

Full monorepo typecheck clean; full `pnpm -r test` green across all 6 packages (1011 tests) —
shared 546 (11 new Grab-specific cases in `RapierSimulation.test.ts`, plus
`GrabController.test.ts`), client 209 (`input.test.ts` extended), server 80, unchanged elsewhere.

## Code review findings and fixes

`/code-review medium` — 6 findings fixed, 1 acknowledged with no code change, 1 non-finding
verified:

- **Fixed — an eliminated Character's `hitFiredThisTick`/`grabFiredThisTick` latched true
  forever.** `CharacterController.beginTick` only clears `pendingHitFired`/`pendingGrabFired`
  from inside `beginCapsuleTick`, which `RapierSimulation.tick` already skips for an eliminated
  Character (ADR 0042) — so the very last tick before elimination that happened to fire either
  verb left the flag permanently stuck true, and every later tick's pre-step resolve loop kept
  trying to resolve a Hit/Grab for a corpse. Fixed by resetting both flags unconditionally at
  the top of `beginTick` (before the elimination-driven early return), and by having the
  pre-step resolve loop itself skip any id the elimination map already marks. Verified as a real
  bug before fixing (reverted, watched a new regression test go red, restored).
- **Fixed — `findNearestInCone` (the helper Hit and Grab both share) didn't exclude eliminated
  targets.** A disabled collider (ADR 0042: "nobody can shove it and it can't shove anybody")
  still had a live position, so a striker could Hit or Grab a corpse standing exactly where it
  died. Fixed by adding an unconditional `this.progress.get(id)!.eliminated` check inside the
  loop, ahead of each caller's own `exclude` callback, so neither verb needed its own copy of
  the check.
- **Fixed — `removeCharacter` deleted a departing grabber's `activeGrabs` entry without ever
  calling `registerGrabReleased()` on the Character still holding them.** The held party's own
  `GrabController` cooldown never starts release-side per CONTEXT.md's own definition, but if
  the *grabber* (not the held party) disconnects mid-hold, the code only ever handled the
  held-party-leaves direction — the grabber-leaves direction just deleted the map entry, so the
  held Character's cooldown never armed at all and could re-grab again instantly with no
  penalty. Fixed by resolving the correct side's release in both directions before removing
  either party's entry.
- **Fixed — Grab targeting didn't exclude a target already down (Ragdoll/GettingUp).** Hit
  reuses the same Impact pipeline Bump does regardless of motion state, but Grab's own "hold
  onto and drag around" fantasy doesn't make sense against a Character already collapsed —
  `resolveGrabInitiation`'s `exclude` callback only checked `isGrabEngaged`, not motion state.
  Fixed by adding `isDownMotionState(this.characters.get(id)!.motionState)` to the same
  callback.
- **Fixed — the struggle-free check read the raw, unsubstituted `inputs` record instead of the
  match-lock-aware effective input.** `RapierSimulation.tick` already computes an
  `effectiveInput(id, inputs, matchLocked)` for `beginTick` itself (substituting `IDLE_INPUTS`
  during a locked phase or after finishing, per ADR 0040-adjacent phase-lock rules), but
  `updateGrabs`'s own struggle check went straight to `inputs[grab.heldId]` — so a held
  Character's stale pre-lock input (e.g. still holding a move key from before Results locked
  everyone) could count toward struggling free after the Round had already ended. Fixed by
  routing the same `effectiveInput` call through `updateGrabs`. Verified as a real bug (reverted,
  confirmed a new test forcing a post-lock stale input goes red, restored).
- **Fixed — `currentFacing` snapped to `0` during phase-lock/finish input substitution.**
  `effectiveInput`'s substituted `IDLE_INPUTS` carried `facing: 0` unconditionally, so a locked
  or finished Character's replicated facing visibly snapped to face world-north the instant the
  lock engaged, rather than staying put — a real visual regression for anyone still rendered
  during Results. Fixed by having `effectiveInput` read the Character's own last real facing
  (`this.characters.get(id)?.facing ?? 0`) into the substituted input instead of a hardcoded
  `0`. Verified as a real bug (reverted, confirmed a new "facing preservation" test in the
  existing "Character facing" describe block goes red, restored).
- **Acknowledged, no fix — a client's replicated `facing` is trusted, unvalidated input**, so a
  modified client could report a facing that doesn't match its actual look direction and widen
  its own effective Hit/Grab cone. This is consistent with the netcode model's existing trust
  boundary (every input — `moveDirection`, `jumpHeld`, etc. — is already trusted the same way;
  the server has never validated any of them against a plausibility check), not a gap newly
  introduced by this ticket. No code change; flagged here rather than silently accepted.
- **Considered, not a real finding — the two self-caught test-construction mistakes** ("cannot
  grab a Character already engaged" positioned behind its own facing, and asserting on
  `grabCooldownMs` which never starts on press) were caught and fixed by me while writing the
  tests, before code review ran, not by code review itself — noted here only because they're the
  kind of mistake code review would otherwise have had to catch.

Re-verified afterward: full monorepo typecheck clean; full `pnpm -r test` green (packages/shared
alone: 553 tests, all green).

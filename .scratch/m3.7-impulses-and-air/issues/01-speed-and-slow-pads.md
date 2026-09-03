# 01 — Speed pads and slow pads

**What to build:** A pad on the floor that fires once as a Character crosses it, briefly making them
faster (or slower) before fading back. The first latched effect in the project, and the pattern the
rest of this milestone reuses.

**Blocked by:** M3.6 ticket 05 (velocity must persist before anything can be written into it).

**Status:** done

- [x] A speed pad applies a one-shot velocity write **plus** a temporarily raised speed cap that
      fades — SuperTuxKart's zipper model. A pure continuous multiplier was considered and rejected:
      the next tick's cap clips it, so on a short pad it does almost nothing (ADR 0035)
- [x] A slow pad is the same mechanism with the cap lowered
- [x] Firing exactly once reuses the project's existing `Epoch` idiom rather than a new mechanism, so
      a wide pad touched across several ticks fires one time and the write is idempotent under
      prediction replay
- [x] A client corrected mid-effect neither double-fires the pad nor loses it — covered by a
      prediction test
- [x] One demo Module each, visually identical to existing floor pieces
- [x] Manually verified live with two browsers, through the real `apps/client` frontend (not just the
      Track builder's own flat playtest render)

## Implementation notes

**Data model** (`packages/shared/src/simulation/SpeedPad.ts`, new): `SpeedPadConfig { trigger:
OrientedBox; capMultiplier: number }` — a speed pad and a slow pad are the exact same type, `1 <
capMultiplier` vs `capMultiplier < 1`; there is no separate "slow pad" concept anywhere in the code,
matching the ticket's own framing and CONTEXT.md's new glossary entry. `Module` gained an optional
`speedPads?: SpeedPadConfig[]` (plural, unlike the singular `checkpoint` — a Module can place more
than one), and `resolveTrack` collects them into world space through the exact same `placeBox`
pipeline `Checkpoint.trigger` already uses (`OrientedBox` → `pointInOrientedBox`), reusing containment
code proven correct for rotated/tilted Segments rather than writing a second one.

**The fading-cap curve** (`movementVerbs.ts`): `speedPadCapMultiplier(elapsedMs, holdMs, fadeMs,
peak)` is a pure function — held at `peak` for `SPEED_PAD_HOLD_MS`, then a *linear* fade back to 1
over `SPEED_PAD_FADE_MS` (SuperTuxKart's own fade-out is linear, not eased — deliberately not
`dashEnvelope`'s smoothstep shape, which is for the burst's own build/release, not this). Wrapped in a
`SpeedPadController` class that mirrors `DashController`'s exact idiom: `trigger()` starts the window,
`beginTick()` advances it, `capMultiplier`/`msLeft`/`peak` getters, and `restoreFromMs(msLeft,
capMultiplier)` for reconciliation — modeled directly on `DashController.restoreCooldownMs`.

**The one-shot write is a real SET, not an ADD**, exactly like Quake 3's `BG_TouchJumpPad`
(`VectorCopy`, discarding incoming speed) — `CharacterController.beginCapsuleTick` branches before
`accelerateVelocity` entirely on a trigger tick, writing `WALK_SPEED * capMultiplier` along the
Character's current heading (velocity if moving, else this tick's own input direction — never a
pad-authored direction, so standing still on a pad does nothing) directly into `velocity.x/z`, then
falls through the ordinary `computeColliderMovement`/grounding/collision tail unchanged. A SET here is
what makes the whole thing idempotent under prediction replay — the alternative (adding into
velocity) would stack on every replay of the same tick.

**A non-obvious discovery, caught only by writing the reconciliation stress test, not by reasoning
about the design up front**: because a Character already moving at `wishSpeed` along its own heading
is a fixed point of `accelerateVelocity` regardless of grip (ticket 06's own finding, reused here),
the *fading cap* alone reproduces the pad's speed change on every subsequent tick with no help from
the one-shot write — the write only matters for the instant the pad fires, to jump discontinuously
rather than ramp there. This is exactly why `reconcileTo` restores the fading cap from
`speedPadMsLeft`/`speedPadCapMultiplier` but deliberately never re-fires the one-shot write on
correction — re-deriving the ongoing effect from the snapshot is sufficient; re-triggering the write
too would double-apply a discontinuity the client already predicted correctly.

**Epoch and rising-edge detection** (`RapierSimulation.ts`): `CharacterSnapshot.speedPadEpoch` rises
by exactly 1 per crossing — same idiom as `ragdollEpoch`/`respawnCount` (CONTEXT.md's `Epoch` entry
now lists it as a third example). `RapierSimulation.updateSpeedPad` compares this tick's
`speedPads.findIndex(pad => pointInOrientedBox(character.position, pad.trigger))` against a per-
Character `touchedSpeedPadIndex` stored in `CharacterProgress`; a change from "not touching this pad"
to "touching it" is what fires `CharacterController.triggerSpeedPad`. Leaving (or switching to a
different pad) clears/updates the stored index, re-arming it for next entry.

**Reconciliation's `touchedSpeedPadIndex` is *re-derived* from the restored position, never blanked**
(a fix that came out of the code review process below) — a first draft blanked it to "touching
nothing" on every `reconcileCharacter`, on the reasoning "the correction can move the capsule across a
pad boundary a mispredicting client had no way to see coming" (the same reasoning ticket 01/06 use for
Surface's own one-tick staleness after a correction). That reasoning does not transfer here: Surface's
one-tick lag is genuinely harmless (grip/top-speed just apply a tick late), but a *blanked* touch index
means every single reconciliation while still standing inside an unchanged pad reads as a *fresh*
rising edge — under this project's own "reconciles every tick" stress-test discipline (established by
ticket 05's dash regression test), that fired the pad's one-shot write dozens of times in a row. Fixed
by re-deriving the index from `pointInOrientedBox(base.position, pad.trigger)` instead of discarding
it — the correct analogue of Surface's own lag-tolerant design, not a blank reset.

**Demo Modules**: `speed-pad`/`slow-pad` in `modules.ts`, geometrically identical to `bridge` (ticket
01/M3.6's own precedent) with a `speedPads: [{ trigger: ..., capMultiplier: 2 | 0.3 }]` covering the
floor's own footprint.

## Manual verification (real browser, through `apps/client`)

Per this session's explicit direction, this ticket's live check ran through the **actual game
frontend** (`apps/client`, full Three.js render + real camera + real HUD + real client-server netcode
with prediction/reconciliation) rather than the Track builder's own flat playtest preview used for
earlier M3.6 tickets — closer to how a player actually experiences it, and exercises the real protocol
path (`CharacterSnapshot.speedPadEpoch`/`speedPadMsLeft`/`speedPadCapMultiplier` actually crossing the
WebSocket) rather than only the shared-package simulation directly.

Built a Track (`start(z=10)` → `speed-pad` → `start` → `slow-pad` → `start`) via track-builder, shifted
to start at the same `(0,0,10)` base `M1_TRACK`/`PLAYGROUND_SPAWN` use (a temporary
`window.__debugShiftTrack` hook, removed before commit — the Track builder always places a Track's
first Segment at local `(0,0,0)`, and the Match server spawns joining players at a **hardcoded**
`PLAYGROUND_SPAWN` world position tied to the M1 seed, a pre-existing limitation unrelated to this
ticket: any custom Track must be authored at that same offset to spawn players onto real floor rather
than empty air). Saved it, then restarted the real Match server (retrying — track-service's `/tracks/
any` picks uniformly at random among stored Tracks, same dead end recorded in earlier M3.6 tickets)
until its startup fetch happened to land on this Track.

Drove two real headless-Chrome windows (raw CDP over a plain `WebSocket`, `Target.createTarget({
newWindow: true })` for genuinely separate top-level windows — the established pattern from M3.6) both
connected to `apps/client`'s real dev server, with a temporary `window.__debugLocalSim`/
`window.__debugMyId` hook in `main.ts` (removed before commit) for ground-truth reads. Held a real
`KeyDown`/`KeyUp` `KeyW` on client A while sampling its own predicted+reconciled snapshot every
100 ms:

```
t=0.10-0.70s  z: 10.30->6.30  speed~6.0        epoch=0            cap=1     (plain WALK_SPEED, pre-pad)
t=0.80s       crosses into speed-pad          epoch: 0->1        cap=2     (fires exactly once)
t=0.80-1.70s  z: 5.50->-5.30  speed 8-12       epoch=1            cap=2     (~2x speed, cap held)
t=1.80s       crosses into slow-pad           epoch: 1->2        cap=0.3   (fires exactly once)
t=1.80-5.70s  z: -6.18->-15.21 speed ~1.8->6.0 epoch=2  cap: 0.3->1 (linear fade back to neutral,
                                                                     visible as the steadily rising
                                                                     speed across this whole window)
t=5.80s+      speed=6.0 (plain WALK_SPEED)     epoch=2            cap=1     (fully faded, unchanged)
t=7.00s       ran off the (short, ~30-unit) end of the demo Track and Fell — Ragdoll, falls: 0->1,
              respawned back at spawn — confirms Fall/Respawn still behaves correctly even at a
              pad-boosted speed, not a bug in the pad mechanism itself
```

Confirmed both numerically (epoch incrementing exactly once per crossing, never more; the visible
linear fade shape; the top-speed doubling/dropping to the exact `capMultiplier`) and visually — a
screenshot mid-run shows the MushroomKing character model, full HUD (`pred`/`recon`/`net` diagnostics,
falls counter), and the real scene geometry, confirmed via `Page.captureScreenshot`; a second
screenshot ~2.5s later shows the same Character correctly ragdolled and respawned after running off
the track's end, with `falls 1` visible in the HUD. Client B (a second real connected player, idle the
whole time) confirmed its own snapshot stayed untouched (`speedPadEpoch: 0` throughout) — the pad
firing for one player has zero effect on another.

## Code review findings and fixes

`/code-review high` (physics/netcode logic, per CLAUDE.md) — 9 findings, all fixed:

- **Fixed — a pad triggered while Sliding stayed queued, undischarged, until Sliding ended.** The
  one-shot velocity write was only ever checked inside the non-Sliding `else` branch of
  `beginCapsuleTick`; a pad fired right before/during a slide sat in `pendingSpeedPadCapMultiplier`
  for the whole rest of the slide, then landed at a slide-driven speed/heading with no relation to the
  pad, long after its own fade window would have expired. Extracted a `consumePendingSpeedPadBoost`
  helper, called once per tick ahead of the Sliding/non-Sliding split, so either branch can consume it
  on the very next tick. Covered by a new regression test that empirically traces the exact tick a
  Character enters Sliding on a fixed ramp and confirms the boost lands immediately once queued, not
  merely "eventually."
- **Fixed — the boost ignored `surfaceTopSpeedMultiplier` entirely.** Every other tick's walk target
  multiplies `WALK_SPEED` by the Character's current Surface (mud's 0.5x, etc.); the one-shot SET used
  a flat `WALK_SPEED * capMultiplier`, so a pad overlapping a non-default Surface produced a one-tick
  speed discontinuity inconsistent with the fading-cap model it's supposed to blend into. Now folded
  into the same multiplier chain.
- **Fixed — the boost ignored `machine.inputScale`, unlike every other movement contributor that same
  tick.** A Staggered Character got the full, undamped boost while walk/jump/dash are all damped by
  `STAGGER_INPUT_SCALE`. Multiplying by `inputScale` fixes this **and**, as a direct consequence (Sliding
  also has its own `inputScale`, `SLIDE_INPUT_SCALE`), makes the Sliding fix above consistently damped
  too — one scalar, not a special case per state.
- **Fixed — the boost silently discarded an in-flight Dash's contribution**, while `dashSpeed`/`dashing`
  kept reporting the burst at full strength for the same tick — a visible mismatch between the
  renderer's speed-lines VFX and the Character's real velocity, and a regression from ADR 0035's own
  "Dash is one contributor to the same velocity" model. `dashBurst` is now added on top of the boosted
  base rather than discarded — matching the project's own research doc, which treats a pad feeding a
  live Dash into the wall-Impact check as a deliberately desirable interaction, not a bug to prevent.
- **Fixed — a pad triggered while Ragdolling/GettingUp incremented `speedPadEpoch` (and armed the
  fading cap) for an effect the Character could never feel** (the boost math zeroes out under
  `inputScale === 0` during GettingUp, and a Ragdoll's camera-follow position can easily drag across a
  trigger it never "walked into"). `updateSpeedPad` now skips entirely while down, leaving
  `touchedSpeedPadIndex` untouched rather than blanked — once truly back in `Controlled`, still
  standing inside the trigger, firing is correct and left alone (indistinguishable from having walked
  onto the pad any other way).
- **Fixed — the reconciliation-safety fix from the first review pass (re-deriving `touchedSpeedPadIndex`
  from the restored position rather than blanking it) hand-duplicated `updateCheckpoint`'s general
  shape with none of the code shared.** Extracted a small `findTriggerIndex` helper on
  `RapierSimulation`, used by both `updateSpeedPad` and `reconcileCharacter` — worth doing now rather
  than leaving it for ticket 02 (bounce/launch pads) to independently rediscover the exact same
  "never blank on reconcile" fix this ticket's own comments describe at length.
- **Fixed — the `Pick<CharacterSnapshot, ...>` field list `RapierSimulation.reconcileCharacter` and
  `CharacterController.reconcileTo` both take was duplicated verbatim (8 literal field names) and had
  to be hand-widened in both places for this one ticket.** Extracted a shared `ReconcileBase` type
  alias in `SimState.ts`, used by both signatures — a future reconciliation-relevant field now only
  needs adding in one place.
- **Fixed — the Track builder had no visual marker at all for a Module's `speedPads`**, unlike
  Checkpoint (`addCheckpoint`'s dedicated wireframe box). A track designer placing `speed-pad`/
  `slow-pad` saw only floor geometry, with no way to see (or debug a custom Module whose trigger
  doesn't match its visible footprint) where a pad's activation zone actually is. Added a matching
  `addSpeedPad` wireframe marker (a distinct yellow, `apps/track-builder/src/render.ts`) — the real
  game client (`apps/client/src/scene.ts`) deliberately does **not** get one, since pads (like Surfaces)
  are meant to be invisible to a player by design, exactly like mud/ice's own precedent; this also
  surfaced that `SpeedPadConfig` was never exported from the shared package's own root `index.ts` at
  all, fixed alongside it.
- **Not fixed, deliberately — `walk` (the ordinary-path target velocity) is computed unconditionally
  every tick even on a tick the boost branch discards it entirely.** Real but negligible (one extra
  vector scale), and restructuring the branch order to avoid it risks introducing a subtler bug for a
  performance non-issue this close to commit — noted rather than chased.

Re-verified afterward: full monorepo typecheck clean; full test suite green (300 shared — 5 new
regression tests covering the fixes above, plus the original 8 pad tests — / 68 track-builder / 32
track-service / 78 client / 16 server, 494 total).

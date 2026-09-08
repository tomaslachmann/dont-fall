# 04 — Hold-to-charge, and Dash locks everything

**What to build:** A swing's weight comes from holding the Hit button, not from riding a Dash's own
speed — and Dash locks Hit and Grab out entirely while a burst is playing, full stop.

**Blocked by:** 01 — A Hit with weight (superseded, not built on).

**Status:** done

## Why

Live play surfaced two problems with ticket 01's approach-speed design:

- **Hit and Grab were never supposed to fire out of a Dash at all.** "Dash locks everything until
  it finishes" was the intended rule; ticket 01 instead read a Hit's magnitude from the striker's
  own approach speed, which only ever got interesting *because* a Dash was still running underneath
  it. That was a misspecification, not a considered trade-off.
- **Firing a swing mid-Dash visibly broke the animation.** `HitReactionPlayer.start()` only ever
  faded out its own previously-playing reaction (Punch → HitReact); it never touched whatever
  ordinary locomotion action the caller's own crossfade had active. A swing landing mid-Dash left
  the dash-run clip at full weight, still playing, underneath the Punch/HitReact overlay — the dash
  animation visibly never let go.

## What changed

- [x] `CharacterController.beginCapsuleTick` reads `this.dash.isActive` right after `dash.beginTick`
      has advanced for the tick, and gates Hit and Grab out entirely on it (`fullControl && !dashActive`
      / `... && notGrabbing && !dashActive`) — neither can fire, or even begin charging, while a Dash
      burst is playing
- [x] `HitController` becomes hold-to-charge: `beginTick(held, allowed)` takes the raw button state
      and tracks its own charge/release edges internally (no external press-edge needed, unlike
      Dash/Grab). Holding accumulates `chargeTicks` up to `HIT_CHARGE_MAX_TICKS`; releasing fires
      with the accumulated fraction and starts the cooldown. Losing `allowed` mid-charge (a forced
      Stagger, Dash starting) discards the charge outright — an involuntary release is not a punch
- [x] `hitImpactMagnitude` now takes a charge fraction (0..1) instead of an approach speed:
      `HIT_IMPACT_MAGNITUDE + chargeFraction * HIT_CHARGE_IMPACT_BONUS`, capped at `HIT_IMPACT_MAX`.
      `HIT_CHARGE_MAX_MS` (600) and `HIT_CHARGE_IMPACT_BONUS` (6) replace `HIT_MOMENTUM_SCALE`,
      sized so a full charge (`12`) matches ticket 01's own "wound Dash" case and a half charge (`9`)
      lands right at `IMPACT_RAGDOLL_MIN` — the same "a knockdown costs real commitment" intent,
      now measured in hold time instead of approach speed
- [x] `hitChargeMs` joins `CharacterState`/`CharacterSnapshot`/`ReconcileBase`, restored on
      reconciliation via a new `HitController.restoreCharge` (a direct round-trip — unlike Dash's own
      `ticksLeft`/cooldown phase-offset restore, charge and cooldown never overlap, so there's no
      subtlety to it)
- [x] `resolveHit`/`resolveGrabInitiation` no longer cancel the striker's/grabber's own Dash on
      connect — it can never be in progress there anymore, since Dash gates both out entirely. Only
      the target's/held Character's own Dash still needs cancelling (CONTEXT.md's own definition)
- [x] `HitReactionPlayer.update`/`start` gain a `currentLocomotionAction` parameter — fades it out
      the instant a *fresh* reaction starts (not on a continuing one, e.g. Punch → HitReact the same
      tick), fixing the animation bug directly rather than only avoiding it by construction
- [x] HUD's `hit` bar shows charge progress (filling, labelled "charging") while held, falling back
      to the existing cooldown/ready display once released — `hitChargeMs` threaded through
      `game/index.ts` alongside `hitCooldownMs`

## Deliberately out of scope

- **No remote-side charge tell.** A remote Character's own windup isn't visible to other players —
  `RenderCharacter` doesn't carry `hitChargeMs`. Local feel (the HUD bar, the eventual knockdown)
  was the priority; a remote windup indicator is a real gap but not one this pass built speculatively.
- **No movement restriction while charging.** Holding Hit doesn't slow or root the Character —
  not asked for, and adding it without a concrete complaint risks solving a problem that doesn't
  exist yet.
- **Charging does not block Dash the other way.** Only Dash locks Hit/Grab; nothing stops a
  Character from starting a Dash while a Hit charge is in progress (the charge is simply discarded,
  per `allowed` dropping out).

Full monorepo typecheck clean; full `pnpm -r test` green across all 6 packages (1039 tests).
`HitController.test.ts` rewritten around hold/release rather than a single press; `RapierSimulation.test.ts`'s
Hit and Grab describe blocks gained dedicated dash-lock regression tests and a reconcile-mid-charge
regression test, and lost the old approach-speed/Dash-momentum test entirely (structurally impossible
now). Two of the new dash-lock tests were initially written with the second Character only 1 unit
away — close enough that a full-speed Dash crashed into it via Bump before the burst ever finished,
contaminating the result with an unrelated knockdown; fixed by placing it beyond a full Dash's own
measured ~13.5-unit reach.

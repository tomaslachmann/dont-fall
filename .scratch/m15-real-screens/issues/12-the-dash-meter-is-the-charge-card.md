# 12 — The Dash meter is the charge card

**What to build:** `DashMeter` becomes the mock DashFeedback's charge card: DASH CHARGE, the bound
key, one pip for the one Dash, RECHARGES IN with the time left. While the Dash is ready the card
blinks (the mock's halo). The DashFeedback overlay itself is not ported. The user's choice, ADR 0110.

**Blocked by:** —

**Status:** done on tests (2026-09-19)

- [x] Markup and CSS from `test_components/src/screens/DashFeedback.tsx` (`.charge`, `.halo`,
      `.chargeCard`, pips, `.recharge`), one pip
- [x] RECHARGES IN from the cooldown, display-rounded (ADR 0088); the key from the bindings
- [x] Blinks while ready, not while refilling
- [x] Both Round HUDs use it

## As built

- The card reads PRESS, not the mock's HOLD: the Dash fires on the press edge
  (`MovementController`: `dashPressed = dashHeld && !dashHeldLastTick`).
- One pip that fills with the recharge (`--df-dash-fill`) and lights when ready; RECHARGES IN counts
  whole seconds (`dashRechargeS`, rounded up), so React is raised fifteen times a recharge, not 150
  (ADR 0088). The halo (`global(df-charge)`) shows only while ready; reduced motion holds it still.

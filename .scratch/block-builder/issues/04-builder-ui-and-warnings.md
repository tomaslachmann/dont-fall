# 04 — Builder dimension UI + warnings (incl. measured jump height)

**What to build:** The "pro debily" surface: dimension entry with snap tiers,
plus live warnings — and the one measurement the warnings depend on (max jump
height).

**Blocked by:** tickets 01–03 (schema, geometry, snap points it drives and
warns about).

**Status:** planned

## Why

Parameters without tiers recreate the disease (free-typed `2.37` heights);
warnings without a measured jump height are guesses. This ticket is where the
research's numbers become UI.

## What to change

- [ ] Dimension entry (length/width/height): coarse step 1 cell on its axis
  (0.5 horizontal, 0.25 vertical), Shift-fine 0.1 WITHOUT quantization
  commit; uncommitted fine values keep `manuallyPlaced` until snapped back
  on-grid (mirror the `applySnapTiers` translation split)
- [ ] Edge handles on the gizmo selection (drag a face = change that
  dimension), not numbers-first — numeric entry stays as the fallback, same
  values, same tiers
- [ ] **Measure max jump height** (`JUMP_VELOCITY = 10`, `GRAVITY_Y = -22`,
  `JUMP_HOLD_MAX_MS = 260` half-gravity hold): a test that jumps from flat
  ground and records peak height. The measured number — not `v²/2g`
  arithmetic — becomes `MAX_JUMP_HEIGHT` in `tuning.ts` (named constant per
  repo convention, not a magic number in the builder)
- [ ] Live builder warnings (red ghost + reason, never authoring-blocking):
  - wedge slope 35–60° → "slide territory"; >= 60° → "wall, unclimbable"
  - step-up above `MAX_JUMP_HEIGHT` with no ramp → "reachable only by …
    nothing — add a wedge" (exact wording TBD, must name the fix)
  - stacked column taller than the kill-plane margin 7.5 → explicit
    authoring confirmation
  - unquantized (Shift-fine, `manuallyPlaced`) params → "off-grid, will be
    rejected at publish" — warn here, reject at publish (ADR 0055 split)
- [ ] Publish path surfaces server 400 reasons verbatim (readable reason, no
  silent fail)

## Done when

- [ ] `MAX_JUMP_HEIGHT` measured test green and used by the step-up warning
  (warning fires on a too-tall bare step-up, stays silent on a ramped one)
- [ ] Tier tests: coarse entry always quantized, Shift-fine marks
  `manuallyPlaced`, snapping back on-grid clears it
- [ ] Each warning has a builder-level test (pure function producing the
  reason string) — rendering the ghost stays manually verified, per the
  app's existing split (logic unit-tested, DOM/Three.js thin)

## Watch out for

**Warning fatigue.** Four warning kinds firing at once teach authors to ignore
all of them. Priority: off-grid and unclimbable-slope first; jump-reach and
kill-plane margin only when the first two are clean. One reason on the ghost
at a time.

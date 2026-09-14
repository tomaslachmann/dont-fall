# 06 — Arc: params + tessellation + rim snaps (phase 2)

**What to build:** The `arc` kind: params, shared tessellation, swept-bounds
footprint, rim snap points.

**Blocked by:** phase 1 verified (ticket 05). Tessellation on top of an
unproven pipeline doubles the debugging surface.

**Status:** planned

## Why

The arc is the expensive third of the ask (curve "přes zet nebo do strany"):
an arc is not one collider but N straight pieces approximating a curve, and
the tessellation must never move a snap target.

## What to change

- [ ] `BlockParams`: `arc` with `radiusGrid` (GRID_XZ units), `angleDeg`
  (finite, (0, 360]), `thicknessGrid` (GRID_XZ units); server rule
  `radiusGrid >= thicknessGrid > 0`; ticket 01's loud refusal of `arc`
  removed here, not earlier
- [ ] `buildBlockGeometry` arc branch: tessellate by angle step `<= 15°`
  (reuses `ROTATE_STEP`), chord count `n = ceil(angleDeg / 15)`, chord error
  bounded by `r*(1-cos(step/2))`; inner/outer wall quads + top/bottom ring
  sectors as one indexed mesh; deterministic like the wedge branch
- [ ] Rim snap points on quadrant boundaries only, so tessellation density
  never moves a snap target; inner/outer rim midpoints (edge family), rim
  quadrant endpoints (corner family)
- [ ] Footprint becomes swept-arc bounds (proposal §footprint-as-contract);
  stacked arcs validated against the 7.5 kill-plane margin like everything
  else
- [ ] Angle entry tier: 15° default, 5° under Shift, never continuous
  (mirror `ROTATE_STEP` / `ROTATE_STEP_FINE`, ADR 0034 posture)
- [ ] "Per side" (asymmetric arc / banking) is a parameter on this ticket
  only if phase-1 UI proves the knob budget has room — otherwise it is cut
  to a follow-up, not smuggled in

## Done when

- [ ] Physics tests: banked-flat arc walks end to end without hitching;
  arc-to-cuboid rim joint tiles within epsilon; quadrant snap targets
  identical at `n` and `2n` tessellation (snap stability test)
- [ ] Same-geometry-both-sides test (ticket 02's pattern) extended to arcs
- [ ] Full typecheck + shared suite green

## Watch out for

**Tessellation count vs. collider count.** A 180° arc at 15° steps is 12+
collider pieces; a Track of arcs multiplies fast. Count budget first (ticket
07 measures); if the count hurts, the fix is coarser steps with a documented
chord-error bound, not a second tessellator.

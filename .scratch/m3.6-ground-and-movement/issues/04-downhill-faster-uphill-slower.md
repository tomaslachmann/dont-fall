# 04 — Downhill is faster, uphill is slower

**What to build:** Running down a ramp is visibly quicker than running up the same ramp.

**Blocked by:** 03 — needs the walkable/sliding split, since the two sides of that split use
different movement models.

**Status:** blocked

- [ ] Speed on a walkable slope is scaled by an explicit multiplier derived from the **signed slope
      angle** — the model Unity's own Character Controller documentation prescribes
- [ ] Projecting gravity onto the slope plane and integrating it is **not** used here: that is the
      rigid-body formulation, and grounded kinematic controllers remove the vertical component
      instead. It belongs to `Sliding` and stays there (ADR 0035)
- [ ] A comment records that Quake 3 deliberately does the opposite — re-normalising so that speed
      stays slope-independent — so a future reader sees this was a choice between two documented
      traditions rather than an oversight
- [ ] Manually verified live: the same ramp is measurably faster downhill than uphill

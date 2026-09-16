# 05 — Spiked Assets always knock down

**What to build:** `hazard: "spiked"` on Asset defs; any Character contact with
a spiked collider is an Impact at `IMPACT_RAGDOLL_MIN`, still or moving.

**Blocked by:** 04 (shares the contact path).

**Status:** done (2026-09-14) — tests; the live check is the user's.

## What to change

- [x] `AssetModuleDef.hazard?`, carried onto the resolved trimesh; converter
      rules per stem (spike plates, spiked saw discs), reviewed with the user
- [x] Standing on, walking into, or being moved into a spiked collider knocks down
- [x] Tests for all three contacts; live check in the client is the user's

## Notes

- Spiked stems (`convert-imagetostl.ts`, `SPIKED_STEMS`): `platformspike*`,
  `trapcirclespike*`, `trapcirclehorizontalspike*` — 12 Assets. Arrows are not
  spiked (Projectile shapes, no mechanic yet). For the user to review.
- `SPIKED_IMPACT_MAGNITUDE = IMPACT_RAGDOLL_MIN`, `SPIKED_LIFT_RATIO = 1`.
- Hazard rides asset trimeshes only (an Asset property, ADR 0061); procedural
  box Modules have none.

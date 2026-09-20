# 01 — The authored rig in the simulation

**What to build:** The production ragdoll becomes the rubber bench's authored BLIP rig: fifteen
bodies on the rig's own pivots wearing Blender-authored convex hulls, hinges with per-body axes and
rest-shifted limits, rope-stop swing cones + twist budgets on every ball joint, and a quiet spawn.
The look is untouched in this ticket — `KO_X` clips still draw the knockdown; only the physics (and
with it the wire's bone count, 11 → 15) changes. The user's call, 2026-09-20: "celkovy ragdoll
state, at je to lepsi a hezci".

**Blocked by:** —

**Status:** done on tests (2026-09-20) — see Notes for what moved and what waits

- [x] The baked spec `packages/shared/src/simulation/ragdoll/blipRagdollSpec.ts` (generated, 115 KB):
      15 bodies (hulls 100–256 points each, masses, per-bone angular damping — 1.1, head 2.4),
      14 joints with every frame resolved at bake time (per-body hinge axes, rest-shifted limits,
      the neck's motor) plus 18 rope stops, **11 rest-touching pairs** (head↔shoulders,
      head↔forearms, feet↔thighs, pelvis↔shins, hands↔upper-arms, body↔forearm.R), the
      `GetUp_F`/`GetUp_B` frame-0 poses for ticket 03, and the bake meta (scale 0.58243,
      drop −0.02621)
- [x] `pnpm bake:ragdoll` — `apps/client/scripts/bake-ragdoll.ts` + dev-only `bake-ragdoll.html` +
      `src/bake/bakeRagdollPage.ts` (the recipe math lives there, where three.js is; the shared
      build does no frame math). Worked first run
- [x] `AuthoredRagdoll` (`packages/shared/src/simulation/ragdoll/AuthoredRagdoll.ts`), old API kept
      plus `bodyOf(name)`: hulls, baked joints applied as written, rest-touching pairs' contacts
      off via never-taut ropes (bone-bit collision groups don't fit — the game's groups share the
      16 membership bits), `RAGDOLL_GROUPS`, contact skin, per-bone angular damping,
      `RAGDOLL_RESTITUTION` (new tuning constant, 0.05, the bench's), the M6.1 mass recompute
- [x] `activate(root, yaw, velocity, impulse)` — yaw is the **drawn model yaw**;
      `modelYawOfFacing(facing) = π − facing` records the ADR 0045/0071 convention beside the class
- [x] `RagdollController` holds it; gains a `facingOf` callback from `CharacterController`; the
      chest is the spec's `body` bone; the GettingUp blend maps over the spec (placeholder until
      ticket 03's sweep — nothing draws it, ADR 0076)
- [x] Old `Ragdoll` + `RAGDOLL_BONES` untouched (rubber bench still imports them; retire in 05)
- [x] Tests: `ragdoll/AuthoredRagdoll.test.ts` (9) — wire order, yaw-turned activation, quiet
      spawn, holds together, shoulder swing cone, wrist twist budget, elbow range (measured with
      the torso hulls off — the inflated hulls honestly block a full fold at 1.25 rad), head
      nods-never-turns inside the authored ±0.1745 + motor, dispose. Bone-count pin 11 → 15 in
      `RapierSimulation.test.ts`

## What building it moved (measured)

- **Hurl distances** with the same launch speeds: flick/half/full = 1.67 / 3.53 / 6.46 u (was
  3.1 / 5.1 / 7.3). Wider spread — winding up pays more; the flick under 2 u is the user's
  balance call. `GrabHolds.test.ts` pins the shape now; ticket 04 re-measures the table when the
  Hurl goes physical.
- **The camera-follow step at knockdown start**: BLIP's pelvis pivot sits 0.48 under the capsule
  centre (old skeleton 0.15), so the first down snapshot steps that far — the handoff test's
  bound moved 0.35 → 0.6 with a comment. Whether the dip shows is a live check.
- **`RAGDOLL_PELVIS_TO_FEET`** now derives from the baked spec (0.37, was 0.7), so the KO clips
  stand an airborne body right until ticket 02 retires that path.
- `pnpm bench:sim` before-run saved (Apple M4: server 12-char p50 1.17 ms, p95 2.76 ms); the
  after-run is ticket 05's.

## Not this ticket's

13 test failures in the impacts-at-speed family (wall/dash/Bump/ice crashes, Prop pushes, and the
walkTrack cascades in Slip Stream / Sky Rings) — the user's own known bug (2026-09-20: "mam tam
chybu v narazech v rychlosti, to neres"). The ragdoll is inert until the first knockdown, so the
knockdown *decision* these test is untouched by this ticket.

## Notes

- Shared cannot import three.js: the build needs `quatFromUnitVectors` (shortest arc) beside the
  existing `mulQuat`/`conjugateQuat`/`rotateVec3ByQuat`, and the twist-about-axis read for
  `restHingeAngle`.
- `pnpm bench:sim` runs before this ticket lands and after ticket 04 — 15 eager hull bodies per
  Character (server ×12 + every client's two worlds) is the measured risk; lazy-build on first
  knockdown is the fallback.
- The spec is in sim units so nothing at runtime scales; the bake computes the same
  `CHARACTER_VISUAL_HEIGHT / glbHeight` factor `characterModel.ts` applies to the drawn rig.

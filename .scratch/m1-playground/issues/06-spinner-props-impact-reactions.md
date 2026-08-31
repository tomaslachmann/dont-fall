# 06 — Spinner + physics props + impact reactions

**What to build:** Something to get whacked by and stuff to shove. One rotating
`Spinner` Obstacle (a constantly rotating bar) that knocks the Character on
contact. A handful of dynamic physics props the Character can bump and knock
around. Visible Impact Reactions (flinch / spin / knockdown) scaled to Impact
magnitude. Dashing into a wall or off an edge now transitions the Character to
Ragdoll (the deferred piece from ticket 04).

**Blocked by:** 05

**Status:** done

- [x] One `Spinner` Obstacle rotating at a constant rate; contact applies Knockback
- [x] Spinner hit routes through the state machine → Stagger or Ragdoll by magnitude
- [x] A few dynamic props (boxes/balls) the Character can push and knock over
- [x] Impact Reactions visible and scaled to Impact magnitude
- [x] Dash into a wall/edge → Ragdoll
- [x] All interactions resolved inside the sim step

**Implementation notes:**

- `Spinner` (`simulation/Spinner.ts`) is a kinematic Rapier body; rotation is a
  pure function of the tick number (`spinnerAngleAt`), so it is never carried in
  `SimState` — the renderer recomputes it locally from the same tuning, the same
  way it already gets `statics`/`checkpoints` once via `getSpinners()`. Contact
  is resolved from the Character's own `computeColliderMovement` collision list
  (no sensor/event-queue needed), same mechanism used for dash-into-wall and Prop
  pushing. Knockback is tangential to the spin at the hit radius (`v = ω × r`),
  so a tip hit lands harder than a graze near the axle — naturally spanning
  Stagger and Ragdoll off the existing Impact thresholds.
- `Prop` (`simulation/Prop.ts`) is ordinary Rapier dynamics; the Character shoves
  it on contact, capped so continuous contact doesn't stack an unbounded
  velocity. Its pose *is* carried in `SimState.props` (physics-driven, not
  reproducible from a formula), interpolated the same way ragdoll bones are.
- Dash-into-a-wall reuses the same per-tick collision list: a Dash burst blocked
  by a near-vertical surface always forces Ragdoll via the normal Impact
  pipeline (`dashWallKnockback`, pure-tested in `CharacterController.test.ts`).
  "Off an edge" needed no separate mechanic — a Fall already forces Ragdoll via
  the existing kill-plane path.
- Seam: `CharacterController` stays ignorant of Spinner/Prop — it only reports
  `(colliderHandle, point, velocity)` through a `CollisionListener`; the moved
  `RapierSimulation` looks the handle up against its own Spinners/Props and
  decides what happens. Ragdoll bones deliberately don't collide with
  Spinners/Props (documented in `collisionGroups.ts`) — an accepted M1
  simplification, not an oversight.
- Verified with the full workspace suite (94 `packages/shared` + 17 apps = 111
  tests), `tsc --noEmit` clean on all three packages, and a headless-Chromium
  check of the running client (Spinner rotates, Props render and get pushed,
  console clean). `/code-review` at high caught a real sign bug in the
  dash-wall bounce direction (fixed, now pure-function tested) plus an unbounded
  Prop-push accumulation and a one-frame-stale camera-occlusion raycast against
  the newly-moving meshes (both fixed).

# Slopes and surfaces for a kinematic character controller

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — see `docs/research/m2-netcode-transport.md` for the
> convention. This file feeds a design discussion; it is not itself a decision
> record. If the recommendations in §8 are adopted they should be captured as
> ADRs the normal way.

Scope: what the established standard is — in shipped games, in engine and
character-controller documentation, and in GDC/academic literature — for making a
**kinematic** character controller behave correctly and feel good on **slopes**
and on **variable-friction / speed-modifying surfaces** (ice, mud, boost pads,
slow pads, bounce pads).

This matters now because ADR 0034 gave a Segment a full 3D orientation and
`RapierSimulation` builds statics as genuinely rotated cuboid colliders
(`RapierSimulation.ts:185–190`) — a ramp is already authorable in the Track
builder today, and nothing in `CharacterController` was written with ramps in
mind. `Module` has no surface/material concept at all, so ice/mud/boost are
green-field.

Every claim below is tagged for source quality:
**[primary]** = engine documentation, engine/game source code, or a first-party
talk; **[verified locally]** = measured against this repo's own dependency;
**[community RE]** = community reverse-engineering of a shipped binary, credible
but not vendor-documented; **[folklore]** = forum/wiki consensus with no
authoritative backing. There is a ledger at the end (§9).

---

## Recommendation

**There is no single "standard" — there are two coherent traditions, and they
disagree on the two questions that matter most.** Pick one deliberately rather
than blending them:

- The **Quake/Source tradition**: velocity lives in a plain vector, ground
  contact is a downward trace re-run every tick (`CategorizePosition`),
  movement is `friction → accelerate → clip-to-plane → step`, and the
  controller **explicitly re-normalises velocity after clipping so slopes do
  not change your speed** ([`bg_pmove.c` `PM_WalkMove`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c) —
  `// don't decrease velocity when going up or down a slope`) **[primary]**.
- The **projection tradition** (Godot, Rapier, Fauerby's sliding-plane paper):
  the desired translation is projected onto the contact plane and whatever
  magnitude survives is what you get, so you are *automatically* slower uphill
  and faster downhill. Godot documents this as its default in one sentence:
  "If `false` (by default), the body will move faster on downward slopes and
  slower on upward slopes."
  ([`CharacterBody3D.floor_constant_speed`](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html)) **[primary]**

Unreal ships both behind a flag and documents the difference precisely:
`bMaintainHorizontalGroundVelocity` — "If true, walking movement always
maintains horizontal velocity when moving up ramps… If false, then walking
movement maintains velocity magnitude parallel to the ramp surface."
([UE `CharacterMovementComponent`](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/CharacterMovementComponent?application_version=5.4)) **[primary]**

Concretely, for DON'T FALL:

**Q1 — snap-to-ground.** Every engine surveyed has it; every engine also gates it
behind the *same three guards*, and this project's stated failure modes are what
happens when the guards are missing, not what happens when the feature is on.
The universal guard set is: **(a) you must have been grounded at the start of the
step, (b) the step's motion must not be upward, (c) the snap only counts if it
lands on a *walkable* plane.** Rapier, Godot and Source all implement exactly
these three, in three different codebases
([Rapier `character_controller.rs`](https://github.com/dimforge/rapier/blob/master/src/control/character_controller.rs),
[Godot `character_body_3d.cpp`](https://github.com/godotengine/godot/blob/master/scene/3d/physics/character_body_3d.cpp),
[Source `gamemovement.cpp` `StayOnGround`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp)) **[primary]**.
For the two specific problems this project hit, the documented fixes are named
features, not "turn it off": **ledge stalling** → Unreal's
`bUseFlatBaseForFloorChecks` ("This avoids the situation where characters slowly
lower off the side of a ledge") plus `PerchRadiusThreshold`, and Source's
`TryTouchGroundInQuadrants` four-sub-box retest; **launching off crests at
speed** → Unity's `MaxDownwardSlopeChangeAngle` /
`PreventGroundingWhenMovingTowardsNoGrounding` predictive raycasts. See §1.

**Q2 — max walkable angle.** The industry has effectively standardised on
**≈45°**: Source hard-codes `plane.normal[2] >= 0.7` (45.573°) as a bare literal
in fifteen places, Quake 3 has
`#define MIN_WALK_NORMAL 0.7f // can't walk on very steep slopes`
(`bg_local.h`), Godot's `floor_max_angle` defaults to
0.7853982 rad ("The default value equals 45 degrees"), and Rapier's
`max_slope_climb_angle` defaults to `π/4`. Unreal is the deliberate outlier at
**44.765°** (`WalkableFloorAngle`). Unity's own manual is the loudest dissent:
"Slope Limit should not be too small. Often using a value of 90 degrees works
best." Above the limit, the split is between *refuse to climb* (PhysX/Unity
default `ePREVENT_CLIMBING`, and Rapier as this project currently configures it)
and *forced slide* (PhysX `ePREVENT_CLIMBING_AND_FORCE_SLIDING`, Quake/Source via
gravity + clip). See §2.

**Q3 — slope-influenced speed.** Yes, shipped games do it, and for a kinematic
character it is done one of exactly three ways: (i) **let plane projection do
it** (Godot default, Rapier, Fauerby); (ii) **explicit multiplier from the
signed slope angle** — which is what Unity's own Character Controller package
documentation *tells you to do*: "use the
`CharacterControlUtilities.GetSlopeAngleTowardsDirection` method… apply a
multiplier to your desired character velocity based on that signed slope angle";
(iii) **an additive acceleration along the slope** — Sonic's `slp * sin(angle)`
added to ground speed every frame **[community RE]**. Projecting *gravity* onto
the slope plane and integrating it is the rigid-body way and is **not** what
kinematic controllers do while grounded — Quake/Source zero out or clip the
vertical component instead. See §3.

**Q4 — friction/grip.** Rapier friction genuinely does not apply here (the
capsule's motion is scripted; `computeColliderMovement` is a shape-cast, not a
solve), and this is not a Rapier quirk: PhysX documents the same posture — "A
kinematic controller directly works with input displacement vectors (1st order
control)" and "users are responsible for applying gravity to characters here",
and Unity's manual says flatly "The Controller does not react to forces on its
own." The near-universal model is a **per-surface scalar that multiplies both
the ground drag *and* the acceleration**. Source is the cleanest example:
`m_surfaceFriction` is read from the surface's material, scaled `*1.25` and
clamped to 1.0, then multiplies `sv_friction` in `Friction()` *and* `sv_accelerate`
in `Accelerate()`. Quake 3 is the crudest and most legible: `SURF_SLICK` skips
ground friction entirely *and* swaps `pm_accelerate` (10.0) for `pm_airaccelerate`
(1.0). **The parameter that carries the feel of ice is acceleration/turn
authority, not top speed** — both engines leave max speed alone. Mud is the
mirror image: cap max speed (and optionally raise drag) while leaving
acceleration high. See §4.

**Q5 — boost/slow pads.** Both models are in shipped use and Source ships
*both behind one spawnflag*: `trigger_push` with `SF_TRIG_PUSH_ONCE` does
`ApplyAbsVelocityImpulse` and deletes itself; without it, it sets
`SetBaseVelocity(vecPush)` continuously while touching, with the comment "apply
x, y as a base velocity so we travel at constant speed on conveyors"
([`triggers.cpp` `CTriggerPush::Touch`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/triggers.cpp)) **[primary]**.
Mario Kart Wii is squarely the one-shot camp: a boost is "a timer, which
decreases every frame", raising max speed and adding acceleration, and on
expiry max speed decays at 3 u/f² **[community RE]**. **For a
predicted networked game, prefer continuous** — it is a pure function of
position and therefore automatically correct under replay. If you need a
one-shot, copy Quake 3's jump pad exactly: it is a *velocity assignment* (not an
addition), it lives in shared `bg_` code both sides run, it is announced with
`BG_AddPredictableEventToPlayerstate(EV_JUMP_PAD, …)`, and it latches
`ps->jumppad_ent` / `ps->jumppad_frame` **inside the replicated player state** so
re-touching within a replay is idempotent. See §5.

**Q6 — bounce.** Restitution is a rigid-body solver concept and does not reach a
kinematic capsule at all, so *every* engine surveyed does bounce for characters
as an explicit scripted vertical velocity. Quake 3's bounce pad and jump pad are
literally the same code path (`BG_TouchJumpPad` → `VectorCopy(jumppad->origin2,
ps->velocity)`). Treat "continuous restitution" as not-an-option here; the only
real design question is *assignment vs addition*, and assignment is what makes it
replay-safe. See §6.

**Q7 — determinism/netcode.** The rule every prediction framework converges on:
**anything that changes movement must be either (a) a pure function of the
replicated state the replay already restores, or (b) an explicitly replicated
field in that state.** Unreal states it structurally — `FSavedMove_Character`
must capture "What velocity and acceleration the character held" and root-motion
sources, or the effect is lost on replay. Source makes base velocity a networked
field (`RecvPropVector(RECVINFO(m_vecBaseVelocity))`) *and* a prediction-copied
field (`DEFINE_FIELD(m_vecBaseVelocity, FIELD_VECTOR)` in `C_BaseEntity`'s
prediction data). A "continuous multiplier keyed off which surface you are
standing on" satisfies (a) for free. A boost *timer* does not — it is new state
and must join `CharacterSnapshot`. See §7.

---

## 1. Snap-to-ground / ground-stick

### 1.1 Why a kinematic controller needs it at all

A kinematic controller does not have a solver holding it against the floor; it
moves by an explicit translation each tick and asks "did I end up touching
something walkable?". Walking down a ramp, the horizontal part of the tick's
motion carries the capsule *past* the ramp surface, so unless the tick's motion
also contains enough downward travel, the capsule ends the tick in the air. Next
tick gravity pulls it back, it lands, `grounded` flickers, and the character
visibly stutters or "takes off" at crests. That is exactly the bug reported
against Godot: running uphill onto flat ground, or from flat ground onto a
descending slope, "characters still leave the ground instead of snapping to the
floor"
([godotengine/godot#71993](https://github.com/godotengine/godot/issues/71993)) **[primary]**.

**The arithmetic is unforgiving and it is worth doing for this project.** With
`WALK_SPEED = 6` and `TICK_DT = 1/30`, one tick's horizontal travel is 0.2 units.
`GROUND_STICK_SPEED = 2` supplies only 0.0667 units of downward travel per tick.
The steepest descent the current controller can follow without leaving the
ground is therefore

```
atan(GROUND_STICK_SPEED / WALK_SPEED) = atan(2 / 6) ≈ 18.4°
```

and during a Dash burst (`DASH_SPEED = 15`, and `beginCapsuleTick` *adds* the
burst to the walk velocity, so up to 21 u/s) it collapses to
`atan(2 / 21) ≈ 5.4°`. Any authored ramp steeper than ~18° will make a walking
Character skip; any ramp steeper than ~5° will make a dashing Character
skip. `GROUND_STICK_SPEED` is a numerical-stability hack (its own docstring says
so — "so the character controller always has a non-degenerate vertical to
solve"), not a ground-stick mechanism, and it does not scale with speed. A real
snap-to-ground is a *distance*, not a *speed*, precisely so it does not have this
failure.

### 1.2 What the engines actually do — and the three shared guards

**Rapier** (this project's engine). `snap_to_ground` is an `Option<CharacterLength>`;
the snap itself is a downward shape-cast of at most `snap_distance`, applied by
subtracting `up * hit.time_of_impact` and forcing `result.grounded = true`. It is
gated on `grounded_at_starting_pos` and on `result.translation.dot(self.up) <= 0.0`
([`character_controller.rs`](https://github.com/dimforge/rapier/blob/master/src/control/character_controller.rs)) **[primary]**.
The Rust `Default` is `Some(CharacterLength::Relative(0.2))`, `autostep: None`,
`max_slope_climb_angle: π/4`, `min_slope_slide_angle: π/4`, `offset:
Relative(0.01)`, `normal_nudge_factor: 1.0e-4`.

**The JS/WASM binding overrides that default.** `RawKinematicCharacterController::new`
in [rapier.js `src/control/character_controller.rs`](https://github.com/dimforge/rapier.js/blob/master/src/control/character_controller.rs)
constructs with `autostep: None, snap_to_ground: None, offset:
CharacterLength::Absolute(offset)`. So in this repo both are off *by
construction* — the comment at `CharacterController.ts:171` is accurate about the
state of the world even though nothing calls `disableSnapToGround()`.
Probing the installed `@dimforge/rapier3d-compat@0.20.0` directly confirms the
live values **[verified locally]**:

| | value |
|---|---|
| `offset()` | 0.01 (as constructed from `CHARACTER_CONTROLLER_OFFSET`) |
| `maxSlopeClimbAngle()` | 0.7853982 rad = **45°** |
| `minSlopeSlideAngle()` | 0.7853982 rad = **45°** |
| `snapToGroundDistance()` | *undefined* (disabled) |
| `autostepMaxHeight()` | *undefined* (disabled) |
| `normalNudgeFactor()` | 1e-4 |

If snap-to-ground were enabled with Rapier's own `Relative(0.2)` default, the
distance for this capsule works out at 0.2 × (AABB up-extent 1.7) = **0.34
units** — five times the per-tick ground-stick travel the controller has today.

**Godot.** `_snap_on_floor` returns early on `collision_state.floor ||
!p_was_on_floor || p_vel_dir_facing_up` — the same three guards — then casts
down by `MAX(floor_snap_length, margin)` and, notably, cancels any non-vertical
component of the recovered travel ("Ensure that we only move the body along the
up axis, because `move_and_collide` may stray the object a bit when getting it
unstuck")
([`character_body_3d.cpp`](https://github.com/godotengine/godot/blob/master/scene/3d/physics/character_body_3d.cpp)) **[primary]**.
`floor_snap_length` defaults to **0.1** (Godot 3D units). Godot also runs a
*speculative* variant, `_on_floor_if_snapped`, used by the constant-speed path —
"When you move forward in a downward slope you don't collide because you will be
in the air. This test ensures that constant speed is applied, only if the player
is still on the ground after the snap is applied."

**Source.** `StayOnGround()` traces up 2 units first ("See how far up we can go
without getting stuck"), then traces down by `player->GetStepSize()` from that
known-safe start, and applies the result only if `trace.fraction > 0.0f &&
trace.fraction < 1.0f && !trace.startsolid && trace.plane.normal[2] >= 0.7`
("can't hit a steep slope that we can't stand on anyway"). It is called from
`FullWalkMove` after the ground move, never from the air path
([`gamemovement.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp)) **[primary]**.
The up-trace-first pattern is the part most re-implementations miss and is worth
copying verbatim.

**Quake/Source `CategorizePosition` tradition.** Ground state is *recomputed
every tick* from a short downward trace (Source: `flOffset = 2.0f`), not carried
as a sticky boolean, with an explicit escape hatch: `#define NON_JUMP_VELOCITY
140.0f` — moving up faster than that means you are definitively not on the
ground, which is how a jump or a launch escapes the ground-stick without a
special case. Quake 3's equivalent is `PM_GroundTrace` with `MIN_WALK_NORMAL`.

### 1.3 The two specific failure modes, and how other engines fix them rather than disabling

**Failure mode A — stalling / "slowly lowering" near ledge edges.** Three
documented fixes, all from primary sources:

1. **Flat-base floor checks.** Unreal's `bUseFlatBaseForFloorChecks`: "Performs
   floor checks as if the character is using a shape with a flat base. This
   avoids the situation where characters slowly lower off the side of a ledge."
   **[primary]** The root cause is the capsule's *rounded bottom*: as the capsule
   overhangs an edge, the hemispherical cap keeps finding a contact whose normal
   tips further and further off vertical, so the controller reads a steepening
   slope and either creeps down or refuses to move. A flat base removes the
   whole failure class.
2. **Perch tolerance.** Unreal's `PerchRadiusThreshold` ("Don't allow the
   character to perch on the edge of a surface if the contact is this close to
   the edge of the capsule") and `PerchAdditionalHeight`, plus `LedgeCheckThreshold`
   and `bCanWalkOffLedges` — an explicit, tunable policy for *what counts as
   still standing on something* rather than an emergent consequence of cast
   geometry. **[primary]**
3. **Sub-box retesting.** Source's `CategorizePosition`, when the full-hull
   downtrace returns `plane.normal[2] < 0.7`, calls
   `TryTouchGroundInQuadrants(...)` — "Test four sub-boxes, to see if any of them
   would have found shallower slope we could actually stand on" — and only gives
   up grounding if all four also fail. **[primary]**

Rapier has none of these three. That is a genuine gap, and it is the honest
reason the feature was disabled here rather than a reason snap-to-ground is a bad
idea. Rapier's own changelog shows the same class of bug being fixed repeatedly
("Fix character controller's snapping to ground not triggering sometimes",
v0.17.2; "Fix kinematic character controller getting stuck against vertical
walls", v0.19.0) and a recent behavioural change worth knowing about before any
upgrade: "The character controller's snap-to-ground now triggers on any movement
that isn't upwards, including movements exactly orthogonal to the up vector,
instead of requiring a downward motion larger than an arbitrary epsilon. Purely
lateral movement along the ground no longer flickers the `grounded` flag when
snap-to-ground is enabled" (v0.35.x, PR #481)
([Rapier CHANGELOG](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md)) **[primary]**.
That entry is a direct admission that pre-0.35 snap-to-ground *did* flicker
`grounded` during ordinary lateral movement — i.e. one of this project's stated
symptoms is a known engine bug with a known fix version, not an inherent property
of the technique.

**Failure mode B — hitching during high-speed movement (Dash), and launching off
crests.** The documented fixes split by cause:

- *Autostep cost.* Rapier's own docs call autostep "computationally expensive"
  and it has been **disabled by default since rapier v0.18.0**
  ("The kinematic character controller autostepping is now disabled by default")
  **[primary]** — so this project's choice matches the engine's own default, and
  is not unusual. Source keeps stepping cheap by structuring the move so the
  expensive path is conditional: `WalkMove` first traces the flat move, and only
  if that succeeds does it retry from `m_flStepSize + 1` above ("assume it is a
  stair or a slope, so press down from stepheight above"); if the flat move was
  blocked it falls through to `StepMove`. Stepping is never a *third*
  unconditional cast per tick.
- *The visual hitch.* Source does not smooth the step in the collision solve at
  all — it accumulates `mv->m_outStepHeight` and smooths the **view**, leaving
  the collision position instantaneous. **[primary]** This is the important
  architectural point for this project: a step/snap discontinuity is a
  *rendering* problem, and DON'T FALL already owns exactly the right mechanism
  for it — the decaying render-time error offset of ADR 0026
  (`CAPSULE_ERR_HALFLIFE_MS = 100`). A snap-to-ground correction can be fed
  through the same offset so the simulation snaps and the camera does not.
- *Launching off crests at speed.* Unity's Character Controller package
  documents predictive raycasting specifically for this:
  `PreventGroundingWhenMovingTowardsNoGrounding`,
  `HasMaxDownwardSlopeChangeAngle` and `MaxDownwardSlopeChangeAngle` ("The
  maximum angle in degrees where your character can stick to the ground when
  moving over a downward slope change"), evaluated by
  `Update_PreventGroundingFromFutureSlopeChange` using a forward raycast of
  length `deltaTimeIntoFuture × |velocity|` plus two downward probes and a
  backward probe
  ([Unity Character Controller — Slope management](https://docs.unity3d.com/Packages/com.unity.charactercontroller@1.0/manual/slope-management.html)) **[primary]**.
  Note the sign of the design: it is a mechanism for **deliberately refusing to
  stick** — "so that your character can launch off the slope instead of sticking
  to it and making the movement feel unnatural." Ground-stick is not
  unconditionally desirable; a party game arguably wants *more* launching, not
  less.

### 1.4 Where sources disagree

Godot's docs say snapping happens "when the body moves against `up_direction`",
but the bug report above argues the implementation only snaps "if the character
collides with the next floor", which "does not cover the important case where the
character is reaching new ground with a slope relatively more descending than the
previous ground and must avoid take off"
([godotengine/godot#71993](https://github.com/godotengine/godot/issues/71993)).
Godot's answer to that case is not a bigger snap length but the separate
`_on_floor_if_snapped` speculative test in the constant-speed path. Unity's DOTS
controller answers the same case with a *predictive raycast*. Rapier answers it
with nothing. **A downward-cast-after-the-fact snap and a look-ahead probe are
different mechanisms and solve different halves of the problem**; sources that
only implement the first still report the "take off at a crest" bug.

---

## 2. Max walkable slope angle

### 2.1 Conventional values (all **[primary]**)

| Engine / game | Parameter | Value |
|---|---|---|
| Quake 3 | `MIN_WALK_NORMAL` (`bg_local.h`) | `0.7f` → **45.573°** |
| Source | hard-coded `plane.normal[2] >= 0.7` | **45.573°** |
| Godot `CharacterBody3D` | `floor_max_angle` | `0.7853982` rad — docs: "The default value equals 45 degrees" |
| Rapier | `max_slope_climb_angle` | `π/4` = **45°** (confirmed live in 0.20.0) |
| Unreal `CharacterMovementComponent` | `WalkableFloorAngle` | **44.765°** (`WalkableFloorZ` is derived from it, never set directly) |
| Unity `CharacterController` | `Slope Limit` | ships at 45° in the Inspector; the manual page does **not** tabulate defaults — treat the number as **[folklore]**, the parameter as **[primary]** |
| PhysX CCT | `PxControllerDesc::slopeLimit` | expressed as the **cosine** of the limit angle |

The clustering around 45° is real and worth respecting: it is the angle at which
"floor" and "wall" stop being visually distinguishable, and level geometry in
practice is authored to it. Source's `0.7` is *not* a rounded 45° — it is 0.7
exactly, which is 45.573°, and it appears as a bare literal in fifteen separate
places in `gamemovement.cpp` rather than as a named constant. Quake 3 at least
names it, and adds a companion constant that matters for slopes:
`#define OVERCLIP 1.001f`, the slight over-projection `PM_ClipVelocity` applies
so a clipped velocity ends up marginally *off* the plane rather than exactly on
it, which is what stops the next tick's cast from starting in a
grazing/penetrating state.

The interesting dissent is Unity's own manual: "Slope Limit should not be too
small. Often using a value of 90 degrees works best. The Character Controller
will not be able to climb up walls due to the capsule shape."
([Unity Manual — Character Controller](https://docs.unity3d.com/Manual/class-CharacterController.html)) **[primary]**
That is advice to *delegate* the limit to geometry rather than to a parameter,
and it is coherent for a capsule: a capsule already cannot climb a vertical
surface, so the slope limit is only doing work in the 45°–90° band, where its
main observable effect is to make the character stick at an invisible boundary.

### 2.2 What happens above the limit

Two camps, explicitly:

- **Refuse to climb, do nothing else.** PhysX
  `PxControllerNonWalkableMode::ePREVENT_CLIMBING` "prevents the character from
  moving up a slope, but does not move the character otherwise" — this is the
  default, and it is what Unity's `CharacterController` inherits, which is why
  "my Unity character doesn't slide down steep slopes" is a perennial question
  with the answer "implement it yourself" **[folklore for the Unity framing,
  [primary] for the PhysX mode]**
  ([PhysX — Character Controllers](https://nvidia-omniverse.github.io/PhysX/physx/5.3.0/docs/CharacterControllers.html)).
  PhysX also offers a third, blunter tool: it can synthesise "invisible walls"
  on non-walkable triangles — "the library creates those extra triangles on the
  fly."
- **Force sliding.** PhysX `ePREVENT_CLIMBING_AND_FORCE_SLIDING` "not only
  prevents the character from moving up non walk-able slopes but also forces it
  to slide down those slopes." Quake/Source get the same result for free,
  because gravity is always in the velocity vector and `PM_ClipVelocity` /
  `ClipVelocity` project it along the plane every tick — there is no separate
  "slide" code path at all.

**Rapier is unusual in exposing the boundary as two independent angles**, and
this project's configuration accidentally closes the gap between them.
`compute_hit_info` computes:

```rust
let is_wall = angle_with_floor >= self.max_slope_climb_angle && !is_ceiling;
let is_nonslip_slope = angle_with_floor <= self.min_slope_slide_angle;
```

With both defaulting to π/4 (verified live, §1.2), *every* surface is either a
wall (≥45°) or a non-slip slope (≤45°) and there is no band in which the
character slides. `handle_slopes` then removes the downhill tangent for a
non-slip slope ("Prevent the vertical movement from sliding down") — so today,
DON'T FALL's Character walks any ramp up to 45° with no slide at all, and treats
anything steeper as a wall it cannot climb. That is a *choice the defaults made*,
not one this project made. Lowering `min_slope_slide_angle` (say to 30°) opens a
30°–45° band where the Character slides down — and `EffectiveCharacterMovement::is_sliding_down_slope`
exists precisely to report it, added in rapier v0.18.0 "to indicate if the
character controlled by the kinematic character controller is sliding on a slope
that is too steep."

---

## 3. Slope-influenced speed

### 3.1 Do shipped games do it?

Yes, but far less universally than intuition suggests, and the two biggest
lineages sit on opposite sides.

**Quake 3 explicitly cancels it.** `PM_WalkMove` clips velocity to the ground
plane, then immediately undoes the magnitude loss:

```c
vel = VectorLength(pm->ps->velocity);
// slide along the ground plane
PM_ClipVelocity (pm->ps->velocity, pml.groundTrace.plane.normal,
    pm->ps->velocity, OVERCLIP );
// don't decrease velocity when going up or down a slope
VectorNormalize(pm->ps->velocity);
VectorScale(pm->ps->velocity, vel, pm->ps->velocity);
```

**[primary]** — that is a deliberate, commented decision that a Quake player's
speed is slope-independent. (Its friction step makes the same choice from the
other end: `if (pml.walking) { vec[2] = 0; } // ignore slope movement` — drag is
computed on horizontal speed only.)

**Godot does it by default.** `floor_constant_speed` is `false` out of the box:
"If `false` (by default), the body will move faster on downward slopes and slower
on upward slopes." Setting it `true` reproduces Quake's behaviour by re-scaling
the remaining motion (`motion = motion.normalized() * MAX(0, (motion_slide_up.length()
- travel_slide_up.length()))`). Even then it is imperfect — Godot has an open
issue titled "`CharacterBody3D` with `floor_constant_speed` still slightly slower
when going uphill"
([godotengine/godot#99244](https://github.com/godotengine/godot/issues/99244)) **[primary]**.

**Unreal ships the flag and names the tradeoff**: `bMaintainHorizontalGroundVelocity`
— "If true, walking movement always maintains horizontal velocity when moving up
ramps, which causes movement up ramps to be faster parallel to the ramp surface.
If false, then walking movement maintains velocity magnitude parallel to the ramp
surface." **[primary]** (The docs page does not state the default; UE's
constructor sets it `true` — treat the *default* as **[folklore]**, the semantics
as **[primary]**.) Note that "maintain horizontal velocity" is not free either:
it makes you *faster along the surface* uphill, which is why speedrunners find
ramp geometry exploitable in UE games.

### 3.2 How it is implemented for a kinematic character — three mechanisms

**(i) Plane projection, i.e. do nothing special.** Project the desired
translation onto the contact plane and keep whatever magnitude survives. This is
Rapier's `decompose_hit` / `unconstrained_slide_part`, Godot's default, and the
sliding-plane response of Fauerby's
["Improved Collision detection and Response" (2003)](https://www.peroxide.dk/papers/collision/collision.pdf) **[primary,
academic-adjacent]**, the canonical write-up of the swept-ellipsoid slide that
most hand-rolled controllers descend from. Cost: a horizontal input of speed `v`
against a slope of angle `θ` yields `v·cos θ` along the surface and `v·cos²θ`
horizontally — at 30° that is a 25% horizontal slowdown uphill, which is a lot
more than most designers intend.

**(ii) An explicit multiplier keyed off the signed slope angle.** This is what
Unity's official Character Controller package documentation recommends: "To make
your character move slower uphill, use the
`CharacterControlUtilities.GetSlopeAngleTowardsDirection` method. This calculates
the signed slope angle in a given movement direction. The resulting angle is
positive if the slope goes up, and negative if the slope goes down… you can apply
a multiplier to your desired character velocity based on that signed slope
angle." **[primary]** This is the recommendation for DON'T FALL: it is a pure
function of `(moveDirection, floorNormal)`, it is trivially tunable and
trivially clampable, and it composes with a Dash instead of fighting it.

**(iii) An additive along-slope acceleration.** The Sonic games add
`slp × sin(angle)` to ground speed every frame, where `slp` is a small constant
(0.125 in the classic games), so the character genuinely accelerates downhill and
decelerates uphill, and can stall and roll back if too slow
([Sonic Retro — Sonic Physics Guide](https://info.sonicretro.org/Sonic_Physics_Guide)) **[community RE]**
— this is a community reverse-engineering of the original 68000 code, not vendor
documentation, and the page is currently behind an anti-scraping challenge so the
constant above should be re-verified by hand before it is used as a number rather
than as an idea. The idea is what matters: this is a *momentum* model, appropriate
when downhill speed is meant to build over time.

**What is not standard:** projecting gravity onto the slope plane and integrating
it as the source of downhill speed. That is the rigid-body formulation; kinematic
controllers grounded on a walkable slope generally *remove* the vertical
component instead — Godot literally does `velocity = velocity.slide(up_direction)`
at the end of `move_and_slide` when on the floor and not moving up ("Reset the
gravity accumulation when touching the ground"), and Quake 3's `PM_WalkMove`
leaves `velocity[2]` alone only in the `SURF_SLICK` case. Gravity-along-plane
reappears only when the character is *sliding* (above the walkable limit), where
it is the right model.

---

## 4. Surface friction / grip on a kinematic controller

### 4.1 Why engine friction genuinely doesn't apply

This is not a Rapier limitation but the definition of the approach. PhysX puts it
plainly: "A kinematic controller directly works with input displacement vectors
(1st order control)" — as opposed to velocities (2nd order) or forces (3rd
order) — and "users are responsible for applying gravity to characters here."
Its rationale for preferring kinematic is the same one ADR 0006 gives: "a lot of
effort can be spent on tweaking and disabling the physics engine's features
simply to emulate what is otherwise a much less complex piece of custom code."
**[primary]** Unity says the same from the other end: "The Controller does not
react to forces on its own and it does not automatically push Rigidbodies away"
and "The Character Controller can not be affected by objects through physics."
**[primary]** In Rapier's case `computeColliderMovement` is a shape-cast plus a
tangent decomposition; there is no contact constraint, so `Collider::friction`
on the floor is never consulted for the capsule.

### 4.2 The standard parameter set

The two reference implementations are remarkably close, and both reduce the
whole thing to **one scalar per surface**:

**Source** — `CategorizeGroundSurface` reads the material's physics friction,
then:

```cpp
// HACKHACK: Scale this to fudge the relationship between vphysics friction values
// and player friction values. A value of 0.8f feels pretty normal for vphysics,
// whereas 1.0f is normal for players.
player->m_surfaceFriction *= 1.25f;
if ( player->m_surfaceFriction > 1.0f )
    player->m_surfaceFriction = 1.0f;
```

and that one scalar then multiplies **both** sides of the movement equation:

```cpp
friction   = sv_friction.GetFloat() * player->m_surfaceFriction;      // Friction()
accelspeed = accel * wishspeed * frametime * player->m_surfaceFriction; // Accelerate()
```

Defaults (`movevars_shared.cpp`): `sv_friction 4`, `sv_accelerate 10` (7 only on
the `_XBOX` build), `sv_stopspeed 100`, `sv_maxspeed 320`, `sv_bounce 0`.
**[primary]** Two details worth
stealing: the friction "control" term is `max(speed, sv_stopspeed)`, which gives
a *constant* stopping force at low speed instead of an exponential tail that
never quite reaches zero; and `CategorizePosition` resets `m_surfaceFriction =
1.0f` at the top of every recategorisation, so friction can never be left stale
by a state transition.

**Quake 3** — the same idea, expressed as a binary surface flag:

```c
if ( pml.walking && !(pml.groundTrace.surfaceFlags & SURF_SLICK) ) { ...apply friction... }
...
if ( ( pml.groundTrace.surfaceFlags & SURF_SLICK ) || pm->ps->pm_flags & PMF_TIME_KNOCKBACK ) {
    accelerate = pm_airaccelerate;   // 1.0f
} else {
    accelerate = pm_accelerate;      // 10.0f
}
```

with `pm_friction = 6.0f`, `pm_stopspeed = 100.0f`. **[primary]** Ice in Quake 3
is therefore *exactly two changes*: no ground drag, and a 10× reduction in
acceleration authority. Note also that `SURF_SLICK` makes Quake keep applying
gravity to `velocity[2]` while walking, which is what lets you slide down icy
slopes.

The third element — turn rate — is implicit in both: because acceleration is
applied along `wishdir` and capped by `addspeed = wishspeed - currentspeed`,
lowering acceleration lowers turn authority automatically. Unreal makes the same
coupling explicit and documents it in exactly those terms: `GroundFriction` is
"Setting that affects movement control. Higher values allow faster changes in
direction." **[primary]** It then splits braking out separately —
`BrakingDecelerationWalking` ("a constant opposing force that directly lowers
velocity by a constant value", i.e. Source's `sv_stopspeed` idea), `BrakingFriction`,
and the delightfully honest `BrakingFrictionFactor` ("This is 2 by default for
historical reasons, a value of 1 gives the true drag equation").

### 4.3 Which parameter carries the feel

**Ice = low acceleration + low deceleration, same max speed.** You reach the same
top speed, you just take a long time to get there and a long time to stop, and
your input barely steers you. Neither Quake nor Source touches max speed for
slick surfaces. This is the single most important finding in this section: the
common first attempt — "ice makes you go faster" — is not what either reference
implementation does.

**Mud/slime = low max speed, acceleration unchanged (or raised).** You feel
*bogged*, not *skiddy*: input is responsive, the ceiling is low. Quake 3 models
wading exactly this way — `wishspeed` is clamped by a `waterScale` factor while
friction is *added* rather than removed.

**Sticky/tar = high deceleration with low max speed.** The distinguishing
sensation vs mud is that releasing input stops you instantly.

A minimal parameter set that covers all three, and maps onto both reference
implementations, is therefore:

| parameter | ice | normal | mud |
|---|---|---|---|
| `accelScale` (input authority / turn rate) | ~0.1 | 1.0 | 1.0 |
| `dragScale` (ground drag / braking) | ~0.1 | 1.0 | 1.5–2.0 |
| `maxSpeedScale` | 1.0 | 1.0 | ~0.5 |

---

## 5. Boost pads and slow pads

### 5.1 Both models are shipped, and Source ships both in one entity

`CTriggerPush::Touch` is the single clearest primary source on this question
**[primary]**:

```cpp
// Instant trigger, just transfer velocity and remove
if (HasSpawnFlags(SF_TRIG_PUSH_ONCE))
{
    pOther->ApplyAbsVelocityImpulse( m_flPushSpeed * vecAbsDir );
    if ( vecAbsDir.z > 0 ) pOther->SetGroundEntity( NULL );
    UTIL_Remove( this );
    return;
}
...
// (default, continuous)
pOther->SetBaseVelocity( vecPush );
pOther->AddFlag( FL_BASEVELOCITY );
```

with the HL1 branch carrying the design note: "apply x, y as a base velocity so
we travel at constant speed on conveyors." The continuous variant is not a
velocity *change* — base velocity is added to `m_vecVelocity` immediately before
the move and subtracted immediately after (`VectorAdd(...GetBaseVelocity()...)`
… `VectorSubtract(...)` bracketing every branch of `WalkMove`/`AirMove`), so the
player's *own* velocity is untouched and the effect vanishes the instant they
leave the surface. That is the correct shape for a conveyor or a slime patch.

**Mario Kart Wii is the one-shot camp, and it is a timed envelope rather than a
single impulse** — the boost pad grants a *timer*, and while it runs, max speed
is raised (roughly 20–40% depending on boost type), an acceleration term is added
each frame (3–7 u/f²), and off-road penalties are suppressed; when the timer
expires "maximum speed returns to the base value decreasing at a rate of 3
u/f²" ([MKW TAS Wiki — Boost information](https://wiki.mkwtas.com/wiki/Boost_information)) **[community RE]**.
Structurally this is the same shape as DON'T FALL's existing `DashController`
envelope — which is a strong argument for reusing it rather than inventing a
second mechanism.

Quake 3's jump pad is the pure one-shot: `VectorCopy( jumppad->origin2,
ps->velocity )` — a velocity **assignment**, not an addition. **[primary]**

**No primary source was found** for how Trackmania's boosters or Fall Guys'
slime/conveyors are implemented; both are commonly described in community write-ups
as continuous-while-touching, but that is **[folklore]** and should not be cited
as evidence.

### 5.2 The tradeoff, specifically for a predicted networked game

The continuous variant is **a pure function of position**. On a client replaying
`N` unacknowledged inputs after a Reconciliation (ADR 0013), each replayed tick
re-evaluates "which surface am I standing on" from the restored position and gets
the right answer with no extra replicated state. It cannot double-apply, cannot
be missed, and needs nothing added to `CharacterSnapshot`. It is also
self-correcting: if the server disagrees about where you were, it disagrees about
whether you were boosted, and the position correction fixes both at once.

The one-shot variant introduces a discrete event, and discrete events are exactly
what ADR 0013 says must *snap* rather than smooth. It brings three concrete
hazards:

1. **Double-application on replay.** If the trigger fires on a *transition*
   ("I wasn't touching last tick, I am now"), a replay that re-crosses the
   boundary fires it again.
2. **Loss on replay.** If the trigger fires from a server-side event the replay
   cannot reproduce, the boost is silently erased by the next Reconciliation.
3. **New replicated state.** A boost *timer* is not derivable from position; it
   must join the snapshot and the replay base.

Quake 3 solves all three at once and is the pattern to copy **[primary]**:

- the effect is a **velocity assignment**, so applying it twice is a no-op;
- it lives in `bg_misc.c` — shared code both the client's prediction and the
  server run;
- the pad's identity is latched **into the replicated player state**
  (`ps->jumppad_ent = jumppad->number; ps->jumppad_frame = ps->pmove_framecount;`)
  and the cosmetic half is guarded by "if we didn't hit this same jumppad the
  previous frame… then don't play the event sound again if we are in a fat
  trigger";
- the effect itself is announced with
  `BG_AddPredictableEventToPlayerstate( EV_JUMP_PAD, effectNum, ps )` — the
  engine has an explicit *category* for "one-shot events the client is allowed to
  predict."

Unreal reaches the same conclusion from the framework side: for a custom movement
effect to survive prediction, the data must be in `FSavedMove_Character`, which
records "What velocity and acceleration the character held" and root-motion
sources, replayed by `ClientUpdatePositionAfterServerUpdate`
([Understanding Networked Movement in the CMC](https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine?lang=en-US)) **[primary]**.
Anything the saved move doesn't carry is lost on correction.

---

## 6. Bounce / jelly surfaces

**Continuous restitution is not available to a kinematic character in any engine
surveyed, so the question resolves itself.** Restitution is applied by the
contact solver to bodies whose velocity the solver owns; a kinematic capsule's
velocity is scripted, so the coefficient is never consulted. Rapier's own
character-controller docs never mention restitution or friction; Unity states the
controller "can not be affected by objects through physics"; PhysX classifies the
CCT as 1st-order displacement control. **[primary, all three]**

Every shipped implementation is therefore a **scripted one-shot** on contact.
Quake 3's bounce pad and jump pad are literally the same function
(`BG_TouchJumpPad`), and the same `VectorCopy(..., ps->velocity)` assignment.
Source's `trigger_push` with `SF_TRIG_PUSH_ONCE` plus `SetGroundEntity(NULL)`
when the push has upward `z` is the same shape — note that clearing the ground
entity is *mandatory*, otherwise the very next `CategorizePosition` /
ground-stick re-grounds the character and eats the launch.

Two design notes fall out of this:

- **Assignment beats addition** for a bounce, for the same idempotence reason as
  §5.2, and because it makes the bounce height a property of the *pad* rather
  than of how fast the player happened to arrive. If you want arrival speed to
  matter, the honest version is `newVel.y = max(minLaunch, |incoming.y| *
  restitution)` — still a deterministic function of restored state, still
  idempotent given the same base.
- **The ground-stick and the bounce must be told about each other.** Source
  clears the ground entity; Quake uses `NON_JUMP_VELOCITY 140.0f` as a
  velocity-based override in `CategorizePosition`; Godot's `_snap_on_floor`
  bails on `p_vel_dir_facing_up`. Whatever snap-to-ground DON'T FALL adopts must
  have the same escape hatch or bounce pads simply will not fire.

---

## 7. Determinism and netcode caveats

Most of this is already settled in this repo by ADRs 0005 / 0013 / 0026 / 0027,
so this section is only the surface-specific deltas.

**7.1 The shared step must own the surface lookup.** Whatever answers "which
surface is under the Character this tick" has to live in `packages/shared` and be
computed from the sim state, exactly like `dashEnvelope` is. A surface effect
resolved on the server and pushed to the client as a field is a *correction*, not
a prediction, and will feel like one. This is the whole content of Quake's
decision to put `BG_TouchJumpPad` in `bg_` code and Source's decision to make
`m_vecBaseVelocity` both a `RecvPropVector` on `CBasePlayer` *and* a
`DEFINE_FIELD` in `C_BaseEntity`'s prediction data block — networked *and*
saved/restored across prediction. **[primary]**

**7.2 Rapier's determinism guarantee is per-machine, which is enough — and it
constrains ordering.** Rapier guarantees that "running the exact same simulation
(with the same initial conditions) twice with the same machine, using the same
version of Rapier, and the same version of the Rust compiler, will result in the
exact same simulation results", where same initial conditions means bodies and
colliders are "added/removed to sets in the exact same order"
([Rapier — Determinism](https://rapier.rs/docs/user_guides/rust/determinism/)) **[primary]**.
ADR 0013 already relies on exactly this. The surface-specific consequence: if a
surface query is implemented as a Rapier scene query (a downward ray/shape-cast
looking for a "surface" collider), its result depends on collider insertion
order, so Track resolution must build colliders in a deterministic order — which
`resolveTrack` already does, but it becomes load-bearing rather than incidental.
The cheaper and more robust option is to skip the scene query entirely: the
Character's ground contact already comes back from
`rapierController.computedCollision(i)` with a `collider.handle`, and
`RapierSimulation` already maintains handle→entity maps (that is exactly what
`CollisionListener` is for). **Look the surface up from the handle of the floor
you are already standing on** — zero extra casts, zero ordering sensitivity.

**7.3 Continuous effects are free under replay; timers are not.** A multiplier
keyed off "which collider am I grounded on" is recomputed by every replayed tick
from the restored base, so it needs no snapshot field. A boost *timer* (§5.1) is
new continuous state and must be added to `CharacterState`/`CharacterSnapshot`
and restored by `reconcileTo`, alongside `dashCooldownMs`. Note that the existing
`dashCooldownMs` is precedent for how to do this correctly.

**7.4 Discrete surface transitions want an Epoch, not a boolean.** CONTEXT.md
already defines Epoch for exactly this shape ("a monotonic counter identifying a
discrete episode… so a one-shot effect fires exactly once even if the Snapshot
carrying it is seen across many frames. Never a one-Tick boolean"). A bounce-pad
launch is the same class of event as `ragdollEpoch`; if bounce pads ship, they
should carry a `launchEpoch` rather than a `bounced: true`. Quake's
`ps->jumppad_ent` + `ps->jumppad_frame` pair is the same idea, discovered
independently.

**7.5 Beware surface effects that change `grounded`.** `grounded` feeds the Jump
controller's coyote time, the Dash's ground gate, and the ground-stick. A bounce
pad that launches you without clearing `grounded` will be immediately re-grounded
by the snap; a conveyor whose base velocity is included in the `computeColliderMovement`
sweep will report collisions the Character did not cause. Source's answer to the
second problem is worth copying: base velocity is added *only* around the move
and subtracted immediately after, so nothing downstream ever sees it.

**7.6 Nothing here needs cross-machine determinism.** All of the above is
arithmetic on floats in shared TypeScript, run once per tick on each side; ADR
0003's rejection of lockstep is untouched. The one thing to avoid is deriving a
surface effect from *ragdoll* physics state, which ADR 0023 already establishes is
server-owned.

---

## 8. What this means for DON'T FALL

### 8.1 The situation today

- Ramps are already authorable (ADR 0034 + rotated cuboid statics), and nothing
  in `CharacterController` accounts for them.
- Rapier's live configuration (verified, §1.2) is: walk anything up to **45°**,
  treat anything steeper as a **wall**, **never slide**, **no snap-to-ground**,
  **no autostep**.
- Ground contact is maintained only by `GROUND_STICK_SPEED = 2`, which is a
  numerical hack that fails on any descent steeper than **~18.4° walking / ~5.4°
  dashing** (§1.1).
- `Module` has no surface concept; `Box` has no material.
- The Dash already *adds* to walk velocity, so any speed multiplier must decide
  explicitly whether it multiplies the dash burst too.

### 8.2 Recommended parameter set

New constants in `packages/shared/src/tuning.ts` (this project's rule), named to
match CONTEXT.md's vocabulary:

```ts
// --- Slopes -----------------------------------------------------------------
/** Steepest floor the Character can walk on. Rapier's own default; Source's 0.7
 *  normal is 45.573°, Unreal's WalkableFloorAngle is 44.765°. */
export const MAX_WALKABLE_SLOPE_RAD = Math.PI / 4;          // 45°

/** Above this the Character slides downhill instead of standing. Opens a real
 *  30–45° "too steep to stand, not steep enough to be a wall" band, which is
 *  where the comedy is. Rapier: setMinSlopeSlideAngle. */
export const MIN_SLOPE_SLIDE_RAD = (30 * Math.PI) / 180;    // 30°

/** Downward distance the controller may snap to stay in contact after a tick's
 *  motion. Absolute, not a speed — this is the fix for the 18.4° ceiling.
 *  Sized to cover one dash-tick down a 45° ramp: 21/30 * tan(45°) ≈ 0.70. */
export const GROUND_SNAP_DISTANCE = 0.7;

/** Speed (units/s) gained per unit of downhill grade, and lost per unit of
 *  uphill grade: speedScale = 1 - SLOPE_SPEED_FACTOR * sin(signedSlopeAngle).
 *  Unity's documented "multiplier keyed off the signed slope angle" shape.
 *  0.45 makes a 30° descent ≈ +22% and a 30° climb ≈ -22%. */
export const SLOPE_SPEED_FACTOR = 0.45;
export const SLOPE_SPEED_MIN = 0.6;
export const SLOPE_SPEED_MAX = 1.5;

// --- Surfaces ---------------------------------------------------------------
/** Per-surface scalars. Source folds drag and acceleration into one
 *  m_surfaceFriction; Quake 3 splits them (SURF_SLICK skips friction AND drops
 *  pm_accelerate 10 → pm_airaccelerate 1). Split, following Quake. */
export const SURFACE_ICE   = { accelScale: 0.1, dragScale: 0.1, maxSpeedScale: 1.0 };
export const SURFACE_MUD   = { accelScale: 1.0, dragScale: 1.6, maxSpeedScale: 0.45 };
export const SURFACE_NORMAL= { accelScale: 1.0, dragScale: 1.0, maxSpeedScale: 1.0 };

/** Continuous surface velocity added around the move and subtracted after
 *  (Source base velocity). Conveyors and slow-slime, in units/s. */
export const CONVEYOR_SPEED = 3;

/** Boost pad: a timed envelope, not an impulse (Mario Kart's model, and the
 *  same shape as DashController). */
export const BOOST_PAD_SPEED = 12;
export const BOOST_PAD_DURATION_MS = 800;

/** Bounce pad: an assignment, never an addition (Quake 3 BG_TouchJumpPad). */
export const BOUNCE_PAD_VELOCITY = 14;
```

Note that today's `WALK_SPEED = 6` is applied *directly* as the tick's velocity
(`velocity.x = walk.x + dashBurst.x`) — there is no acceleration model at all, so
`accelScale`/`dragScale` have nothing to multiply yet. **Ice is not implementable
until an acceleration model exists.** That drives the ordering below.

### 8.3 Recommended implementation order

**Step 1 — make ramps not broken, before adding any surface types.**
Replace the `GROUND_STICK_SPEED` hack's *role* (not necessarily the constant) with
a real snap: `rapierController.enableSnapToGround(GROUND_SNAP_DISTANCE)`, and set
`setMinSlopeSlideAngle(MIN_SLOPE_SLIDE_RAD)` so the 30–45° band actually slides.
Verify against the two failure modes that caused it to be disabled the first
time. Mitigations, in the order to try them:

- Confirm the Rapier version in use predates the v0.35 fix ("Purely lateral
  movement along the ground no longer flickers the `grounded` flag when
  snap-to-ground is enabled"). If it does, upgrading may resolve the lateral
  flicker outright, and that is a cheaper fix than any workaround.
- Feed the snap correction through the ADR 0026 render-time error offset
  (`CAPSULE_ERR_HALFLIFE_MS`) so the simulation snaps and the camera does not —
  this is precisely Source's `m_outStepHeight`-smooths-the-view design.
- Add Source's `StayOnGround` guard set if Rapier's is insufficient: only accept
  a snap onto a plane with `normal.y >= cos(MAX_WALKABLE_SLOPE_RAD)`, only when
  grounded at the start of the tick, only when the tick's motion is not upward.
- Only if ledge-edge stalling reappears: Unreal's `bUseFlatBaseForFloorChecks`
  fix has no Rapier equivalent, so the substitute is a small ledge tolerance —
  keep `grounded` true for a few ticks after contact is lost (the same shape as
  the existing `COYOTE_TICKS = 3`), rather than fighting the cast geometry.

Do **not** re-enable autostep. Rapier disabled it by default for the stated
performance reason, this project's Modules connect at Socket level so there are
no incidental stairs, and Source's own design keeps stepping off the hot path.

**Step 2 — slope-influenced speed, as an explicit multiplier.**
Take `computedCollision(i).normal1` for the floor contact (already read in
`resolveCollisions`), compute the signed slope angle toward `input.moveDirection`,
and scale the walk velocity by `clamp(1 - SLOPE_SPEED_FACTOR * sin(θ),
SLOPE_SPEED_MIN, SLOPE_SPEED_MAX)`. Deliberately choose whether the Dash burst is
also scaled — recommendation: **scale the walk, leave the Dash flat**, so a Dash
stays a reliable, readable commitment and does not become a downhill exploit.
This is a pure function of `(floorNormal, moveDirection)` and therefore costs
nothing in the netcode (§7.3).

**Step 3 — add a surface type to the Module/Track data model.**
A `surface?: SurfaceKind` field on `Box` (defaulting to `"normal"`, so every
existing Revision resolves identically — the same additive-and-optional pattern
ADR 0034 used for `pitch`/`roll`), carried through `resolveTrack` into
`RapierSimulation`'s handle→entity map. Look the surface up from the *floor
collider handle the controller already reports*, never from a fresh scene query
(§7.2). No new Rapier queries, no ordering sensitivity, no snapshot fields.

**Step 4 — conveyor / slow-slime, continuous.**
Copy Source's base-velocity bracketing exactly: add the surface velocity to
`this.velocity` immediately before `computeColliderMovement`, subtract it
immediately after, so the Character's own velocity — the thing that feeds Bump
closing speed, the Dash wall check and the snapshot — never contains it. Pure
function of position; nothing to replicate.

**Step 5 — introduce an acceleration model, then ice and mud.**
`velocity.xz` currently teleports to `WALK_SPEED * moveDirection` every tick.
Replace with Source's shape — `Friction()` then `Accelerate()` with
`addspeed = wishspeed - currentspeed` and the `max(speed, stopspeed)` control
term — because it is the formulation both reference implementations use and it is
the only one in which `accelScale`/`dragScale` mean anything. Expect this to
change baseline feel; it should be its own ticket with its own feel-tuning pass,
not a rider on the ice ticket. Only once it lands do `SURFACE_ICE` /
`SURFACE_MUD` become one-line multipliers, exactly as in Quake 3.

**Step 6 — boost pads and bounce pads, last.**
These are the only items that add replicated state. Boost: a timed envelope
reusing `DashController`'s structure, with `boostMs` joining `CharacterSnapshot`
next to `dashCooldownMs` and restored by `reconcileTo`. Bounce: a velocity
**assignment** plus an explicit `grounded = false` (Source's
`SetGroundEntity(NULL)`) and a `launchEpoch` in the Epoch style CONTEXT.md
already defines, so the cosmetic half fires once. Both must be implemented in
`packages/shared` and applied inside `beginCapsuleTick`, so a Reconciliation
replay reproduces them from restored state (§7.1).

### 8.4 What to deliberately not do

- **Do not model ice as "you go faster."** Neither Quake nor Source touches max
  speed for slick surfaces; the feel comes entirely from lost acceleration and
  lost drag (§4.3).
- **Do not use Rapier collider `friction` on floor statics** and expect it to
  affect the Character. It will silently do nothing for the capsule while
  changing how Props and ragdoll bones behave on that surface (§4.1).
- **Do not implement downhill speed by projecting gravity onto the slope while
  grounded.** That is the rigid-body model; it belongs only in the >30° sliding
  case (§3.2).
- **Do not make boost a one-shot velocity addition.** It is the one shape that is
  neither idempotent under replay nor derivable from position (§5.2).
- **Do not tune the snap distance as a speed.** A distance is speed-independent;
  a speed re-creates the exact 18.4°/5.4° cliff that exists today (§1.1).

---

## 9. Source quality ledger

**[primary] — engine/game source code:**
[Quake III Arena `bg_pmove.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c),
[`bg_misc.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_misc.c),
[`g_trigger.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_trigger.c),
[`bg_local.h`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_local.h);
[Source SDK 2013 `gamemovement.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp),
[`movevars_shared.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/movevars_shared.cpp),
[`triggers.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/triggers.cpp),
[`c_baseplayer.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseplayer.cpp),
[`c_baseentity.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseentity.cpp);
[Rapier `character_controller.rs`](https://github.com/dimforge/rapier/blob/master/src/control/character_controller.rs)
and [CHANGELOG](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md);
[rapier.js binding `character_controller.rs`](https://github.com/dimforge/rapier.js/blob/master/src/control/character_controller.rs);
[Godot `character_body_3d.cpp`](https://github.com/godotengine/godot/blob/master/scene/3d/physics/character_body_3d.cpp).

**[primary] — vendor documentation:**
[Rapier — Character controller (JS)](https://rapier.rs/docs/user_guides/javascript/character_controller/),
[Rapier — Determinism](https://rapier.rs/docs/user_guides/rust/determinism/),
[Rapier JS `KinematicCharacterController`](https://rapier.rs/javascript3d/classes/KinematicCharacterController.html),
[`rapier3d::control::KinematicCharacterController`](https://docs.rs/rapier3d/latest/rapier3d/control/struct.KinematicCharacterController.html);
[Godot `CharacterBody3D`](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html);
[Unity Manual — Character Controller](https://docs.unity3d.com/Manual/class-CharacterController.html) and its
[5.2 archive](https://docs.unity3d.com/520/Documentation/Manual/class-CharacterController.html),
[Unity `CharacterController` scripting reference](https://docs.unity3d.com/ScriptReference/CharacterController.html),
[Unity Character Controller package — Slope management](https://docs.unity3d.com/Packages/com.unity.charactercontroller@1.0/manual/slope-management.html);
[Unreal `CharacterMovementComponent` (Python API, 5.4)](https://docs.unrealengine.com/5.4/en-US/PythonAPI/class/CharacterMovementComponent.html),
[Unreal — Understanding Networked Movement in the CMC](https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine?lang=en-US),
[Unreal `SetWalkableFloorAngle`](https://docs.unrealengine.com/4.27/en-US/API/Runtime/Engine/GameFramework/UCharacterMovementComponent/SetWalkableFloor-/);
[NVIDIA PhysX 5.3 — Character Controllers](https://nvidia-omniverse.github.io/PhysX/physx/5.3.0/docs/CharacterControllers.html).

**[primary] — issue trackers (engine maintainers/reporters, treated as evidence a
problem exists, not as documentation of behaviour):**
[godotengine/godot#71993](https://github.com/godotengine/godot/issues/71993),
[#99244](https://github.com/godotengine/godot/issues/99244),
[#79542](https://github.com/godotengine/godot/issues/79542).

**[primary] — academic / long-form:**
[Kasper Fauerby, "Improved Collision detection and Response" (2003)](https://www.peroxide.dk/papers/collision/collision.pdf).

**[verified locally]:** Rapier controller defaults measured against this repo's
`@dimforge/rapier3d-compat@0.20.0` (§1.2 table); the 18.4°/5.4° ground-stick
ceilings derived from `tuning.ts` (§1.1).

**[community RE] — credible reverse-engineering, not vendor-documented:**
[MKW TAS Wiki — Boost information](https://wiki.mkwtas.com/wiki/Boost_information);
[Sonic Retro — Sonic Physics Guide](https://info.sonicretro.org/Sonic_Physics_Guide)
(currently behind an anti-scraping challenge; the `slp = 0.125` constant quoted in
§3.2 is from secondary recollection and must be re-verified before use as a
number).

**[folklore] — no authoritative source found; do not cite as evidence:**
Unity `CharacterController`'s numeric Inspector defaults (45° / 0.3 / 0.08 /
0.001); Unreal's default value of `bMaintainHorizontalGroundVelocity`; how
Trackmania boosters and Fall Guys slime/conveyors are implemented; "Unity's
CharacterController doesn't slide down steep slopes" (true in practice, and
explained by PhysX's `ePREVENT_CLIMBING` default, but not stated in Unity's own
docs).

**Searched for and not found:** any GDC talk, postmortem or first-party technical
write-up from Mediatonic/Epic on Fall Guys' surface or slope handling; any
primary source on Trackmania's booster implementation. Rocket League's GDC 2018
networked-physics talk ([slides](https://media.gdcvault.com/gdc2018/presentations/Cone_Jared_It_Is_Rocket.pdf))
exists and is relevant to fixed-tick prediction generally, but its subject is a
*dynamic rigid-body* car, so it was not used as evidence for kinematic-controller
questions.

# Surface and Volume mechanics: what shipped games do, and how surface data is modelled

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — same convention as `docs/research/m2-netcode-transport.md`.
> This file feeds a design discussion; it is not itself a decision record. If the
> recommendation below is adopted it should be captured as an ADR the normal way.
>
> Companion note: `docs/research/slope-and-surface-movement.md` covers slopes,
> snap-to-ground and friction *models* for a kinematic controller. This note
> deliberately does not re-derive that; it catalogues the **mechanics** ("the floor
> or the air does something to you") and answers the **data-modelling** question
> (where the property lives, and who wins when it is set twice).

Scope: DON'T FALL has a Character that is a kinematic capsule driven by Rapier's
`KinematicCharacterController` (ADR 0006), a motion state machine
`Controlled → Stagger → Ragdoll → GettingUp` that is replicated and *snapped*, never
blended, on any correction (ADR 0013), and a Track assembled from Modules whose only
geometry today is `statics: Box[]` (`packages/shared/src/track/Module.ts`). The two
questions this note answers:

1. Which "the floor/air does something to you" mechanics are actually worth having,
   what do shipped games do for each, and which of them are a multiplier versus a new
   subsystem?
2. Where should the surface property live — per collider (`Box`), per Module, or both —
   and what are the precedence, default-value and backward-compatibility rules?

---

## Recommendation

**Ship four mechanics, in this order: low-grip surfaces, speed pads, bounce/launch pads,
updraft Volumes. Every one of them is a per-tick modifier or a one-shot velocity write.
None of them adds a `CharacterMotionState`.** That is the line that matters here, and it
is the line every engine surveyed draws too: a surface property is *re-derived from
position every tick* and therefore costs nothing to replicate, while a genuine mode
change (swimming, ladder, flying, gliding) is a state that must be in the Snapshot and
must survive Reconciliation. Source re-reads the ground's surface properties every tick
in `CGameMovement::CategorizeGroundSurface` and never stores them
([source-sdk-2013 `gamemovement.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp));
Quake III reads `SURF_SLICK` straight off `pml.groundTrace.surfaceFlags` inside the move
function ([`bg_pmove.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_pmove.c));
Unreal, by contrast, models *water* as a distinct `MOVE_Swimming` movement mode, because
that one genuinely is a different control scheme
([UE movement modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/MovementMode?application_version=5.0)).

**Model the surface property at two levels — per `Box` and per `Module` — with
"most specific wins", resolved once at `resolveTrack` time, not per tick.** Every engine
that started coarser than per-collider has since regretted it and either added a
finer level (Unreal's Physical Material Masks exist precisely so one mesh can carry two
physical materials without being split up) or has an open proposal to add one (Godot
proposal [#7401](https://github.com/godotengine/godot-proposals/issues/7401), which also
records that Khronos decided per-shape physics materials belong in the base glTF physics
extension). Nobody who has per-collider granularity is asking to remove it.
The Module-level default is the ergonomic half: SuperTuxKart's zipper parameters, Source's
`$surfaceprop`, and Roblox's material chain all show the same shape — a general default
with a specific override and an explicit "not set here" sentinel.

**Represent a Volume as its own thing, never as a `Box` with a special surface tag.**
This is unanimous across the sources: glTF's physics extension gives a node either a
`collider` (which carries a `physicsMaterial`) or a `trigger` (a volume that generates
overlap events and *no* physical response, and which carries no material at all)
([KHR_physics_rigid_bodies draft](https://github.com/eoineoineoin/glTF_Physics/blob/master/extensions/2.0/Khronos/KHR_physics_rigid_bodies/README.md));
Unreal has `APhysicsVolume` as its own actor class with its own priority field; Source has
`trigger_push` as an entity, not a material. This project already has the exact machinery
— `Checkpoint.volume` is an authored local `Box`, placed through `orientBox`, tested with
`pointInOrientedBox` each tick — so a Volume is a copy of a pattern that already works,
not a new subsystem.

**Do not ship conveyors, low-gravity volumes or glide in the first pass.** Conveyors are
the one "cheap-looking" mechanic that is not cheap: Source needs a dedicated
`FL_BASEVELOCITY` lifecycle, and a special case that converts the accumulated conveyor
velocity into a real impulse at the moment you step off, or you lose all momentum
(`CPlayerMove::CheckMovingGround`). Glide is a new motion state and therefore a protocol
change. Low gravity is cheap in the sim and expensive in prediction, because it changes
the jump envelope that `JumpController` latches.

---

# Part 1 — The catalogue

## 1.0 The distinction that decides everything: derived modifier vs replicated state

Before the individual mechanics, the classification that this project should apply to
each one.

**A derived per-tick modifier** is a number computed fresh each tick from *where the
Character is* — the collider under its feet, or the volume its capsule centre is inside.
It is never stored, never sent, and never restored on Reconciliation, because the client
and the server both compute it from the same Track (the client already fetches its exact
Track Revision, ADR 0028) and the same predicted position. If prediction is right about
position, it is automatically right about the modifier; if prediction is wrong about
position, the position correction fixes the modifier for free on the next replayed tick.
This is what Source and Quake III do for surface friction, speed and jump-height factors.
Source's per-surface game properties are literally a `maxSpeedFactor` and a `jumpFactor`
alongside friction and elasticity, in `surfacegameprops_t`
([`vphysics_interface.h`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/vphysics_interface.h)).

**A latched timed effect** is a countdown that outlives contact — a boost that keeps
working for three seconds after you leave the pad. This is *not* free. It is exactly the
same class of thing as `DashController.ticksLeft`, and this codebase has already paid for
getting that wrong once: `restoreCooldownMs`'s long comment records a real regression
where reconciliation silently killed an in-flight dash burst because the latched tick
counter was not restored correctly from the Snapshot. Any latched surface effect needs
either a Snapshot field plus a restore path, or a rule that lets it be re-derived from
the acked state. Prefer the latter, or prefer no latch at all.

**A motion state** is a distinct control mode — different input mapping, different
gravity handling, a different animation set. Unreal spells out the taxonomy in its
movement modes: walking, falling, swimming ("through a fluid volume, under the effects of
gravity and buoyancy"), flying ("ignoring the effects of gravity"), custom. Source has the
same thing at a lower level: a surface property carries a `climbable` byte, and touching a
climbable surface puts the player into `MOVETYPE_LADDER`, which every other system then
special-cases (`trigger_push` even has a spawnflag governing whether it is allowed to
disengage a player who is on a ladder). In this project a new motion state means a new
member of the `CharacterMotionState` union, which means a Snapshot field change, which
means ADR 0013's snap-don't-blend rule applies to it and ADR 0006's "the renderer snaps on
any motionState change" applies to it. That is a milestone, not a ticket.

The catalogue below labels every mechanic with which of the three it is.

---

## 1.1 Low grip (ice), high drag (mud), sticky floors

**The mechanic.** The ground under you scales how fast you accelerate, how fast you stop,
and sometimes your top speed. Ice removes deceleration so you keep sliding; mud caps your
speed and drags you down; sticky floors do both hard.

**Shipped examples.**

- *Quake III Arena* — `SURF_SLICK`, a surface flag whose own comment in
  [`surfaceflags.h`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/surfaceflags.h)
  is simply that it "effects game physics". The implementation is two branches, both in
  `bg_pmove.c`: `PM_Friction` skips ground friction entirely when the ground trace has
  `SURF_SLICK`, and `PM_WalkMove` swaps `pm_accelerate` for `pm_airaccelerate` and keeps
  applying gravity. Ice in Quake III is literally *"treat the ground as if it were air"* —
  two lines, no new state, no new data beyond one bit on the face.
- *Minecraft (Bedrock)* — a per-block `minecraft:friction` component, range 0.0–0.9,
  default 0.4, with ice at 0.02 and sand at 0.2
  ([Microsoft Learn — `minecraft:friction`](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftBlock_friction)).
  Note the shape of this: a scalar on the *block type*, not a flag, and a documented
  default so that "no value" and "normal ground" are the same thing.
- *Half-Life 2 / Source* — per-surfaceprop `friction` from the surface-properties database,
  read from the ground trace every tick and multiplied into both the friction term and the
  acceleration term (`sv_friction * m_surfaceFriction`, and
  `sv_accelerate * wishspeed * frametime * m_surfaceFriction`). Source additionally applies
  a hard-coded 1.25 rescale clamped to 1.0 to reconcile "vphysics friction units" with
  "player friction units" — the comment calls it a HACKHACK. Worth knowing: a friction
  number that is correct for rigid bodies is usually *not* the number that feels right for
  a player controller, in any engine.
- *SuperTuxKart* — the mud/slow case as an explicit material property pair:
  `max-speed-fraction` and `slowdown-time`, applied every tick as
  `setSlowdown(MS_DECREASE_TERRAIN, fraction, ticks)` from whatever material is under the
  kart ([`kart.cpp`](https://github.com/supertuxkart/stk-code/blob/master/src/karts/kart.cpp)).
  The `slowdown-time` is a *fade-in*: the terrain does not instantly halve your speed, it
  ramps to the new cap. That ramp is what makes driving into mud feel like mud instead of
  like hitting a wall.

**Implementation for a kinematic controller.** Trivially cheap, because a kinematic
controller already owns its own velocity integration. Each tick: find the collider under
the capsule (the ground trace / the grounded contact), look up its surface, and use the
surface's numbers instead of the global constants when computing this tick's horizontal
velocity. In this codebase that is `WALK_SPEED` and the (currently absent) acceleration
model in `CharacterController.beginCapsuleTick`. Note that DON'T FALL currently has *no*
acceleration or friction model at all — `velocity.x`/`velocity.z` are assigned outright
from `walk + dashBurst` every Controlled tick. Ice therefore requires introducing an
acceleration/friction step first (see the companion slope/friction note); once that exists,
ice is one multiplier.

1. **Continuous, always.** No shipped implementation does ice as an entry impulse. The
   whole point is that the effect is on while you are on it and off when you leave.
2. **Modifier, never a state.** All four examples derive it from the ground trace each
   tick.
3. **Full control retained** — that is the joke. On ice you have full authority over your
   *acceleration* and almost none over your *velocity*. Quake III's choice (air
   acceleration on the ground) is the sharpest expression of this and is worth copying
   directly.
4. **Fall/knockdown interaction: none, directly.** Ice does not knock you down; it slides
   you off the edge and the existing Fall does the rest. That is exactly this game's
   thesis, which is why ice is the single best-fitting mechanic in the catalogue.

**Cost: cheap** (one lookup + one multiplier), *conditional on* an acceleration model
existing.

---

## 1.2 Speed pads (boost) and slow pads

**The mechanic.** A patch of floor that adds speed (Mario Kart's dash panels, Sonic's dash
pads, Trackmania boosters) or removes it.

**Shipped examples with published implementations.**

- *SuperTuxKart's zipper* is the most instructive because the source is readable. A zipper
  is a **material property**, not an entity: a material with a `<zipper>` child gets
  `duration`, `fade-out-time`, `max-speed-increase`, `speed-gain`, `engine-force` and
  `min-speed` ([`material.cpp`](https://github.com/supertuxkart/stk-code/blob/master/src/graphics/material.cpp)).
  When the kart is on the ground on a zipper material, `Kart::handleZipper` calls
  `MaxSpeed::instantSpeedIncrease`, which does three things at once: an instant one-shot
  speed bump (`speed-gain`), a *temporarily raised speed cap* (`max-speed-increase`) held
  for `duration`, and then a linear fade-out over `fade-out-time`
  ([`max_speed.cpp`](https://github.com/supertuxkart/stk-code/blob/master/src/karts/max_speed.cpp)).
  Defaults in `kart_characteristics.xml`: duration 3.5 s, force 250, speed-gain 4.5,
  max-speed-increase 15, fade-out 1.0 s. A boost pad in a shipped racer is therefore
  *both* a one-shot impulse *and* a timed modifier — the impulse alone would be clipped
  right back to the normal speed cap on the very next tick, which is the classic bug when
  people implement boost as "add velocity".
- *Source's `trigger_push`* offers the same choice as an authoring switch. With the
  `SF_TRIG_PUSH_ONCE` spawnflag it applies `ApplyAbsVelocityImpulse` once and then deletes
  itself; without it, it re-applies a base velocity on every touch
  ([`triggers.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/triggers.cpp)).
  Two different mechanics, one entity, chosen by the level author.
- *Fall Guys* ships "speed arches" and conveyor floors in its obstacle set; the officially
  documented behaviour is thin, and the detailed parameter behaviour circulating for
  individual Fall Guys obstacles is community wiki material, not developer documentation —
  treat it as folklore. What *is* official is that conveyors move every draggable object,
  not just players ([Fall Guys release notes](https://www.fallguys.com/news/fall-guys-free-for-all-release-notes)).

**Slow pads** are the same mechanism with the sign flipped, and SuperTuxKart implements
them as the *default* branch (any material that is neither a rescue-surface nor a zipper
contributes `max-speed-fraction`), which is a nice trick: "slow" is not a special case, it
is the general case with the fraction at 1.0.

**Implementation for a kinematic controller.** Reuse whatever timed-envelope machinery the
dash already has. In this codebase `dashEnvelope(elapsed, duration, rampOut)` in
`movementVerbs.ts` is *exactly* SuperTuxKart's build/hold/fade shape already, and
`DashController` already owns the "a burst is playing out" bookkeeping. A boost pad
implemented as "start a Dash-like burst, but triggered by geometry and not by input, and
ignoring the cooldown" is a small amount of new code and a large amount of reused,
already-tuned feel.

1. **Hybrid, and this is the one place shipped games genuinely differ.** Quake III sets
   velocity outright, one shot. SuperTuxKart does impulse + timed cap. Source lets the
   author pick. There is no consensus to average here; the choice follows from whether the
   boost should survive leaving the pad. For a party racer, it should — a boost that dies
   the moment you step off makes the pad feel like a treadmill.
2. **Modifier — but a *latched* one, which is the expensive kind.** If the boost outlives
   contact it has a countdown, and that countdown is prediction state. Two honest options:
   (a) make it stateless — while you are on the pad, and only then, your speed cap and
   acceleration are raised (SuperTuxKart's terrain-slowdown branch, Source's
   `maxSpeedFactor`); or (b) accept a Snapshot field and a restore path, modelled directly
   on `DashController.restoreCooldownMs`. Option (a) is one ticket; option (b) is one
   ticket plus a netcode trap this repo has already been bitten by once.
3. **Full control retained** in every implementation surveyed; you steer normally, you are
   just faster. SuperTuxKart adds one guard worth stealing: a zipper is ignored while the
   player is braking or moving backwards.
4. **Fall/knockdown interaction: it makes Falls more likely and that is the point.** No
   surveyed game makes a boost pad itself cause a knockdown. But note this codebase's
   `DASH_WALL_MIN_SPEED_RATIO` rule — a fast Dash into a wall Ragdolls you. A boost pad
   that feeds the same speed into the same wall check will produce boost-into-wall
   knockdowns for free, which is almost certainly desirable and should be a deliberate
   decision rather than an accident.

**Cost: cheap if stateless, medium if latched.**

---

## 1.3 Conveyor belts and moving floors

**The mechanic.** The floor itself has a velocity; standing on it carries you.

**Shipped examples.** Source's `func_conveyor` is the canonical implementation and the
canonical warning. The whole mechanism lives in
[`player_command.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/player_command.cpp)'s
`CPlayerMove::CheckMovingGround`, and it is more intricate than it looks:

- If the player is on the ground and the ground entity has `FL_CONVEYOR`, the conveyor's
  ground velocity is written into the player's **base velocity** and `FL_BASEVELOCITY` is
  set — accumulating with any base velocity a `trigger_push` set this same tick.
- Movement then *adds* base velocity to the player's velocity immediately before the
  collision trace and *subtracts it again* immediately after (visible half a dozen times
  in `gamemovement.cpp`). The conveyor therefore never contaminates the player's own
  velocity; it is a pure per-tick additive term.
- On the tick where the flag was **not** re-set — i.e. the tick you step off — the
  accumulated base velocity is converted into a real impulse on your own velocity
  (`ApplyAbsVelocityImpulse((1 + frametime*0.5) * baseVelocity)`) and then zeroed. That
  half-frame fudge factor is what makes running off the end of a conveyor keep your
  momentum instead of dropping it.
- Separately, `CGameMovement::SetGroundEntity` adds the old ground's velocity into base
  velocity when you leave a mover and subtracts the new ground's when you land on one, so
  jumping off a moving platform inherits it.

Fall Guys' conveyor floors are the party-game reference point, and the official release
notes confirm they move *all* draggable objects, not only players — which in this project
would mean Props too, and Props are server-interpolated-only and never predicted
(ADR 0016), so a Prop on a conveyor is a separate small design question.

**Implementation for a kinematic controller.** Add the belt velocity to the desired
translation passed to `computeColliderMovement` while grounded on the belt collider,
and — critically — *do not* fold it into the stored `velocity`, or every subsequent tick
compounds it. Rapier's controller makes this natural, since you already hand it a movement
vector per tick and it hands you back a corrected one.

1. **Continuous**, with a one-shot momentum handoff at the moment of departure. Both halves
   matter; the departure handoff is the part everyone forgets.
2. **Modifier**, but with a hidden state: "what was my base velocity last tick" must be
   remembered exactly one tick in order to do the handoff. Source stores it on the player
   and clears it every frame.
3. **Full control**; you walk normally, the world scrolls under you.
4. **Fall interaction:** a conveyor pointed at a gap is a Fall machine, which is
   exceptionally on-theme. No knockdown of its own.

**Cost: medium.** Not because the maths is hard, but because it touches the grounded
handoff, jumping off a moving surface, and Prop interaction. It is the most tempting
mechanic to underestimate.

---

## 1.4 Bounce surfaces (trampolines, jelly, bouncy mushrooms)

**The mechanic.** Landing on it reverses and amplifies your vertical velocity instead of
absorbing it.

**Shipped examples.** Fall Guys' bouncy floors and inflatables (community-documented in
detail; the official material only confirms the assets exist). Minecraft's slime block.
Fortnite's Bouncer and Crash Pad devices, both listed as first-class devices in Epic's
documentation ([Fortnite devices](https://dev.epicgames.com/documentation/fortnite/using-devices-in-fortnite)).
Portal 2's repulsion gel is the interesting outlier because it is a *surface material* that
is painted on and can be applied to arbitrary geometry, rather than a special block type.

**Implementation for a kinematic controller.** Because the capsule is kinematic, no
physics restitution applies to it — Rapier's controller does not bounce anything; it
computes a corrected movement and stops
([Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller)).
The bounce must be written by hand: on the tick where `computedGrounded()` becomes true on
a bouncy collider, set `velocity.y = max(bounceMin, -velocity.y * restitution)` and
suppress the ground-stick that would otherwise clamp it. In this codebase the exact line
to guard is in `beginCapsuleTick`:

```
if (this.grounded && this.velocity.y < 0) {
  this.velocity.y = -GROUND_STICK_SPEED;   // ← this is what kills a bounce
  this.jump.land();
}
```

A bounce surface must take that branch instead, and must *not* call `jump.land()` in a way
that re-arms coyote time for a free extra jump at the apex (unless you want that, which for
a comedy game you might).

1. **One-shot per landing**, computed from your impact velocity — that is what makes it a
   *bounce* rather than a *launcher*: a small fall gives a small bounce. A minimum bounce
   floor is usually added so that walking onto it still does something.
2. **Modifier.** No new state anywhere: it is one branch inside the existing landing code.
3. **Control in the air is unchanged** (whatever your normal air control is). Games that
   want a bigger comedy beat instead take control away for the arc, which is a *state*, and
   costs accordingly.
4. **Fall/knockdown interaction is the real design question,** and Quake III answers it
   explicitly at the data level: `SURF_NODAMAGE` exists, and the comment in `bg_pmove.c`'s
   `PM_CrashLand` says in so many words that it is used for bounce pads, where you never
   want to take damage or play a crunch sound. The generalisable rule: *a surface that
   launches you must be able to declare that landings it caused do not count.* DON'T FALL
   has no fall damage — a Fall is defined by the kill plane (CONTEXT.md) — so this maps to
   a different question: should a big bounce landing trigger a Ragdoll? Recommendation: no
   by default, with a `noKnockdown` bit available on the surface, exactly mirroring
   `SURF_NODAMAGE`.

**Cost: cheap.** One branch in the landing code plus one surface property.

---

## 1.5 Launch pads / jump pads (fixed-target launchers)

**The mechanic.** Touch it and you are thrown along a fixed arc, regardless of how you
arrived.

**Shipped examples and the best-documented implementation.** Quake III's `trigger_push`,
which is worth studying line by line because it solves the netcode problem this project
has:

- The launch velocity is **precomputed at map load**, not at touch time. `AimAtTarget` in
  [`g_trigger.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_trigger.c)
  takes the pad's target position, solves `time = sqrt(height / (0.5 * gravity))` for the
  apex, and stores the resulting velocity in the entity's `origin2`. The pad knows exactly
  one velocity and hands it to everyone.
- On touch, `BG_TouchJumpPad` **sets** the player's velocity outright (`VectorCopy`), it
  does not add to it. Your incoming speed is discarded. That is what makes a jump pad
  reliable enough to build a map around.
- It lives in `bg_` — the code shared between the game module and the client-side
  prediction module, the direct analogue of `packages/shared` here.
- `SP_trigger_push` explicitly clears `SVF_NOCLIENT` so the trigger entity is replicated to
  clients, and the QUAKED comment states the reason: this one is client-side predicted,
  unlike `target_push`. **A jump pad has to be part of the world the client predicts
  against.** In this project that is already true for free — the client fetches the same
  Track Revision (ADR 0028) — which is a genuine architectural advantage worth noticing.
- Firing the *sound/effect* exactly once is handled by remembering `ps->jumppad_ent` and
  `ps->jumppad_frame` on the player state, so that a wide trigger touched over several
  frames does not re-fire. This is precisely CONTEXT.md's **Epoch** pattern, arrived at
  independently: never a one-tick boolean.

Fortnite's Launch Pad is the party-game counterpart, and it demonstrates the expensive
variant: it launches you *and* deploys the glider, i.e. it transitions you into a different
movement mode. That second half is not a surface mechanic at all (see §2.4).

**Implementation for a kinematic controller.** Identical to the bounce pad, minus the
dependence on incoming velocity: on entry, assign `velocity` from the pad's authored vector
and clear grounded so the next tick does not immediately re-stick you to the floor
(Source's `trigger_push` does exactly this: on an upward push it nulls the ground entity
and nudges the origin up by one unit).

1. **One-shot on entry**, unambiguously, in every implementation surveyed.
2. **Modifier** — a single write to velocity — *provided* you keep the "don't re-trigger"
   guard as a derived comparison (which pad am I touching this tick vs last tick) rather
   than a timer.
3. **Full air control retained** in Quake III. Games that want a spectacular arc reduce or
   remove air control for its duration, which again is a state.
4. **Fall/knockdown:** same as bounce; the pad should carry the "landings from this do not
   knock down" bit, and Quake III's `SURF_NODAMAGE` is the precedent for putting that bit
   on the *surface data* rather than hard-coding it in the pad entity.

**Cost: cheap.** Cheapest of the lot after ice, and the only one whose authored data is a
vector rather than a scalar.

---

## 1.6 Damaging, knockdown and kill floors

**The mechanic.** The floor eliminates you, resets you, or knocks you over.

**Shipped examples.** Quake III's `CONTENTS_LAVA` / `CONTENTS_SLIME` — note that these are
*content* flags on the brush volume, not *surface* flags on the face, which is the
engine's own way of saying "this is a property of being inside a region, not of standing on
a plane". SuperTuxKart's `reset` / `crash-reset` material flags, which trigger a
`RescueAnimation` when a kart drives on (or crashes into) them, with a documented
`CollisionReaction` enum for the crash case. Fall Guys' slime, which the official docs
describe as having a `Collision In Game` toggle — when off, players fall through it and
respawn.

**How it maps here.** DON'T FALL already has this mechanic and calls it Fall — a kill plane
plus `Respawn` at the last Checkpoint with a penalty (ADR 0010). A "slime floor" is
therefore not a new mechanic, it is a *second* trigger for the existing one: a surface (or
volume) that calls `RapierSimulation`'s existing fall path instead of waiting for the kill
plane. That is genuinely a few lines, and it is the thing that lets a Module be a
Slime Climb-style hazard without needing a hole in the geometry.

A **knockdown floor** (touch it and you Ragdoll, no respawn) is likewise already
implemented: `CharacterController.applyImpact` with a magnitude above
`IMPACT_RAGDOLL_MIN` and a `RagdollCause`. Adding a new `RagdollCause` is an additive
Snapshot change, and ADR 0023's cause-latching rules already cover it.

1. **Continuous check, one-shot effect**, guarded by the existing `respawnCount` /
   `ragdollEpoch` counters.
2. **Modifier** (it triggers an existing state; it is not a new one).
3. N/A.
4. This *is* the fall/knockdown system.

**Cost: cheap**, and unusually high value per line for this specific game, because the
knockdown pipeline is already built and tested.

---

## 2.1 Updraft / vertical wind volumes

**The mechanic.** A region of air that pushes you upward while you are inside it.

**Shipped examples.** Fortnite's Air Vent device: standing on it projects the player
upward, it also knocks vehicles, balls and projectiles into the air, and a wall-mounted
vent pushes in the direction the gust blows; the authored parameter is a
**Knockup Force Multiplier** with named steps from Low to Mega High, default Medium
([Epic — Using Air Vent Devices](https://dev.epicgames.com/documentation/en-us/fortnite/using-air-vent-devices-in-fortnite-creative)).
Zelda: Breath of the Wild / Tears of the Kingdom updrafts are the famous case; the GDC 2017
talk describes wind as an *element* in the chemistry engine that exerts real physics forces
on objects, but it is press coverage rather than a technical writeup and the numbers are
not published — treat as illustrative, not as an implementation source
([Game Developer's coverage of the GDC 2017 talk](https://www.gamedeveloper.com/design/video-designing-i-zelda-breath-of-the-wild-i-s-unconventional-mechanics)).
Apex Legends' jump towers are frequently cited here but Respawn has published no technical
description; anything specific about them is folklore.

**Implementation for a kinematic controller.** The cheapest correct version is: each tick,
test the capsule's reference point against the volume; if inside, add an upward term to
`velocity.y` *before* gravity is integrated, or equivalently reduce the effective gravity
and add a target rise speed. Do **not** implement it as a per-tick impulse without a cap:
uncapped it accelerates without bound and the player leaves the map. Every practical
version clamps to a terminal rise speed, which is the same shape as Unreal's
`terminal_velocity` on `APhysicsVolume`
([UE PhysicsVolume](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PhysicsVolume?application_version=5.0)).

1. **Continuous while inside** for a wind column; **one-shot** for a vent you stand on
   (Fortnite's air vent reads as one-shot knockup by its wording). A "fan section" in a
   party game is the continuous kind, because the comedy is in fighting it.
2. **Modifier**, as long as you accept that the player is in the ordinary airborne state
   while inside — which is the whole reason to prefer an updraft over a launcher. It
   becomes a state only if you want a distinct control scheme in the column.
3. **Full air control** in every party-game version; the fun is steering while being lifted.
4. **Fall interaction: an updraft must suppress "landings caused by this don't count", or
   nothing** — with no fall damage in this game the honest answer is *nothing*. What it
   *does* interact with is the kill plane: a wind column above a pit is a rescue mechanic,
   and a horizontal wind above a pit is an execution mechanic.

**Cost: cheap in the sim, medium in the data model** — because it is the mechanic that
forces `Module` to gain a Volume concept. That is the whole cost, and it is one-time.

---

## 2.2 Horizontal wind / push volumes

**The mechanic.** A region that pushes you sideways while you are inside it.

**Shipped example with published source.** Source's `trigger_push`, non-once variant:
`pushdir` (an angle, converted to a vector at spawn and stored in entity space) and
`speed`, applied every touch as a base velocity. Three details worth stealing:

- Different move types get different treatment in the same entity: a VPhysics object gets a
  *force* scaled by an assumed 100 kg mass and by frametime, while a player gets a base
  velocity. One authored parameter, two physically appropriate applications.
- There is an explicit `alternateticksfix` scale factor, because the push was tuned at one
  tick rate and broke at another. A fixed-30 Hz project is immune to this class of bug by
  construction (ADR 0004) — but it is a good reminder that a push expressed in
  units-per-second and applied per-tick is the only safe formulation.
- Because it writes base velocity, and base velocity is added-then-subtracted around the
  move, a horizontal push *does not* accumulate into your own velocity while you are inside
  — you move at (walk + wind), not at (walk + wind × ticks). Getting this wrong is the
  single most common wind bug.

1. **Continuous** (or one-shot with the spawnflag).
2. **Modifier.**
3. **Full control**, and the tension between your input and the push is the mechanic.
4. **Fall interaction:** it pushes you off things. Perfect fit for this game.

**Cost: cheap** once Volumes exist — it is the updraft with a different vector, which is a
strong argument for authoring the effect as a direction + magnitude from the start rather
than as a scalar "lift".

---

## 2.3 Low-gravity volumes

**The mechanic.** Inside the region, gravity is scaled.

**Shipped examples.** Source's `trigger_gravity`, whose implementation is a cautionary
tale: `CTriggerGravity::GravityTouch` calls `pOther->SetGravity(...)` on the touching player
and *nothing ever restores it* — the entity mutates a persistent property of the player on
entry and has no exit handling at all. Unreal takes the opposite approach, and the right
one: gravity-ish parameters live on `APhysicsVolume`, and the engine guarantees each actor
is affected by exactly one physics volume at any time, resolved by an integer `priority`,
with any authored volume outranking the always-present `DefaultPhysicsVolume`. Fortnite
exposes gravity as an island-wide setting rather than a volume.

**Implementation for a kinematic controller.** One multiplier on the gravity term. In this
codebase that is `this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT`, where
`gravityScale` is *already* a variable owned by `JumpController` for variable-height jumps.
Multiplying in a volume factor there is a one-line change.

1. **Continuous while inside.**
2. **Modifier in the sim, but a prediction hazard.** `JumpController` latches
   `holdTicksLeft` and `jumping` across ticks, and its output depends on gravity; a
   correction that moves the Character in or out of the volume mid-jump changes the jump
   arc under replay. Not fatal — replay recomputes it — but it is the mechanic most likely
   to produce a visible correction, which is why it is not in the recommended first set.
3. **Full control**, with everything feeling floatier.
4. **Fall interaction:** low gravity makes Falls *slower*, which drags out the failure beat.
   For a game whose failure moment is the joke, that is a design cost, not just a
   technical one.

**Cost: cheap to implement, medium to tune, and the first mechanic where "exactly one
volume wins" (Unreal's rule) matters** — two overlapping gravity volumes that both apply
would be nonsense.

---

## 2.4 Glide / float volumes, and why they are not like the others

**The mechanic.** You fall slowly and steer, either everywhere (a glider item) or inside a
region (a float zone).

**Why it is different.** Gliding is a control scheme, not a number. Unreal models it as a
movement mode (`MOVE_Flying`, which "ignores the effects of gravity" and is affected by the
physics volume's fluid friction) rather than as a physics-volume parameter, and water is
`MOVE_Swimming` for the same reason. Quake III's flight powerup is checked explicitly in
`BG_TouchJumpPad` — a flying player is not affected by jump pads at all — and again in
`Use_target_push`, and again as a separate friction term in `PM_Friction`. That is three
unrelated systems that each had to learn about one new state. Fortnite's Launch Pad is
"launch + enter glider mode", and the glider is a whole movement mode with its own input
mapping.

Applied here, a glide state means: a new member of `CharacterMotionState`, a new Snapshot
value, ADR 0006's "the renderer snaps on any motionState change" applying to entering and
leaving it, ADR 0013's snap-don't-blend rule applying to corrections of it, ADR 0015's
question of who decides when it ends, and every existing check that reads
`machine.inputScale` or `isDown(state)` needing review.

**A float volume** ("you descend slowly while inside") is the cheap impostor of gliding and
is worth distinguishing: clamping downward velocity inside a region is a per-tick modifier
with no state at all, and delivers most of the visual read. If a floaty section is wanted,
build that, not a glider.

1. Continuous while inside.
2. **A real state** for gliding; a modifier for a float volume. This is the sharpest
   state-vs-modifier boundary in the catalogue.
3. Reduced-and-different control (that is the point of the mode).
4. Gliding fundamentally changes the Fall — it is an anti-Fall mechanic — which for this
   game is a design decision far above the level of a surface property.

**Cost: expensive (glide) / cheap (float volume).**

---

## 2.5 Summary table

| Mechanic | Continuous or one-shot | State or modifier | Control | New systems dragged in | Verdict |
|---|---|---|---|---|---|
| Ice / low grip | continuous | modifier | full | acceleration/friction model | cheap* |
| Mud / slow surface | continuous (ramped) | modifier | full | same as above | cheap* |
| Speed pad | one-shot + timed cap | modifier (latched) | full | prediction state if it outlives contact | cheap–medium |
| Slow pad | continuous | modifier | full | none | cheap |
| Conveyor | continuous + exit impulse | modifier + 1 tick of memory | full | grounded handoff, Props, jump-off inheritance | medium |
| Bounce surface | one-shot per landing | modifier | full | landing branch, knockdown suppression bit | cheap |
| Launch pad | one-shot on entry | modifier | full | re-trigger guard (Epoch pattern) | cheap |
| Kill / slime floor | continuous check | modifier (fires existing Fall) | n/a | none — reuses Respawn | cheap |
| Knockdown floor | continuous check | modifier (fires existing Ragdoll) | n/a | one new `RagdollCause` | cheap |
| Updraft volume | continuous (or one-shot vent) | modifier | full | **Volume concept in `Module`** | cheap + one-time |
| Horizontal wind | continuous | modifier | full | none once Volumes exist | cheap |
| Low gravity | continuous | modifier | full | jump envelope under replay | medium |
| Float volume | continuous | modifier | full | none | cheap |
| Glide | continuous | **state** | different | Snapshot, reconciliation, every state check | expensive |

\* conditional on an acceleration/friction model existing, which today it does not.

---

# Part 2 — How surface data is modelled and authored

## 3.1 What each system actually does

**Unity.** A Physics Material asset is dragged onto a **Collider**. If a collider has none,
it uses the project's default surface settings from the Physics settings. Two colliders in
contact each bring their own friction/bounciness plus a *combine mode*, and when the modes
disagree Unity documents an explicit priority: Maximum, then Multiply, then Minimum, then
Average
([Unity — Physics Material asset reference](https://docs.unity3d.com/6000.3/Documentation/Manual/class-PhysicsMaterial.html),
[Unity — How collider surface values combine](https://docs.unity3d.com/6000.3/Documentation/Manual/collider-surfaces-combine.html)).
Note a documented inconsistency: Unity's 2D physics documentation lists the priority order
with Minimum ahead of Multiply, the 3D page lists Multiply ahead of Minimum. Do not assume
one rule across both. Unity provides no engine-level "surface type" enum; the
near-universal shipping pattern is to key a lookup table off the physics material asset (or
off a tag/component) to get footstep sounds, decals and gameplay behaviour. That pattern is
convention, not documented engine behaviour — mark it as such.

**Unreal.** The richest model, and the most instructive:

- A **Physical Material** asset carries friction, friction combine mode, restitution,
  density, and — crucially — a **Surface Type**, an enum defined per project in
  `DefaultEngine.ini` and used for "what sound plays as a character walks across a surface,
  to the type of decal an explosion should leave"
  ([UE — Physical Materials Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/physical-materials-reference-for-unreal-engine)).
  The physical parameters and the gameplay classification are the *same object*: one asset,
  two audiences.
- Assignment is deliberately layered by *which collision representation is used*: simple
  collision reads the physical material set on the static mesh asset; complex (per-triangle)
  collision reads the physical material of the render Material applied to the mesh; and a
  `Phys Material Override` property, present on everything with a Collision category,
  supersedes it ([UE — Physical Materials User Guide](https://dev.epicgames.com/documentation/unreal-engine/physical-materials-user-guide-for-unreal-engine)).
  **The docs contradict themselves here** — the same page says the override applies to
  complex-collision traces in one paragraph and states that it does not affect complex
  collision traces in another. Where sources disagree, this is the disagreement; treat the
  override as reliably applying to simple collision only.
- **Physical Material Masks** exist because per-collider granularity was not enough: a
  1-bit mask texture on a chosen UV channel selects between two physical materials across
  one graphical material, so a window mesh can be wood at the frame and glass at the pane
  *without splitting it into multiple elements and materials*. Material instances can
  override part of the mask and inherit the rest from the parent
  ([UE — PhysicalMaterialMask](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/PhysicalMaterialMask?application_version=5.5)).
  This is the single strongest piece of evidence in this note for "go finer than the
  object".
- Documented limits disagree across versions: UE 4.27 material states 62 surface types are
  supported; the 5.x reference states you are limited to 30 without source changes. Both
  are engine documentation; they simply differ by version.

**Source.** The property is a *string on the material*, resolved to an index at compile
time. `vbsp`'s `GetSurfaceProperties` reads the `$surfaceprop` variable from a VMT and looks
it up in the surface-properties database, and if the named prop does not exist it falls back
to the entry literally named `default` with a warning
([`src/utils/vbsp/textures.cpp`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/utils/vbsp/textures.cpp)).
The database itself is a set of KeyValues files enumerated by
`scripts/surfaceproperties_manifest.txt`. There is a `$surfaceprop2` for blended
displacement materials — a second surface property for the second blend layer, i.e. one
piece of geometry with two surface identities, the same conclusion Unreal reached with
masks. Content flags (water, ladder, grate, playerclip) are assigned in the same pass from
material names and material variables, so a brush's *volume* semantics and its *surface*
semantics both derive from the material it is textured with, and both are baked. Note the
consequence: in Source you cannot make one face of a brush icy without giving it a different
material. That is a real authoring limitation people work around by making
`nature/ice_slippery` variants of textures.

**Quake / idTech.** Two parallel namespaces, and the split is the whole lesson:

- **Content flags** describe *being inside a volume*: `CONTENTS_WATER`, `CONTENTS_LAVA`,
  `CONTENTS_PLAYERCLIP`, `CONTENTS_JUMPPAD`, `CONTENTS_TELEPORTER`.
- **Surface flags** describe *a face you touch*: `SURF_SLICK`, `SURF_NODAMAGE`,
  `SURF_LADDER`, `SURF_METALSTEPS`, `SURF_DUST`, `SURF_NOSTEPS`.
- Both are bitfields on the face/brush, authored via the shader (material) the face uses,
  and the header carrying them
  ([`surfaceflags.h`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/surfaceflags.h))
  opens with an instruction that the file must be identical between the game and the map
  compiler — a shared-constants file across the tool boundary, which is exactly what
  `packages/shared` is here.

**Godot.** The outlier. `PhysicsMaterial` is assigned to a *body*, via
`physics_material_override`, and the class docs say an assigned material is used instead of
any other physics material such as an inherited one
([Godot — RigidBody3D](https://docs.godotengine.org/en/stable/classes/class_rigidbody3d.html)).
There is no per-shape material. Proposal
[#7401](https://github.com/godotengine/godot-proposals/issues/7401) documents the resulting
problems in the engine's own tracker: a hammer whose handle and head are different materials
cannot be represented without two bodies and a weld joint; glTF files carrying per-shape
materials cannot be imported faithfully; and Khronos concluded that per-shape materials
belong in the base glTF physics extension with implementations required to support them.
The proposed rule is the standard one — a shape's material takes priority over the body's.

**glTF `KHR_physics_rigid_bodies` (draft).** The interchange format's answer, which is
useful precisely because it had to satisfy every engine at once: a node's `collider` has a
`physicsMaterial` that indexes a **top-level shared array** of materials; materials carry
`staticFriction`, `dynamicFriction`, `restitution` and explicit `frictionCombine` /
`restitutionCombine` policies; and if a collider has no material assigned, the
implementation may pick any appropriate defaults. Separately, a node may have a `trigger`
instead — a volume that detects overlap and produces no physical response, carrying geometry
and a collision filter but **no material**.

**Roblox.** The clearest published precedence chain of any engine, four levels deep, most
specific first: the part's own custom physical properties, then the custom properties of the
part's custom material, then those of the material override for the part's material, then
the material's built-in defaults ([Roblox — Materials](https://create.roblox.com/docs/parts/materials)).
Roblox also has the explicit-override idiom: physical properties come from the material
unless `CustomPhysicalProperties` is set.

**SuperTuxKart.** A working example of the *gameplay* layer done as material properties:
`zipper`, `reset`, `high-adhesion`, `slowdown-time`, `max-speed-fraction`,
`collision-reaction`, plus per-material zipper tuning. Its default sentinel is a negative
number: any zipper parameter left at `-1` means "not specified on this material", and
`Kart::handleZipper` falls back to the kart's own value for each parameter independently.
This is per-*parameter* inheritance, not per-object, and it is the most flexible scheme
here — and also the one most likely to produce "why is this pad behaving differently"
confusion, since a material can override three of six parameters.

---

## 3.2 Q1 — Which granularity do they settle on, and what went wrong for the coarse ones?

**Per-collider (or finer) wins, everywhere, with the object level surviving only as a
default.** Unity: per-collider. Unreal: per-collision-primitive *and* per-render-material
*and* per-mask-region within one material. Source: per-material, which in practice is
per-face. Quake: per-face. glTF: per-collider, mandated. Godot alone is per-body, and its
own proposal tracker records that as a defect rather than a design.

The documented failure modes of coarse granularity:

- **You cannot represent a compound object.** Godot's hammer. The workaround (two bodies
  plus a joint) changes the simulation to satisfy the data model, which is exactly
  backwards.
- **You cannot round-trip authored content.** Godot cannot import a glTF body whose shapes
  carry different materials without losing information. Any format that is coarser than its
  interchange format has a permanent import problem.
- **Authors duplicate assets to work around it.** Unreal's Physical Material Masks exist to
  avoid splitting a mesh into multiple elements just to get two surface types; Source
  authors make near-duplicate VMTs (an "icy" copy of a texture) for the same reason. Asset
  duplication to express a one-bit property is the tell.

The mirror-image failure — *only* per-collider, no object-level default — shows up as
authoring tedium rather than as a representational hole: every collider in a 30-collider
prefab has to be set individually, and one missed collider is a bug you find by walking on
it. That is why the systems with real content pipelines (Roblox, Unreal, SuperTuxKart) all
have both levels.

## 3.3 Q2 — Precedence when the property exists at two levels

**Most specific wins. Unanimously.** Roblox: part over custom material over material
override over material default. Godot's proposal: shape over body. Unreal: `Phys Material
Override` over the mesh's/material's own. Unity: a collider's material over the project
default. Nobody surveyed uses "nearest ancestor" in the scene-graph sense (which is what a
Unity-style hierarchical inheritance would imply), and nobody uses "outermost wins".

Two refinements worth adopting or rejecting deliberately:

- **Explicit override flag vs implicit "is it set".** Roblox's `CustomPhysicalProperties`
  is an explicit opt-in; Unreal's `Phys Material Override` is "anything other than `None`";
  Godot's is "if a material is assigned". The explicit-flag variant only earns its keep
  when the property's value space has no free sentinel (Roblox's is a struct of numbers, so
  "not set" cannot be expressed as a value). Where the property is a reference that can be
  absent, absence *is* the flag, and a separate boolean is a second source of truth that
  can disagree with the first.
- **Per-parameter vs whole-record override.** SuperTuxKart overrides parameter-by-parameter
  via `-1` sentinels; everyone else overrides the whole material record. Whole-record is far
  easier to reason about and to debug ("what am I standing on?" has one answer). Per-
  parameter is strictly more expressive and strictly harder to explain.

A separate precedence question that only shows up with *pairs* of surfaces (Unity's and
glTF's combine modes) does not arise here: the Character is kinematic and has no surface
material of its own, so exactly one surface is in play. That is a real simplification worth
banking.

## 3.4 Q3 — How "no material set" is represented, and which representation causes fewer bugs

Three approaches are visible:

1. **Absent reference, resolved to an engine default at use time.** Unity ("no Physics
   Material → project default settings"), Godot, glTF ("the implementation may choose any
   appropriate default values").
2. **Absent reference, resolved to a *named* default entry at bake time.** Source: `vbsp`
   resolves `$surfaceprop` to an index, and an unresolvable name becomes the index of the
   entry named `default`, with a warning printed at compile time.
3. **Per-parameter sentinel value.** SuperTuxKart's `-1`.

**Option 2 causes the fewest bugs, and by a clear margin.** The reason is that it makes the
absent case *loud once* (a compile-time warning naming the material) and *silent
thereafter* (every runtime consumer sees a real, fully-populated record and never writes a
fallback branch). Option 1 pushes a null check into every consumer, and glTF's version is
worse still because the default is implementation-defined, so the same asset behaves
differently in two runtimes. Option 3 is the worst for debugging: `-1` is a value, it flows
through code, and a sign error turns "unset" into a real parameter.

The corollary for a project with a wire format: keep the field **optional and absent** on
the wire (so old data parses and new data is small), and **resolve it to a total,
non-optional record exactly once** at the boundary where authored data becomes runtime data.
Do not let `undefined` reach the tick loop.

## 3.5 Q4 — Adding the property to a format that already has content

This is the best-solved problem in the set, and every source does the same thing.

- **Additive optional fields with a defined default.** glTF's entire extension mechanism is
  this: `collider.physicsMaterial` is an optional index, and a file without it is valid.
  Segment's own `pitch`/`roll` (ADR 0034) are the in-repo precedent — new optional fields
  defaulting to 0, with every published Revision parsing unchanged and no migration.
- **A named default entry, so old content resolves to something explicitly authored.**
  Source's `default` surfaceprop means the "no surfaceprop" case is not a hole in the data
  model; it is a row in the table that a designer can tune. This is materially better than
  hard-coded constants, because the day someone wants "slightly grippier default floors" it
  is a data change, not a code change.
- **Never repurpose an existing field's meaning.** Unreal's version drift (62 vs 30 surface
  types) is survivable precisely because the surface type is an enum index whose *meaning*
  is project data; had the count been baked into the format semantics it would not have been.
- **Zero-value defaults where possible.** A property whose "unset" default is the identity
  (friction multiplier 1.0, wind vector zero) means old content is not merely parseable but
  *behaviourally identical*, which is the actual requirement for immutable published
  Revisions. This is stronger than parse-compatibility and should be the explicit test:
  an M1-seed Revision must produce a bit-identical world after the change.

The one trap: a *new required table* (e.g. a `SURFACES` registry that Modules index into by
id) is not additive if a Revision can reference an id that later disappears. The project
already has the right instinct here — `unknownModuleIds` in `apps/track-service/src/validate.ts`
validates that every `Segment.moduleId` resolves before a Track is saved, and rejects
prototype-chain names via `Object.hasOwn` rather than `in`. A surface registry needs the same
validation and the same "ids are append-only, never renamed or removed" discipline, since
`Revision`s are immutable (ADR 0032) but the Module and surface libraries are code.

## 3.6 Q5 — How a Volume (wind, updraft, gravity) is represented

**Not as a collider with a special material. As its own kind of thing.** The evidence:

- **glTF** gives a node either a `collider` (solid, carries a physics material) or a
  `trigger` (a volume that detects overlaps, produces no physical response, and has **no**
  material field). The specification names the industry synonyms — triggers, sensors,
  phantoms, overlap volumes — and explicitly leaves what happens on overlap to application
  logic.
- **Unreal** goes further and gives volumes a dedicated actor class, `APhysicsVolume`, whose
  documented contract is that each actor is affected by exactly one physics volume at a
  time, with overlaps resolved by an integer `priority` (higher wins) and any authored
  volume outranking the always-present `DefaultPhysicsVolume`. Its parameters are volume
  parameters, not surface parameters: terminal velocity, fluid friction, "is this water".
- **Source** makes volumes entities (`trigger_push`, `trigger_gravity`, `trigger_teleport`),
  authored as brushes with a trigger texture, with per-entity keyvalues (`pushdir`, `speed`)
  and spawnflags (`SF_TRIG_PUSH_ONCE`). Its volume semantics live in *content* flags, a
  namespace deliberately separate from surface flags.
- **Quake** likewise: `CONTENTS_WATER` / `CONTENTS_LAVA` / `CONTENTS_JUMPPAD` are content
  flags on brushes; `SURF_SLICK` is a surface flag on faces. Two namespaces, on purpose.

Two sub-decisions the sources answer:

- **Overlap resolution.** Unreal: exactly one volume applies, chosen by priority. Source:
  effects accumulate (a conveyor's ground velocity is *added* to a `trigger_push`'s base
  velocity in the same tick). Both ship. Unreal's rule is far easier to reason about and to
  debug and is the right default for authored content; Source's accumulation is right when
  the effects are genuinely independent (a conveyor under a fan). Pick one and write it down.
- **Where the effect parameters live.** On the volume instance (Source's keyvalues, Unreal's
  volume properties), *not* in a shared material table. This is the opposite of the surface
  case, and for a good reason: two icy floors are the same ice, but two wind volumes almost
  always blow different directions at different strengths.

---

# What this means for DON'T FALL

## (a) The coherent minimum set

Four mechanics, chosen because together they cover both halves of the space (surface and
volume, continuous and one-shot), because each one directly serves "physical chaos, bumping,
shoving and falling", and because not one of them adds a `CharacterMotionState`:

1. **Low-grip surface (ice).** The purest expression of the game's thesis: full control, no
   authority, and the Fall does the rest. Prerequisite: an acceleration/friction model,
   which does not exist today (`velocity.x`/`velocity.z` are assigned outright each tick).
   Quake III's implementation — on slick ground, accelerate as if in air and keep applying
   gravity — is the model to copy.
2. **Speed pad.** Highest value per line, because `dashEnvelope` and `DashController`
   already implement the exact build/hold/fade curve that SuperTuxKart's zipper uses.
   Recommend the **stateless** variant first: while grounded on the pad, and only then, the
   pad's speed contribution applies. If a tail past the pad is wanted later, model it on
   `restoreCooldownMs` and accept the Snapshot field consciously.
3. **Bounce / launch pad.** One branch in the landing code (`grounded && velocity.y < 0`)
   plus one authored vector, plus a "landings from this do not knock down" bit copied
   conceptually from `SURF_NODAMAGE`. Re-trigger suppression uses the Epoch idiom already
   codified in CONTEXT.md, not a boolean.
4. **Updraft Volume.** The one mechanic that forces the Volume concept, which is why it is
   in the minimum set rather than deferred: it is better to pay for Volumes once, on the
   simplest possible effect, than to retrofit them later under a harder one.

Also worth noting as *nearly free*, because the pipeline already exists: a **slime/kill
surface** (calls the existing Fall/Respawn path instead of waiting for the kill plane) and a
**knockdown surface** (calls `applyImpact` above `IMPACT_RAGDOLL_MIN` with a new
`RagdollCause`). Neither is a new system; both are new triggers for shipped ones.

**Deliberately excluded from the first pass:** conveyors (grounded handoff + momentum-on-exit
+ Prop interaction; Source needed a dedicated base-velocity lifecycle for it), low gravity
(interacts with `JumpController`'s latched jump-hold state under replay), and glide (a real
motion state and therefore a protocol change).

## (b) Data model and precedence for surface properties

```ts
// packages/shared/src/track/surfaces.ts (new)
export type SurfaceId = string;              // key into SURFACES; "default" always exists

export interface Surface {
  id: SurfaceId;
  friction: number;      // multiplier on the (to-be-added) ground friction/accel term
  speedFactor: number;   // Source's surfacegameprops_t.maxSpeedFactor
  jumpFactor: number;    // Source's surfacegameprops_t.jumpFactor
  restitution: number;   // 0 = no bounce; >0 = bounce surface
  noKnockdown: boolean;  // Quake's SURF_NODAMAGE, adapted: landings here never Ragdoll
  kills: boolean;        // slime: triggers the existing Fall path
}
```

- **Two levels: per `Box` and per `Module`.** `Module.statics` entries gain an optional
  `surface?: SurfaceId`; `Module` gains an optional `surface?: SurfaceId` used as the default
  for all of its statics. This mirrors what every engine with a real content pipeline
  converged on, and specifically avoids Godot's documented per-body-only problem — a
  "half ice, half concrete" Module must be expressible without splitting it into two Modules.
- **Precedence: most specific wins.** `Box.surface ?? Module.surface ?? "default"`.
  Whole-record override, not per-parameter (reject SuperTuxKart's `-1` scheme: harder to
  explain, harder to debug, and this project has no need for it yet).
- **No `Segment`-level override.** Deliberate. A third level would let a Track mutate a
  Module's authored meaning, which contradicts "a Module is a reusable template authored
  once" (CONTEXT.md) and would make two Segments of the same Module behave differently for
  reasons invisible in the Module library. If a Track needs icy-Straight, that is a second
  Module, not an override. Revisit only if authoring pain proves otherwise.
- **Absence is absence on the wire; totality at runtime.** The field is optional and omitted
  when unset — exactly the additive-optional pattern ADR 0034 already used for
  `pitch`/`roll`, so every published Revision (including the M1 seed) parses *and behaves*
  identically, provided `SURFACES.default` is the identity (friction 1, speedFactor 1,
  jumpFactor 1, restitution 0, noKnockdown false, kills false). Make that behavioural
  identity an explicit test, not just a parse test.
- **Resolve exactly once, at `resolveTrack`.** Following Source's `vbsp`: `resolveTrack`
  already flattens Modules into world-space `OrientedBox[]`; that is the right place to
  collapse the two-level lookup into one non-optional `Surface` per collider. The tick loop
  must never see `undefined` and must never walk a fallback chain. This requires
  `OrientedBox` to carry the resolved surface through `orientBox` (which today constructs a
  fresh object and would silently drop it) and `RapierSimulation` to keep a
  `surfaceByHandle: Map<number, Surface>` alongside the existing `spinnerByHandle` /
  `propByHandle` — it currently keeps no handle map for statics at all, which is the single
  concrete blocker.
- **Derive the standing surface every tick; never store it.** `CharacterController` already
  walks `rapierController.computedCollision(i)` and has each collider's handle and normal.
  Pick the grounded contact (normal.y above the walkable threshold) and look up its surface.
  Because the client and server both build the same statics from the same Revision
  (ADR 0028), this is reproduced identically under prediction and under replay with **zero**
  Snapshot changes — the property this whole design is optimising for, and the reason to
  resist any latched surface effect.
- **Validation.** Unknown `SurfaceId`s must be rejected the way unknown `moduleId`s already
  are (`apps/track-service/src/validate.ts`), with `Object.hasOwn`. Surface ids are
  append-only: never rename, never remove, because Revisions are immutable (ADR 0032).

## (c) How a Volume should be represented

**A new optional array on `Module`, not a flavour of `Box`.**

```ts
export interface VolumeConfig {
  volume: Box;                       // authored in Module-local space, like Checkpoint.volume
  effect: VolumeEffect;              // { kind: "wind"; velocity: Vec3; maxSpeed: number } | ...
  priority?: number;                 // Unreal's rule: highest wins; exactly one applies
}

export interface Module {
  // ...existing fields
  volumes?: VolumeConfig[];          // additive, optional — old Revisions unaffected
}
```

Why this shape:

- It follows the unanimous engine split (glTF's `collider` vs `trigger`; Quake's surface
  flags vs content flags; Unreal's `APhysicsVolume`). A Volume is not solid, carries no
  friction, and its parameters are per-instance (a direction and a strength), so putting it
  in the shared surface table would be wrong on all three counts.
- **The pipeline already exists.** `Checkpoint.volume` is an authored local `Box`, placed by
  `orientBox` inside `resolveTrack`, and tested every tick with `pointInOrientedBox` — which
  ADR 0034's review already generalised to arbitrary rotations. A wind Volume is that code
  path with a different payload. This is the strongest argument for choosing an updraft as
  the first Volume effect: the risky part is already built and tested.
- **Overlap rule: take Unreal's.** Exactly one Volume applies per Character per tick, chosen
  by highest `priority` (ties broken by Track order, deterministically). Reject Source-style
  accumulation for now: two overlapping updrafts that stack is an authoring mistake that
  launches a player out of the world, and "why am I flying" is a much worse bug to diagnose
  than "why is only one fan working".
- **Cap every continuous effect.** Unreal has `terminal_velocity` on the volume for exactly
  this reason. A wind Volume without a maximum induced speed is an unbounded integrator.
- The Track builder needs to render Volumes as translucent boxes — it already has to render
  Checkpoint volumes and Footprints, so this is a third instance of an existing visual idiom
  rather than new work.

## (d) What to sequence first, and why

1. **Surface plumbing, with exactly one surface (`default`) and zero behaviour change.**
   `Surface` + `SURFACES` in `packages/shared`; optional `surface?` on `Box` and `Module`;
   resolution in `resolveTrack`; `OrientedBox` carrying it; `surfaceByHandle` in
   `RapierSimulation`; `CharacterController` learning which surface it is standing on this
   tick and doing nothing with it. **Everything else in this note is blocked on this**, and
   done this way it is a pure-refactor ticket whose success criterion is that every existing
   test and the M1 seed Revision behave bit-identically. That is the cheapest possible way to
   de-risk the part that touches the most files.
2. **Ice.** The smallest real effect, and the one that proves the derived-modifier path end
   to end including under Reconciliation. It is also the mechanic that forces the
   acceleration/friction model to exist, which the companion slope/friction note covers and
   which slopes will need anyway — so this is shared foundation, not a detour.
3. **Speed pad (stateless variant) + the surface bits (`noKnockdown`, `kills`).** Proves the
   surface table can carry gameplay classification, not just physics numbers, and reuses
   `dashEnvelope`. Cheap because step 1 and 2 already exist.
4. **Volumes as a concept, with updraft as the only effect.** Proves the volume path against
   the Checkpoint precedent. Wind (horizontal) then costs nothing extra, since the effect
   should be authored as a vector from the start.
5. **Bounce/launch surfaces.** Deliberately after Volumes rather than before, because
   launchers and updrafts compete for the same design space and it is worth knowing how the
   updraft feels before tuning a launcher against it.
6. **Only then:** conveyors, low gravity, float volumes. And glide only as a milestone with
   its own ADR, since it is a `CharacterMotionState` and therefore a protocol change.

The through-line: steps 1–5 add **no field to any Character Snapshot and no member to
`CharacterMotionState`**. That is not a coincidence, it is the selection criterion — and it
is what makes a catalogue this large affordable for a project whose netcode is already
paid for.

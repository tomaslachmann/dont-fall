import { addVec3, dotVec3, lengthVec3, lerpVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../../math/vec3.js";
import { GRAVITY_Y, GROUND_SNAP_DISTANCE, GROUND_STICK_SPEED, WALK_SPEED } from "../../tuning/character.js";
import { TICK_DT } from "../../tuning/clock.js";
import { IMPACT_KNOCKBACK_DECAY, IMPACT_KNOCKBACK_LIFT, IMPACT_KNOCKBACK_MIN, IMPACT_KNOCKBACK_SCALE } from "../../tuning/knockdown.js";
import { MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR, SLIDE_STEER_BLEND } from "../../tuning/movement.js";
import type { ReconcileBase } from "../../state/SimState.js";
import { CHARACTER_GROUPS } from "../collisionGroups.js";
import { DashController } from "../DashController.js";
import { accelerateVelocity, applyVolumeForce, JumpController, slopeSpeedMultiplier } from "../movementVerbs.js";
import type { SimInputs } from "../SimInputs.js";
import type { Capsule } from "./Capsule.js";
import type { SurfaceController } from "./SurfaceController.js";

/**
 * A Ride for one tick (ADR 0061), handed to the Character by `RapierSimulation`
 * before `CharacterController.beginTick`: how far the Moving Segment under
 * it carries its capsule centre this tick, and that Segment's colliders — which
 * the carry sweep ignores, so being carried never collides with the carrier.
 */
export interface Ride {
  displacement: Vec3;
  ignoreColliders: ReadonlySet<number>;
}

/**
 * How a Character's capsule moves (ADR 0035/0037): its velocity and whether
 * it stands on anything, jump and Dash, the walk wish and the two velocity
 * models, everything that rides on top of them (a shove, a launch, a Volume),
 * being carried by a Moving Segment, and the sweep that asks Rapier how far
 * all of it actually gets.
 *
 * `velocity` and `grounded` are the capsule's own state, read (and, on a
 * knockdown or a correction, reset) by the rest of `CharacterController`.
 */
export class MovementController {
  /** Capsule velocity (units/s): `x`/`z` set fresh each Controlled tick, `y` integrated. */
  velocity: Vec3 = vec3();
  grounded = false;

  readonly jump = new JumpController();
  readonly dash = new DashController();
  /**
   * Current horizontal speed (units/s) contributed by an active Dash burst —
   * the exact `dashEnvelope` curve already driving the physics, exposed
   * directly so the renderer's speed-lines effect doesn't have to derive it
   * (noisily) from position deltas. 0 whenever no burst is active.
   */
  dashSpeed = 0;
  /** This tick's rising edges, latched by {@link latchButtons}. */
  jumpPressed = false;
  dashPressed = false;
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;

  /**
   * A shove still playing out on the capsule (units/s, horizontal only —
   * ADR 0093). Its own contributor to velocity rather than a write into it:
   * the movement pipeline (ADR 0035) recomputes horizontal velocity toward
   * the wish velocity every tick and, at full grip, reaches it exactly within
   * that tick, so anything written straight into `velocity` is gone before it
   * is drawn. Added on top after that pipeline and decayed by
   * {@link IMPACT_KNOCKBACK_DECAY} each tick.
   *
   * Only a staggering Impact uses it. A knockdown does not: it hands the
   * whole shove to the ragdoll instead (`RagdollController.beginRagdoll`), and the capsule
   * is switched off for the duration anyway.
   */
  private knockback: Vec3 = vec3();
  /**
   * The true peak fall speed (units/s, always ≥ 0) since velocity.y was last
   * non-negative — see the gravity-integration line in {@link accelerateTowardWish}
   * for the full reasoning. Consumed (and reset) by a genuine bounce;
   * otherwise reset the instant velocity.y next becomes non-negative (a
   * jump/bounce/launch apex).
   */
  airbornePeakFallSpeed = 0;
  /** Rises every time a launch pad fires (M3.7 ticket 02) — the Epoch idiom, same as `ragdollEpoch`. */
  launchPadEpoch = 0;
  /**
   * Set by {@link triggerLaunchPad}, consumed at the top of the very next
   * capsule tick — unlike a speed pad's boost (which only ever
   * touches the horizontal wish velocity a Surface/Sliding model still gets
   * to shape), a launch pad's SET overrides the tick's ENTIRE velocity
   * outright, after every other contributor has already been computed —
   * Quake's jump-pad model taken further: "your incoming speed is
   * discarded" applies to gravity and Sliding too, not just walk/Dash.
   */
  private pendingLaunchVelocity: Vec3 | undefined;

  /** This tick's Ride, set before `beginTick` (ADR 0061); `undefined` when not riding. */
  private ride: Ride | undefined;
  /** The velocity the last applied Ride carried this Character at — what leaving it keeps. */
  private rideVelocity: Vec3 | undefined;
  /**
   * The horizontal part of a Ride's velocity kept after leaving it, added to
   * every airborne sweep until landing (ADR 0061). Separate from `velocity`
   * because air control converges on the input wish within a tick and would
   * erase it; the vertical part goes into `velocity.y` once instead, where
   * gravity takes it.
   */
  private keptRideVelocity: Vec3 | undefined;
  /** How far a Moving Segment that moved into this capsule pushes it out, taken by the next sweep (ADR 0061). */
  private pendingPush: Vec3 | undefined;

  constructor(private readonly capsule: Capsule) {}

  /** Latch this tick's jump and Dash presses — rising edges of the held state. */
  latchButtons(input: SimInputs): void {
    this.jumpPressed = input.jumpHeld && !this.jumpHeldLastTick;
    this.dashPressed = input.dashHeld && !this.dashHeldLastTick;
    this.jumpHeldLastTick = input.jumpHeld;
    this.dashHeldLastTick = input.dashHeld;
  }

  /**
   * Queue a push out of a Moving Segment that moved into this capsule (ADR
   * 0061), swept with the next tick's own movement so a push never carries it
   * through a wall. Two bodies pushing in one tick: the deeper push wins.
   */
  queuePush(push: Vec3): void {
    if (!this.pendingPush || lengthVec3(push) > lengthVec3(this.pendingPush)) this.pendingPush = { ...push };
  }

  /** Set this tick's Ride (ADR 0061) — `RapierSimulation` calls it for every Character before `beginTick`. */
  setRide(ride: Ride | undefined): void {
    this.ride = ride;
  }

  /**
   * Fire a launch pad (M3.7 ticket 02) — called by `RapierSimulation` exactly
   * once per crossing, on the tick its own position-based rising-edge check
   * finds a *new* pad the Character wasn't already touching. Queues the
   * one-shot throw for the very next capsule tick — vertical SET,
   * horizontal ADDED (ADR 0069); there is no ongoing decay state to arm, and
   * no state change either: a launch never knocks down, the Character stays
   * exactly as Controlled (or as staggered) as it already was.
   */
  triggerLaunchPad(velocity: Vec3): void {
    this.launchPadEpoch += 1;
    this.pendingLaunchVelocity = { ...velocity };
  }

  /**
   * Puts an Impact's shove onto the capsule (ADR 0093) — the horizontal part
   * into the decaying {@link knockback}, the lift straight into vertical
   * velocity, where gravity is already the thing that takes it back.
   *
   * The strongest shove in flight wins rather than accumulating: two Hits
   * landing in the same tick should stagger a Character once, not launch it.
   */
  shove(impulse: Vec3, magnitude: number): void {
    const horizontal = Math.hypot(impulse.x, impulse.z);
    if (horizontal === 0) return;
    const speed = magnitude * IMPACT_KNOCKBACK_SCALE;
    const next = vec3((impulse.x / horizontal) * speed, 0, (impulse.z / horizontal) * speed);
    if (lengthVec3(next) <= lengthVec3(this.knockback)) return;
    this.knockback = next;
    this.velocity.y = Math.max(this.velocity.y, magnitude * IMPACT_KNOCKBACK_LIFT);
  }

  /**
   * Sends the capsule off at `velocity` (ADR 0104) — a Character let go of by
   * a hold on its feet, flung by a Spin or shoved clear of its grabber. The
   * horizontal part goes into the same decaying {@link knockback} a Hit's
   * shove uses, for the same reason (the movement model would erase it
   * within the tick); the vertical part into `velocity.y`, where gravity is
   * already the thing that takes it back.
   */
  fling(velocity: Vec3): void {
    const horizontal = vec3(velocity.x, 0, velocity.z);
    if (lengthVec3(horizontal) > lengthVec3(this.knockback)) this.knockback = horizontal;
    this.velocity.y = Math.max(this.velocity.y, velocity.y);
  }

  /** Jump's own half of the tick — the take-off, and what the Surface under it makes of it. */
  beginJump(pressed: boolean, surface: SurfaceController, carryScale = 1): number | null {
    const takeoff = this.jump.beginTick(this.grounded, pressed);
    // ADR 0092: the Surface you push off decides how much of the jump you
    // get. Ice gives back less, mud less again, a bounce deck more — height
    // goes with the square of this, so even a light multiplier is felt at once.
    if (takeoff !== null) {
      // ADR 0125: a carried Prop takes its share on top, by its weight.
      const pushed = takeoff * surface.surfaceJumpMultiplier * carryScale;
      // ADR 0094: on a bounce Surface the deck's own rebound is still there
      // to be had, and this take-off replaces the landing branch below that
      // would otherwise have given it (the branch only runs on a downward
      // velocity, and a jump has just made this one upward). Taking the
      // greater of the two — never their sum — means arriving hard and
      // jumping is never worse than arriving hard and not jumping, while
      // repeatedly timing a jump converges on the jump's own height instead
      // of climbing without limit.
      this.velocity.y = surface.surfaceBounce
        ? Math.max(pushed, surface.surfaceBounce.minSpeed, this.airbornePeakFallSpeed * surface.surfaceBounce.restitution)
        : pushed;
      // The peak belongs to the landing this jump just took off from, spent
      // either way — left standing it would be handed to a later bounce that
      // had no fall behind it, the stale-peak bug the landing branch below
      // documents.
      if (surface.surfaceBounce) this.airbornePeakFallSpeed = 0;
    }
    return takeoff;
  }

  /** Whatever this Character was riding, and no longer is. */
  leaveRide(): void {
    // Left a Ride since last tick (ADR 0061): a jump, a walk-off, or the
    // carrier moving out from under it. Airborne, it keeps the carrier's
    // velocity; landed straight on other ground, there is nothing to keep.
    if (!this.ride && this.rideVelocity) {
      if (!this.grounded) {
        this.velocity.y += this.rideVelocity.y;
        this.keptRideVelocity = vec3(this.rideVelocity.x, 0, this.rideVelocity.z);
      }
      this.rideVelocity = undefined;
    }
  }

  /**
   * Dash's own half of the action verbs: a burst started here locks Hit and
   * Grab out for as long as it plays (`InteractionController.beginVerbs`
   * reads {@link DashController.isActive} right after). Returns this tick's
   * Dash contribution to the wish velocity.
   */
  beginDash(move: Vec3, start: boolean, slides: boolean): Vec3 {
    const dashBurst = this.dash.beginTick(move, start);
    this.dashSpeed = slides ? 0 : lengthVec3(dashBurst);
    return dashBurst;
  }

  /** This tick's walk wish, before any slope scaling. */
  walkWish(move: Vec3, surface: SurfaceController, carrySpeedMultiplier: number): Vec3 {
    // Surface-scaled, but not yet slope-scaled (below) — the Sliding branch
    // uses this as-is for its steering blend, deliberately never applying
    // the slope-angle multiplier (ticket 04): that model is for walking
    // only, per ADR 0037/CONTEXT.md's split between the two.
    // ADR 0104: `carrySpeedMultiplier` folds in the same way — 1 (no effect)
    // unless this Character is carrying someone, 0 while it Spins them.
    // ADR 0064: the belt joins outright — one more contributor to the same
    // wish velocity (ADR 0035's model), so it steers a slide exactly like it
    // carries a walk, with no second code path.
    const walk = addVec3(
      scaleVec3(move, WALK_SPEED * surface.surfaceTopSpeedMultiplier * carrySpeedMultiplier),
      surface.conveyorVelocity,
    );
    return walk;
  }

  /** The Sliding branch (ADR 0037) — gravity along the slope plane, steered, integrated tick over tick. */
  slideDownSlope(walk: Vec3, normal: Vec3): void {

    // ADR 0037: the one place gravity is projected onto the slope plane and
    // integrated tick over tick, rather than the direct `velocity.xz =
    // target` assignment every other Controlled/Stagger tick uses below —
    // ADR 0035 rejects that accelerating model for ordinary walking, but
    // adopts it here.
    const gravity = vec3(0, GRAVITY_Y, 0);
    const slopeGravity = subVec3(gravity, scaleVec3(normal, dotVec3(gravity, normal)));
    // `walk` is already reduced via SLIDE_INPUT_SCALE (folded into `move`
    // above) — but it's still a *velocity*, not an acceleration, so it
    // can't just be integrated (`+= walk * TICK_DT`) alongside gravity
    // the way a first attempt at this did (code review): that grows
    // without bound the longer a direction is held, eventually swamping
    // the slide itself. Blending the horizontal velocity toward `walk`
    // each tick keeps steering genuinely limited — it can pull the
    // Character's own speed at most as far as `walk`'s magnitude, never
    // past it, while gravity keeps accumulating independently.
    const horizontal = lerpVec3({ x: this.velocity.x, y: 0, z: this.velocity.z }, walk, SLIDE_STEER_BLEND);
    this.velocity.x = horizontal.x + slopeGravity.x * TICK_DT;
    this.velocity.z = horizontal.z + slopeGravity.z * TICK_DT;
    this.velocity.y += slopeGravity.y * TICK_DT;
  }

  /** Every other state (ADR 0035) — gravity, the slope multiplier, and one accelerate toward the wish. */
  accelerateTowardWish(
    input: SimInputs,
    move: Vec3,
    walk: Vec3,
    dashBurst: Vec3,
    fullControl: boolean,
    surface: SurfaceController,
  ): void {

    const gravityScale = this.jump.gravityScale(fullControl && input.jumpHeld, this.velocity.y);
    this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT;
    // M3.7 ticket 02: tracks the TRUE peak fall speed across an entire
    // fall, independent of the ordinary ground-stick clamp below —
    // resets the instant velocity.y is non-negative (a jump/bounce/launch
    // apex, or simply not falling), so it always reflects "how fast has
    // this Character been falling since it was last not falling," never
    // contaminated by an intervening clamp. Exists because `surfaceBounce`
    // (like every Surface field) can take several ticks to resolve after
    // a fast landing — Rapier's own snap-to-ground correction can report
    // `computedGrounded()` true for multiple ticks without ever producing
    // a `computedCollision()` entry (`resolveCollisions`'s own documented
    // caveat) — and reading `-this.velocity.y` directly at the ground-
    // stick check, once Surface finally does resolve, would by then only
    // see whatever the ordinary clamp had already reduced it to on the
    // ticks in between (empirically confirmed: a bounce Surface bounced
    // back at exactly its own `minSpeed` floor regardless of fall height,
    // because the real impact speed was already destroyed before the
    // bounce math ever ran). Tracking the peak here, decoupled from
    // `this.velocity.y`'s own clamped value, fixes this without changing
    // the ground-stick clamp's own timing for every other (non-bounce)
    // landing at all.
    this.airbornePeakFallSpeed = this.velocity.y < 0 ? Math.max(this.airbornePeakFallSpeed, -this.velocity.y) : 0;

    // Ticket 04: downhill faster, uphill slower — an explicit multiplier
    // keyed off the signed slope angle toward `move` (Unity's Character
    // Controller model, not Quake 3's flatten-to-slope-independent one;
    // see `slopeSpeedMultiplier`'s own doc comment for both). Only applies
    // to the walk contribution, not Dash — same "Surface caps WALK_SPEED,
    // never Dash" precedent ticket 01 already established — and only
    // while genuinely grounded on a real surface (mid-air/no ground
    // contact reads as flat, i.e. no effect, exactly like Surface itself).
    const slope =
      this.grounded && surface.currentGroundNormal ? slopeSpeedMultiplier(move, surface.currentGroundNormal) : 1;
    const slopedWalk = scaleVec3(walk, slope);
    // Ticket 05, ADR 0035: Dash is now a contributor to the same wish
    // velocity the persistent-velocity pipeline chases, rather than an
    // addition tacked directly onto the final velocity outside any model
    // — the structural change that later lets a wall-Impact rule (ADR
    // 0037) read "how fast is this Character going" without asking "was
    // this a Dash?" At today's saturating MOVE_ACCEL_FACTOR/
    // MOVE_FRICTION_FACTOR (full grip), `accelerateVelocity` reaches
    // `wish` exactly within this same tick — numerically identical to the
    // direct `velocity.xz = wish` assignment it replaces. `surfaceGrip`
    // (ticket 06) multiplies both factors together — Source's own
    // one-scalar-does-both model — so ice's near-zero grip alone is
    // exactly what turns this from "identical" into "a genuine, gradual
    // ramp," with no other code path change needed.
    const wish = addVec3(slopedWalk, dashBurst);
    const newVelocity = accelerateVelocity(
      this.velocity,
      wish,
      MOVE_ACCEL_FACTOR * surface.surfaceGrip,
      MOVE_FRICTION_FACTOR * surface.surfaceGrip,
    );
    this.velocity.x = newVelocity.x;
    this.velocity.z = newVelocity.z;

  }

  /** What rides on top of whatever the movement model just decided: a shove, a launch, a Volume. */
  applyImpulses(surface: SurfaceController): void {
    // ADR 0093: the shove rides on top of whatever the movement model just
    // decided, then spends itself. Applied after both branches — being
    // knocked sideways is not something a slide should be immune to.
    if (lengthVec3(this.knockback) > 0) {
      this.velocity.x += this.knockback.x;
      this.velocity.z += this.knockback.z;
      this.knockback = scaleVec3(this.knockback, IMPACT_KNOCKBACK_DECAY);
      if (lengthVec3(this.knockback) < IMPACT_KNOCKBACK_MIN) this.knockback = vec3();
    }

    if (this.pendingLaunchVelocity) {
      // M3.7 ticket 02, amended by ADR 0069: the *vertical* half of a launch
      // overrides EVERYTHING computed above this tick — gravity, Sliding's
      // slope-gravity integration, the Surface/Dash/Conveyor/accelerate model,
      // all of it — so the apex is the height the author set whether the
      // Character walked on or fell on (Unreal's `bZOverride`). The horizontal
      // half is *added* to the run the Character brought: this is a platformer,
      // not an arena shooter, and Quake's whole-vector `VectorCopy` ("your
      // incoming speed is discarded") would make a Spring a stop, not a boost.
      this.velocity = {
        x: this.velocity.x + this.pendingLaunchVelocity.x,
        y: this.pendingLaunchVelocity.y,
        z: this.velocity.z + this.pendingLaunchVelocity.z,
      };
      this.pendingLaunchVelocity = undefined;
    }

    if (surface.activeVolume) {
      // M3.7 ticket 04: unconditional, on top of everything above (including
      // a launch pad's own SET this same tick) — a Volume is a continuous
      // force, not a one-shot effect competing for the same "what is this
      // tick's velocity" slot the way a launch pad's SET does. No flight
      // mode: this never touches `motionState`, controls, or the camera —
      // the Character just gets pushed and otherwise behaves exactly as it
      // already would (walks, staggers, ragdolls) while inside.
      this.velocity = applyVolumeForce(this.velocity, surface.activeVolume.force, surface.activeVolume.maxInducedSpeed);
    }
  }

  /** Ask Rapier how far this tick's velocity can actually carry the capsule. */
  sweepCapsule(): Vec3 {
    // `filterGroups: CHARACTER_GROUPS` so the sweep honours collision groups
    // the way the rest of the world does — without it the character controller
    // collides against *everything*, including another Character's active
    // ragdoll bones (ticket 04: two Characters, one down), which would wall-
    // knock or block the mover on a body it should pass straight through.
    const ownVelocity = this.keptRideVelocity ? addVec3(this.velocity, this.keptRideVelocity) : this.velocity;
    const push = this.pendingPush ?? vec3();
    this.pendingPush = undefined;
    this.capsule.controller.computeColliderMovement(
      this.capsule.collider,
      addVec3(scaleVec3(ownVelocity, TICK_DT), push),
      undefined,
      CHARACTER_GROUPS,
    );
    const ownMovement = this.capsule.controller.computedMovement();
    const corrected = vec3(ownMovement.x, ownMovement.y, ownMovement.z);
    return corrected;
  }

  /**
   * Whether this tick ends on the floor, and what the floor does about the
   * arrival. `onLanding` runs at the one point a landing may take the
   * Character's feet (ADR 0092) — before the peak fall speed it is judged
   * against is let go of.
   */
  settleOnGround(
    corrected: Vec3,
    takeoff: number | null,
    slides: boolean,
    surface: SurfaceController,
    onLanding: () => void,
  ): void {
    const wasGrounded = this.grounded;
    this.grounded = this.capsule.controller.computedGrounded();
    // ADR 0084: a sweep that starts on the floor can come back tilted — Rapier
    // resolves it against a contact normal a few degrees off vertical (noise
    // on flat trimeshes, or a chamfer between two decks) and slides the whole
    // step along it. At Dash speed that lifts the capsule ~0.1 clear of the
    // floor, and Rapier's own snap-to-ground only pulls down a sweep that went
    // down, so it reported one airborne tick mid-run. Nothing sent this
    // Character up — no jump this tick, no upward speed (a launch, a bounce,
    // an updraft all have one) — so it goes back down onto the floor.
    if (!this.grounded && wasGrounded && takeoff === null && this.velocity.y <= 0) {
      const drop = surface.standableGroundBelow(corrected);
      if (drop !== undefined) {
        corrected.y -= drop;
        this.grounded = true;
      }
    }
    if (this.grounded) this.keptRideVelocity = undefined;
    // Skipped while Sliding: this would overwrite the very slope-gravity
    // velocity just built up above with a flat constant every tick, which
    // is exactly the ground-stick-as-a-speed unit bug ticket 02 fixed —
    // reintroducing it here, just for Sliding, would recreate the same skip.
    if (this.grounded && this.velocity.y < 0 && !slides) {
      // M3.7 ticket 02: a bounce Surface takes this exact branch instead of
      // the ordinary ground-stick clamp — the research doc's own words:
      // "on the tick where computedGrounded() becomes true on a bouncy
      // collider, set velocity.y = max(bounceMin, -velocity.y * restitution)
      // and suppress the ground-stick that would otherwise clamp it." Uses
      // {@link airbornePeakFallSpeed} rather than reading `-this.velocity.y`
      // directly — see that field's own comment for why: `surfaceBounce`
      // can take several ticks to resolve after landing, by which point an
      // ordinary (non-bounce) clamp may already have run on the ticks in
      // between, and reading the instantaneous value here would see that
      // clamp's own residue instead of the real impact speed. A launch pad
      // never reaches this branch with a negative Y in practice (a launch's
      // own Y is virtually always positive), so it needs no corresponding
      // handling here.
      // ADR 0092: ice may not let you land it. Read here, before the peak is
      // let go of below, and against that same peak rather than
      // `-this.velocity.y` — for exactly the reason the bounce above does:
      // the Surface can take a tick or two to resolve after a fast fall, by
      // which point the instantaneous value is an earlier clamp's residue and
      // not the speed the Character actually arrived at.
      onLanding();
      this.velocity.y = surface.surfaceBounce
        ? Math.max(surface.surfaceBounce.minSpeed, this.airbornePeakFallSpeed * surface.surfaceBounce.restitution)
        : -GROUND_STICK_SPEED;
      // Reset the peak once the ground handle has genuinely resolved,
      // whether bounce or not — NOT merely "consumed by a bounce" (an
      // earlier version, code review): `surfaceBounce`/`currentGroundColliderHandle`
      // can still be stale on the very first landing tick(s) after a fast
      // fall (see `airbornePeakFallSpeed`'s own comment), so resetting
      // unconditionally on every ground-stick tick would re-introduce the
      // original bug (the peak gone before a genuine bounce ever reads it).
      // But resetting ONLY when a bounce consumes it left a stale peak from
      // an unrelated, long-past fall sitting around indefinitely through
      // ordinary walking on non-bounce ground — confirmed empirically: a
      // Character that fell once, landed normally, then walked flatly for
      // over a minute still launched to the ORIGINAL fall's full bounce
      // height the instant it later stepped onto an actual bounce Surface,
      // with no real fall behind it at all. `currentGroundColliderHandle`
      // (checked here before `resolveCollisions` below updates it, so it
      // still reflects whether Surface was ALREADY known going into this
      // tick) is the same one-tick-lag signal `surfaceBounce` itself is
      // derived from — once it's resolved, Surface is no longer in doubt,
      // so it's always safe to let go of a peak nothing has consumed by then.
      if (surface.surfaceBounce || surface.currentGroundColliderHandle !== undefined) {
        this.airbornePeakFallSpeed = 0;
      }
      this.jump.land();
    }
  }

  /**
   * Take out whatever part of the horizontal velocity runs into a surface
   * whose contact normal is `normal` (ADR 0102) — the Character is blocked
   * there, so it is not moving into it, whatever the velocity model has been
   * accumulating. At full grip this is invisible: the next tick rebuilds
   * velocity from the wish anyway. On ice it is the difference between
   * leaning on a rail and crashing into it.
   */
  stopAgainst(normal: Vec3): void {
    const horizontal = Math.hypot(normal.x, normal.z);
    if (horizontal === 0) return;
    const nx = normal.x / horizontal;
    const nz = normal.z / horizontal;
    const into = -(this.velocity.x * nx + this.velocity.z * nz);
    if (into <= 0) return;
    this.velocity.x += nx * into;
    this.velocity.z += nz * into;
  }

  /** Queue the kinematic move: this Character's own, plus whatever carries it. */
  commitMovement(corrected: Vec3): void {
    const carried = this.sweepRide();

    const at = this.capsule.body.translation();
    this.capsule.body.setNextKinematicTranslation({
      x: at.x + corrected.x + carried.x,
      y: at.y + corrected.y + carried.y,
      z: at.z + corrected.z + carried.z,
    });
    // No world.step() here — the caller (RapierSimulation) steps once for
    // every Character's queued movement (ticket 02); the single-Character
    // `tick()` convenience steps right after calling this.
  }

  /**
   * Carry this Character by this tick's Ride (ADR 0061): a second sweep from
   * the same start as its own movement, ignoring the carrier's colliders so
   * riding never collides with what it rides, while anything else (a wall, a
   * low ceiling) still blocks. Snap-to-ground is off for it: with the
   * carrier ignored it would otherwise reach for whatever floor lies below.
   * Its own collisions resolve nothing — being carried into a wall is no
   * crash of this Character's making. Returns the carried movement.
   */
  private sweepRide(): Vec3 {
    const ride = this.ride;
    if (!ride) return vec3();
    this.capsule.controller.disableSnapToGround();
    this.capsule.controller.computeColliderMovement(
      this.capsule.collider,
      ride.displacement,
      undefined,
      CHARACTER_GROUPS,
      (collider) => !ride.ignoreColliders.has(collider.handle),
    );
    this.capsule.controller.enableSnapToGround(GROUND_SNAP_DISTANCE);
    const movement = this.capsule.controller.computedMovement();
    const carried = vec3(movement.x, movement.y, movement.z);
    this.rideVelocity = scaleVec3(carried, 1 / TICK_DT);
    return carried;
  }

  /** Knocked down while riding, or in the air after leaving a Ride: the body keeps what it was being carried at (ADR 0061). */
  carriedVelocity(): Vec3 {
    return this.rideVelocity ?? this.keptRideVelocity ?? vec3();
  }

  /** Everything this Character was doing with its own legs, stopped — a knockdown, a Respawn, a correction. */
  reset(): void {
    this.velocity = vec3();
    this.knockback = vec3();
    this.jump.reset();
    this.dash.reset();
    this.dashSpeed = 0;
    this.pendingLaunchVelocity = undefined;
    this.airbornePeakFallSpeed = 0;
    this.rideVelocity = undefined;
    this.keptRideVelocity = undefined;
    this.pendingPush = undefined;
  }

  /** The movement half of a reconciliation (ticket 05, ADR 0013) — see `CharacterController.reconcileTo`. */
  reconcile(base: ReconcileBase): void {
    this.velocity = { ...base.velocity };
    this.grounded = base.grounded;
    // Same fallback for a Ride's kept momentum (ADR 0061): not replicated, so
    // the replay starts without it rather than with a stale one.
    this.rideVelocity = undefined;
    this.keptRideVelocity = undefined;
    this.pendingPush = undefined;
    // Re-derived fresh from `base.velocity` starting the very next tick's
    // own gravity-integration line — a reconciliation landing mid-fall onto
    // a bounce Surface loses whatever higher peak a mispredicting client saw
    // before the correction, the same one-off precision trade every other
    // Surface-adjacent field here already accepts.
    this.airbornePeakFallSpeed = 0;
    this.dash.restoreCooldownMs(base.dashCooldownMs, base.dashing);
    // A launch pad has no decay curve to restore (M3.7 ticket 02) — its
    // whole effect already lives in `base.velocity` above. Only the pending
    // one-shot write itself needs clearing: never replayed here, only ever
    // re-derived fresh by `RapierSimulation`'s rising-edge check against the
    // replayed position.
    this.pendingLaunchVelocity = undefined;
    this.jump.reset(); // stale coyote/hold bookkeeping would let replay grant a jump the server won't
  }
}

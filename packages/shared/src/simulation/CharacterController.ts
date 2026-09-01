import RAPIER from "@dimforge/rapier3d-compat";
import { lengthVec3, lerpVec3, normalizeVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  DASH_SPEED,
  DASH_WALL_IMPACT_MAGNITUDE,
  DASH_WALL_LIFT_RATIO,
  DASH_WALL_MIN_SPEED_RATIO,
  GETUP_CAPSULE_LIFT,
  GETUP_TICKS,
  GRAVITY_Y,
  GROUND_STICK_SPEED,
  RAGDOLL_SETTLE_SPEED,
  RESPAWN_FLOP_IMPULSE,
  TICK_DT,
  WALK_SPEED,
  WALL_NORMAL_MAX_Y,
} from "../tuning.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { CharacterStateMachine, type CharacterMotionState } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS } from "./collisionGroups.js";
import { DashController, JumpController } from "./movementVerbs.js";
import { Ragdoll } from "./Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";

const isDown = (state: CharacterMotionState): boolean => state === "Ragdoll" || state === "GettingUp";

interface PendingImpact {
  magnitude: number;
  impulse: Vec3;
}

interface PendingRespawn {
  point: Vec3;
  fallCount: number;
}

/**
 * Reported once per Obstacle/Prop the Character's movement collides with this
 * tick (ticket 06) — `RapierSimulation` looks `colliderHandle` up against its
 * own Spinners/Props and decides what the contact does; `CharacterController`
 * only knows *that* something was hit and *where*.
 */
export type CollisionListener = (
  colliderHandle: number,
  point: Vec3,
  characterVelocity: Vec3,
) => void;

/**
 * Knockback for a Dash blocked by a near-vertical surface: bounces back along
 * `normal` (the obstacle's outward contact normal, which already points away
 * from the surface toward the Character — no sign flip needed), plus a small
 * lift, always at {@link DASH_WALL_IMPACT_MAGNITUDE}.
 */
export const dashWallKnockback = (normal: Vec3): Vec3 => {
  const away = normalizeVec3(vec3(normal.x, DASH_WALL_LIFT_RATIO, normal.z));
  return scaleVec3(away, DASH_WALL_IMPACT_MAGNITUDE);
};

/** What {@link CharacterController.snapshot} reports back to `RapierSimulation` each tick. */
export interface CharacterState {
  /** The point the camera follows: capsule centre while upright, pelvis while ragdolling. */
  position: Vec3;
  grounded: boolean;
  motionState: CharacterMotionState;
  teleported: boolean;
  dashCooldownMs: number;
  /** Whether a Dash burst is currently playing out (for the renderer to speed up the movement animation). */
  dashing: boolean;
  /** Current horizontal speed (units/s) contributed by an active Dash burst; 0 when not dashing. Drives the speed-lines effect directly — no noisy derivation from position needed. */
  dashSpeed: number;
  bones: BoneSnapshot[];
}

/**
 * The Character concern extracted from `RapierSimulation` (ticket 05b): the
 * kinematic capsule, jump/dash, the `CharacterStateMachine` and the `Ragdoll`,
 * plus every Controlled ↔ Ragdoll ↔ GettingUp handoff. `RapierSimulation` still
 * owns the Rapier `World`, statics, checkpoints and Fall detection, and drives
 * this class's {@link tick} once per simulation tick — Fall itself is reported
 * in via {@link fall} rather than detected here, since it depends on the
 * kill-plane the sim owns.
 */
export class CharacterController {
  private readonly world: RAPIER.World;
  private readonly rapierController: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly ragdoll: Ragdoll;
  private readonly onCollision: CollisionListener | undefined;

  private tickCount = 0;
  /** Capsule velocity (units/s): `x`/`z` set fresh each Controlled tick, `y` integrated. */
  private velocity: Vec3 = vec3();
  private grounded = false;
  private teleportedThisTick = false;
  /** Set by {@link beginTick}, read by {@link endTick} once the shared `world.step()` has run. */
  private tickingRagdoll = false;

  private readonly machine = new CharacterStateMachine();
  private readonly jump = new JumpController();
  private readonly dash = new DashController();
  /**
   * Current horizontal speed (units/s) contributed by an active Dash burst —
   * the exact `dashEnvelope` curve already driving the physics, exposed
   * directly so the renderer's speed-lines effect doesn't have to derive it
   * (noisily) from position deltas. 0 whenever no burst is active.
   */
  private dashSpeed = 0;
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;

  /** Strongest Impact queued since the last tick, with the shove to apply if it ragdolls. */
  private pendingImpact: PendingImpact | null = null;
  /** Set by {@link fall}; consumed at the top of the next {@link tick}. */
  private pendingRespawn: PendingRespawn | null = null;

  private getupBones: readonly BoneSnapshot[] = [];
  private getupStartTick = 0;
  private getupStartRoot: Vec3 = vec3();

  constructor(world: RAPIER.World, spawn: Vec3, onCollision?: CollisionListener) {
    this.world = world;
    this.onCollision = onCollision;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS).setCollisionGroups(
        CHARACTER_GROUPS,
      ),
      this.body,
    );

    this.rapierController = world.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
    // Snap-to-ground and autostep are deliberately OFF: snap-to-ground stalls the
    // controller near platform edges, and autostep hitches during fast movement
    // (dash). M1 platforms are same-height or step down, so neither is needed;
    // GROUND_STICK_SPEED keeps ground contact.
    this.rapierController.setApplyImpulsesToDynamicBodies(false);

    this.ragdoll = new Ragdoll(world);
  }

  /** The camera-follow point: capsule centre while upright, ragdoll pelvis while down. */
  get position(): Vec3 {
    const t = this.body.translation();
    return vec3(t.x, t.y, t.z);
  }

  /** Whether a Fall-triggered respawn is queued for the top of the next tick. */
  get hasPendingRespawn(): boolean {
    return this.pendingRespawn !== null;
  }

  /**
   * Deliver an Impact to the Character (a shove from the Spinner, a wall dash,
   * another player…). The magnitude decides Stagger vs Ragdoll (ADR 0006); the
   * vector is the shove applied to the ragdoll. If the Character is already down,
   * the shove flails it right away.
   */
  applyImpact(impulse: Vec3): void {
    const magnitude = lengthVec3(impulse);
    this.machine.impact(magnitude);
    if (!this.pendingImpact || magnitude > this.pendingImpact.magnitude) {
      this.pendingImpact = { magnitude, impulse: { ...impulse } };
    }
    if (this.machine.state === "Ragdoll") this.ragdoll.applyImpulse(impulse);
  }

  /** Queue a Fall respawn at `point`, applied at the top of the next {@link tick}. */
  fall(point: Vec3, fallCount: number): void {
    this.resetMovementControllers();
    this.machine.forceRagdoll();
    this.pendingRespawn = { point: { ...point }, fallCount };
  }

  /**
   * Advance one tick, split around the shared `world.step()` (ticket 02) so
   * `RapierSimulation` can drive several Characters through a single step:
   * {@link beginTick} queues this Character's movement/state-machine work,
   * the caller steps the (one, shared) world, then {@link endTick} reads the
   * result back. Single-Character callers (tests) may call both back to back
   * with a `world.step()` between them, exactly like this used to be one method.
   */
  beginTick(input: SimInputs): void {
    this.teleportedThisTick = false;

    const jumpPressed = input.jumpHeld && !this.jumpHeldLastTick;
    const dashPressed = input.dashHeld && !this.dashHeldLastTick;
    this.jumpHeldLastTick = input.jumpHeld;
    this.dashHeldLastTick = input.dashHeld;

    // Order matters: read prevState before the machine ticks; compute `settled`
    // from last tick's physics before this tick's world.step().
    const prevState = this.machine.state;
    const settled = this.ragdoll.isActive && this.ragdoll.maxSpeed() < RAGDOLL_SETTLE_SPEED;
    const state = this.machine.tick(settled);

    if (this.pendingRespawn) {
      this.respawnAtCheckpoint(this.pendingRespawn);
    } else if (state === "Ragdoll" && prevState !== "Ragdoll") {
      this.beginRagdoll();
    }
    if (prevState === "Ragdoll" && state === "GettingUp") this.beginGettingUp();
    if (prevState === "GettingUp" && state === "Controlled") this.getupBones = [];

    this.tickingRagdoll = state === "Ragdoll";
    if (!this.tickingRagdoll) {
      this.beginCapsuleTick(input, jumpPressed, dashPressed);
    }
  }

  /** The other half of {@link beginTick}, run after the shared `world.step()`. */
  endTick(): void {
    if (this.tickingRagdoll) {
      this.body.setTranslation(this.ragdoll.rootPosition(), false); // camera continuity
      this.grounded = false;
    }
    this.tickCount += 1;
  }

  /** Single-Character convenience: {@link beginTick}, step this Character's own world, {@link endTick}. */
  tick(input: SimInputs): void {
    this.beginTick(input);
    this.world.step();
    this.endTick();
  }

  /** Controlled / Stagger / GettingUp: queue the kinematic capsule's movement, input scaled by the state. */
  private beginCapsuleTick(input: SimInputs, jumpPressed: boolean, dashPressed: boolean): void {
    // Stagger dampens *all* movement input — walk, jump and dash — not just walk.
    const fullControl = this.machine.inputScale >= 1;
    const move = scaleVec3(input.moveDirection, this.machine.inputScale);

    const takeoff = this.jump.beginTick(this.grounded, fullControl && jumpPressed);
    if (takeoff !== null) this.velocity.y = takeoff;
    const gravityScale = this.jump.gravityScale(fullControl && input.jumpHeld, this.velocity.y);
    this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT;

    const walk = scaleVec3(move, WALK_SPEED);
    // Dash only starts while grounded (a walking burst, not an air dash); an
    // already-active burst keeps running if it carries the Character off an edge.
    const dashBurst = this.dash.beginTick(move, fullControl && dashPressed && this.grounded);
    this.dashSpeed = lengthVec3(dashBurst);
    this.velocity.x = walk.x + dashBurst.x;
    this.velocity.z = walk.z + dashBurst.z;

    this.rapierController.computeColliderMovement(this.collider, scaleVec3(this.velocity, TICK_DT));
    const corrected = this.rapierController.computedMovement();
    this.grounded = this.rapierController.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -GROUND_STICK_SPEED;
      this.jump.land();
    }

    this.resolveCollisions(lengthVec3(dashBurst));

    const at = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: at.x + corrected.x,
      y: at.y + corrected.y,
      z: at.z + corrected.z,
    });
    // No world.step() here — the caller (RapierSimulation) steps once for
    // every Character's queued movement (ticket 02); the single-Character
    // `tick()` convenience above steps right after calling this.
  }

  /**
   * Walk this tick's `computeColliderMovement` collisions (ticket 06): a Dash
   * burst moving at or above {@link DASH_WALL_MIN_SPEED_RATIO} of full speed,
   * blocked by a near-vertical surface, knocks the Character down (wall or
   * Spinner or Prop — whatever it hit) — a slow build-up or late-release hit
   * is just a blocked walk. Every collision is also forwarded to
   * {@link onCollision} so `RapierSimulation` can resolve Obstacle/Prop-
   * specific reactions (Spinner Knockback, a shoved Prop).
   */
  private resolveCollisions(dashSpeed: number): void {
    const dashingFastEnough = dashSpeed >= DASH_SPEED * DASH_WALL_MIN_SPEED_RATIO;
    const count = this.rapierController.numComputedCollisions();
    for (let i = 0; i < count; i += 1) {
      const collision = this.rapierController.computedCollision(i);
      if (!collision) continue;

      if (dashingFastEnough && Math.abs(collision.normal1.y) < WALL_NORMAL_MAX_Y) {
        this.applyImpact(dashWallKnockback(vec3(collision.normal1.x, collision.normal1.y, collision.normal1.z)));
      }

      if (this.onCollision && collision.collider) {
        const point = vec3(collision.witness1.x, collision.witness1.y, collision.witness1.z);
        this.onCollision(collision.collider.handle, point, { ...this.velocity });
      }
    }
  }

  private beginRagdoll(): void {
    const at = this.body.translation();
    this.collider.setEnabled(false);
    this.resetMovementControllers();
    this.ragdoll.activate(vec3(at.x, at.y, at.z), { ...this.velocity }, this.takeImpactImpulse());
  }

  private beginGettingUp(): void {
    this.getupBones = this.ragdoll.readBones();
    this.getupStartTick = this.tickCount + 1; // this tick's snapshot is t = 0
    this.getupStartRoot = this.ragdoll.rootPosition();
    this.ragdoll.deactivate();
    this.pendingImpact = null;
    this.body.setTranslation(
      { x: this.getupStartRoot.x, y: this.getupStartRoot.y + GETUP_CAPSULE_LIFT, z: this.getupStartRoot.z },
      false,
    );
    this.collider.setEnabled(true);
    this.velocity = vec3();
  }

  private respawnAtCheckpoint(respawn: PendingRespawn): void {
    this.pendingRespawn = null;
    this.teleportedThisTick = true;
    this.getupBones = [];
    this.pendingImpact = null;
    this.collider.setEnabled(false);
    this.body.setTranslation({ ...respawn.point }, true);
    // A gentle, varied flop onto the Checkpoint — enough not to land upright, not
    // enough to launch the ragdoll off a small platform. Varied by fallCount so
    // repeated Falls don't look identical.
    this.ragdoll.activate({ ...respawn.point }, vec3(0, -1, 0), {
      x: Math.sin(respawn.fallCount * 1.7) * RESPAWN_FLOP_IMPULSE,
      y: 0.5,
      z: Math.cos(respawn.fallCount * 2.3) * RESPAWN_FLOP_IMPULSE,
    });
  }

  /** The queued Impact shove, consumed. Zero if none. */
  private takeImpactImpulse(): Vec3 {
    const impulse = this.pendingImpact?.impulse ?? vec3();
    this.pendingImpact = null;
    return impulse;
  }

  private resetMovementControllers(): void {
    this.velocity = vec3();
    this.jump.reset();
    this.dash.reset();
    this.dashSpeed = 0;
  }

  snapshot(): CharacterState {
    const state = this.machine.state;
    const t = this.body.translation();
    const capsuleCentre = vec3(t.x, t.y, t.z);

    let position = capsuleCentre;
    let bones: BoneSnapshot[] = [];
    if (state === "Ragdoll") {
      position = this.ragdoll.rootPosition();
      bones = this.ragdoll.readBones();
    } else if (state === "GettingUp") {
      const elapsed = this.tickCount - this.getupStartTick;
      const getupT = Math.min(1, Math.max(0, elapsed / GETUP_TICKS));
      // position rises smoothly from the settled pelvis to the standing capsule,
      // so there is no jump at the Ragdoll → GettingUp boundary
      position = lerpVec3(this.getupStartRoot, capsuleCentre, getupT);
      bones = blendGettingUpBones(this.getupBones, capsuleCentre, elapsed);
    }

    return {
      position,
      grounded: this.grounded,
      motionState: state,
      teleported: this.teleportedThisTick,
      dashCooldownMs: this.dash.cooldownMs,
      dashing: this.dash.isActive,
      dashSpeed: this.dashSpeed,
      bones,
    };
  }

  /**
   * Ticket 03's minimal placeholder correction for a locally predicted
   * Character: force it into Ragdoll to match the server when the server
   * reports a Ragdoll this Character had no way to predict — most importantly
   * a Bump from another player (ticket 04). This is the *only* correction
   * ticket 03 makes.
   *
   * Only a `Ragdoll` report forces, never `GettingUp`: a lone local ragdoll
   * body can settle faster than the server's (1 body here vs N there), or
   * the intervening `Ragdoll` snapshots can be dropped, leaving the server in
   * `GettingUp` while local prediction is already back in `Controlled` —
   * forcing there would restart a whole fresh Ragdoll + get-up cycle and
   * re-collapse a player the server already has upright. Missing the tail of
   * a knockdown by a few ticks is the lesser evil for a placeholder; ticket
   * 05's input replay closes that gap properly.
   *
   * It deliberately does *not* touch continuous position. Comparing "my
   * predicted position now" against "the server's latest snapshot" conflates
   * real misprediction with plain network latency: that snapshot reflects a
   * state from roughly one round-trip ago, so during ordinary movement the
   * gap is always ~speed × RTT — at Dash speed even a 60–100 ms RTT exceeds
   * any reasonable snap threshold on essentially every tick, producing a
   * constant backward tug that reads as jitter, not smoothing. Correcting
   * position needs the server's report lined up against what *this client*
   * predicted for that same tick (buffered input replay) — that is ticket
   * 05's job (ADR 0013), not this one.
   */
  reconcile(server: Pick<CharacterSnapshot, "motionState">): void {
    if (server.motionState === "Ragdoll" && !isDown(this.machine.state)) {
      this.machine.forceRagdoll();
    }
    // Otherwise: trust local prediction. Given identical inputs and the same
    // deterministic shared step (ADR 0003, ADR 0005), local and server stay
    // close modulo that fixed latency offset, with no unbounded drift.
  }

  /** Remove this Character's capsule body, character controller and ragdoll bones from the world (ticket 01: `removeCharacter`). */
  dispose(): void {
    this.ragdoll.dispose();
    this.world.removeCharacterController(this.rapierController);
    this.world.removeRigidBody(this.body);
  }
}

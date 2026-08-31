import RAPIER from "@dimforge/rapier3d-compat";
import { lengthVec3, lerpVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  GETUP_CAPSULE_LIFT,
  GETUP_TICKS,
  GRAVITY_Y,
  GROUND_STICK_SPEED,
  RAGDOLL_SETTLE_SPEED,
  RESPAWN_FLOP_IMPULSE,
  TICK_DT,
  WALK_SPEED,
} from "../tuning.js";
import { CharacterStateMachine, type CharacterMotionState } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS } from "./collisionGroups.js";
import { DashController, JumpController } from "./movementVerbs.js";
import { Ragdoll } from "./Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";

interface PendingImpact {
  magnitude: number;
  impulse: Vec3;
}

interface PendingRespawn {
  point: Vec3;
  fallCount: number;
}

/** What {@link CharacterController.snapshot} reports back to `RapierSimulation` each tick. */
export interface CharacterState {
  /** The point the camera follows: capsule centre while upright, pelvis while ragdolling. */
  position: Vec3;
  grounded: boolean;
  motionState: CharacterMotionState;
  teleported: boolean;
  dashCooldownMs: number;
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

  private tickCount = 0;
  /** Capsule velocity (units/s): `x`/`z` set fresh each Controlled tick, `y` integrated. */
  private velocity: Vec3 = vec3();
  private grounded = false;
  private teleportedThisTick = false;

  private readonly machine = new CharacterStateMachine();
  private readonly jump = new JumpController();
  private readonly dash = new DashController();
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;

  /** Strongest Impact queued since the last tick, with the shove to apply if it ragdolls. */
  private pendingImpact: PendingImpact | null = null;
  /** Set by {@link fall}; consumed at the top of the next {@link tick}. */
  private pendingRespawn: PendingRespawn | null = null;

  private getupBones: readonly BoneSnapshot[] = [];
  private getupStartTick = 0;
  private getupStartRoot: Vec3 = vec3();

  constructor(world: RAPIER.World, spawn: Vec3) {
    this.world = world;

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

  tick(input: SimInputs): void {
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

    if (state === "Ragdoll") {
      this.world.step();
      this.body.setTranslation(this.ragdoll.rootPosition(), false); // camera continuity
      this.grounded = false;
    } else {
      this.simulateCapsule(input, jumpPressed, dashPressed);
    }

    this.tickCount += 1;
  }

  /** Controlled / Stagger / GettingUp: the kinematic capsule drives, input scaled by the state. */
  private simulateCapsule(input: SimInputs, jumpPressed: boolean, dashPressed: boolean): void {
    // Stagger dampens *all* movement input — walk, jump and dash — not just walk.
    const fullControl = this.machine.inputScale >= 1;
    const move = scaleVec3(input.moveDirection, this.machine.inputScale);

    const takeoff = this.jump.beginTick(this.grounded, fullControl && jumpPressed);
    if (takeoff !== null) this.velocity.y = takeoff;
    const gravityScale = this.jump.gravityScale(fullControl && input.jumpHeld, this.velocity.y);
    this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT;

    const walk = scaleVec3(move, WALK_SPEED);
    const dashBurst = this.dash.beginTick(move, fullControl && dashPressed);
    this.velocity.x = walk.x + dashBurst.x;
    this.velocity.z = walk.z + dashBurst.z;

    this.rapierController.computeColliderMovement(this.collider, scaleVec3(this.velocity, TICK_DT));
    const corrected = this.rapierController.computedMovement();
    this.grounded = this.rapierController.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -GROUND_STICK_SPEED;
      this.jump.land();
    }

    const at = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: at.x + corrected.x,
      y: at.y + corrected.y,
      z: at.z + corrected.z,
    });
    this.world.step();
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
      bones,
    };
  }
}

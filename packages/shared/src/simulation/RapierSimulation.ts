import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js";
import { IDENTITY_QUAT, slerpQuat } from "../math/quat.js";
import { addVec3, lengthVec3, lerpVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  DEFAULT_KILL_PLANE_Y,
  GETUP_TICKS,
  GRAVITY_Y,
  GROUND_STICK_SPEED,
  RAGDOLL_SETTLE_SPEED,
  TICK_DT,
  WALK_SPEED,
} from "../tuning.js";
import type { Checkpoint } from "./Checkpoint.js";
import { CharacterStateMachine } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS, STATIC_GROUPS } from "./collisionGroups.js";
import { DashController, JumpController } from "./movementVerbs.js";
import { Ragdoll, type BoneSnapshot } from "./Ragdoll.js";
import { RAGDOLL_BONES } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";

export interface SimulationConfig {
  /** Where the Character starts (capsule centre). Also its first respawn point. */
  spawn?: Vec3;
  /** Static collision geometry. Defaults to a single large ground box. */
  statics?: Box[];
  /** Checkpoints the Character can walk through to move its respawn point. */
  checkpoints?: Checkpoint[];
  /** Height below which the Character has Fallen out of the playground. */
  killPlaneY?: number;
}

const DEFAULT_SPAWN = vec3(0, 2, 0);
const DEFAULT_GROUND: Box = {
  center: vec3(0, -0.5, 0),
  halfExtents: vec3(30, 0.5, 30),
};

/** Lift applied to the capsule when GettingUp begins, above the settled pelvis. */
const GETUP_CAPSULE_LIFT = 0.7;

const cloneBox = (box: Box): Box => ({
  center: { ...box.center },
  halfExtents: { ...box.halfExtents },
});

let initPromise: Promise<void> | null = null;

/** Load the Rapier WASM module. Idempotent; await once before constructing a simulation. */
export const initPhysics = (): Promise<void> => {
  initPromise ??= RAPIER.init();
  return initPromise;
};

/**
 * The authoritative simulation for M1: a Rapier world with one kinematic-capsule
 * Character, an articulated ragdoll it hands off to on Impact/Fall, Fall
 * detection and Checkpoint respawns. Owns the Rapier `World` and the entity ↔
 * body mapping; `SimState` stays a plain POJO (ADR 0009).
 *
 * `initPhysics()` must have resolved before constructing this.
 */
export class RapierSimulation implements FixedSimulation<SimInputs, SimState> {
  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly ragdoll: Ragdoll;
  private readonly statics: Box[];
  private readonly checkpoints: Checkpoint[];
  private readonly killPlaneY: number;
  private readonly spawn: Vec3;

  private tickCount = 0;
  private verticalVelocity = 0;
  private horizontalVelocity: Vec3 = vec3();
  private grounded = false;

  private respawnPoint: Vec3;
  private checkpointIndex: number | null = null;
  private fallCount = 0;
  private pendingRespawn = false;
  private teleportedThisTick = false;

  private readonly machine = new CharacterStateMachine();
  private readonly jump = new JumpController();
  private readonly dash = new DashController();
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;

  private lastImpactImpulse: Vec3 = vec3();
  private getupBones: BoneSnapshot[] | null = null;
  private getupStartTick = 0;

  constructor(config: SimulationConfig = {}) {
    this.spawn = config.spawn ?? DEFAULT_SPAWN;
    this.respawnPoint = { ...this.spawn };
    this.statics = config.statics ?? [DEFAULT_GROUND];
    this.checkpoints = config.checkpoints ?? [];
    this.killPlaneY = config.killPlaneY ?? DEFAULT_KILL_PLANE_Y;

    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });

    for (const box of this.statics) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z)
          .setCollisionGroups(STATIC_GROUPS),
        this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(box.center.x, box.center.y, box.center.z),
        ),
      );
    }

    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.spawn.x,
        this.spawn.y,
        this.spawn.z,
      ),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS).setCollisionGroups(
        CHARACTER_GROUPS,
      ),
      this.body,
    );

    this.controller = this.world.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
    // Snap-to-ground and autostep are deliberately OFF: snap-to-ground stalls the
    // controller near platform edges, and autostep hitches during fast movement
    // (dash). M1 platforms are same-height or step down, so neither is needed;
    // GROUND_STICK_SPEED keeps ground contact.
    this.controller.setApplyImpulsesToDynamicBodies(false);

    this.ragdoll = new Ragdoll(this.world);
  }

  /**
   * Deliver an Impact to the Character (a shove from the Spinner, a wall dash,
   * another player…). The magnitude decides Stagger vs Ragdoll (ADR 0006); the
   * vector is the shove applied to the ragdoll if it goes down.
   */
  applyImpact(impulse: Vec3): void {
    this.lastImpactImpulse = { ...impulse };
    this.machine.impact(lengthVec3(impulse));
  }

  tick(input: SimInputs): void {
    this.teleportedThisTick = false;

    const jumpPressed = input.jumpHeld && !this.jumpHeldLastTick;
    const dashPressed = input.dashHeld && !this.dashHeldLastTick;
    this.jumpHeldLastTick = input.jumpHeld;
    this.dashHeldLastTick = input.dashHeld;

    const prevState = this.machine.state;
    const settled = this.ragdoll.isActive && this.ragdoll.maxSpeed() < RAGDOLL_SETTLE_SPEED;
    const state = this.machine.tick(settled);

    if (this.pendingRespawn) {
      this.respawnAtCheckpoint();
    } else if (state === "Ragdoll" && prevState !== "Ragdoll") {
      this.beginRagdoll();
    }
    if (prevState === "Ragdoll" && state === "GettingUp") this.beginGettingUp();
    if (prevState === "GettingUp" && state === "Controlled") this.getupBones = null;

    if (state === "Ragdoll") {
      this.world.step();
      this.followRagdollWithCapsule();
    } else {
      this.simulateCapsule(input, jumpPressed, dashPressed);
    }

    this.tickCount += 1;
    this.updateCheckpoint();
    this.detectFall();
  }

  /** Controlled / Stagger / GettingUp: the kinematic capsule drives, input scaled by the state. */
  private simulateCapsule(input: SimInputs, jumpPressed: boolean, dashPressed: boolean): void {
    const inputScale = this.machine.inputScale;
    const move = scaleVec3(input.moveDirection, inputScale);

    const takeoff = inputScale > 0 ? this.jump.beginTick(this.grounded, jumpPressed) : null;
    if (takeoff !== null) this.verticalVelocity = takeoff;
    const gravityScale =
      inputScale > 0 ? this.jump.gravityScale(input.jumpHeld, this.verticalVelocity) : 1;
    this.verticalVelocity += GRAVITY_Y * gravityScale * TICK_DT;

    const walk = scaleVec3(move, WALK_SPEED);
    const dashBurst = inputScale > 0 ? this.dash.beginTick(move, dashPressed) : this.dash.beginTick(vec3(), false);
    this.horizontalVelocity = addVec3(walk, dashBurst);

    const desired = {
      x: this.horizontalVelocity.x * TICK_DT,
      y: this.verticalVelocity * TICK_DT,
      z: this.horizontalVelocity.z * TICK_DT,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) {
      this.verticalVelocity = -GROUND_STICK_SPEED;
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

  private followRagdollWithCapsule(): void {
    const root = this.ragdoll.rootPosition();
    this.body.setTranslation(root, false);
    this.grounded = false;
  }

  private beginRagdoll(): void {
    const at = this.body.translation();
    this.collider.setEnabled(false);
    this.jump.reset();
    this.dash.reset();
    this.ragdoll.activate(
      vec3(at.x, at.y, at.z),
      vec3(this.horizontalVelocity.x, this.verticalVelocity, this.horizontalVelocity.z),
      this.lastImpactImpulse,
    );
    this.lastImpactImpulse = vec3();
  }

  private beginGettingUp(): void {
    this.getupBones = this.ragdoll.readBones();
    this.getupStartTick = this.tickCount;
    const root = this.ragdoll.rootPosition();
    this.ragdoll.deactivate();
    this.body.setTranslation({ x: root.x, y: root.y + GETUP_CAPSULE_LIFT, z: root.z }, false);
    this.collider.setEnabled(true);
    this.verticalVelocity = 0;
    this.horizontalVelocity = vec3();
  }

  private respawnAtCheckpoint(): void {
    this.pendingRespawn = false;
    this.teleportedThisTick = true;
    this.getupBones = null;
    this.collider.setEnabled(false);
    this.body.setTranslation({ ...this.respawnPoint }, true);
    // A gentle, varied flop onto the Checkpoint — enough not to land upright,
    // not enough to launch the ragdoll off a small platform.
    this.ragdoll.activate(
      { ...this.respawnPoint },
      vec3(0, -1, 0),
      vec3(Math.sin(this.fallCount * 1.7) * 1.5, 0.5, Math.cos(this.fallCount * 2.3) * 1.5),
    );
  }

  private updateCheckpoint(): void {
    const reached = this.checkpointIndex ?? -1;
    const p = this.body.translation();
    for (let i = reached + 1; i < this.checkpoints.length; i += 1) {
      if (pointInBox(p, this.checkpoints[i]!.volume)) {
        this.checkpointIndex = i;
        this.respawnPoint = { ...this.checkpoints[i]!.respawn };
      }
    }
  }

  private detectFall(): void {
    if (this.pendingRespawn || this.body.translation().y >= this.killPlaneY) return;

    this.fallCount += 1;
    this.verticalVelocity = 0;
    this.horizontalVelocity = vec3();
    this.jump.reset();
    this.dash.reset();
    this.machine.forceRagdoll();
    this.pendingRespawn = true;
  }

  snapshot(): SimState {
    const state = this.machine.state;
    const t = this.body.translation();

    let position: Vec3;
    let bones: BoneSnapshot[];
    if (state === "Ragdoll") {
      position = this.ragdoll.rootPosition();
      bones = this.ragdoll.readBones();
    } else if (state === "GettingUp") {
      position = vec3(t.x, t.y, t.z);
      bones = this.blendedGettingUpBones(vec3(t.x, t.y, t.z));
    } else {
      position = vec3(t.x, t.y, t.z);
      bones = [];
    }

    return {
      tick: this.tickCount,
      character: characterSnapshot({
        position,
        grounded: this.grounded,
        motionState: state,
        checkpointIndex: this.checkpointIndex,
        fallCount: this.fallCount,
        respawning: state === "Ragdoll" || state === "GettingUp",
        teleported: this.teleportedThisTick,
        dashCooldownMs: this.dash.cooldownMs,
        bones,
      }),
    };
  }

  /** Bones blended from the pose captured when GettingUp began toward the standing rest pose. */
  private blendedGettingUpBones(capsuleCenter: Vec3): BoneSnapshot[] {
    const from = this.getupBones ?? [];
    const t = Math.min(1, (this.tickCount - this.getupStartTick) / GETUP_TICKS);
    return RAGDOLL_BONES.map((spec, i) => {
      const rest: BoneSnapshot = {
        position: addVec3(capsuleCenter, spec.restCenter),
        rotation: IDENTITY_QUAT,
      };
      const start = from[i] ?? rest;
      return {
        position: lerpVec3(start.position, rest.position, t),
        rotation: slerpQuat(start.rotation, rest.rotation, t),
      };
    });
  }

  /** The resolved static geometry (including the default ground), for the renderer. */
  getStatics(): Box[] {
    return this.statics.map(cloneBox);
  }

  /** The configured checkpoints, for the renderer. */
  getCheckpoints(): Checkpoint[] {
    return this.checkpoints.map((cp) => ({
      respawn: { ...cp.respawn },
      volume: cloneBox(cp.volume),
    }));
  }
}

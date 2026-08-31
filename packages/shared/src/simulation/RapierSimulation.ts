import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js";
import { lengthVec3, lerpVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  DEFAULT_KILL_PLANE_Y,
  GETUP_CAPSULE_LIFT,
  GETUP_TICKS,
  GRAVITY_Y,
  GROUND_STICK_SPEED,
  RAGDOLL_SETTLE_SPEED,
  RESPAWN_FLOP_IMPULSE,
  TICK_DT,
  WALK_SPEED,
} from "../tuning.js";
import type { Checkpoint } from "./Checkpoint.js";
import { CharacterStateMachine } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS, STATIC_GROUPS } from "./collisionGroups.js";
import { DashController, JumpController } from "./movementVerbs.js";
import { Ragdoll } from "./Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "./ragdollSkeleton.js";
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

const cloneBox = (box: Box): Box => ({
  center: { ...box.center },
  halfExtents: { ...box.halfExtents },
});

interface PendingImpact {
  magnitude: number;
  impulse: Vec3;
}

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

  private tickCount = 0;
  /** Capsule velocity (units/s): `x`/`z` set fresh each Controlled tick, `y` integrated. */
  private velocity: Vec3 = vec3();
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

  /** Strongest Impact queued since the last tick, with the shove to apply if it ragdolls. */
  private pendingImpact: PendingImpact | null = null;
  private getupBones: readonly BoneSnapshot[] = [];
  private getupStartTick = 0;
  private getupStartRoot: Vec3 = vec3();

  constructor(config: SimulationConfig = {}) {
    const spawn = config.spawn ?? DEFAULT_SPAWN;
    this.respawnPoint = { ...spawn };
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
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
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
      this.respawnAtCheckpoint();
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
    this.updateCheckpoint();
    this.detectFall();
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

    this.controller.computeColliderMovement(this.collider, scaleVec3(this.velocity, TICK_DT));
    const corrected = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
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

  private respawnAtCheckpoint(): void {
    this.pendingRespawn = false;
    this.teleportedThisTick = true;
    this.getupBones = [];
    this.pendingImpact = null;
    this.collider.setEnabled(false);
    this.body.setTranslation({ ...this.respawnPoint }, true);
    // A gentle, varied flop onto the Checkpoint — enough not to land upright, not
    // enough to launch the ragdoll off a small platform. Varied by fallCount so
    // repeated Falls don't look identical.
    this.ragdoll.activate({ ...this.respawnPoint }, vec3(0, -1, 0), {
      x: Math.sin(this.fallCount * 1.7) * RESPAWN_FLOP_IMPULSE,
      y: 0.5,
      z: Math.cos(this.fallCount * 2.3) * RESPAWN_FLOP_IMPULSE,
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
    this.resetMovementControllers();
    this.machine.forceRagdoll();
    this.pendingRespawn = true;
  }

  snapshot(): SimState {
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
      const t = Math.min(1, Math.max(0, elapsed / GETUP_TICKS));
      // position rises smoothly from the settled pelvis to the standing capsule,
      // so there is no jump at the Ragdoll → GettingUp boundary
      position = lerpVec3(this.getupStartRoot, capsuleCentre, t);
      bones = blendGettingUpBones(this.getupBones, capsuleCentre, elapsed);
    }

    return {
      tick: this.tickCount,
      character: characterSnapshot({
        position,
        grounded: this.grounded,
        motionState: state,
        checkpointIndex: this.checkpointIndex,
        fallCount: this.fallCount,
        teleported: this.teleportedThisTick,
        dashCooldownMs: this.dash.cooldownMs,
        bones,
      }),
    };
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

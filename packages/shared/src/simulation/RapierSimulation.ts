import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js";
import { addVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_AUTOSTEP_MAX_HEIGHT,
  CHARACTER_AUTOSTEP_MIN_WIDTH,
  CHARACTER_CONTROLLER_OFFSET,
  DEFAULT_KILL_PLANE_Y,
  GRAVITY_Y,
  GROUND_STICK_SPEED,
  RESPAWN_LOCKOUT_TICKS,
  TICK_DT,
  WALK_SPEED,
} from "../tuning.js";
import type { Checkpoint } from "./Checkpoint.js";
import { DashController, JumpController } from "./movementVerbs.js";
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

let initPromise: Promise<void> | null = null;

/** Load the Rapier WASM module. Idempotent; await once before constructing a simulation. */
export const initPhysics = (): Promise<void> => {
  initPromise ??= RAPIER.init();
  return initPromise;
};

/**
 * The authoritative simulation for M1: a Rapier world with one kinematic-capsule
 * Character, Fall detection and Checkpoint respawns. Owns the Rapier `World` and
 * the entity ↔ body mapping; `SimState` stays a plain POJO (ADR 0009).
 *
 * `initPhysics()` must have resolved before constructing this.
 */
export class RapierSimulation implements FixedSimulation<SimInputs, SimState> {
  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly statics: Box[];
  private readonly checkpoints: Checkpoint[];
  private readonly killPlaneY: number;
  private readonly spawn: Vec3;

  private tickCount = 0;
  private verticalVelocity = 0;
  private grounded = false;

  private respawnPoint: Vec3;
  private checkpointIndex: number | null = null;
  private fallCount = 0;
  private respawnLockTicks = 0;
  private respawning = false;
  private teleportedThisTick = false;

  private readonly jump = new JumpController();
  private readonly dash = new DashController();
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;

  constructor(config: SimulationConfig = {}) {
    this.spawn = config.spawn ?? DEFAULT_SPAWN;
    this.respawnPoint = { ...this.spawn };
    this.statics = config.statics ?? [DEFAULT_GROUND];
    this.checkpoints = config.checkpoints ?? [];
    this.killPlaneY = config.killPlaneY ?? DEFAULT_KILL_PLANE_Y;

    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });

    for (const box of this.statics) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        box.center.x,
        box.center.y,
        box.center.z,
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z),
        this.world.createRigidBody(bodyDesc),
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
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );

    this.controller = this.world.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
    // Snap-to-ground is deliberately OFF: it stalls the controller near platform
    // edges (the character stops ~2 units short of a ledge). M1 has no stairs to
    // need it; GROUND_STICK_SPEED keeps ground contact instead.
    this.controller.enableAutostep(
      CHARACTER_AUTOSTEP_MAX_HEIGHT,
      CHARACTER_AUTOSTEP_MIN_WIDTH,
      true,
    );
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  tick(input: SimInputs): void {
    this.teleportedThisTick = false;

    // Edge detection runs even during the lockout so a button held through the
    // freeze isn't seen as a fresh press on the first live tick.
    const jumpPressed = input.jumpHeld && !this.jumpHeldLastTick;
    const dashPressed = input.dashHeld && !this.dashHeldLastTick;
    this.jumpHeldLastTick = input.jumpHeld;
    this.dashHeldLastTick = input.dashHeld;

    const locked = this.respawnLockTicks > 0;
    this.respawning = locked;
    if (locked) this.respawnLockTicks -= 1;
    // During the lockout the Character is pinned at its Checkpoint: movement input
    // is dropped and no gravity accumulates. It is genuinely frozen.
    if (locked) {
      this.verticalVelocity = 0;
      this.grounded = true;
      this.body.setTranslation({ ...this.respawnPoint }, true);
      this.world.step();
      this.tickCount += 1;
      return;
    }

    const takeoff = this.jump.beginTick(this.grounded, jumpPressed);
    if (takeoff !== null) this.verticalVelocity = takeoff;
    const gravity = GRAVITY_Y * this.jump.gravityScale(input.jumpHeld, this.verticalVelocity);
    this.verticalVelocity += gravity * TICK_DT;

    const walk = scaleVec3(input.moveDirection, WALK_SPEED);
    const dashBurst = this.dash.beginTick(input.moveDirection, dashPressed);
    const horizontal = addVec3(walk, dashBurst);

    const desired = {
      x: horizontal.x * TICK_DT,
      y: this.verticalVelocity * TICK_DT,
      z: horizontal.z * TICK_DT,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.verticalVelocity < 0) {
      // Keep a slight downward bias, not a hard 0 — see GROUND_STICK_SPEED.
      this.verticalVelocity = -GROUND_STICK_SPEED;
      this.jump.land();
    }

    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    });

    this.world.step();
    this.tickCount += 1;

    this.updateCheckpoint();
    this.detectFall();
  }

  private updateCheckpoint(): void {
    const reached = this.checkpointIndex ?? -1;
    const p = this.body.translation();
    for (let i = reached + 1; i < this.checkpoints.length; i += 1) {
      // Only ever advance — walking back through an earlier Checkpoint must not
      // move the respawn point backward.
      if (pointInBox(p, this.checkpoints[i]!.volume)) {
        this.checkpointIndex = i;
        this.respawnPoint = { ...this.checkpoints[i]!.respawn };
      }
    }
  }

  private detectFall(): void {
    if (this.body.translation().y >= this.killPlaneY) return;

    this.fallCount += 1;
    this.verticalVelocity = 0;
    this.jump.reset();
    this.dash.reset();
    this.respawnLockTicks = RESPAWN_LOCKOUT_TICKS;
    this.teleportedThisTick = true;
    this.body.setTranslation({ ...this.respawnPoint }, true);
  }

  snapshot(): SimState {
    const t = this.body.translation();
    return {
      tick: this.tickCount,
      character: characterSnapshot({
        position: vec3(t.x, t.y, t.z),
        grounded: this.grounded,
        checkpointIndex: this.checkpointIndex,
        fallCount: this.fallCount,
        respawning: this.respawning,
        teleported: this.teleportedThisTick,
        dashCooldownMs: this.dash.cooldownMs,
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

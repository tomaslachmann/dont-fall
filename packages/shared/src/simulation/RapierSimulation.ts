import RAPIER from "@dimforge/rapier3d-compat";
import { scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import type { SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_AUTOSTEP_MAX_HEIGHT,
  CHARACTER_AUTOSTEP_MIN_WIDTH,
  CHARACTER_CONTROLLER_OFFSET,
  CHARACTER_SNAP_TO_GROUND,
  GRAVITY_Y,
  TICK_DT,
  WALK_SPEED,
} from "../tuning.js";
import type { SimInputs } from "./SimInputs.js";
import { worldToSnapshot } from "./snapshot.js";

/** An axis-aligned static box in the world. Plain data — the config never mentions Rapier. */
export interface StaticBox {
  center: Vec3;
  halfExtents: Vec3;
}

export interface SimulationConfig {
  /** Where the Character starts (capsule centre). */
  spawn?: Vec3;
  /** Static collision geometry. Defaults to a single large ground box. */
  statics?: StaticBox[];
}

const DEFAULT_SPAWN = vec3(0, 2, 0);
const DEFAULT_GROUND: StaticBox = {
  center: vec3(0, -0.5, 0),
  halfExtents: vec3(30, 0.5, 30),
};

let initPromise: Promise<void> | null = null;

/** Load the Rapier WASM module. Idempotent; await once before constructing a simulation. */
export const initPhysics = (): Promise<void> => {
  initPromise ??= RAPIER.init();
  return initPromise;
};

/**
 * The authoritative simulation for M1: a Rapier world with one kinematic-capsule
 * Character. Owns the Rapier `World` and the entity ↔ body mapping; `SimState`
 * stays a plain POJO (ADR 0009).
 *
 * `initPhysics()` must have resolved before constructing this.
 */
export class RapierSimulation implements FixedSimulation<SimInputs, SimState> {
  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly statics: StaticBox[];

  private tickCount = 0;
  private verticalVelocity = 0;
  private grounded = false;

  constructor(config: SimulationConfig = {}) {
    const spawn = config.spawn ?? DEFAULT_SPAWN;
    this.statics = config.statics ?? [DEFAULT_GROUND];

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
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );

    this.controller = this.world.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
    this.controller.enableSnapToGround(CHARACTER_SNAP_TO_GROUND);
    this.controller.enableAutostep(
      CHARACTER_AUTOSTEP_MAX_HEIGHT,
      CHARACTER_AUTOSTEP_MIN_WIDTH,
      true,
    );
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  tick(input: SimInputs): void {
    this.verticalVelocity += GRAVITY_Y * TICK_DT;

    const horizontal = scaleVec3(input.moveDirection, WALK_SPEED * TICK_DT);
    const desired = {
      x: horizontal.x,
      y: this.verticalVelocity * TICK_DT,
      z: horizontal.z,
    };

    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    if (this.grounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }

    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    });

    this.world.step();
    this.tickCount += 1;
  }

  snapshot(): SimState {
    return worldToSnapshot(this.tickCount, {
      translation: this.body.translation(),
      grounded: this.grounded,
    });
  }

  /** The resolved static geometry (including the default ground), for the renderer. */
  getStatics(): StaticBox[] {
    return this.statics.map((box) => ({
      center: { ...box.center },
      halfExtents: { ...box.halfExtents },
    }));
  }
}

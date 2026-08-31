import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import { DEFAULT_KILL_PLANE_Y, GRAVITY_Y } from "../tuning.js";
import { CharacterController } from "./CharacterController.js";
import type { Checkpoint } from "./Checkpoint.js";
import { STATIC_GROUPS } from "./collisionGroups.js";
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
 * The authoritative simulation for M1: a Rapier world composing a
 * {@link CharacterController} (the capsule, jump/dash, state machine and
 * ragdoll — ticket 05b), plus Fall detection and Checkpoint respawns.
 * Owns the Rapier `World` and the entity ↔ body mapping; `SimState` stays a
 * plain POJO (ADR 0009).
 *
 * `initPhysics()` must have resolved before constructing this.
 */
export class RapierSimulation implements FixedSimulation<SimInputs, SimState> {
  private readonly world: RAPIER.World;
  private readonly character: CharacterController;
  private readonly statics: Box[];
  private readonly checkpoints: Checkpoint[];
  private readonly killPlaneY: number;

  private tickCount = 0;
  private respawnPoint: Vec3;
  private checkpointIndex: number | null = null;
  private fallCount = 0;

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

    this.character = new CharacterController(this.world, spawn);
  }

  /**
   * Deliver an Impact to the Character (a shove from the Spinner, a wall dash,
   * another player…). See {@link CharacterController.applyImpact}.
   */
  applyImpact(impulse: Vec3): void {
    this.character.applyImpact(impulse);
  }

  tick(input: SimInputs): void {
    // The Character must finish moving — including any queued respawn — before
    // Checkpoint and Fall detection read its position for this tick.
    this.character.tick(input);
    this.tickCount += 1;
    this.updateCheckpoint();
    this.detectFall();
  }

  private updateCheckpoint(): void {
    const reached = this.checkpointIndex ?? -1;
    const p = this.character.position;
    for (let i = reached + 1; i < this.checkpoints.length; i += 1) {
      if (pointInBox(p, this.checkpoints[i]!.volume)) {
        this.checkpointIndex = i;
        this.respawnPoint = { ...this.checkpoints[i]!.respawn };
      }
    }
  }

  private detectFall(): void {
    if (this.character.hasPendingRespawn || this.character.position.y >= this.killPlaneY) return;

    this.fallCount += 1;
    this.character.fall(this.respawnPoint, this.fallCount);
  }

  snapshot(): SimState {
    return {
      tick: this.tickCount,
      character: characterSnapshot({
        ...this.character.snapshot(),
        checkpointIndex: this.checkpointIndex,
        fallCount: this.fallCount,
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

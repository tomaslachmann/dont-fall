import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import { DEFAULT_KILL_PLANE_Y, GRAVITY_Y } from "../tuning.js";
import { CharacterController } from "./CharacterController.js";
import type { Checkpoint } from "./Checkpoint.js";
import { STATIC_GROUPS } from "./collisionGroups.js";
import { Prop, type PropConfig } from "./Prop.js";
import type { SimInputs } from "./SimInputs.js";
import { Spinner, type SpinnerConfig } from "./Spinner.js";

export interface SimulationConfig {
  /** Where the Character starts (capsule centre). Also its first respawn point. */
  spawn?: Vec3;
  /** Static collision geometry. Defaults to a single large ground box. */
  statics?: Box[];
  /** Checkpoints the Character can walk through to move its respawn point. */
  checkpoints?: Checkpoint[];
  /** Height below which the Character has Fallen out of the playground. */
  killPlaneY?: number;
  /** Rotating-bar Obstacles (ticket 06). */
  spinners?: SpinnerConfig[];
  /** Dynamic props (boxes/balls) the Character can bump and knock around (ticket 06). */
  props?: PropConfig[];
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

const cloneSpinnerConfig = (config: SpinnerConfig): SpinnerConfig => ({
  ...config,
  center: { ...config.center },
});

const clonePropConfig = (config: PropConfig): PropConfig => ({
  ...config,
  center: { ...config.center },
  shape:
    config.shape.kind === "box"
      ? { kind: "box", halfExtents: { ...config.shape.halfExtents } }
      : { ...config.shape },
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
  private readonly spinners: Spinner[];
  private readonly props: Prop[];
  private readonly spinnerByHandle = new Map<number, Spinner>();
  private readonly propByHandle = new Map<number, Prop>();

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

    this.spinners = (config.spinners ?? []).map((c) => new Spinner(this.world, c));
    for (const spinner of this.spinners) this.spinnerByHandle.set(spinner.collider.handle, spinner);

    this.props = (config.props ?? []).map((c) => new Prop(this.world, c));
    for (const prop of this.props) this.propByHandle.set(prop.collider.handle, prop);

    this.character = new CharacterController(this.world, spawn, this.resolveCollision);
  }

  /**
   * Look `colliderHandle` up against the Spinners/Props this sim owns and
   * resolve the contact (ticket 06): a Spinner delivers Knockback through the
   * Character's Impact pipeline; a Prop gets shoved by the Character's own
   * velocity. Anything else (statics) is not registered here and is ignored.
   */
  private readonly resolveCollision = (colliderHandle: number, point: Vec3, velocity: Vec3): void => {
    const spinner = this.spinnerByHandle.get(colliderHandle);
    if (spinner) {
      this.character.applyImpact(spinner.knockbackAt(point));
      return;
    }
    this.propByHandle.get(colliderHandle)?.shove(velocity);
  };

  /**
   * Deliver an Impact to the Character (a shove from the Spinner, a wall dash,
   * another player…). See {@link CharacterController.applyImpact}.
   */
  applyImpact(impulse: Vec3): void {
    this.character.applyImpact(impulse);
  }

  tick(input: SimInputs): void {
    // Queue each Spinner's rotation for the tick about to run — it must be
    // queued before `character.tick()`'s `world.step()` applies it, the same
    // way the capsule's own `setNextKinematicTranslation` works.
    for (const spinner of this.spinners) spinner.tick(this.tickCount + 1);

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
      props: this.props.map((p) => p.snapshot()),
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

  /**
   * The configured Spinners, for the renderer to build geometry from. A
   * Spinner's rotation is not part of `SimState` — it is a pure function of
   * the tick number (`spinnerAngleAt`), so the renderer recomputes it directly.
   */
  getSpinners(): SpinnerConfig[] {
    return this.spinners.map((s) => cloneSpinnerConfig(s.config));
  }

  /** The configured Props, for the renderer to build geometry from (pose comes from `SimState.props`). */
  getProps(): PropConfig[] {
    return this.props.map((p) => clonePropConfig(p.config));
  }
}

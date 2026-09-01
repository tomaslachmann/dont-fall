import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type CharacterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import { DEFAULT_KILL_PLANE_Y, GRAVITY_Y } from "../tuning.js";
import { CharacterController, type CollisionListener } from "./CharacterController.js";
import type { Checkpoint } from "./Checkpoint.js";
import { STATIC_GROUPS } from "./collisionGroups.js";
import { Prop, type PropConfig } from "./Prop.js";
import type { SimInputs } from "./SimInputs.js";
import { Spinner, type SpinnerConfig } from "./Spinner.js";

/**
 * ID of the Character `SimulationConfig.spawn` auto-creates — the only
 * Character single-player (and every M1 test) ever has. From ticket 02
 * onward each connected client gets its own server-assigned session ID via
 * {@link RapierSimulation.addCharacter} instead.
 */
export const DEFAULT_CHARACTER_ID = "local";

/** Per-Character progress that belongs to the world, not the Character itself: where it Checkpointed and how many times it has Fallen. */
interface CharacterProgress {
  respawnPoint: Vec3;
  checkpointIndex: number | null;
  fallCount: number;
}

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
 * The authoritative simulation: a Rapier world composing a collection of
 * {@link CharacterController}s (each one's capsule, jump/dash, state machine
 * and ragdoll — ticket 05b), keyed by ID (ticket 01), plus Fall detection and
 * Checkpoint respawns tracked per Character. Owns the Rapier `World` and the
 * entity ↔ body mapping; `SimState` stays a plain POJO (ADR 0009).
 *
 * `tick`/`applyImpact` are scoped to {@link DEFAULT_CHARACTER_ID} until
 * ticket 04 needs to address other Characters individually.
 *
 * `initPhysics()` must have resolved before constructing this.
 */
export class RapierSimulation implements FixedSimulation<SimInputs, SimState> {
  private readonly world: RAPIER.World;
  private readonly characters = new Map<string, CharacterController>();
  private readonly progress = new Map<string, CharacterProgress>();
  private readonly statics: Box[];
  private readonly checkpoints: Checkpoint[];
  private readonly killPlaneY: number;
  private readonly spinners: Spinner[];
  private readonly props: Prop[];
  private readonly spinnerByHandle = new Map<number, Spinner>();
  private readonly propByHandle = new Map<number, Prop>();

  private tickCount = 0;

  constructor(config: SimulationConfig = {}) {
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

    this.addCharacter(DEFAULT_CHARACTER_ID, config.spawn ?? DEFAULT_SPAWN);
  }

  /**
   * Add a Character to the Match (ticket 01), spawning it at `point` and
   * making it its own first respawn point. Wires up the same Spinner/Prop
   * collision resolution every Character gets, scoped to this one.
   */
  addCharacter(id: string, point: Vec3): void {
    // Guard against orphaning the previous Character's Rapier bodies if `id`
    // is reused (e.g. a reconnect) before it was explicitly removed.
    this.removeCharacter(id);

    const onCollision: CollisionListener = (colliderHandle, hitPoint, velocity) => {
      const spinner = this.spinnerByHandle.get(colliderHandle);
      if (spinner) {
        this.characters.get(id)?.applyImpact(spinner.knockbackAt(hitPoint));
        return;
      }
      this.propByHandle.get(colliderHandle)?.shove(velocity);
    };

    this.characters.set(id, new CharacterController(this.world, point, onCollision));
    this.progress.set(id, { respawnPoint: { ...point }, checkpointIndex: null, fallCount: 0 });
  }

  /** Remove a Character from the Match and free its Rapier bodies (ticket 01). */
  removeCharacter(id: string): void {
    this.characters.get(id)?.dispose();
    this.characters.delete(id);
    this.progress.delete(id);
  }

  private character(id: string): CharacterController {
    const character = this.characters.get(id);
    if (!character) throw new Error(`no Character with id "${id}"`);
    return character;
  }

  /**
   * Deliver an Impact to the default Character (a shove from the Spinner, a
   * wall dash…). See {@link CharacterController.applyImpact}. Scoped to the
   * single-player default Character until ticket 04 needs to target others.
   */
  applyImpact(impulse: Vec3): void {
    this.character(DEFAULT_CHARACTER_ID).applyImpact(impulse);
  }

  tick(input: SimInputs): void {
    // Queue each Spinner's rotation for the tick about to run — it must be
    // queued before `character.tick()`'s `world.step()` applies it, the same
    // way the capsule's own `setNextKinematicTranslation` works.
    for (const spinner of this.spinners) spinner.tick(this.tickCount + 1);

    // The Character must finish moving — including any queued respawn — before
    // Checkpoint and Fall detection read its position for this tick. Only the
    // default Character is driven until ticket 04 ticks every Character.
    this.character(DEFAULT_CHARACTER_ID).tick(input);
    this.tickCount += 1;
    this.updateCheckpoint(DEFAULT_CHARACTER_ID);
    this.detectFall(DEFAULT_CHARACTER_ID);
  }

  private updateCheckpoint(id: string): void {
    const character = this.character(id);
    const progress = this.progress.get(id)!;
    const reached = progress.checkpointIndex ?? -1;
    const p = character.position;
    for (let i = reached + 1; i < this.checkpoints.length; i += 1) {
      if (pointInBox(p, this.checkpoints[i]!.volume)) {
        progress.checkpointIndex = i;
        progress.respawnPoint = { ...this.checkpoints[i]!.respawn };
      }
    }
  }

  private detectFall(id: string): void {
    const character = this.character(id);
    const progress = this.progress.get(id)!;
    if (character.hasPendingRespawn || character.position.y >= this.killPlaneY) return;

    progress.fallCount += 1;
    character.fall(progress.respawnPoint, progress.fallCount);
  }

  snapshot(): SimState {
    const characters: Record<string, CharacterSnapshot> = {};
    for (const [id, character] of this.characters) {
      const progress = this.progress.get(id)!;
      characters[id] = characterSnapshot({
        ...character.snapshot(),
        checkpointIndex: progress.checkpointIndex,
        fallCount: progress.fallCount,
      });
    }
    return {
      tick: this.tickCount,
      characters,
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

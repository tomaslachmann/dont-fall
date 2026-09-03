import RAPIER from "@dimforge/rapier3d-compat";
import { pointInOrientedBox, type OrientedBox } from "../math/box.js";
import { IDENTITY_QUAT } from "../math/quat.js";
import { normalizeVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { characterSnapshot, type CharacterSnapshot, type SimState } from "../state/SimState.js";
import type { FixedSimulation } from "../timing/FixedSimulation.js";
import {
  BUMP_IMPULSE_SCALE,
  BUMP_LIFT_RATIO,
  DEFAULT_KILL_PLANE_Y,
  GRAVITY_Y,
} from "../tuning.js";
import { DEFAULT_SURFACE, surfaceConfig, type SurfaceId } from "../track/Surface.js";
import { CharacterController, type CollisionListener } from "./CharacterController.js";
import type { CharacterMotionState } from "./CharacterStateMachine.js";
import type { Checkpoint } from "./Checkpoint.js";
import { STATIC_GROUPS } from "./collisionGroups.js";
import { MirrorCharacter } from "./MirrorCharacter.js";
import { Prop, type PropConfig, type PropSnapshot } from "./Prop.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";
import { Spinner, type SpinnerConfig } from "./Spinner.js";

/**
 * ID of the Character `SimulationConfig.spawn` auto-creates — the only
 * Character single-player (and every M1 test) ever has. From ticket 02
 * onward each connected client gets its own server-assigned session ID via
 * {@link RapierSimulation.addCharacter} instead.
 */
export const DEFAULT_CHARACTER_ID = "local";

/** Per-Character progress that belongs to the world, not the Character itself. */
interface CharacterProgress {
  respawnPoint: Vec3;
  checkpointIndex: number | null;
  fallCount: number;
  /** Sim tick the current `motionState` phase began — the client derives the GettingUp blend from it (ADR 0023). Epoch and cause come from `CharacterController.snapshot()`. */
  phaseStartTick: number;
  /** The `motionState` seen in the previous snapshot, for transition detection. */
  lastMotionState: CharacterMotionState;
}

export interface SimulationConfig {
  /** Where the Character starts (capsule centre). Also its first respawn point. */
  spawn?: Vec3;
  /** Static collision geometry. Defaults to a single large ground box. */
  statics?: OrientedBox[];
  /**
   * Each `statics` entry's Surface id, index-aligned with it (ticket 01,
   * ADR 0036) — `Track.ts`'s `resolveTrack` produces both together. Missing
   * or shorter than `statics` (e.g. the M1-era `DEFAULT_GROUND` fallback,
   * or any hand-built `statics` array in a test) resolves the remainder to
   * {@link DEFAULT_SURFACE}.
   */
  staticSurfaces?: SurfaceId[];
  /** Checkpoints the Character can walk through to move its respawn point. */
  checkpoints?: Checkpoint[];
  /** Height below which the Character has Fallen out of the playground. */
  killPlaneY?: number;
  /** Rotating-bar Obstacles (ticket 06). */
  spinners?: SpinnerConfig[];
  /** Dynamic props (boxes/balls) the Character can bump and knock around (ticket 06). */
  props?: PropConfig[];
  /**
   * Whether to auto-create the single-player {@link DEFAULT_CHARACTER_ID}
   * Character at `spawn` (ticket 01). Defaults to `true`; the server (ticket
   * 02) sets this `false` and calls {@link RapierSimulation.addCharacter}
   * with a real per-connection ID instead, so it never allocates and
   * immediately disposes a Character nothing uses.
   */
  withDefaultCharacter?: boolean;
  /**
   * Whether every Character added to this simulation decides for itself when
   * a knockdown ends (`Ragdoll`/`GettingUp` recovering via the Ragdoll body's
   * own physics settle-check). Defaults to `true` — the server, and every
   * test that doesn't opt out, is the authority and must. The client's
   * local-prediction `RapierSimulation` (`apps/client/src/main.ts`) sets this
   * `false`: its own knockdown recovery is never trusted, only a server
   * snapshot can end one (ADR 0015) — that's what makes reconciling a down
   * state unconditional and safe (no more stale-vs-live ambiguity).
   */
  authoritative?: boolean;
}

const DEFAULT_SPAWN = vec3(0, 2, 0);
const DEFAULT_GROUND: OrientedBox = {
  center: vec3(0, -0.5, 0),
  halfExtents: vec3(30, 0.5, 30),
  rotation: IDENTITY_QUAT,
};

const cloneOrientedBox = (box: OrientedBox): OrientedBox => ({
  center: { ...box.center },
  halfExtents: { ...box.halfExtents },
  rotation: { ...(box.rotation ?? IDENTITY_QUAT) },
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
export class RapierSimulation implements FixedSimulation<Record<string, SimInputs>, SimState> {
  private readonly world: RAPIER.World;
  private readonly characters = new Map<string, CharacterController>();
  private readonly progress = new Map<string, CharacterProgress>();
  private readonly statics: OrientedBox[];
  private readonly checkpoints: Checkpoint[];
  private readonly killPlaneY: number;
  /** See `SimulationConfig.authoritative`. */
  private readonly authoritative: boolean;
  private readonly spinners: Spinner[];
  private readonly props: Prop[];
  private readonly spinnerByHandle = new Map<number, Spinner>();
  private readonly propByHandle = new Map<number, Prop>();
  private readonly propIndexByHandle = new Map<number, number>();
  /** Capsule collider handle → Character ID, so a Character-to-Character contact can find the Character it hit (ticket 04 — Bump). */
  private readonly characterIdByHandle = new Map<number, string>();
  /**
   * Static collider handle → Surface id (ticket 01, ADR 0036) — the one
   * piece of plumbing the whole Surface path needed: without this, reading
   * "what Surface is this Character standing on?" from a collider handle
   * would mean a new scene query instead, which would depend on collider
   * insertion order and break client/server determinism quietly.
   */
  private readonly staticSurfaceByHandle = new Map<number, SurfaceId>();
  /**
   * Other players mirrored into this world as positioned obstacles (ADR 0012,
   * ticket 04) — a client's local prediction world only. The server has real
   * {@link CharacterController}s for every player and never populates this.
   */
  private readonly mirrors = new Map<string, MirrorCharacter>();

  // --- Client-only: Props as pinned obstacles (ticket 06, ADR 0012 / 0016) ---
  /**
   * Latest authoritative pose per Prop, from the server snapshot. On a client
   * every Prop is pinned here every tick — it is a solid obstacle for the
   * local Character's prediction but never simulated locally (ADR 0016). On
   * the server this stays empty, so Props are fully dynamic and authoritative.
   */
  private followPoses: (PropSnapshot | undefined)[] = [];

  /**
   * Client-only (ADR 0022, ticket 11.8): Prop indices the local Character is
   * predicting right now. A predicted Prop is a live dynamic body — skipped by
   * the every-tick pin to {@link followPoses} — until the render layer's grace
   * lapses and clears it. Empty on the server and for a plain interpolation-only
   * client.
   */
  private predictedProps = new Set<number>();

  /**
   * Client-only (ADR 0022): Prop indices the local Character's capsule contacted
   * since {@link consumeContactedProps} was last called. Only tracked on a
   * non-`authoritative` (client-prediction) simulation.
   */
  private readonly contactedProps = new Set<number>();

  private tickCount = 0;

  constructor(config: SimulationConfig = {}) {
    this.statics = config.statics ?? [DEFAULT_GROUND];
    this.checkpoints = config.checkpoints ?? [];
    this.killPlaneY = config.killPlaneY ?? DEFAULT_KILL_PLANE_Y;
    this.authoritative = config.authoritative ?? true;

    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });

    this.statics.forEach((box, i) => {
      // ADR 0034: a real rotated rigid body, not the old pre-rotated-AABB
      // trick — Rapier itself has always supported this; nothing here needed
      // the previous multiple-of-90°-only restriction.
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z)
          .setCollisionGroups(STATIC_GROUPS),
        this.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed()
            .setTranslation(box.center.x, box.center.y, box.center.z)
            .setRotation(box.rotation ?? IDENTITY_QUAT),
        ),
      );
      this.staticSurfaceByHandle.set(collider.handle, config.staticSurfaces?.[i] ?? DEFAULT_SURFACE);
    });

    this.spinners = (config.spinners ?? []).map((c) => new Spinner(this.world, c));
    for (const spinner of this.spinners) this.spinnerByHandle.set(spinner.collider.handle, spinner);

    this.props = (config.props ?? []).map((c) => new Prop(this.world, c));
    this.props.forEach((prop, i) => {
      this.propByHandle.set(prop.collider.handle, prop);
      this.propIndexByHandle.set(prop.collider.handle, i);
    });

    if (config.withDefaultCharacter ?? true) {
      this.addCharacter(DEFAULT_CHARACTER_ID, config.spawn ?? DEFAULT_SPAWN);
    }
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

    const onCollision: CollisionListener = (colliderHandle, hitPoint, velocity, normal) => {
      const spinner = this.spinnerByHandle.get(colliderHandle);
      if (spinner) {
        this.characters.get(id)?.applyImpact(spinner.knockbackAt(hitPoint), "Spinner");
        return;
      }
      const bumpedId = this.characterIdByHandle.get(colliderHandle);
      if (bumpedId !== undefined && bumpedId !== id) {
        this.resolveBump(id, bumpedId, velocity, normal);
        return;
      }
      const propIndex = this.propIndexByHandle.get(colliderHandle);
      if (propIndex !== undefined) {
        // The shove takes effect on the server (Props are dynamic there) and on
        // a client for a Prop currently being predicted (ADR 0022); for a pinned
        // Prop it is overwritten by the post-step re-pin, a harmless no-op
        // (ADR 0016).
        this.props[propIndex]!.shove(velocity);
        // Client-only: note the contact so the render layer can start / extend
        // predicting this Prop (ADR 0022). Server sims are `authoritative`.
        if (!this.authoritative) this.contactedProps.add(propIndex);
      }
    };

    const character = new CharacterController(this.world, point, onCollision, this.authoritative);
    this.characters.set(id, character);
    this.characterIdByHandle.set(character.colliderHandle, id);
    this.progress.set(id, {
      respawnPoint: { ...point },
      checkpointIndex: null,
      fallCount: 0,
      phaseStartTick: 0,
      lastMotionState: "Controlled",
    });
  }

  /**
   * Character-to-Character Bump (ticket 04), resolved authoritatively here —
   * never predicted on a client (ADR 0012). One-sided: only `bumpedId` takes
   * the Impact; the `moverId` who ran into them is untouched and keeps their
   * momentum (a Dash isn't cut short by hitting someone). The Impact magnitude
   * is the *closing speed* — how fast the mover is approaching along the
   * contact normal, net of the target's own motion — so a glancing brush or a
   * target running away lands softer than a square head-on hit. Feeds the same
   * `applyImpact` / `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN` pipeline the
   * Spinner and dash-into-wall already use.
   */
  private resolveBump(moverId: string, bumpedId: string, moverVelocity: Vec3, normal: Vec3): void {
    const bumped = this.characters.get(bumpedId);
    if (!bumped) return;

    // `normal` points from the bumped Character back toward the mover, so
    // `-normal` is "from the mover toward the target" — the push direction.
    const toTarget = vec3(-normal.x, 0, -normal.z);
    const approach = moverVelocity.x * toTarget.x + moverVelocity.z * toTarget.z;
    if (approach <= 0) return; // the mover isn't actually driving into the target — no Bump

    const relative = subVec3(moverVelocity, bumped.currentVelocity);
    const closingSpeed = relative.x * toTarget.x + relative.z * toTarget.z;
    if (closingSpeed <= 0) return;

    const direction = normalizeVec3(vec3(-normal.x, BUMP_LIFT_RATIO, -normal.z));
    const magnitude = closingSpeed * BUMP_IMPULSE_SCALE;
    bumped.applyImpact(scaleVec3(direction, magnitude), "Bump");
  }

  /** Remove a Character from the Match and free its Rapier bodies (ticket 01). */
  removeCharacter(id: string): void {
    const character = this.characters.get(id);
    if (character) this.characterIdByHandle.delete(character.colliderHandle);
    character?.dispose();
    this.characters.delete(id);
    this.progress.delete(id);
  }

  /**
   * Client-only (ADR 0012, ticket 04): reconcile this local prediction world's
   * set of *other* players' mirror capsules against `poses` (every connected
   * Character except the local one, positioned from the latest server
   * snapshot). Adds mirrors that appeared, moves the rest, drops any that are
   * gone. A mirror is a movement obstacle only — never simulated, never
   * Bumped.
   */
  syncMirrorCharacters(poses: Record<string, Vec3>): void {
    for (const [id, pose] of Object.entries(poses)) {
      const existing = this.mirrors.get(id);
      if (existing) existing.moveTo(pose);
      else this.mirrors.set(id, new MirrorCharacter(this.world, pose));
    }
    for (const [id, mirror] of this.mirrors) {
      if (!(id in poses)) {
        mirror.dispose(this.world);
        this.mirrors.delete(id);
      }
    }
  }

  private character(id: string): CharacterController {
    const character = this.characters.get(id);
    if (!character) throw new Error(`no Character with id "${id}"`);
    return character;
  }

  /** Deliver an Impact to Character `id` (a shove from the Spinner, a wall dash, a Bump…). See {@link CharacterController.applyImpact}. */
  applyImpact(id: string, impulse: Vec3): void {
    this.character(id).applyImpact(impulse);
  }

  /**
   * Ticket 05: overwrite a locally predicted Character with the server's
   * authoritative base so the client can replay its unacknowledged inputs
   * forward from it (ADR 0013). A down `base.motionState` is always synced
   * unconditionally (ADR 0015) — safe because a non-`authoritative` Character
   * (the client's own) never decides on its own when a knockdown ends, so
   * there is no "stale vs. live" report to tell apart. See
   * {@link CharacterController.reconcileTo}.
   */
  reconcileCharacter(
    id: string,
    base: Pick<CharacterSnapshot, "position" | "velocity" | "grounded" | "motionState" | "dashCooldownMs" | "dashing">,
  ): void {
    this.character(id).reconcileTo(base);
  }

  /**
   * Ticket 05: realign the tick counter to the server's, so Spinner phase —
   * a pure function of the tick — is correct for the replay that follows a
   * reconciliation, rather than running on this client's own slowly-drifting
   * count. The counter is a plain integer with no accumulated state, so
   * setting it (backward, to the snapshot's tick) is safe.
   */
  syncTick(serverTick: number): void {
    this.tickCount = serverTick;
  }

  /**
   * Ticket 05: re-run one Character's own buffered inputs forward from a
   * freshly-reconciled base — one full shared {@link tick} per input — to
   * catch it back up to the present prediction tick (Bernier-style local
   * replay: only this machine's own inputs, against its own corrected state;
   * ADR 0013). Returns the Character's position after each replayed tick so the
   * client can rebuild its tick-aligned position history.
   *
   * Routes through {@link tick} so Spinner phase, Checkpoint and Fall
   * detection all stay coherent during the replay (call {@link syncTick}
   * first). A few extra `world.step()`s do nudge dynamic Props slightly — an
   * accepted M2 approximation; Prop sync is ticket 06.
   */
  replayLocalCharacter(id: string, inputs: readonly SimInputs[]): Vec3[] {
    const positions: Vec3[] = [];
    for (const input of inputs) {
      this.tick({ [id]: input });
      positions.push({ ...this.character(id).snapshot().position });
    }
    return positions;
  }

  /**
   * Advance every Character by one tick, keyed the same way as `inputs` — a
   * Character with no entry this tick (a client whose packet hasn't arrived
   * yet) simply idles. Every Character's movement is queued first, the Rapier
   * `world` steps exactly once for all of them together, then each Character
   * reads the result back — the split `beginTick`/`endTick` on
   * `CharacterController` (ticket 02) is what makes one shared step possible.
   */
  tick(inputs: Record<string, SimInputs>): void {
    // Queue each Spinner's rotation for the tick about to run — it must be
    // queued before `world.step()` applies it, the same way each Character's
    // own `setNextKinematicTranslation` works.
    for (const spinner of this.spinners) spinner.tick(this.tickCount + 1);
    // Mirrored other-players (client only) are re-placed from their latest
    // snapshot pose every tick — they never move under their own physics.
    for (const mirror of this.mirrors.values()) mirror.step();

    for (const [id, character] of this.characters) character.beginTick(inputs[id] ?? IDLE_INPUTS);
    this.world.step();
    this.tickCount += 1;

    // Each Character must finish moving — including any queued respawn —
    // before Checkpoint and Fall detection read its position for this tick.
    for (const [id, character] of this.characters) {
      character.endTick();
      this.updateCheckpoint(id);
      this.detectFall(id);
      // Stamp the tick a `motionState` phase begins, in sim-tick space, exactly
      // once (ADR 0023). Must be here, not in `snapshot()` — that is called
      // several times per client frame and before `syncTick` in reconcile.
      const progress = this.progress.get(id)!;
      if (character.motionState !== progress.lastMotionState) {
        progress.phaseStartTick = this.tickCount;
        progress.lastMotionState = character.motionState;
      }
      // Ticket 01/ADR 0036: this tick's ground contact (just computed above,
      // in `endTick`/the sweep it followed) decides the Surface that gates
      // *next* tick's walk speed and (ticket 06) grip — the same one-tick
      // lag `grounded` itself already has relative to jump/landing.
      const groundHandle = character.groundColliderHandle;
      const surfaceId = groundHandle !== undefined ? this.staticSurfaceByHandle.get(groundHandle) : undefined;
      const surface = surfaceConfig(surfaceId);
      character.setSurfaceTopSpeedMultiplier(surface.topSpeedMultiplier);
      character.setSurfaceGrip(surface.grip);
    }

    // Client-only (ADR 0012 / 0016, ticket 06): every Prop is pinned to the
    // authoritative snapshot pose for this tick — a solid obstacle for the
    // local Character's prediction, never simulated locally. On the server
    // `followPoses` is empty, so every Prop stays fully dynamic and
    // authoritative. A Prop the render layer is predicting (ADR 0022) is left
    // to simulate freely — it is seeded from the server on every reconcile.
    //
    // Also skipped: a Prop contacted THIS tick (`contactedProps`, set above by
    // `onCollision`, which runs during `beginTick` — before `world.step()`).
    // `predictedProps` is only updated once per FRAME, from the render layer,
    // AFTER this tick's `consumeContactedProps()` has even been read — so on
    // the very tick a contact first registers, the Prop is *never* in
    // `predictedProps` yet. Without this exemption the shove (applied moments
    // ago, in this same tick's `beginTick`) gets pinned straight back to the
    // stale pre-shove pose before anyone outside this method ever sees it
    // moved — a regression from ticket 06's original same-tick exemption
    // (`!contactedProps.has(i)`), dropped when ADR 0016 removed Prop
    // prediction entirely and never restored when ADR 0022 (ticket 11.8)
    // reintroduced it. Restored here, unconditionally (not gated on
    // `authoritative`) — `contactedProps` is already only ever populated on a
    // non-authoritative sim, so it's empty (a no-op) on the server.
    for (let i = 0; i < this.props.length; i += 1) {
      if (this.predictedProps.has(i) || this.contactedProps.has(i)) continue;
      const pose = this.followPoses[i];
      if (pose) this.props[i]!.follow(pose);
    }
  }

  /**
   * Client-only (ADR 0022, ticket 11.8): the set of Prop indices to leave
   * unpinned and simulate locally this frame. The client's render layer
   * (`apps/client/src/propPrediction.ts`) decides membership from local contact
   * plus a grace window and calls this once per frame before the predict loop.
   */
  setPredictedProps(indices: Iterable<number>): void {
    this.predictedProps = new Set(indices);
  }

  /**
   * Client-only (ADR 0022): Prop indices the local Character's capsule has
   * contacted since the last call. Clears on read — call once per frame after
   * the predict loop.
   */
  consumeContactedProps(): number[] {
    const out = [...this.contactedProps];
    this.contactedProps.clear();
    return out;
  }

  /**
   * Client-only (ADR 0022): overwrite one predicted Prop's dynamic state with
   * the server's authoritative pose + velocity, so a replay converges instead
   * of drifting. Called from `reconcile` before the local-input replay, for
   * every currently-predicted Prop. See {@link Prop.applyAuthoritativeState}.
   */
  applyAuthoritativePropState(index: number, pose: PropSnapshot): void {
    this.props[index]?.applyAuthoritativeState(pose);
  }

  /**
   * Client-only (ticket 06, ADR 0012 / 0016): set the poses every Prop is
   * pinned to from the next {@link tick}. The local player never predicts a
   * Prop's motion (ADR 0016) — the Prop is drawn from the interpolated
   * snapshot and exists here only to block movement. `main.ts` calls this
   * every frame with the *interpolated* render poses (so a Prop you're pushing
   * advances smoothly as an obstacle, no per-snapshot sawtooth), and
   * `reconcile` calls it with the raw acked-snapshot poses before a replay.
   */
  syncPropsToSnapshot(poses: readonly PropSnapshot[]): void {
    this.followPoses = poses.map((p) => ({
      position: { ...p.position },
      rotation: { ...p.rotation },
      atRest: p.atRest,
    }));
  }

  private updateCheckpoint(id: string): void {
    const character = this.character(id);
    const progress = this.progress.get(id)!;
    const reached = progress.checkpointIndex ?? -1;
    const p = character.position;
    for (let i = reached + 1; i < this.checkpoints.length; i += 1) {
      if (pointInOrientedBox(p, this.checkpoints[i]!.volume)) {
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
        phaseStartTick: progress.phaseStartTick,
      });
    }
    return {
      tick: this.tickCount,
      characters,
      props: this.props.map((p) => p.snapshot()),
    };
  }

  /** The resolved static geometry (including the default ground), for the renderer. */
  getStatics(): OrientedBox[] {
    return this.statics.map(cloneOrientedBox);
  }

  /** The configured checkpoints, for the renderer. */
  getCheckpoints(): Checkpoint[] {
    return this.checkpoints.map((cp) => ({
      respawn: { ...cp.respawn },
      volume: cloneOrientedBox(cp.volume),
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

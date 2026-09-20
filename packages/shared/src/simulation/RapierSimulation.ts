import RAPIER from "@dimforge/rapier3d-compat";
import { pointInOrientedBox, type OrientedBox } from "../math/box.js";
import { conjugateQuat, IDENTITY_QUAT } from "../math/quat.js";
import { addVec3, dotVec3, lengthVec3, normalizeVec3, rotateVec3ByQuat, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { phaseLocksInput, phaseNeedsPhysicsStep, type MatchPhase } from "../match/MatchPhase.js";
import { DEFAULT_ROUND_RULES, type RoundRules } from "../match/RoundRules.js";
import { characterSnapshot, type CharacterSnapshot, type HeldPhase, type EliminationCredit, type EliminationHow, type RagdollCause, type ReconcileBase, type SimState } from "../state/SimState.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, GROUND_SNAP_DISTANCE, GRAVITY_Y, SEAT_CLEAR_MAX_LIFT, SEAT_CLEAR_STEP, SURFACE_GROUND_NORMAL_MIN_Y } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { BUMP_IMPULSE_SCALE, BUMP_LIFT_RATIO, HIT_FACING_COS_MIN, HIT_LIFT_RATIO, HIT_RANGE, ELIMINATION_CREDIT_TICKS } from "../tuning/fight.js";
import { RAGDOLL_BELT_REACH } from "../tuning/knockdown.js";
import { DEFAULT_KILL_PLANE_Y, MOVING_SEGMENT_LIFT_RATIO, SPIKED_IMPACT_MAGNITUDE, SPIKED_LIFT_RATIO } from "../tuning/world.js";
import { DEFAULT_SURFACE, surfaceConfig, type SurfaceId } from "../track/Surface.js";
import { passesThroughGate } from "../track/Gate.js";
import type { StaticTrimesh } from "../track/resolveTrack.js";
import { CharacterController, type CollisionListener } from "./CharacterController.js";
import type { HoldRole } from "./character/InteractionController.js";
import type { Ride } from "./character/MovementController.js";
import { GrabHolds } from "./GrabHolds.js";
import { hitImpactMagnitude } from "./HitController.js";
import { isDownMotionState, isPlayerDrivenMotionState, type CharacterMotionState } from "./CharacterStateMachine.js";
import type { Checkpoint } from "./Checkpoint.js";
import type { FinishZone } from "./FinishZone.js";
import { GROUP_CHARACTER, GROUP_RAGDOLL, STATIC_GROUPS } from "./collisionGroups.js";
import type { LaunchPadConfig } from "./LaunchPad.js";
import { MirrorCharacter } from "./MirrorCharacter.js";
import { slipRoll } from "./slipRoll.js";
import {
  MovingSegment,
  movingSegmentImpactMagnitude,
  movingSegmentPose,
  type MovingSegmentConfig,
} from "./MovingSegment.js";
import { Prop, type PropConfig, type PropSnapshot } from "./Prop.js";
import { IDLE_INPUTS, type SimInputs } from "./SimInputs.js";
import { Spinner, type SpinnerConfig } from "./Spinner.js";
import { byVolumePriority, volumeAt, type VolumeConfig } from "./Volume.js";

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
  /**
   * Index into `launchPads` this Character was touching as of the last check,
   * or `undefined` (M3.7 ticket 02) — the rising-edge memory `updateLaunchPad`
   * compares against, so a wide pad touched across several ticks fires once
   * and leaving-then-re-entering (even the same pad) re-arms it. Re-derived
   * (never blanked) on every `reconcileCharacter` from the restored
   * position — see that method's own comment for why a naive blank reset
   * fails under frequent reconciliation. Local bookkeeping, never replicated.
   */
  touchedLaunchPadIndex: number | undefined;
  /**
   * The Tick this Character entered a Finish Zone and Qualified, or `null`
   * while it has not (M4 ticket 02, ADR 0039). Latched on the first entry and
   * never re-stamped: Qualification is granted once, and a Character shoved
   * back out of the zone afterwards keeps it.
   */
  finishTick: number | null;
  /**
   * Whether this Character is eliminated (M5 ticket 04, ADR 0042) — marked,
   * never removed: its entry stays in `characters` and its body stays in
   * the world (collider disabled), so the simulated set and the iteration
   * order never vary. Once `true`, `tick`'s own per-Character loops skip it
   * entirely — not a controller sweep, an iteration and a branch. Set either
   * by an eliminating Fall (`detectFall`) or directly (`eliminateCharacter`,
   * a mid-Round disconnect) — never cleared; a Round with an eliminated
   * Character in it always gets a fresh simulation before it plays again.
   */
  eliminated: boolean;
  /**
   * The Tick {@link eliminated} was set, or `null` while it hasn't been (M7
   * ticket 02) — the Tick elimination was *marked*, not the Tick of whatever
   * Fall or shove doomed it (`detectFall`'s own comment: the kill plane can
   * fire one or more Ticks late). Rides the snapshot so a Survival Round can
   * rank its non-Qualified Characters by it; never cleared, same lifecycle
   * as `eliminated` itself.
   */
  eliminatedTick: number | null;
  /**
   * The last other Character to grab, throw or hit this one, and when (ADR
   * 0110) — authoritative bookkeeping, read only when an eliminating Fall
   * marks {@link eliminatedBy}. Never replicated itself.
   */
  lastTouch: (EliminationCredit & { tick: number }) | null;
  /** Who put this Character out — `lastTouch`, if it was recent enough when it Fell out (ADR 0110). */
  eliminatedBy: EliminationCredit | null;
  /** Struggles this Character won in this world (ADR 0110) — read by the Match server at the Round's end. */
  strugglesWon: number;
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
  /**
   * Each `statics` entry's belt flow, index-aligned with it (ADR 0064) —
   * `resolveTrack`'s `staticConveyors`, produced together like
   * `staticSurfaces`. Missing/short/`undefined` entries are still floor.
   */
  staticConveyors?: (Vec3 | undefined)[];
  /**
   * Static asset collision (M8 ticket 02, ADR 0050) — `resolveTrack`'s
   * `staticTrimeshes`, one entry per authored mesh. Each becomes a fixed
   * trimesh collider exactly as authored (verbatim — hull-shrinking would
   * only invent error at these vertex counts), surfaced through the same
   * `staticSurfaceByHandle` map as the box half, never a parallel one.
   * Trimeshes are static-only by engine contract; articulated asset parts
   * are out of scope until a dynamic representation is designed.
   */
  staticTrimeshes?: StaticTrimesh[];
  /** Checkpoints the Character can walk through to move its respawn point. */
  checkpoints?: Checkpoint[];
  /** Launch pads the Character can cross to fire a one-shot full-velocity SET (M3.7 ticket 02). */
  launchPads?: LaunchPadConfig[];
  /** Volumes that apply a continuous force to any Character inside them (M3.7 ticket 04, ADR 0036). */
  volumes?: VolumeConfig[];
  /**
   * Finish Zones a Character Qualifies by entering (M4 ticket 02, ADR 0039).
   * Empty (the default) means the Track has no finish authored and is simply
   * not raceable — every Character stays unqualified forever, which is
   * exactly how every pre-M4 Track behaves.
   */
  finishZones?: FinishZone[];
  /** Height below which the Character has Fallen out of the playground. */
  killPlaneY?: number;
  /** Rotating-bar Obstacles (ticket 06). */
  spinners?: SpinnerConfig[];
  /** Segments with a Motion (ADR 0061), each one kinematic body posed from the Tick. */
  movingSegments?: MovingSegmentConfig[];
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
  /**
   * The Round this simulation runs by (M5 ticket 02, ADR 0041/0043) —
   * resolved once by the caller (Track defaults under Round overrides,
   * `resolveRoundRules`) before this simulation exists, and fixed for its
   * whole life: a Round's rules never change mid-Round, so a rules change
   * means a fresh simulation, the same way a Track reload already gets one.
   * Defaults to {@link DEFAULT_ROUND_RULES} — a Race, on a Track authored
   * with no other opinion — so every existing caller with no Round concept
   * (most of this file's own tests among them) is unaffected. Nothing in
   * this ticket reads it yet; ticket 03 is the first Round-type rule that
   * does (what a Fall does), read where the per-Character loop already
   * reads `qualified`, right beside it.
   */
  roundRules?: RoundRules;
  /**
   * Measurement only (M13 ticket 02): a millisecond clock (the caller's
   * `performance.now`) turns on Rapier's internal profiler and times the
   * per-tick Moving Segment switching, read back through
   * {@link RapierSimulation.lastTickTimings}. It never changes what a tick
   * computes. Omitted — always, in play — nothing is timed.
   */
  profileClock?: () => number;
}

/** What the last tick cost, from a simulation built with `profileClock` (M13 ticket 02). */
export interface SimulationTimings {
  /** Rapier's whole last `world.step()` — stale through phases that skip the step. */
  stepMs: number;
  collisionDetectionMs: number;
  broadPhaseMs: number;
  narrowPhaseMs: number;
  solverMs: number;
  ccdMs: number;
  /** Rapier propagating what changed between steps — every Moving Segment's body-type switch lands here. */
  userChangesMs: number;
  /** Outside the step: every Moving Segment switched to `Fixed` for the sweeps, then back with its next pose. */
  movingSegmentsMs: number;
  /** Outside the step: every Character's `beginTick` — its movement and its controller's collision sweep. */
  characterSweepsMs: number;
  /** Outside the step: every Character's post-step bookkeeping — `endTick`, contacts, Checkpoints, Falls, Surfaces, Volumes. */
  characterUpdatesMs: number;
}

/** Every timing at zero — the start of a sum over ticks. */
export const emptySimulationTimings = (): SimulationTimings => ({
  stepMs: 0,
  collisionDetectionMs: 0,
  broadPhaseMs: 0,
  narrowPhaseMs: 0,
  solverMs: 0,
  ccdMs: 0,
  userChangesMs: 0,
  movingSegmentsMs: 0,
  characterSweepsMs: 0,
  characterUpdatesMs: 0,
});

const DEFAULT_SPAWN = vec3(0, 2, 0);
const DEFAULT_GROUND: OrientedBox = {
  center: vec3(0, -0.5, 0),
  halfExtents: vec3(30, 0.5, 30),
  rotation: IDENTITY_QUAT,
};

let initPromise: Promise<void> | null = null;

/**
 * Which way a Moving Segment pressing into a Character shoves it (ADR 0061,
 * `docs/research/moving-obstacle-collision-shapes.md`). Normally the contact
 * normal, out of the Segment. But a body pressing a *grounded* Character from
 * above has a normal pointing into the floor: that push is absorbed by the
 * ground, and closing speed along it is ~0 while the body sweeps sideways — the
 * Character was held underneath, neither moved nor hit. So from above, the
 * into-ground part is dropped: what is left of the normal sideways, or — right
 * under the body, where nothing is left — the way the body itself is sweeping.
 * `undefined` when there is no sideways way out at all (a straight crush).
 */
const pushDirection = (normal: Vec3, segmentVelocity: Vec3, grounded: boolean): Vec3 | undefined => {
  if (!grounded || normal.y >= 0) return normal;
  const sideways = vec3(normal.x, 0, normal.z);
  if (lengthVec3(sideways) >= PRESSED_SIDEWAYS_MIN) return normalizeVec3(sideways);
  const sweep = vec3(segmentVelocity.x, 0, segmentVelocity.z);
  return lengthVec3(sweep) > 1e-3 ? normalizeVec3(sweep) : undefined;
};

/** Below this much sideways normal (a unit normal's length on the floor plane), a press from above counts as straight overhead. */
const PRESSED_SIDEWAYS_MIN = 0.3;

/**
 * The Impact of touching a Spiked Asset (ADR 0061), along the contact normal
 * (pointing from the spikes toward the Character) with a lift that clears them.
 */
const spikedKnockback = (normal: Vec3): Vec3 =>
  scaleVec3(normalizeVec3(vec3(normal.x, Math.max(normal.y, 0) + SPIKED_LIFT_RATIO, normal.z)), SPIKED_IMPACT_MAGNITUDE);

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
export class RapierSimulation {
  private readonly world: RAPIER.World;
  private readonly characters = new Map<string, CharacterController>();
  private readonly progress = new Map<string, CharacterProgress>();
  /**
   * Where each Character's capsule centre was when this tick began, and
   * whether a Respawn was queued then — what a Gate pass is measured from
   * (ADR 0068). A Respawn's teleport is never a pass.
   */
  private readonly tickStart = new Map<string, { position: Vec3; respawning: boolean }>();
  private readonly statics: OrientedBox[];
  private readonly checkpoints: Checkpoint[];
  private readonly finishZones: FinishZone[];
  private readonly launchPads: LaunchPadConfig[];
  /**
   * Volumes, sorted highest-`priority`-first once here at construction
   * (M3.7 ticket 04, ADR 0036) — resolving containment every tick against a
   * pre-sorted array means "first match wins" is all `resolveActiveVolume`
   * needs, rather than re-scanning for a max every tick.
   */
  private readonly volumes: VolumeConfig[];
  private readonly killPlaneY: number;
  /** See `SimulationConfig.authoritative`. */
  private readonly authoritative: boolean;
  /** See `SimulationConfig.roundRules`; mutable so the client's own copy can adopt the server's via `syncRoundRules`. */
  private roundRules: RoundRules;
  private readonly spinners: Spinner[];
  private readonly props: Prop[];
  private readonly spinnerByHandle = new Map<number, Spinner>();
  private readonly movingSegments: MovingSegment[];
  private readonly movingSegmentByHandle = new Map<number, MovingSegment>();
  /** Every collider of a Spiked Asset, still or moving (ADR 0061). */
  private readonly spikedHandles = new Set<number>();
  private readonly propByHandle = new Map<number, Prop>();
  private readonly propIndexByHandle = new Map<number, number>();
  /** Capsule collider handle → Character ID, so a Character-to-Character contact can find the Character it hit (ticket 04 — Bump). */
  private readonly characterIdByHandle = new Map<number, string>();
  /** Every Grab hold in progress, and everything a hold does to the pair in it (ADR 0101) — see {@link GrabHolds}. */
  private readonly holds = new GrabHolds({
    character: (id) => this.characters.get(id),
    ids: () => this.characters.keys(),
    eliminated: (id) => this.progress.get(id)?.eliminated ?? true,
    effectiveInput: (id, inputs, matchLocked) => this.effectiveInput(id, inputs, matchLocked),
    nearestInCone: (fromId, fromPos, facing, range, facingCosMin, exclude) =>
      this.findNearestInCone(fromId, fromPos, facing, range, facingCosMin, exclude),
    tick: () => this.tickCount,
    roll: (id) => slipRoll(id, this.tickCount),
    credit: (targetId, byId, how) => this.credit(targetId, byId, how),
    struggleWon: (id) => {
      const progress = this.progress.get(id);
      if (progress) progress.strugglesWon += 1;
    },
  });
  /**
   * Client-only (ADR 0104): the hold the server last said the local Character
   * is in, if any — see {@link syncOwnHold}. Empty on the server, which has
   * {@link holds} instead.
   */
  private readonly ownHolds = new Map<string, { role: HoldRole; phase: HeldPhase | null }>();
  /**
   * Static collider handle → Surface id (ticket 01, ADR 0036) — the one
   * piece of plumbing the whole Surface path needed: without this, reading
   * "what Surface is this Character standing on?" from a collider handle
   * would mean a new scene query instead, which would depend on collider
   * insertion order and break client/server determinism quietly.
   */
  private readonly staticSurfaceByHandle = new Map<number, SurfaceId>();
  /**
   * Static collider handle → belt flow (ADR 0064) — the Conveyor half of
   * {@link staticSurfaceByHandle}'s own idea, one map rather than a
   * belt-shaped hole in the Surface registry: a belt is a vector, not an id,
   * and it composes with whatever Surface the same collider already has
   * (mud slows the belt's own target, ice slows how fast you're carried).
   * No entry (the common case) is still floor.
   */
  private readonly staticConveyorByHandle = new Map<number, Vec3>();
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

  /** See `SimulationConfig.profileClock`. */
  private readonly profileClock: (() => number) | null;
  private readonly lastPhaseMs = { movingSegmentsMs: 0, characterSweepsMs: 0, characterUpdatesMs: 0 };

  /**
   * Set by {@link RapierSimulation.dispose}. The Rapier `World` is WASM
   * memory: once freed, every handle into it dangles, and calling through one
   * crashes inside the engine with no useful stack. This turns that into a
   * plain error at the call site.
   */
  private disposed = false;

  constructor(config: SimulationConfig = {}) {
    this.statics = config.statics ?? [DEFAULT_GROUND];
    this.checkpoints = config.checkpoints ?? [];
    this.finishZones = config.finishZones ?? [];
    this.launchPads = config.launchPads ?? [];
    this.volumes = byVolumePriority(config.volumes ?? []);
    this.killPlaneY = config.killPlaneY ?? DEFAULT_KILL_PLANE_Y;
    this.authoritative = config.authoritative ?? true;
    this.roundRules = config.roundRules ?? DEFAULT_ROUND_RULES;

    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    this.profileClock = config.profileClock ?? null;
    if (this.profileClock) this.world.profilerEnabled = true;

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
      const belt = config.staticConveyors?.[i];
      if (belt !== undefined) this.staticConveyorByHandle.set(collider.handle, belt);
    });

    for (const mesh of config.staticTrimeshes ?? []) {
      const vertices = new Float32Array(mesh.vertices.flatMap((v) => [v.x, v.y, v.z]));
      // ORIENTED (pseudo-normals for border contacts) is correct exactly
      // when winding is consistently outward — verified per file by the
      // signed-volume test in `assetModules.test.ts`, which fails on any
      // future file that breaks the assumption instead of letting Players
      // fall through its edges in-game.
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(vertices, new Uint32Array(mesh.indices), RAPIER.TriMeshFlags.ORIENTED).setCollisionGroups(
          STATIC_GROUPS,
        ),
        this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
      );
      this.staticSurfaceByHandle.set(collider.handle, mesh.surface);
      if (mesh.hazard === "spiked") this.spikedHandles.add(collider.handle);
      if (mesh.conveyor !== undefined) this.staticConveyorByHandle.set(collider.handle, mesh.conveyor);
    }

    this.movingSegments = (config.movingSegments ?? []).map((c) => new MovingSegment(this.world, c, this.tickCount));
    for (const segment of this.movingSegments) {
      for (const { collider, surface, hazard, conveyor } of segment.colliders) {
        this.movingSegmentByHandle.set(collider.handle, segment);
        if (hazard === "spiked") this.spikedHandles.add(collider.handle);
        // A Surface rides its Moving Segment like any other floor (ADR 0036).
        this.staticSurfaceByHandle.set(collider.handle, surface);
        if (conveyor !== undefined) this.staticConveyorByHandle.set(collider.handle, conveyor);
      }
    }

    this.spinners = (config.spinners ?? []).map((c) => new Spinner(this.world, c));
    for (const spinner of this.spinners) this.spinnerByHandle.set(spinner.collider.handle, spinner);

    this.props = (config.props ?? []).map((c) => new Prop(this.world, c));
    this.props.forEach((prop, i) => {
      // An Asset Prop collides as several parts (ADR 0095); a shove landing on
      // any of them has to find the same Prop.
      for (const collider of prop.colliders) {
        this.propByHandle.set(collider.handle, prop);
        this.propIndexByHandle.set(collider.handle, i);
      }
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
  /**
   * Where `point` can actually seat a Character (see `SEAT_CLEAR_STEP`'s own
   * doc): overlapping anything solid that is not a Character, the seat rises
   * step by step until the capsule stands clear. A pure read of the world at
   * seat time, so the client's own simulation seats its Character at the
   * same height the server did. Roofed all the way up, the authored point is
   * kept — a spawn that broken is the Track author's to see, not this
   * method's to hide.
   */
  private clearSeat(point: Vec3): Vec3 {
    // Colliders join the query structures on the next step — a seat taken
    // before the world ever stepped (the constructor's own) would probe an
    // empty scene. A zero-dt step refreshes them while integrating nothing:
    // no gravity, no motion, and seating always happens between real ticks,
    // so no queued kinematic target is waiting to be applied.
    const timestep = this.world.timestep;
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = timestep;
    // A hair under the real capsule, so a seat resting exactly ON a floor —
    // the ordinary case — never reads as inside it; only true penetration lifts.
    const shape = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT - 0.02, CAPSULE_RADIUS - 0.02);
    for (let lift = 0; lift <= SEAT_CLEAR_MAX_LIFT; lift += SEAT_CLEAR_STEP) {
      let blocked = false;
      this.world.intersectionsWithShape({ x: point.x, y: point.y + lift, z: point.z }, IDENTITY_QUAT, shape, (collider) => {
        if (!collider.isSensor() && !this.characterIdByHandle.has(collider.handle)) blocked = true;
        return !blocked;
      });
      if (!blocked) return lift === 0 ? point : { x: point.x, y: point.y + lift, z: point.z };
    }
    return point;
  }

  addCharacter(id: string, point: Vec3): void {
    // Guard against orphaning the previous Character's Rapier bodies if `id`
    // is reused (e.g. a reconnect) before it was explicitly removed.
    this.removeCharacter(id);
    point = this.clearSeat(point);

    const onCollision: CollisionListener = (colliderHandle, hitPoint, velocity, normal) => {
      if (this.spikedHandles.has(colliderHandle)) {
        // Standing on or running into spikes (ADR 0061): a knockdown, whatever the speed.
        this.characters.get(id)?.applyImpact(spikedKnockback(normal), "Obstacle");
        return;
      }
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
      touchedLaunchPadIndex: undefined,
      finishTick: null,
      eliminated: false,
      eliminatedTick: null,
      lastTouch: null,
      eliminatedBy: null,
      strugglesWon: 0,
    });
  }

  /** Records that `byId` just grabbed, threw or hit `targetId` — what a knockout is credited to (ADR 0110). */
  private credit(targetId: string, byId: string, how: EliminationHow): void {
    const progress = this.progress.get(targetId);
    if (progress && targetId !== byId) progress.lastTouch = { byId, how, tick: this.tickCount };
  }

  /**
   * This tick's Ride for `character` (ADR 0061), or `undefined`: grounded on a
   * Moving Segment, it is carried by that Segment's rigid movement from this
   * Tick's pose to the next — read off the pure {@link movingSegmentPose},
   * never off the body, so it is right even on the first tick after a
   * reconcile moved the Tick. A reconcile also forgets which collider the
   * Character stood on (`reconcileTo`); a grounded Character with no known
   * ground looks straight down for a Moving Segment instead, or a player
   * riding through a correction would miss one carry and mispredict again.
   */
  private rideFor(character: CharacterController): Ride | undefined {
    if (this.movingSegments.length === 0 || !character.isGrounded) return undefined;
    const handle = character.groundColliderHandle;
    const segment = handle !== undefined ? this.movingSegmentByHandle.get(handle) : this.movingSegmentBelow(character.position);
    if (!segment) return undefined;
    const now = movingSegmentPose(segment.config, this.tickCount);
    const next = movingSegmentPose(segment.config, this.tickCount + 1);
    const at = character.position;
    const local = rotateVec3ByQuat(subVec3(at, now.position), conjugateQuat(now.rotation));
    const carriedTo = addVec3(rotateVec3ByQuat(local, next.rotation), next.position);
    return { displacement: subVec3(carriedTo, at), ignoreColliders: segment.colliderHandles };
  }

  /**
   * The belt flow under a Ragdolling body, if it lies (or tumbles low) over
   * one. A belt is virtual — its collider never moves — so without this the
   * drag has nothing to read and a down body stands still on a running belt
   * (found live 2026-09-20). Only Ragdoll proper: a Held body belongs to its
   * hold, and GettingUp's capsule rides the belt itself while the sweep
   * follows it. Characters and bones never count as the floor below.
   */
  private beltUnderRagdoll(character: CharacterController): Vec3 | undefined {
    if (character.motionState !== "Ragdoll") return undefined;
    const at = character.position;
    const hit = this.world.castRay(
      new RAPIER.Ray({ x: at.x, y: at.y, z: at.z }, { x: 0, y: -1, z: 0 }),
      RAGDOLL_BELT_REACH,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => ((collider.collisionGroups() >>> 16) & (GROUP_CHARACTER | GROUP_RAGDOLL)) === 0,
    );
    return hit ? this.staticConveyorByHandle.get(hit.collider.handle) : undefined;
  }

  /**
   * Moving Segments that moved into `character` this step (ADR 0061): each one
   * pushes the capsule out along its contact normal (taken by the next sweep),
   * and the closing speed there — the Segment's velocity at the contact point
   * along that normal, net of the Character's own — is an Impact through the
   * same Stagger/Ragdoll thresholds as a Bump. A contact from below is the
   * floor it stands on: a Ride, never a hit. Only the strongest Impact of the
   * tick is delivered, like two walls hit at once.
   */
  private resolveMovingSegmentContacts(character: CharacterController): void {
    if (this.movingSegments.length === 0 || isDownMotionState(character.motionState)) return;
    const capsule = this.world.getCollider(character.colliderHandle);
    if (!capsule || !capsule.isEnabled()) return;
    let push: Vec3 | undefined;
    let strongest: { impulse: Vec3; magnitude: number } | undefined;
    this.world.intersectionsWithShape(
      capsule.translation(),
      capsule.rotation(),
      capsule.shape,
      (collider) => {
        const segment = this.movingSegmentByHandle.get(collider.handle)!;
        const contact = collider.contactCollider(capsule, 0);
        if (!contact) return true;
        const normal = vec3(contact.normal1.x, contact.normal1.y, contact.normal1.z);
        if (this.spikedHandles.has(collider.handle)) {
          // Spiked: from any side, the floor included — no Ride exemption.
          if (!strongest || SPIKED_IMPACT_MAGNITUDE > strongest.magnitude) {
            strongest = { impulse: spikedKnockback(normal), magnitude: SPIKED_IMPACT_MAGNITUDE };
          }
        }
        if (normal.y > SURFACE_GROUND_NORMAL_MIN_Y) return true;
        const point = vec3(contact.point1.x, contact.point1.y, contact.point1.z);
        const segmentVelocity = this.movingSegmentVelocityAt(segment, point);
        const direction = pushDirection(normal, segmentVelocity, character.isGrounded);
        if (!direction) return true;
        const depth = -contact.distance;
        if (depth > 0 && (!push || depth > lengthVec3(push))) push = scaleVec3(direction, depth);
        const closing = dotVec3(subVec3(segmentVelocity, character.currentVelocity), direction);
        const magnitude = movingSegmentImpactMagnitude(closing);
        if (magnitude > 0 && (!strongest || magnitude > strongest.magnitude)) {
          const away = normalizeVec3(vec3(direction.x, direction.y + MOVING_SEGMENT_LIFT_RATIO, direction.z));
          strongest = { impulse: scaleVec3(away, magnitude), magnitude };
        }
        return true;
      },
      undefined,
      undefined,
      capsule,
      undefined,
      (collider) => this.movingSegmentByHandle.has(collider.handle),
    );
    if (push) character.queuePush(push);
    if (strongest) character.applyImpact(strongest.impulse, "Obstacle");
  }

  /** Velocity of the world point `point` on `segment` over the step just taken (Tick − 1 → Tick). */
  private movingSegmentVelocityAt(segment: MovingSegment, point: Vec3): Vec3 {
    const now = movingSegmentPose(segment.config, this.tickCount);
    const before = movingSegmentPose(segment.config, this.tickCount - 1);
    const local = rotateVec3ByQuat(subVec3(point, now.position), conjugateQuat(now.rotation));
    const then = addVec3(rotateVec3ByQuat(local, before.rotation), before.position);
    return scaleVec3(subVec3(point, then), 1 / TICK_DT);
  }

  /** The Moving Segment directly under a capsule centred at `center`, if its feet are on one. */
  private movingSegmentBelow(center: Vec3): MovingSegment | undefined {
    const reach = 0.1;
    const hit = this.world.castRay(
      new RAPIER.Ray({ x: center.x, y: center.y - CAPSULE_BOTTOM_OFFSET + reach, z: center.z }, { x: 0, y: -1, z: 0 }),
      reach + GROUND_SNAP_DISTANCE,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => this.movingSegmentByHandle.has(collider.handle),
    );
    return hit ? this.movingSegmentByHandle.get(hit.collider.handle) : undefined;
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
    this.credit(bumpedId, moverId, "hit");
  }

  /**
   * The input `id` actually moves on this tick — `inputs[id]` verbatim,
   * unless the Match is locked or `id` has already finished, in which case
   * movement/actions are substituted with idle (M5 ticket 01, ADR 0044) but
   * `facing` is preserved from whatever this Character was last actually
   * looking (code review, M6 ticket 04): `IDLE_INPUTS.facing` is a bare `0`,
   * and substituting it wholesale snapped a locked/finished Character's
   * rendered orientation to a fixed direction the instant it happened,
   * visible to every other client. Used both for `beginTick` itself and for
   * `updateGrabs`'s own struggle-free check, which must judge the SAME
   * input the held Character's own movement this tick was actually driven
   * by — not the raw, pre-substitution one.
   */
  private effectiveInput(id: string, inputs: Record<string, SimInputs>, matchLocked: boolean): SimInputs {
    const progress = this.progress.get(id)!;
    if (!matchLocked && progress.finishTick === null) return inputs[id] ?? IDLE_INPUTS;
    return { ...IDLE_INPUTS, facing: this.characters.get(id)?.facing ?? 0 };
  }

  /**
   * The nearest OTHER Character within `range` and within `facingCosMin` of
   * `facing`, from `fromPos` — the exact targeting shape both Hit (ticket 03)
   * and Grab (ticket 04) need: "the Character just ahead of you" (CONTEXT.md),
   * a plain geometric proximity+facing check against positions this class
   * already tracks, never a new Rapier hitbox/sensor. `exclude` additionally
   * filters out candidates a caller already knows are ineligible (Grab: a
   * Character already part of another hold).
   */
  private findNearestInCone(
    fromId: string,
    fromPos: Vec3,
    facing: number,
    range: number,
    facingCosMin: number,
    exclude: (id: string) => boolean,
  ): string | undefined {
    // `forward(yaw) = (sin, 0, -cos)` — `movementDirection`'s own convention
    // (ADR 0045's `facing` is sent in exactly this space).
    const forward = vec3(Math.sin(facing), 0, -Math.cos(facing));

    let bestId: string | undefined;
    let bestDistance = range;
    for (const [id, other] of this.characters) {
      // Code review: an eliminated Character is inert by design (ADR 0042 —
      // "nobody can shove it and it can't shove anybody") for both Hit and
      // Grab, universally, not just a caller-specific exclusion.
      if (id === fromId || this.progress.get(id)!.eliminated || exclude(id)) continue;
      const toOther = subVec3(other.position, fromPos);
      toOther.y = 0;
      const distance = lengthVec3(toOther);
      if (distance === 0 || distance > bestDistance) continue;
      const facingDot = dotVec3(forward, normalizeVec3(toOther));
      if (facingDot < facingCosMin) continue;
      bestDistance = distance;
      bestId = id;
    }
    return bestId;
  }

  /**
   * Hit (M6 ticket 03): a player-initiated melee swing, resolved once every
   * Character's `beginTick` has run this tick but before `world.step()` —
   * the same pre-step timing Bump's own `resolveBump` gets "for free" from
   * firing inside `beginTick`'s collision sweep, so a target's `applyImpact`
   * here lands before anyone's post-step bookkeeping (`updateCheckpoint` etc.)
   * runs for *any* Character this tick, exactly like Bump's own ordering.
   *
   * Targets the nearest OTHER Character within {@link HIT_RANGE} and within
   * {@link HIT_FACING_COS_MIN} of the striker's own replicated `facing` —
   * reusing the exact Impact-application pipeline Bump already uses
   * (`applyImpact` / `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN`).
   *
   * How hard it lands comes from {@link hitImpactMagnitude} (M6.1: hold-to-
   * charge), so a fully-charged swing knocks down and a tapped one Staggers —
   * decided by those same two thresholds, never by a branch of Hit's own.
   *
   * Connecting cancels the TARGET's own in-progress Dash (CONTEXT.md's own
   * Hit/Grab definition) — always, regardless of whether the resulting
   * Impact clears `IMPACT_STAGGER_MIN`, so this is explicit here rather than
   * left to ride along with whatever motion-state transition the Impact
   * happens to cause. The striker's own Dash is never cancelled here because
   * it can never be in progress: Dash gates Hit out entirely while a burst
   * plays (M6.1), so a swing cannot fire while its own striker is mid-Dash.
   */
  private resolveHit(strikerId: string): void {
    const striker = this.characters.get(strikerId);
    if (!striker) return;
    const strikerPos = striker.position;
    // ADR 0104: never a Held Character — it takes no Impact — so a swing at a
    // pair lands on the grabber behind it.
    const bestId = this.findNearestInCone(
      strikerId,
      strikerPos,
      striker.facing,
      HIT_RANGE,
      HIT_FACING_COS_MIN,
      (id) => this.characters.get(id)!.motionState === "Held",
    );
    if (bestId === undefined) return;

    const target = this.characters.get(bestId)!;
    const toTarget = normalizeVec3(vec3(target.position.x - strikerPos.x, 0, target.position.z - strikerPos.z));
    const direction = normalizeVec3(vec3(toTarget.x, HIT_LIFT_RATIO, toTarget.z));
    target.applyImpact(scaleVec3(direction, hitImpactMagnitude(striker.hitChargeFraction)), "Hit");
    target.registerHitReceived();
    target.cancelDash();
    this.credit(bestId, strikerId, "hit");
  }

  /** Remove a Character from the Match and free its Rapier bodies (ticket 01). */
  removeCharacter(id: string): void {
    const character = this.characters.get(id);
    if (character) this.characterIdByHandle.delete(character.colliderHandle);
    character?.dispose();
    this.characters.delete(id);
    this.progress.delete(id);
    this.tickStart.delete(id);
    this.holds.drop(id);
  }

  /**
   * Mark a Character eliminated directly, outside a Fall (M5 ticket 04, ADR
   * 0042) — a mid-Round disconnect, which used to call {@link removeCharacter}
   * mid-Round and disturb contact resolution for everyone still playing.
   * Its entry stays, its body stays (collider disabled), the simulated set
   * and iteration order never vary — the caller no longer removes it. Needs
   * no `RoundRules` opinion: a disconnect ends a Character's part in any
   * Round type, not only an eliminating one. A no-op if `id` doesn't exist
   * or is already eliminated.
   */
  eliminateCharacter(id: string): void {
    const progress = this.progress.get(id);
    if (!progress || progress.eliminated) return;
    progress.eliminated = true;
    progress.eliminatedTick = this.tickCount;
    const character = this.character(id);
    character.eliminate();
    // Same bookkeeping `tick`'s own per-Character loop does right after a
    // Fall-eliminated Character's `motionState` changes — done here too,
    // since this runs outside that loop (called directly from a socket
    // close handler, between ticks) and nothing will ever run it for this
    // Character again once `eliminated` starts skipping it (code review).
    if (character.motionState !== progress.lastMotionState) {
      progress.phaseStartTick = this.tickCount;
      progress.lastMotionState = character.motionState;
    }
  }

  /**
   * Qualify every Character still standing (M5 ticket 05, ADR 0042) — a
   * Survival Round's own ending grants Qualification to whoever it left
   * un-eliminated, all at once, rather than a Race's own per-Character
   * Finish Zone crossing. Match authority only: `matchLoop.ts` calls this
   * exactly once, the Tick it decides the Round has ended, never predicted
   * by a client — which Character survives depends on every other
   * Character, exactly the kind of decision ADR 0003/0042 keep off the
   * shared step. A Character that already has a `finishTick` some other
   * way (impossible on a zoneless Survival Track today — but not assumed
   * here) keeps its own earlier one.
   */
  qualifySurvivors(tick: number): void {
    for (const progress of this.progress.values()) {
      if (!progress.eliminated && progress.finishTick === null) progress.finishTick = tick;
    }
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
  applyImpact(id: string, impulse: Vec3, cause?: RagdollCause): void {
    this.character(id).applyImpact(impulse, cause);
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
  reconcileCharacter(id: string, base: ReconcileBase): void {
    this.character(id).reconcileTo(base);
    // Re-derive "which pad (if any) is this Character standing in" from the
    // RESTORED position, rather than blanking it to "touching nothing." A
    // wide pad's trigger can easily span many ticks' worth of travel — under
    // realistic reconciliation cadence this rarely matters (the correction
    // and the pad's own edges rarely coincide), but a naive blank reset fails
    // badly under a "reconciles every single tick" stress: dozens of
    // consecutive corrections would each independently see a "fresh" rising
    // edge into a pad the Character has been inside the whole time, firing
    // the one-shot write over and over — precisely the double-fire the
    // ticket's own prediction test (RapierSimulation.test.ts) exists to
    // catch. Never re-fires here itself — it only seeds the baseline the
    // very next replayed tick's own rising-edge check compares against.
    const progress = this.progress.get(id);
    if (progress) {
      // A launch pad's whole effect already lives in `base.velocity`, but
      // the touch index still needs to be right before the next replayed
      // tick's own rising-edge check runs.
      progress.touchedLaunchPadIndex = this.findTriggerIndex(this.launchPads, base.position);
      // Qualification is synced from the authority outright, never merged
      // (M4 ticket 02) — the same reasoning as ADR 0015's unconditional
      // down-state sync. The client predicts entering the zone so its input
      // locks at the right Tick, but a prediction that was wrong (a capsule
      // that grazed the boundary here and not on the server) would otherwise
      // stay locked for the rest of the Round, sending nothing but idle
      // input while the server kept expecting it to run. The server's answer
      // wins in both directions.
      progress.finishTick = base.finishTick;
      // Elimination is latched too (M5 ticket 04) — synced outright for the
      // same reason: a disconnect-triggered one never applies to your own
      // Character (nothing to predict), and a Fall-triggered misprediction
      // must not stay locally "still in it" for the rest of the Round.
      progress.eliminated = base.eliminated;
      progress.eliminatedTick = base.eliminatedTick;
      progress.eliminatedBy = base.eliminatedBy;
    }
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
    if (this.movingSegments.length === 0) return;
    // A Moving Segment is posed from the Tick (ADR 0061): after a jump in it,
    // put every one where the new Tick says before anything sweeps against it.
    for (const segment of this.movingSegments) segment.place(serverTick);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  /**
   * Client-only (ADR 0104): the hold the server's latest snapshot says `id` —
   * the local Character — is in, read off its own row. No hold is ever
   * resolved in a client's world (the other end of it is a mirror, not a
   * Character), so without this the grabber's own prediction would walk at
   * full pace and turn at full speed while the server carried, and the held
   * Character's would never Struggle. Applied before every tick, replays
   * included, until a snapshot says otherwise.
   */
  syncOwnHold(id: string, row: Pick<CharacterSnapshot, "grabbingId" | "heldByGrabberId" | "heldPhase">): void {
    if (row.grabbingId !== null) this.ownHolds.set(id, { role: "grabbing", phase: null });
    else if (row.heldByGrabberId !== null) this.ownHolds.set(id, { role: "held", phase: row.heldPhase });
    else this.ownHolds.delete(id);
  }

  /**
   * Adopt the server's own resolved `RoundRules` (M5 ticket 02, ADR 0041) —
   * the client's own guess at construction time (before any snapshot has
   * arrived) can only be the Track's bare default; the server may have
   * overridden it. Called every snapshot, the same cadence `phase` is
   * captured at (`game.ts`), so it self-corrects the instant the real value
   * is known and is a no-op once it already matches.
   *
   * The server calls it in exactly one place (M5 ticket 07): a Lobby host
   * picking a Round type, which re-resolves the rules and hands them here
   * rather than rebuilding a world that has not changed. That does not
   * weaken ADR 0041's "nothing downstream re-resolves" — the rules are
   * still resolved once, by `MatchRuntime.resolveRules`, and are still fixed
   * for the life of a *Round*: `setRoundType` is LOBBY-only, so nothing can
   * move them once a Round is under way.
   */
  syncRoundRules(rules: RoundRules): void {
    this.roundRules = rules;
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
   *
   * `phase` is the one the caller's own reconcile is currently acting under —
   * applied to every replayed tick alike (M5 ticket 01). A phase transition
   * landing mid-replay is a real but vanishingly rare edge (the whole
   * unacked span this replays is only an RTT wide); the client's own
   * behaviour already treated this instant as the reconcile's single source
   * of truth for tick alignment and Prop poses before this ticket, so this
   * follows the same discipline rather than inventing per-tick phase history
   * nothing else here tracks.
   */
  replayLocalCharacter(id: string, inputs: readonly SimInputs[], phase: MatchPhase = "RUNNING"): Vec3[] {
    const positions: Vec3[] = [];
    for (const input of inputs) {
      this.tick({ [id]: input }, phase);
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
   *
   * `phase` answers the one question every Round type's "who may move right
   * now" rule ultimately reduces to (M5 ticket 01, ADR 0044 extending ADR
   * 0040): whether every Character's input is locked this tick. Defaults to
   * `"RUNNING"` (unlocked) so the many callers that only care about physics —
   * most of this file's own tests among them — never have to think about
   * Match phase at all; the two real production callers (the server's Match
   * loop, and the client's own local prediction) always pass their current
   * phase, which is what makes the two stop and start driving the Character
   * on the identical Tick.
   */
  tick(inputs: Record<string, SimInputs>, phase: MatchPhase = "RUNNING"): void {
    if (this.disposed) throw new Error("RapierSimulation: tick() on a disposed simulation");
    // A phase whose world does not step freezes the Characters with it
    // (found live 2026-09-18, amending the 2026-09 grilling session's
    // `world.step()` gate below): this method used to run every Character's
    // `beginTick` in every phase while the skipped step never applied the
    // sweep's queued translation — so the body never moved, never landed,
    // and gravity kept integrating into `velocity.y`, −22 u/s per second of
    // Lobby. The Countdown's first sweep then moved whole metres in one
    // tick and, depending on exactly how much a given Lobby wait had
    // accumulated, either clamped on the start deck or put the capsule
    // INSIDE it — every Player, authoritatively, "sometimes". Frozen means
    // frozen: nothing below runs, and COUNTDOWN drops everyone their 0.35
    // spawn hover afresh. Only `tickCount` still advances — freezing it too
    // is exactly the tick-epoch bug class M5 ticket 08 found live.
    if (!phaseNeedsPhysicsStep(phase)) {
      this.tickCount += 1;
      return;
    }
    // Queue each Spinner's rotation for the tick about to run — it must be
    // queued before `world.step()` applies it, the same way each Character's
    // own `setNextKinematicTranslation` works.
    for (const spinner of this.spinners) spinner.tick(this.tickCount + 1);
    // Mirrored other-players (client only) are re-placed from their latest
    // snapshot pose every tick — they never move under their own physics.
    for (const mirror of this.mirrors.values()) mirror.step();
    for (const [id, character] of this.characters) {
      this.tickStart.set(id, { position: { ...character.position }, respawning: character.hasPendingRespawn });
    }

    // "May this Character be driven this tick?" (M5 ticket 01) is now decided
    // in exactly one place: the whole Match is locked outside RUNNING (ADR
    // 0040 — Lobby, Countdown, Round end), or this one Character is
    // individually locked because it Qualified (M4 ticket 02, ADR 0039) and
    // stops to spectate from inside the zone.
    //
    // Applied here, in the shared step, rather than by the server dropping
    // the packet or the client withholding it before this call: that is what
    // makes a client's own prediction lock at the same Tick the server does,
    // so it never runs half an RTT past a lock before being yanked back.
    // Everything else still acts on the body while locked: gravity,
    // collision, and another Character shoving it are all unchanged.
    //
    // An eliminated Character (M5 ticket 04, ADR 0042) is a step further:
    // not merely locked but not stepped at all — no `beginTick`/`endTick`,
    // no Checkpoint/Fall/pad detection, nothing. Its entry and body both
    // stay (the simulated set and iteration order never vary); its collider
    // is already disabled (`eliminate`/`fall`'s own doing), so nobody can
    // shove it and it can't shove anybody. The cost per tick is exactly what
    // ADR 0042 asks for: an iteration and a branch, not a controller sweep.
    const matchLocked = phaseLocksInput(phase);
    // ADR 0104: both ends of every hold are told so before `beginTick` reads
    // it — the grabber walks loaded and Spins, the held one Struggles. "Not
    // engaged until proven otherwise" every tick, exactly like the
    // Surface/Volume defaults below.
    for (const [id, character] of this.characters) {
      if (this.progress.get(id)!.eliminated) continue;
      character.clearHold();
      character.setRide(this.rideFor(character));
      character.setRagdollBelt(this.beltUnderRagdoll(character));
    }
    this.holds.assertBeforeStep();
    for (const [id, hold] of this.ownHolds) this.characters.get(id)?.holdAs(hold.role, hold.phase);
    const clock = this.profileClock;
    const holdStarted = clock ? clock() : 0;
    for (const segment of this.movingSegments) segment.holdForSweeps();
    const holdMs = clock ? clock() - holdStarted : 0;

    const sweepsStarted = clock ? clock() : 0;
    for (const [id, character] of this.characters) {
      const progress = this.progress.get(id)!;
      if (progress.eliminated) continue;
      character.beginTick(this.effectiveInput(id, inputs, matchLocked));
    }
    if (clock) this.lastPhaseMs.characterSweepsMs = clock() - sweepsStarted;
    const moveStarted = clock ? clock() : 0;
    for (const segment of this.movingSegments) segment.tick(this.tickCount + 1);
    if (clock) this.lastPhaseMs.movingSegmentsMs = holdMs + clock() - moveStarted;
    // Resolved here — after every Character's `beginTick` has run this tick,
    // but before `world.step()` — the same pre-step timing Bump's own
    // `resolveBump` gets "for free" from firing inside `beginTick`'s own
    // collision sweep (see `resolveHit`'s own doc comment for why this
    // ordering matters).
    for (const [id, character] of this.characters) {
      // Code review: an eliminated Character never gets a fresh `beginTick`
      // (skipped just above, permanently), so `hitFiredThisTick`/
      // `grabFiredThisTick` — only ever reset at the top of `beginTick` —
      // would otherwise stay stuck at whatever they last were, firing every
      // tick forever against anyone who wanders near its frozen position.
      if (this.progress.get(id)!.eliminated) continue;
      if (character.hitFiredThisTick) this.resolveHit(id);
      // M6 ticket 04: same pre-step timing, same reason — a grab's own
      // `cancelDash` calls on both participants must land before anyone's
      // post-step bookkeeping runs this tick.
      if (character.grabFiredThisTick) this.holds.resolveGrabInitiation(id);
    }
    // Grilling session, 2026-09: `world.step()` — the expensive part, Rapier's
    // own collision/contact solve. A phase that doesn't need it never reaches
    // this line at all (the whole-tick freeze at the top of this method), so
    // by here it always runs.
    this.world.step();
    this.tickCount += 1;

    // Each Character must finish moving — including any queued respawn —
    // before Checkpoint and Fall detection read its position for this tick.
    const updatesStarted = clock ? clock() : 0;
    for (const [id, character] of this.characters) {
      const progress = this.progress.get(id)!;
      if (progress.eliminated) continue;
      character.endTick();
      this.resolveMovingSegmentContacts(character);
      this.updateCheckpoint(id);
      this.updateFinishZone(id);
      this.updateLaunchPad(id);
      this.detectFall(id, !matchLocked);
      // Stamp the tick a `motionState` phase begins, in sim-tick space, exactly
      // once (ADR 0023). Must be here, not in `snapshot()` — that is called
      // several times per client frame and before `syncTick` in reconcile.
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
      // M3.7 ticket 04, ADR 0036: this tick's now-updated position decides the
      // Volume that pushes *next* tick, the same one-tick lag as the Surface.
      // `this.volumes` is pre-sorted highest-priority-first, so the first
      // containing entry wins outright (never summed).
      const volume = volumeAt(this.volumes, character.position);
      character.applyGroundContext({
        surface: surfaceConfig(surfaceId),
        // ADR 0064: the same ground contact's belt — still floor, or mid-air,
        // reads as no belt at all.
        conveyor: groundHandle !== undefined ? this.staticConveyorByHandle.get(groundHandle) : undefined,
        volume: volume ? { force: volume.force, maxInducedSpeed: volume.maxInducedSpeed } : undefined,
        // The slip draw is made here because this is what knows both the
        // Character's id and the Tick. `syncTick` realigns `tickCount` to the
        // server's before every replay (ticket 05), precisely so tick-derived
        // pure functions match across prediction — the same guarantee Motion
        // phase already relies on, and the whole reason this chance can be
        // predicted instead of corrected.
        slipRoll: slipRoll(id, this.tickCount),
      });
      // M6.1: who (if anyone) this Character is currently grabbing, for the
      // renderer's own arm-reach pose — same "not engaged until proven
      // otherwise" default as the speed multiplier above; re-applied within
      // this same tick by `updateGrabs` below for whichever grabber is still
      // actively holding someone (including a hold that just started this
      // very tick, since `resolveGrabInitiation` already ran pre-step).
      character.setGrabbingId(null);
      // M6.1: the reverse of grabbingId — same default-reset treatment.
      character.reportHeld(null);
    }
    if (clock) this.lastPhaseMs.characterUpdatesMs = clock() - updatesStarted;
    this.holds.updateGrabs(inputs, matchLocked);
    // A hold can change a motion state after the loop above has stamped them
    // (ADR 0104: a Hurl, a Limp body put down, a Struggle won), and the phase
    // it starts has to be stamped on the Tick it started, like every other.
    for (const [id, character] of this.characters) {
      const progress = this.progress.get(id)!;
      if (progress.eliminated || character.motionState === progress.lastMotionState) continue;
      progress.phaseStartTick = this.tickCount;
      progress.lastMotionState = character.motionState;
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

  /**
   * Which entry of `triggers` (if any) `point` currently lies inside — one
   * lookup shared by every rising-edge `OrientedBox` trigger this project
   * has (M3.7 ticket 01's speed pads today; the milestone's own bounce/
   * launch pads, ticket 02, need the identical one-shot-on-entry check
   * next). `Checkpoint`'s own containment check doesn't route through this:
   * it only ever moves forward (`reached + 1..`), never re-arms, and has no
   * "which one changed" question to answer — a plain `pointInOrientedBox`
   * scan is all it needs.
   */
  private findTriggerIndex(triggers: readonly { trigger: OrientedBox }[], point: Vec3): number | undefined {
    const index = triggers.findIndex((t) => pointInOrientedBox(point, t.trigger));
    return index === -1 ? undefined : index;
  }

  private updateCheckpoint(id: string): void {
    const character = this.character(id);
    const progress = this.progress.get(id)!;
    const reached = progress.checkpointIndex ?? -1;
    const p = character.position;
    for (let i = reached + 1; i < this.checkpoints.length; i += 1) {
      const checkpoint = this.checkpoints[i]!;
      const got = checkpoint.gate ? this.passedThisTick(id, checkpoint.gate) : pointInOrientedBox(p, checkpoint.trigger);
      if (got) {
        progress.checkpointIndex = i;
        progress.respawnPoint = { ...checkpoint.respawn };
      }
    }
  }

  /** Whether this Character passed through `gate` during the tick just stepped (ADR 0068). */
  private passedThisTick(id: string, gate: NonNullable<Checkpoint["gate"]>): boolean {
    const start = this.tickStart.get(id);
    if (!start || start.respawning) return false;
    return passesThroughGate(start.position, this.character(id).position, gate);
  }

  /**
   * Qualification (M4 ticket 02, ADR 0039): the Tick this Character's
   * capsule centre first lies inside any Finish Zone. A pure function of
   * position, so the client's own prediction derives it identically — nothing
   * about it depends on being the server.
   *
   * Latched, not rising-edge: unlike a pad, a Finish Zone fires once per
   * Round and never re-arms, so there is no `touched…Index` to track and
   * leaving the zone changes nothing.
   *
   * Deliberately *not* skipped while down, unlike the launch pad check —
   * a Character shoved into the zone mid-ragdoll has still entered it, and
   * "entry counts" is the whole M4 rule (ADR 0039). That a launch pad or a
   * Bump can put you there is the design, not a hole in it.
   *
   * Skipped outright for an eliminating Round type (M5 ticket 05, ADR
   * 0041/0043, found by code review): what grants Qualification is the
   * Round type's own rule, same as what a Fall does — a Survival-only Track
   * authors no Finish Zone of its own, but nothing before ticket 07 lets
   * the Lobby run Survival on anything *but* an ordinary,
   * possibly-Finish-Zone-carrying Track (the test-only `fallBehaviorOverride`
   * this ticket's own tests use is exactly that case). Without this, two
   * Characters could Qualify by simply crossing a leftover Finish Zone,
   * bypassing `qualifySurvivors`/the Survivor Target entirely.
   */
  private updateFinishZone(id: string): void {
    if (this.roundRules.fallBehavior === "eliminate") return;
    const progress = this.progress.get(id)!;
    if (progress.finishTick !== null) return;
    const p = this.character(id).position;
    if (!this.finishZones.some((zone) => (zone.gate ? this.passedThisTick(id, zone.gate) : pointInOrientedBox(p, zone.trigger)))) return;
    progress.finishTick = this.tickCount;
  }

  /**
   * Rising-edge launch pad detection (M3.7 ticket 02) — fires exactly once
   * per crossing: the tick this Character's (just-updated) position enters a
   * pad's `trigger` it wasn't already inside, via {@link findTriggerIndex}.
   * Leaving (or switching to a different pad) re-arms it. Skipped entirely
   * while down (a Ragdolling/GettingUp Character never gets launched — the
   * whole point of a launch pad is a deliberate, player-caused jump, not
   * something that fires while they have no control at all), and the touch
   * index is left untouched (not blanked) while down, so standing back up
   * still inside the same trigger correctly reads as "already touching it,"
   * not a fresh edge.
   */
  private updateLaunchPad(id: string): void {
    const character = this.character(id);
    // ADR 0104: nor while Held — a carried body would bank the launch for the
    // first tick it was its own again.
    if (!isPlayerDrivenMotionState(character.motionState)) return;
    const progress = this.progress.get(id)!;
    const touched = this.findTriggerIndex(this.launchPads, character.position);
    if (touched !== undefined && touched !== progress.touchedLaunchPadIndex) {
      character.triggerLaunchPad(this.launchPads[touched]!.velocity);
    }
    progress.touchedLaunchPadIndex = touched;
  }

  /**
   * What follows a Fall is read from `RoundRules.fallBehavior`, not
   * hardcoded (M5 ticket 03, ADR 0042) — a Race passes this Character's own
   * `respawnPoint` (unchanged), an eliminating Round type passes `null`, and
   * `CharacterController.fall` decides what that means. The Fall itself —
   * a Character's centre crossing the kill plane — is unchanged either way.
   *
   * `roundRunning` gates only the *eliminating* half — see below.
   */
  private detectFall(id: string, roundRunning: boolean): void {
    const character = this.character(id);
    const progress = this.progress.get(id)!;
    if (character.hasPendingRespawn || character.position.y >= this.killPlaneY) return;
    // Already resolved — Qualified, spectating (code review, ticket 05):
    // without this, residual ragdoll momentum from an unrelated Impact
    // could carry an already-Qualified Survival Character across the kill
    // plane one or more ticks later, marking it eliminated too and
    // contradicting `finishTick !== null` on the very same snapshot. A
    // Character that has already Qualified has nothing left for a Fall to
    // change, in either Round type.
    if (progress.finishTick !== null) return;

    progress.fallCount += 1;
    // Only a Round that is actually RUNNING can eliminate (code review,
    // ticket 07). `fallBehavior` is resolved the moment a Lobby host picks
    // Survival, but physics keeps running through LOBBY and COUNTDOWN —
    // input is locked, gravity and Spinners are not — so without this a
    // Character shoved off the start platform before the Countdown ends is
    // Eliminated from a Round that has not begun, permanently: nothing
    // between LOBBY and RUNNING rebuilds the world, and `eliminated` is
    // never cleared. Outside a running Round a Fall does what it has always
    // done and respawns, in either Round type.
    const eliminates = roundRunning && this.roundRules.fallBehavior === "eliminate";
    if (eliminates) {
      progress.eliminated = true;
      // The Tick elimination was *marked* (this one, post-`world.step()` —
      // see `tick`'s own call site), not the Tick of the Fall that doomed
      // it: the kill plane can fire one or more Ticks late, and ranking by
      // when it was marked is the honest read of "how long they lasted."
      progress.eliminatedTick = this.tickCount;
      // ADR 0110: whoever last grabbed, threw or hit it, if recently enough.
      const touch = progress.lastTouch;
      progress.eliminatedBy =
        touch !== null && this.tickCount - touch.tick <= ELIMINATION_CREDIT_TICKS ? { byId: touch.byId, how: touch.how } : null;
    }
    character.fall(eliminates ? null : progress.respawnPoint, progress.fallCount);
  }

  /**
   * Struggles each Character won in this world, by id (ADR 0110) — only the
   * ones that won any. The Match server adds them up across a Match's Rounds
   * for the career's GRABS BROKEN; it never rides a snapshot.
   */
  strugglesWon(): Record<string, number> {
    const won: Record<string, number> = {};
    for (const [id, progress] of this.progress) if (progress.strugglesWon > 0) won[id] = progress.strugglesWon;
    return won;
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
        finishTick: progress.finishTick,
        eliminated: progress.eliminated,
        eliminatedTick: progress.eliminatedTick,
        eliminatedBy: progress.eliminatedBy,
      });
    }
    return {
      tick: this.tickCount,
      characters,
      props: this.props.map((p) => p.snapshot()),
    };
  }

  /** What the last tick cost (M13 ticket 02), or `null` when this simulation was built without a `profileClock`. */
  lastTickTimings(): SimulationTimings | null {
    if (!this.profileClock) return null;
    const world = this.world;
    return {
      stepMs: world.timingStep(),
      collisionDetectionMs: world.timingCollisionDetection(),
      broadPhaseMs: world.timingBroadPhase(),
      narrowPhaseMs: world.timingNarrowPhase(),
      solverMs: world.timingSolver(),
      ccdMs: world.timingCcd(),
      userChangesMs: world.timingUserChanges(),
      ...this.lastPhaseMs,
    };
  }

  /**
   * Release the Rapier world and everything in it (M4 ticket 01).
   *
   * `World.free()` frees every body, collider, joint and character controller
   * it owns, so the per-entity `dispose` methods are deliberately not called
   * here — they would each remove something from a world that is about to
   * vanish anyway. What matters is that this happens *at all*: a client that
   * routes into the game and back out repeatedly (ADR 0008) builds a
   * prediction world each time, and WASM memory is not reclaimed by the JS
   * garbage collector.
   *
   * Idempotent: teardown can run more than once, and a double `free()` is a
   * crash inside Rapier rather than a no-op.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
    this.characters.clear();
    this.mirrors.clear();
    this.progress.clear();
    this.spinnerByHandle.clear();
    this.movingSegmentByHandle.clear();
    this.propByHandle.clear();
    this.propIndexByHandle.clear();
    this.characterIdByHandle.clear();
    this.staticSurfaceByHandle.clear();
  }
}

import RAPIER from "@dimforge/rapier3d-compat";
import { lengthVec3, lerpVec3, normalizeVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  DASH_SPEED,
  DASH_WALL_IMPACT_MAGNITUDE,
  DASH_WALL_LIFT_RATIO,
  DASH_WALL_MIN_SPEED_RATIO,
  GETUP_CAPSULE_LIFT,
  GETUP_TICKS,
  GRAVITY_Y,
  GROUND_STICK_SPEED,
  IMPACT_STAGGER_MIN,
  RAGDOLL_IMPACT_VELOCITY_SCALE,
  RAGDOLL_SETTLE_SPEED,
  RESPAWN_FLOP_IMPULSE,
  TICK_DT,
  WALK_SPEED,
  WALL_NORMAL_MAX_Y,
} from "../tuning.js";
import type { CharacterSnapshot, RagdollCause } from "../state/SimState.js";
import { CharacterStateMachine, type CharacterMotionState } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS, GROUP_CHARACTER } from "./collisionGroups.js";
import { DashController, JumpController } from "./movementVerbs.js";
import { Ragdoll } from "./Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";

const isDown = (state: CharacterMotionState): boolean => state === "Ragdoll" || state === "GettingUp";

interface PendingImpact {
  magnitude: number;
  impulse: Vec3;
}

interface PendingRespawn {
  point: Vec3;
  fallCount: number;
}

/**
 * Reported once per Obstacle/Prop/other-Character the Character's movement
 * collides with this tick (ticket 06, extended for Bump in ticket 04) —
 * `RapierSimulation` looks `colliderHandle` up against its own Spinners/Props/
 * Characters and decides what the contact does; `CharacterController` only
 * knows *that* something was hit, *where*, how fast it was moving, and the
 * contact `normal` (pointing from the thing hit back toward this Character).
 */
export type CollisionListener = (
  colliderHandle: number,
  point: Vec3,
  characterVelocity: Vec3,
  normal: Vec3,
) => void;

/**
 * Knockback for a Dash blocked by a near-vertical surface: bounces back along
 * `normal` (the obstacle's outward contact normal, which already points away
 * from the surface toward the Character — no sign flip needed), plus a small
 * lift, always at {@link DASH_WALL_IMPACT_MAGNITUDE}.
 */
export const dashWallKnockback = (normal: Vec3): Vec3 => {
  const away = normalizeVec3(vec3(normal.x, DASH_WALL_LIFT_RATIO, normal.z));
  return scaleVec3(away, DASH_WALL_IMPACT_MAGNITUDE);
};

/** What {@link CharacterController.snapshot} reports back to `RapierSimulation` each tick. */
export interface CharacterState {
  /** The point the camera follows: capsule centre while upright, pelvis while ragdolling. */
  position: Vec3;
  /** Capsule velocity (units/s) this tick — a reconciling client restores it as a replay base (ticket 05). */
  velocity: Vec3;
  grounded: boolean;
  motionState: CharacterMotionState;
  /** Monotonic count of Respawn teleports — the renderer snaps on a change (ADR 0023). */
  respawnCount: number;
  /** Rises on every entry to `Ragdoll` (ADR 0023). */
  ragdollEpoch: number;
  /** Why the current / most recent knockdown happened (ADR 0023). */
  ragdollCause: RagdollCause;
  dashCooldownMs: number;
  /** Whether a Dash burst is currently playing out (for the renderer to speed up the movement animation). */
  dashing: boolean;
  /** Current horizontal speed (units/s) contributed by an active Dash burst; 0 when not dashing. Drives the speed-lines effect directly — no noisy derivation from position needed. */
  dashSpeed: number;
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
  private readonly onCollision: CollisionListener | undefined;
  /**
   * Whether this Character decides for itself when a knockdown ends (the
   * Ragdoll body's own physics settle-check). `false` for the client's
   * local-prediction Character — see `SimulationConfig.authoritative` /
   * ADR 0015.
   */
  private readonly authoritative: boolean;

  private tickCount = 0;
  /** Capsule velocity (units/s): `x`/`z` set fresh each Controlled tick, `y` integrated. */
  private velocity: Vec3 = vec3();
  private grounded = false;
  /**
   * Monotonic count of Respawn teleports (ADR 0023 / Q9). The renderer holds the
   * last value it saw and snaps (no interpolation) when it changes — robust
   * against the interpolation buffer skipping the exact respawn tick, which a
   * one-tick boolean was not.
   */
  private respawnCount = 0;
  /** Rises on every entry to `Ragdoll` (ADR 0023). */
  private ragdollEpoch = 0;
  /** Cause latched on the last Ragdoll entry; `pendingCause` is what the next entry will latch. */
  private ragdollCause: RagdollCause = "Fall";
  private pendingCause: RagdollCause = "Fall";
  /** Set by {@link beginTick}, read by {@link endTick} once the shared `world.step()` has run. */
  private tickingRagdoll = false;

  private readonly machine = new CharacterStateMachine();
  private readonly jump = new JumpController();
  private readonly dash = new DashController();
  /**
   * Current horizontal speed (units/s) contributed by an active Dash burst —
   * the exact `dashEnvelope` curve already driving the physics, exposed
   * directly so the renderer's speed-lines effect doesn't have to derive it
   * (noisily) from position deltas. 0 whenever no burst is active.
   */
  private dashSpeed = 0;
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;

  /** Strongest Impact queued since the last tick, with the shove to apply if it ragdolls. */
  private pendingImpact: PendingImpact | null = null;
  /** Set by {@link fall}; consumed at the top of the next {@link tick}. */
  private pendingRespawn: PendingRespawn | null = null;

  private getupBones: readonly BoneSnapshot[] = [];
  private getupStartTick = 0;
  private getupStartRoot: Vec3 = vec3();

  constructor(world: RAPIER.World, spawn: Vec3, onCollision?: CollisionListener, authoritative = true) {
    this.world = world;
    this.onCollision = onCollision;
    this.authoritative = authoritative;

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

  /** This tick's capsule velocity (units/s). Used by `RapierSimulation` to compute a Bump's closing speed against another Character (ticket 04). */
  get currentVelocity(): Vec3 {
    return { ...this.velocity };
  }

  /** Handle of this Character's capsule collider, so `RapierSimulation` can recognise it as the thing another Character bumped into (ticket 04). */
  get colliderHandle(): number {
    return this.collider.handle;
  }

  /** The current motion state — a cheap read (no bone/pose computation), for transition detection. */
  get motionState(): CharacterMotionState {
    return this.machine.state;
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
  applyImpact(impulse: Vec3, cause: RagdollCause = "Bump"): void {
    const magnitude = lengthVec3(impulse);
    // Only an impact big enough to change state names the cause of the knockdown
    // it will trigger — a sub-threshold nudge from lingering contact must not
    // overwrite a real cause latched earlier (ADR 0023).
    if (magnitude >= IMPACT_STAGGER_MIN) this.pendingCause = cause;
    this.machine.impact(magnitude);
    if (!this.pendingImpact || magnitude > this.pendingImpact.magnitude) {
      this.pendingImpact = { magnitude, impulse: { ...impulse } };
    }
    if (this.machine.state === "Ragdoll") this.ragdoll.applyImpulse(impulse);
  }

  /** Queue a Fall respawn at `point`, applied at the top of the next {@link tick}. */
  fall(point: Vec3, fallCount: number): void {
    this.resetMovementControllers();
    this.pendingCause = "Fall";
    this.machine.forceRagdoll();
    this.pendingRespawn = { point: { ...point }, fallCount };
  }

  /**
   * Advance one tick, split around the shared `world.step()` (ticket 02) so
   * `RapierSimulation` can drive several Characters through a single step:
   * {@link beginTick} queues this Character's movement/state-machine work,
   * the caller steps the (one, shared) world, then {@link endTick} reads the
   * result back. Single-Character callers (tests) may call both back to back
   * with a `world.step()` between them, exactly like this used to be one method.
   */
  beginTick(input: SimInputs): void {

    const jumpPressed = input.jumpHeld && !this.jumpHeldLastTick;
    const dashPressed = input.dashHeld && !this.dashHeldLastTick;
    this.jumpHeldLastTick = input.jumpHeld;
    this.dashHeldLastTick = input.dashHeld;

    // Order matters: read prevState before the machine ticks; compute `settled`
    // from last tick's physics before this tick's world.step().
    const prevState = this.machine.state;
    // A non-authoritative (client-prediction) Character never trusts its own
    // settle-check to end a knockdown — only a server snapshot can (ADR 0015).
    // Without this it could recover *ahead* of the server, which is exactly
    // what reopens the double-knockdown bug ADR 0014 fixed: a later, slower
    // snapshot still reporting the old episode would read as a fresh one.
    const settled =
      this.authoritative && this.ragdoll.isActive && this.ragdoll.maxSpeed() < RAGDOLL_SETTLE_SPEED;
    const state = this.machine.tick(settled);

    // Every entry to Ragdoll is a new down episode (ADR 0023) — whether it came
    // from an Impact, a forced Fall, or the Respawn flop.
    if (state === "Ragdoll" && prevState !== "Ragdoll") {
      this.ragdollEpoch += 1;
      this.ragdollCause = this.pendingCause;
    }

    if (this.pendingRespawn) {
      this.respawnAtCheckpoint(this.pendingRespawn);
    } else if (state === "Ragdoll" && prevState !== "Ragdoll") {
      this.beginRagdoll();
    }
    if (prevState === "Ragdoll" && state === "GettingUp") this.beginGettingUp();
    if (prevState === "GettingUp" && state === "Controlled") this.getupBones = [];

    this.tickingRagdoll = state === "Ragdoll";
    if (!this.tickingRagdoll) {
      this.beginCapsuleTick(input, jumpPressed, dashPressed);
    }
  }

  /** The other half of {@link beginTick}, run after the shared `world.step()`. */
  endTick(): void {
    if (this.tickingRagdoll) {
      this.body.setTranslation(this.ragdoll.rootPosition(), false); // camera continuity
      this.grounded = false;
    }
    this.tickCount += 1;
  }

  /** Single-Character convenience: {@link beginTick}, step this Character's own world, {@link endTick}. */
  tick(input: SimInputs): void {
    this.beginTick(input);
    this.world.step();
    this.endTick();
  }

  /** Controlled / Stagger / GettingUp: queue the kinematic capsule's movement, input scaled by the state. */
  private beginCapsuleTick(input: SimInputs, jumpPressed: boolean, dashPressed: boolean): void {
    // Stagger dampens *all* movement input — walk, jump and dash — not just walk.
    const fullControl = this.machine.inputScale >= 1;
    const move = scaleVec3(input.moveDirection, this.machine.inputScale);

    const takeoff = this.jump.beginTick(this.grounded, fullControl && jumpPressed);
    if (takeoff !== null) this.velocity.y = takeoff;
    const gravityScale = this.jump.gravityScale(fullControl && input.jumpHeld, this.velocity.y);
    this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT;

    const walk = scaleVec3(move, WALK_SPEED);
    // Dash only starts while grounded (a walking burst, not an air dash); an
    // already-active burst keeps running if it carries the Character off an edge.
    const dashBurst = this.dash.beginTick(move, fullControl && dashPressed && this.grounded);
    this.dashSpeed = lengthVec3(dashBurst);
    this.velocity.x = walk.x + dashBurst.x;
    this.velocity.z = walk.z + dashBurst.z;

    // `filterGroups: CHARACTER_GROUPS` so the sweep honours collision groups
    // the way the rest of the world does — without it the character controller
    // collides against *everything*, including another Character's active
    // ragdoll bones (ticket 04: two Characters, one down), which would wall-
    // knock or block the mover on a body it should pass straight through.
    this.rapierController.computeColliderMovement(
      this.collider,
      scaleVec3(this.velocity, TICK_DT),
      undefined,
      CHARACTER_GROUPS,
    );
    const corrected = this.rapierController.computedMovement();
    this.grounded = this.rapierController.computedGrounded();
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -GROUND_STICK_SPEED;
      this.jump.land();
    }

    this.resolveCollisions(lengthVec3(dashBurst));

    const at = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: at.x + corrected.x,
      y: at.y + corrected.y,
      z: at.z + corrected.z,
    });
    // No world.step() here — the caller (RapierSimulation) steps once for
    // every Character's queued movement (ticket 02); the single-Character
    // `tick()` convenience above steps right after calling this.
  }

  /**
   * Walk this tick's `computeColliderMovement` collisions (ticket 06): a Dash
   * burst moving at or above {@link DASH_WALL_MIN_SPEED_RATIO} of full speed,
   * blocked by a near-vertical surface, knocks the Character down (wall or
   * Spinner or Prop — whatever it hit) — a slow build-up or late-release hit
   * is just a blocked walk. Another Character is the exception: dashing into a
   * player never knocks the *mover* down (ticket 04 — Bump is one-sided, only
   * the one bumped goes down), so the wall-crash check skips Character
   * colliders. Every collision is still forwarded to {@link onCollision} so
   * `RapierSimulation` can resolve the contact — Spinner Knockback, a shoved
   * Prop, or a Bump delivered to the other Character.
   */
  private resolveCollisions(dashSpeed: number): void {
    const dashingFastEnough = dashSpeed >= DASH_SPEED * DASH_WALL_MIN_SPEED_RATIO;
    const count = this.rapierController.numComputedCollisions();
    for (let i = 0; i < count; i += 1) {
      const collision = this.rapierController.computedCollision(i);
      if (!collision?.collider) continue;

      const hitCharacter = ((collision.collider.collisionGroups() >>> 16) & GROUP_CHARACTER) !== 0;
      const normal = vec3(collision.normal1.x, collision.normal1.y, collision.normal1.z);

      if (dashingFastEnough && !hitCharacter && Math.abs(normal.y) < WALL_NORMAL_MAX_Y) {
        this.applyImpact(dashWallKnockback(normal), "DashWall");
      }

      if (this.onCollision) {
        const point = vec3(collision.witness1.x, collision.witness1.y, collision.witness1.z);
        this.onCollision(collision.collider.handle, point, { ...this.velocity }, normal);
      }
    }
  }

  private beginRagdoll(): void {
    const at = this.body.translation();
    const impulse = this.takeImpactImpulse();
    // A crash (dash into a wall/Prop, a Bump, a Spinner — anything carrying an
    // Impact impulse) absorbs most forward momentum: the ragdoll tumbles, it
    // doesn't keep full dash speed and rocket through what it hit (ticket 08).
    // A Fall carries no impulse and keeps its velocity.
    const scale = lengthVec3(impulse) > 0 ? RAGDOLL_IMPACT_VELOCITY_SCALE : 1;
    const launch = scaleVec3(this.velocity, scale); // captured before resetMovementControllers zeroes it
    this.collider.setEnabled(false);
    this.resetMovementControllers();
    this.ragdoll.activate(vec3(at.x, at.y, at.z), launch, impulse);
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
    this.respawnCount += 1;
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
    this.dashSpeed = 0;
  }

  /** The GettingUp blend's current position — shared by `snapshot()` and `reconcileTo`'s position-tracking correction. */
  private getupBlendedPosition(elapsed: number, capsuleCentre: Vec3): Vec3 {
    const getupT = Math.min(1, Math.max(0, elapsed / GETUP_TICKS));
    return lerpVec3(this.getupStartRoot, capsuleCentre, getupT);
  }

  snapshot(): CharacterState {
    const state = this.machine.state;
    const t = this.body.translation();
    const capsuleCentre = vec3(t.x, t.y, t.z);

    let position = capsuleCentre;
    let velocity = this.velocity;
    let bones: BoneSnapshot[] = [];
    if (state === "Ragdoll") {
      position = this.ragdoll.rootPosition();
      // The capsule's own velocity was zeroed the moment Ragdoll began
      // (`resetMovementControllers`); report the ragdoll body's real velocity
      // instead so a reconciling client has a real launch to hand its own
      // ragdoll on a forced Bump snap (ticket 08 follow-up), not zero.
      velocity = this.ragdoll.rootVelocity();
      bones = this.ragdoll.readBones();
    } else if (state === "GettingUp") {
      const elapsed = this.tickCount - this.getupStartTick;
      // position rises smoothly from the settled pelvis to the standing capsule,
      // so there is no jump at the Ragdoll → GettingUp boundary
      position = this.getupBlendedPosition(elapsed, capsuleCentre);
      bones = blendGettingUpBones(this.getupBones, capsuleCentre, elapsed);
    }

    return {
      position,
      velocity: { ...velocity },
      grounded: this.grounded,
      motionState: state,
      respawnCount: this.respawnCount,
      ragdollEpoch: this.ragdollEpoch,
      ragdollCause: this.ragdollCause,
      dashCooldownMs: this.dash.cooldownMs,
      dashing: this.dash.isActive,
      dashSpeed: this.dashSpeed,
      bones,
    };
  }

  /**
   * Reconciliation base (ticket 05, ADR 0013, ADR 0015): overwrite this
   * Character's predicted state with the server's authoritative snapshot so
   * the client can replay its not-yet-acknowledged inputs forward from here.
   * The client is responsible for deciding *when* a correction is warranted
   * (a tick-aligned position-error check, or a discrete-state disagreement);
   * this method just applies it.
   *
   * - **Server reports a down state:** always synced, unconditionally — enter
   *   `Ragdoll` now if we weren't already down, then advance to `GettingUp`
   *   too if the server has and we haven't, then re-anchor the pelvis to the
   *   server's position. Safe (idempotent, never a duplicate knockdown)
   *   specifically because a non-`authoritative` Character never decides on
   *   its own when a knockdown ends (ADR 0015) — it can only ever be at or
   *   behind the server's down-state, never ahead of it, so there is no
   *   "stale vs. live" report left to tell apart. This restores ADR 0013's
   *   original "any snapshot reporting a discrete state forces the snap"
   *   rule; ADR 0014's `bumpSeq`/`forceRagdoll` gate is superseded.
   * - **Server reports `Controlled`/`Stagger`:** restore the capsule transform,
   *   velocity, ground flag, motion state and dash cooldown from the snapshot;
   *   the caller then replays buffered inputs from here. `dashing` tells the
   *   dash controller whether an in-progress local burst should keep playing
   *   out (see {@link DashController.restoreCooldownMs}) —
   *   reconciliation must not silently truncate a burst the server agrees is
   *   still happening.
   */
  reconcileTo(
    base: Pick<CharacterSnapshot, "position" | "velocity" | "grounded" | "motionState" | "dashCooldownMs" | "dashing">,
  ): void {
    const serverDown = isDown(base.motionState);

    if (serverDown) {
      if (this.machine.state !== base.motionState) {
        if (!isDown(this.machine.state)) {
          // A knockdown the client never predicted at all (or already wrongly
          // recovered from — which can't happen once `authoritative` is
          // false, but stays correct either way): flop now, at the server's
          // real position, not wherever we last predicted.
          this.body.setTranslation({ ...base.position }, false);
          this.velocity = { ...base.velocity };
          this.machine.snapTo("Ragdoll");
          this.beginRagdoll();
        }
        if (base.motionState === "GettingUp" && this.machine.state !== "GettingUp") {
          this.machine.snapTo("GettingUp");
          this.beginGettingUp();
        }
      }
      if (this.ragdoll.isActive) this.ragdoll.snapRootTo(base.position);
      return;
    }

    if (isDown(this.machine.state)) this.returnToControlled();
    this.body.setTranslation({ ...base.position }, false);
    this.velocity = { ...base.velocity };
    this.grounded = base.grounded;
    this.machine.snapTo(base.motionState);
    this.dash.restoreCooldownMs(base.dashCooldownMs, base.dashing);
    this.jump.reset(); // stale coyote/hold bookkeeping would let replay grant a jump the server won't
    this.pendingRespawn = null; // a Fall the client predicted but the server (this base) hasn't seen
  }

  /** Undo a local Ragdoll/GettingUp the server says never happened (or is already over): freeze and hide the bones, re-enable the capsule. */
  private returnToControlled(): void {
    if (this.ragdoll.isActive) this.ragdoll.deactivate();
    this.collider.setEnabled(true);
    this.getupBones = [];
    this.pendingImpact = null;
    this.resetMovementControllers();
  }

  /** Remove this Character's capsule body, character controller and ragdoll bones from the world (ticket 01: `removeCharacter`). */
  dispose(): void {
    this.ragdoll.dispose();
    this.world.removeCharacterController(this.rapierController);
    this.world.removeRigidBody(this.body);
  }
}

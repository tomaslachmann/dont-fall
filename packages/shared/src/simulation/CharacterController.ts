import RAPIER from "@dimforge/rapier3d-compat";
import { dotVec3, lengthVec3, lerpVec3, normalizeVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
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
  GROUND_SNAP_DISTANCE,
  GROUND_STICK_SPEED,
  IMPACT_STAGGER_MIN,
  RAGDOLL_IMPACT_VELOCITY_SCALE,
  RAGDOLL_SETTLE_SPEED,
  RESPAWN_FLOP_IMPULSE,
  SLIDE_STEER_BLEND,
  SURFACE_GROUND_NORMAL_MIN_Y,
  TICK_DT,
  WALK_SPEED,
  WALKABLE_SLOPE_MAX_ANGLE,
  WALL_NORMAL_MAX_Y,
} from "../tuning.js";
import type { CharacterSnapshot, RagdollCause } from "../state/SimState.js";
import { CharacterStateMachine, type CharacterMotionState } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS, GROUP_CHARACTER } from "./collisionGroups.js";
import { DashController, JumpController, slopeSpeedMultiplier } from "./movementVerbs.js";
import { Ragdoll } from "./Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";

const isDown = (state: CharacterMotionState): boolean => state === "Ragdoll" || state === "GettingUp";

/** A ground normal's Y component below this is steeper than {@link WALKABLE_SLOPE_MAX_ANGLE} — the walkable/Sliding boundary, ticket 03. */
const WALKABLE_NORMAL_MIN_Y = Math.cos(WALKABLE_SLOPE_MAX_ANGLE);

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
   * The floor collider this tick's ground contact was against, if any
   * (ticket 01/ADR 0036) — the "floor collider the character controller
   * already reports" `RapierSimulation` resolves a Surface from, without a
   * new scene query. Set in {@link resolveCollisions} from this tick's own
   * `computeColliderMovement` collisions (the same list the dash-into-wall
   * check already walks), never from a separate raycast. `undefined`
   * whenever not grounded, so `RapierSimulation` reads the default Surface
   * in the air exactly like it would with no ground contact at all.
   */
  private currentGroundColliderHandle: number | undefined;
  /**
   * This tick's ground-contact surface normal, if any (ticket 03, M3.6) —
   * what decides `tooSteepToWalk` (below) and, while `Sliding`, the
   * direction gravity is projected along. Updated in {@link resolveCollisions}
   * with exactly the same "only update on a fresh hit, clear only once
   * ungrounded" stickiness as {@link currentGroundColliderHandle}, for the
   * same reason (code review, ticket 02): Rapier's own snap-to-ground can
   * make `computedGrounded()` true via a correction that never appears in
   * `computedCollision()`'s list, and this is exactly the steep/fast-descent
   * case that happens on.
   */
  private currentGroundNormal: Vec3 | undefined;
  /**
   * Multiplies `WALK_SPEED` this tick (ticket 01) — set from outside by
   * `RapierSimulation` once it's resolved {@link groundColliderHandle}
   * against the Track's Surfaces, one tick behind (the same lag `grounded`
   * itself already has relative to `RapierSimulation`'s per-tick bookkeeping).
   * 1 (no effect) until anything ever calls {@link setSurfaceTopSpeedMultiplier}.
   */
  private surfaceTopSpeedMultiplier = 1;
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
    // Snap-to-ground ON (ticket 02, M3.6) — a spike measured it against the
    // M1-era edge-stalling/Dash-hitching symptoms it was originally disabled
    // for and reproduced neither; disabling it instead reliably reproduces
    // the ramp-skip bug it now fixes (see ticket 02's notes for both sets of
    // numbers). Autostep stays OFF: it hitches during fast movement (Dash),
    // and nothing about this ticket touches that rationale.
    this.rapierController.enableSnapToGround(GROUND_SNAP_DISTANCE);
    // Rapier's own climb/slide split is collapsed back to one coincident
    // value (ticket 03, M3.6, ADR 0037) — but at the *wall* angle
    // (`WALL_NORMAL_MAX_Y`), not its old 45°/45° default. That leaves Rapier
    // responsible for exactly one thing: "is this even standable ground at
    // all" (below it, `computedGrounded()` can be true; at/above it, this
    // is a wall — blocked, never grounded). The finer walkable-vs-Sliding
    // split within that band is this project's own job (`beginCapsuleTick`'s
    // `tooSteepToWalk` branch + `CharacterStateMachine`), reading the actual
    // ground-contact normal directly rather than leaning on a second Rapier
    // threshold — the ADR's "two explicit, independent thresholds" are
    // WALKABLE_SLOPE_MAX_ANGLE and WALL_NORMAL_MAX_Y, not two Rapier knobs.
    const wallAngle = Math.acos(WALL_NORMAL_MAX_Y);
    this.rapierController.setMaxSlopeClimbAngle(wallAngle);
    this.rapierController.setMinSlopeSlideAngle(wallAngle);
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

  /** Handle of the floor collider this tick's ground contact was against, or `undefined` if not grounded (ticket 01) — see {@link currentGroundColliderHandle}. */
  get groundColliderHandle(): number | undefined {
    return this.currentGroundColliderHandle;
  }

  /** Sets this tick's Surface-driven top-speed multiplier (ticket 01) — see {@link surfaceTopSpeedMultiplier}. */
  setSurfaceTopSpeedMultiplier(multiplier: number): void {
    this.surfaceTopSpeedMultiplier = multiplier;
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
    // Ticket 03, M3.6: last tick's ground contact (from `resolveCollisions`,
    // read here before this tick's own sweep overwrites it) decides whether
    // this tick enters/stays in `Sliding` — the same one-tick lag `grounded`
    // itself already has relative to jump/landing. `currentGroundNormal` is
    // `undefined` both while airborne and while grounded on a Surface flat
    // enough to be filtered out by `SURFACE_GROUND_NORMAL_MIN_Y`, so both
    // correctly read as "not too steep" here.
    const tooSteepToWalk =
      this.grounded && this.currentGroundNormal !== undefined && this.currentGroundNormal.y < WALKABLE_NORMAL_MIN_Y;
    const state = this.machine.tick(settled, tooSteepToWalk);

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
      // No ground sweep runs while ragdolling — leaving the last-known handle
      // in place could hand RapierSimulation a stale Surface (e.g. still
      // "mud" from before the knockdown) the instant it gets back up
      // somewhere else entirely. The next real `beginCapsuleTick` recomputes
      // this fresh from an actual sweep.
      this.currentGroundColliderHandle = undefined;
      this.currentGroundNormal = undefined;
    }
    this.tickCount += 1;
  }

  /** Single-Character convenience: {@link beginTick}, step this Character's own world, {@link endTick}. */
  tick(input: SimInputs): void {
    this.beginTick(input);
    this.world.step();
    this.endTick();
  }

  /** Controlled / Stagger / Sliding / GettingUp: queue the kinematic capsule's movement, input scaled by the state. */
  private beginCapsuleTick(input: SimInputs, jumpPressed: boolean, dashPressed: boolean): void {
    // Stagger/Sliding both dampen *all* movement input — walk, jump and dash
    // — not just walk.
    const fullControl = this.machine.inputScale >= 1;
    const move = scaleVec3(input.moveDirection, this.machine.inputScale);
    const sliding = this.machine.state === "Sliding";

    const takeoff = this.jump.beginTick(this.grounded, fullControl && jumpPressed);
    if (takeoff !== null) this.velocity.y = takeoff;
    // Dash only starts while grounded and in full control (a walking burst,
    // not an air dash, and never while Sliding); an already-active burst's
    // own remaining duration still ticks down here even while Sliding, it
    // just doesn't contribute to velocity below (ticket 03 simplification —
    // ADR 0035's persistent-velocity model, not yet built, is what would
    // unify how a burst's momentum carries across a state change).
    const dashBurst = this.dash.beginTick(move, fullControl && dashPressed && this.grounded);
    this.dashSpeed = sliding ? 0 : lengthVec3(dashBurst);
    // Surface-scaled, but not yet slope-scaled (below) — the Sliding branch
    // uses this as-is for its steering blend, deliberately never applying
    // the slope-angle multiplier (ticket 04): that model is for walking
    // only, per ADR 0037/CONTEXT.md's split between the two.
    const walk = scaleVec3(move, WALK_SPEED * this.surfaceTopSpeedMultiplier);

    if (sliding && this.currentGroundNormal) {
      // ADR 0037: the one place gravity is projected onto the slope plane and
      // integrated tick over tick, rather than the direct `velocity.xz =
      // target` assignment every other Controlled/Stagger tick uses below —
      // ADR 0035 rejects that accelerating model for ordinary walking, but
      // adopts it here.
      const gravity = vec3(0, GRAVITY_Y, 0);
      const normal = this.currentGroundNormal;
      const slopeGravity = subVec3(gravity, scaleVec3(normal, dotVec3(gravity, normal)));
      // `walk` is already reduced via SLIDE_INPUT_SCALE (folded into `move`
      // above) — but it's still a *velocity*, not an acceleration, so it
      // can't just be integrated (`+= walk * TICK_DT`) alongside gravity
      // the way a first attempt at this did (code review): that grows
      // without bound the longer a direction is held, eventually swamping
      // the slide itself. Blending the horizontal velocity toward `walk`
      // each tick keeps steering genuinely limited — it can pull the
      // Character's own speed at most as far as `walk`'s magnitude, never
      // past it, while gravity keeps accumulating independently.
      const horizontal = lerpVec3({ x: this.velocity.x, y: 0, z: this.velocity.z }, walk, SLIDE_STEER_BLEND);
      this.velocity.x = horizontal.x + slopeGravity.x * TICK_DT;
      this.velocity.y += slopeGravity.y * TICK_DT;
      this.velocity.z = horizontal.z + slopeGravity.z * TICK_DT;
    } else {
      const gravityScale = this.jump.gravityScale(fullControl && input.jumpHeld, this.velocity.y);
      this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT;

      // Ticket 04: downhill faster, uphill slower — an explicit multiplier
      // keyed off the signed slope angle toward `move` (Unity's Character
      // Controller model, not Quake 3's flatten-to-slope-independent one;
      // see `slopeSpeedMultiplier`'s own doc comment for both). Only applies
      // to the walk contribution, not Dash — same "Surface caps WALK_SPEED,
      // never Dash" precedent ticket 01 already established — and only
      // while genuinely grounded on a real surface (mid-air/no ground
      // contact reads as flat, i.e. no effect, exactly like Surface itself).
      const slope =
        this.grounded && this.currentGroundNormal ? slopeSpeedMultiplier(move, this.currentGroundNormal) : 1;
      const slopedWalk = scaleVec3(walk, slope);
      this.velocity.x = slopedWalk.x + dashBurst.x;
      this.velocity.z = slopedWalk.z + dashBurst.z;
    }

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
    // Skipped while Sliding: this would overwrite the very slope-gravity
    // velocity just built up above with a flat constant every tick, which
    // is exactly the ground-stick-as-a-speed unit bug ticket 02 fixed —
    // reintroducing it here, just for Sliding, would recreate the same skip.
    if (this.grounded && this.velocity.y < 0 && !sliding) {
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
    // The most floor-like collision this tick (highest normal.y among the
    // roughly-horizontal, non-Character ones) — the ground contact ticket
    // 01/ADR 0036 reads a Surface from. `GROUND_STICK_SPEED` (below) is
    // exactly what makes this reliably show up here every grounded tick:
    // it's the reason a resting Character keeps sweeping into the floor at
    // all. `!hitCharacter` matters here for the same reason it matters to
    // the dash-wall check below: two overlapping Characters standing on a
    // tilted floor (ADR 0034) can produce a contact normal steeper than the
    // floor's own — without this exclusion that contact could outrank the
    // real floor and report the wrong (or no) Surface (code review).
    let groundNormalY = -Infinity;
    let groundHandle: number | undefined;
    let groundNormal: Vec3 | undefined;
    for (let i = 0; i < count; i += 1) {
      const collision = this.rapierController.computedCollision(i);
      if (!collision?.collider) continue;

      const hitCharacter = ((collision.collider.collisionGroups() >>> 16) & GROUP_CHARACTER) !== 0;
      const normal = vec3(collision.normal1.x, collision.normal1.y, collision.normal1.z);

      if (!hitCharacter && normal.y > SURFACE_GROUND_NORMAL_MIN_Y && normal.y > groundNormalY) {
        groundNormalY = normal.y;
        groundHandle = collision.collider.handle;
        groundNormal = normal;
      }

      if (dashingFastEnough && !hitCharacter && Math.abs(normal.y) < WALL_NORMAL_MAX_Y) {
        this.applyImpact(dashWallKnockback(normal), "DashWall");
      }

      if (this.onCollision) {
        const point = vec3(collision.witness1.x, collision.witness1.y, collision.witness1.z);
        this.onCollision(collision.collider.handle, point, { ...this.velocity }, normal);
      }
    }
    // Ticket 02 code review: Rapier's own snap-to-ground (enabled this
    // ticket) can make `computedGrounded()` true via an internal correction
    // that never goes through `computedCollision()`'s list at all — exactly
    // on the steep/fast-descent ticks this ticket targets, since those are
    // the ones the regular sweep alone doesn't keep contact on. When that
    // happens `groundHandle` is `undefined` even though the Character is
    // still standing on the same floor as last tick; overwriting
    // `currentGroundColliderHandle` to `undefined` here would silently drop
    // the Surface (mud/ice) back to default for as long as it persists —
    // confirmed empirically to last many consecutive ticks, not just one.
    // So: only ever *update* it when this tick's sweep actually found a
    // qualifying collision; otherwise keep whatever it was, and only clear
    // it once `grounded` itself goes false. Worst case this is one tick
    // stale right at a genuine Surface boundary — the same order of lag
    // already accepted everywhere else in this Surface pipeline.
    if (!this.grounded) {
      this.currentGroundColliderHandle = undefined;
      this.currentGroundNormal = undefined;
    } else if (groundHandle !== undefined) {
      this.currentGroundColliderHandle = groundHandle;
      this.currentGroundNormal = groundNormal;
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
    // The correction can move the capsule across a Surface boundary (mud vs
    // default) that a mispredicting client had no way to see coming — the
    // snapshot carries no Surface of its own (ADR 0036: it's a pure function
    // of position, never replicated), so the safest thing this can do is
    // fall back to no cap and let the very next real ground sweep recompute
    // the true Surface, exactly like the existing one-tick lag already does
    // after a normal landing. Without this the first tick replayed from here
    // would run with whatever multiplier happened to be set before the
    // correction (code review, ticket 01) — a *second*, undocumented tick of
    // wrong walk speed stacked on top of the position correction itself.
    this.currentGroundColliderHandle = undefined;
    // Code review, ticket 03: a snapshot's `motionState` is authoritative for
    // *state* but carries no ground normal of its own (never replicated —
    // it's a pure function of position, ADR 0036/0037). Clearing this to
    // `undefined` unconditionally (as the Surface handle above still
    // correctly does) would break reconciling into "Sliding" specifically:
    // `beginTick`'s `tooSteepToWalk` reads this field *before* this same
    // tick's own sweep can refresh it, so it would read `false` and the
    // state machine would immediately flip the just-restored Sliding back to
    // Controlled for one tick — discarding the server's own conclusion. A
    // synthetic near-vertical normal (just past the walkable threshold) is
    // enough to keep the *state* correct for that one tick; projected onto a
    // vertical normal, its own tangential-gravity contribution is ~0, so the
    // Character simply doesn't accelerate for that one tick instead of
    // wrongly regaining full control — a much smaller, self-correcting
    // discrepancy, fixed for real the moment the next sweep runs.
    this.currentGroundNormal = base.motionState === "Sliding" ? { x: 0, y: WALKABLE_NORMAL_MIN_Y - 0.01, z: 0 } : undefined;
    this.surfaceTopSpeedMultiplier = 1;
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

import RAPIER from "@dimforge/rapier3d-compat";
import { addVec3, dotVec3, lengthVec3, lerpVec3, normalizeVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  GETUP_CAPSULE_LIFT,
  GETUP_TICKS,
  GRAVITY_Y,
  GROUND_SNAP_DISTANCE,
  GROUND_STICK_SPEED,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  MOVE_ACCEL_FACTOR,
  MOVE_FRICTION_FACTOR,
  RAGDOLL_IMPACT_VELOCITY_SCALE,
  RAGDOLL_SETTLE_SPEED,
  RESPAWN_FLOP_IMPULSE,
  SLIDE_STEER_BLEND,
  SURFACE_GROUND_NORMAL_MIN_Y,
  TICK_DT,
  WALK_SPEED,
  WALKABLE_SLOPE_MAX_ANGLE,
  WALL_IMPACT_LIFT_RATIO,
  WALL_IMPACT_MIN_SPEED,
  WALL_IMPACT_SCALE,
  WALL_NORMAL_MAX_Y,
} from "../tuning.js";
import type { ReconcileBase, RagdollCause } from "../state/SimState.js";
import type { SurfaceBounceConfig } from "../track/Surface.js";
import { CharacterStateMachine, isDownMotionState, type CharacterMotionState } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS, GROUP_CHARACTER } from "./collisionGroups.js";
import { DashController } from "./DashController.js";
import { GrabController } from "./GrabController.js";
import { HitController } from "./HitController.js";
import { accelerateVelocity, applyVolumeForce, JumpController, slopeSpeedMultiplier, SpeedPadController } from "./movementVerbs.js";
import { Ragdoll } from "./Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";

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
 * Knockback for a Character moving fast enough into a near-vertical surface
 * (M3.7 ticket 03, ADR 0037) — Dash is one contributor to that speed among
 * several (a bounce, a launch pad, an updraft), never a special case of its
 * own. Bounces back along `normal` (the obstacle's outward contact normal,
 * which already points away from the surface toward the Character — no sign
 * flip needed), plus a small lift, with a magnitude that scales with
 * `closingSpeed` (how fast the Character was moving into the wall) instead
 * of the flat constant this replaced — a glancing, barely-qualifying hit now
 * lands softer than someone launched into the same wall at twice the speed.
 *
 * Floored at {@link IMPACT_RAGDOLL_MIN} (code review): `WALL_IMPACT_SCALE` is
 * calibrated so a full-strength Dash reproduces its old flat magnitude
 * exactly (`DASH_SPEED * WALL_IMPACT_SCALE === 14`), which makes a
 * closing speed only just at {@link WALL_IMPACT_MIN_SPEED} scale down to
 * ~8.4 — below `IMPACT_RAGDOLL_MIN`, so the wall-Impact check would fire
 * (`resolveCollisions` decided this was a wall hit) yet only Stagger the
 * Character, contradicting this very ticket's "any Character moving fast
 * enough into a wall goes down." The floor guarantees every hit that clears
 * the gate actually forces Ragdoll; it never engages above ~9.6 units/s
 * closing speed, so the proportional scaling (and the full-Dash-speed
 * continuity above) is otherwise untouched.
 */
export const wallImpactKnockback = (normal: Vec3, closingSpeed: number): Vec3 => {
  const away = normalizeVec3(vec3(normal.x, WALL_IMPACT_LIFT_RATIO, normal.z));
  return scaleVec3(away, Math.max(IMPACT_RAGDOLL_MIN, closingSpeed * WALL_IMPACT_SCALE));
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
  /** Rises every time this Character's own Hit swing fires, connects or not (M6 ticket 03). */
  hitEpoch: number;
  /** Rises every time this Character is on the receiving end of a landed Hit (M6 ticket 03). */
  hitReactEpoch: number;
  dashCooldownMs: number;
  /** Whether a Dash burst is currently playing out (for the renderer to speed up the movement animation). */
  dashing: boolean;
  /** Milliseconds left on the Hit cooldown; 0 means a swing is ready (M6 ticket 03). */
  hitCooldownMs: number;
  /** Ms charged so far on an in-progress Hit hold; 0 while not charging (M6.1: hold-to-charge). Drives the HUD's charge tell. */
  hitChargeMs: number;
  /** Milliseconds left on the Grab cooldown; 0 means a grab is ready (M6 ticket 04). Counts from the moment a hold this Character initiated last *ended*, not from when it started. */
  grabCooldownMs: number;
  /** Current horizontal speed (units/s) contributed by an active Dash burst; 0 when not dashing. Drives the speed-lines effect directly — no noisy derivation from position needed. */
  dashSpeed: number;
  /** Rises every time a speed/slow pad fires (M3.7 ticket 01, ADR 0035). */
  speedPadEpoch: number;
  /** Ms remaining on the currently-active pad effect's fade; 0 when none is active. */
  speedPadMsLeft: number;
  /** The peak multiplier the currently-active pad effect is holding/fading from. */
  speedPadCapMultiplier: number;
  /** Rises every time a launch pad fires (M3.7 ticket 02). */
  launchPadEpoch: number;
  /** World-space yaw in radians this Character is currently facing (M6, ADR 0045). */
  facing: number;
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
   * Multiplies both `MOVE_ACCEL_FACTOR` and `MOVE_FRICTION_FACTOR` this tick
   * (ticket 06) — set from outside by `RapierSimulation` alongside
   * {@link surfaceTopSpeedMultiplier}, from the same resolved Surface, with
   * the same one-tick lag. 1 (full grip, today's saturating default) until
   * anything ever calls {@link setSurfaceGrip}.
   */
  private surfaceGrip = 1;
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
  /** Rises every time this Character's own Hit swing fires (M6 ticket 03) — the Epoch idiom, same as {@link ragdollEpoch}. */
  private hitEpoch = 0;
  /** Rises every time this Character is on the receiving end of a landed Hit (M6 ticket 03) — set by `RapierSimulation` via {@link registerHitReceived}. */
  private hitReactEpoch = 0;
  /** Set by {@link beginTick}, read by {@link endTick} once the shared `world.step()` has run. */
  private tickingRagdoll = false;

  private readonly machine = new CharacterStateMachine();
  private readonly jump = new JumpController();
  private readonly dash = new DashController();
  /** Hit's cooldown (M6 ticket 03) — see {@link HitController}. */
  private readonly hit = new HitController();
  /**
   * Whether a swing actually fired THIS tick — set fresh at the top of every
   * {@link beginTick} (never stale across a tick where {@link beginCapsuleTick}
   * doesn't run, e.g. pure Ragdoll) and read once by `RapierSimulation`,
   * right after every Character's `beginTick` has run and before
   * `world.step()`, to resolve who (if anyone) it actually landed on — a
   * cross-Character question only `RapierSimulation` can answer.
   */
  private pendingHitFired = false;
  /** The charge fraction (0..1) a swing fired with THIS tick; 0 whenever {@link pendingHitFired} is false (M6.1 hold-to-charge). */
  private pendingHitChargeFraction = 0;
  /** Grab's cooldown (M6 ticket 04) — see {@link GrabController}. */
  private readonly grab = new GrabController();
  /** Same "fresh this tick only" treatment as {@link pendingHitFired}, for a grab attempt instead of a swing. */
  private pendingGrabFired = false;
  private grabHeldLastTick = false;
  /**
   * Multiplies `WALK_SPEED` this tick, and independently gates Dash outright,
   * while this Character is engaged in a Grab hold — either role (M6 ticket
   * 04). Set from outside by `RapierSimulation`, which alone knows the
   * cross-Character hold relationship; 1 (no effect, not engaged) until
   * anything ever calls {@link setGrabSpeedMultiplier}.
   */
  private grabSpeedMultiplier = 1;
  /**
   * Current horizontal speed (units/s) contributed by an active Dash burst —
   * the exact `dashEnvelope` curve already driving the physics, exposed
   * directly so the renderer's speed-lines effect doesn't have to derive it
   * (noisily) from position deltas. 0 whenever no burst is active.
   */
  private dashSpeed = 0;
  /** A speed/slow pad's fading `WALK_SPEED` cap (M3.7 ticket 01, ADR 0035) — see {@link SpeedPadController}. */
  private readonly speedPad = new SpeedPadController();
  /** Rises every time a speed/slow pad fires (M3.7 ticket 01) — the Epoch idiom, same as {@link ragdollEpoch}. */
  private speedPadEpoch = 0;
  /**
   * Set by {@link triggerSpeedPad}, consumed at the top of the very next
   * {@link beginCapsuleTick} — the one-shot velocity *write* (Quake's jump-pad
   * model: SET, not ADD) is deliberately a separate step from
   * {@link speedPad}'s ongoing fading cap, applied exactly once per trigger
   * regardless of how many ticks the fading effect itself goes on to last.
   */
  private pendingSpeedPadCapMultiplier: number | undefined;
  /**
   * This tick's Surface-driven bounce config, if any (M3.7 ticket 02) — set
   * from outside by `RapierSimulation` alongside {@link surfaceTopSpeedMultiplier}/
   * {@link surfaceGrip}, from the same resolved Surface, with the same
   * one-tick lag. `undefined` (no bounce, the ordinary ground-stick clamp)
   * until anything ever calls {@link setSurfaceBounce}.
   */
  private surfaceBounce: SurfaceBounceConfig | undefined;
  /**
   * This tick's active Volume, if any (M3.7 ticket 04, ADR 0036) — set from
   * outside by `RapierSimulation`, resolved from the Character's position
   * with the same one-tick lag `surfaceBounce`/`surfaceGrip` themselves have
   * (containment is checked *after* this tick's own move, for next tick's
   * force). `undefined` (no Volume contains this Character) most of the
   * time, until anything ever calls {@link setActiveVolume}. Deliberately
   * just `{ force, maxInducedSpeed }`, not the full `VolumeConfig` — this
   * Character never needs to know its own `bounds`/`priority` back.
   */
  private activeVolume: { force: Vec3; maxInducedSpeed: number } | undefined;
  /**
   * The true peak fall speed (units/s, always ≥ 0) since velocity.y was last
   * non-negative — see the gravity-integration line in {@link beginCapsuleTick}
   * for the full reasoning. Consumed (and reset) by a genuine bounce;
   * otherwise reset the instant velocity.y next becomes non-negative (a
   * jump/bounce/launch apex).
   */
  private airbornePeakFallSpeed = 0;
  /** Rises every time a launch pad fires (M3.7 ticket 02) — the Epoch idiom, same as {@link speedPadEpoch}. */
  private launchPadEpoch = 0;
  /**
   * Set by {@link triggerLaunchPad}, consumed at the top of the very next
   * {@link beginCapsuleTick} — unlike a speed pad's boost (which only ever
   * touches the horizontal wish velocity a Surface/Sliding model still gets
   * to shape), a launch pad's SET overrides the tick's ENTIRE velocity
   * outright, after every other contributor has already been computed —
   * Quake's jump-pad model taken further: "your incoming speed is
   * discarded" applies to gravity and Sliding too, not just walk/Dash.
   */
  private pendingLaunchVelocity: Vec3 | undefined;
  private jumpHeldLastTick = false;
  private dashHeldLastTick = false;
  /**
   * This Character's last known facing, world-space yaw in radians (M6, ADR
   * 0045) — mirrored straight from `input.facing` every {@link beginTick},
   * the same way `moveDirection` is, never restored on {@link reconcileTo}
   * (it's an input mirror, not simulation-owned state; a correction's own
   * replay re-derives it from the replayed inputs' own facing). Exposed via
   * the {@link facing} getter so `RapierSimulation` can read it for Hit's
   * own targeting (M6 ticket 03), the same way {@link position}/
   * {@link currentVelocity} already expose per-Character state it needs.
   */
  private currentFacing = 0;

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

  /** This Character's current facing, world-space yaw in radians (M6, ADR 0045). Used by `RapierSimulation` for Hit's own targeting (ticket 03). */
  get facing(): number {
    return this.currentFacing;
  }

  /** Handle of this Character's capsule collider, so `RapierSimulation` can recognise it as the thing another Character bumped into (ticket 04). */
  get colliderHandle(): number {
    return this.collider.handle;
  }

  /** Handle of the floor collider this tick's ground contact was against, or `undefined` if not grounded (ticket 01) — see {@link currentGroundColliderHandle}. */
  get groundColliderHandle(): number | undefined {
    return this.currentGroundColliderHandle;
  }

  /** Whether a swing fired THIS tick (M6 ticket 03) — see {@link pendingHitFired}. */
  get hitFiredThisTick(): boolean {
    return this.pendingHitFired;
  }

  /** The charge fraction (0..1) the swing that just fired THIS tick was released at — meaningless unless {@link hitFiredThisTick} is true (M6.1 hold-to-charge). */
  get hitChargeFraction(): number {
    return this.pendingHitChargeFraction;
  }

  /**
   * Cancels an in-progress Dash burst outright, leaving its cooldown
   * untouched (M6 tickets 03/04: Hit and Grab cancel the TARGET's/HELD's
   * in-progress Dash the instant they connect). A no-op if no burst is
   * active — which, since M6.1, is always true for the STRIKER's/GRABBER's
   * own Dash: Dash now gates Hit and Grab out entirely while a burst plays,
   * so neither can ever fire while its own initiator is mid-Dash.
   */
  cancelDash(): void {
    this.dash.cancelBurst();
  }

  /** Registers that this Character was just on the receiving end of a landed Hit (M6 ticket 03) — bumps {@link hitReactEpoch}, called by `RapierSimulation.resolveHit`. */
  registerHitReceived(): void {
    this.hitReactEpoch += 1;
  }

  /** Whether a grab attempt fired THIS tick (M6 ticket 04) — see {@link pendingGrabFired}. */
  get grabFiredThisTick(): boolean {
    return this.pendingGrabFired;
  }

  /** Sets this tick's Grab-driven walk-speed multiplier (M6 ticket 04) — see {@link grabSpeedMultiplier}. `1` (no effect) once the hold this Character was in has ended. */
  setGrabSpeedMultiplier(multiplier: number): void {
    this.grabSpeedMultiplier = multiplier;
  }

  /** Starts this Character's own Grab cooldown (M6 ticket 04) — called once a hold it initiated has ended, however it ended. See `GrabController.release`. */
  registerGrabReleased(): void {
    this.grab.release();
  }

  /** Sets this tick's Surface-driven top-speed multiplier (ticket 01) — see {@link surfaceTopSpeedMultiplier}. */
  setSurfaceTopSpeedMultiplier(multiplier: number): void {
    this.surfaceTopSpeedMultiplier = multiplier;
  }

  /** Sets this tick's Surface-driven grip (ticket 06) — see {@link surfaceGrip}. */
  setSurfaceGrip(grip: number): void {
    this.surfaceGrip = grip;
  }

  /** Sets this tick's Surface-driven bounce config (M3.7 ticket 02) — see {@link surfaceBounce}. */
  setSurfaceBounce(bounce: SurfaceBounceConfig | undefined): void {
    this.surfaceBounce = bounce;
  }

  /** Sets this tick's active Volume, if any (M3.7 ticket 04) — see {@link activeVolume}. */
  setActiveVolume(volume: { force: Vec3; maxInducedSpeed: number } | undefined): void {
    this.activeVolume = volume;
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
   * Fire a speed/slow pad (M3.7 ticket 01, ADR 0035) — called by
   * `RapierSimulation` exactly once per crossing, on the tick its own
   * position-based rising-edge check finds a *new* pad the Character wasn't
   * already touching. Arms {@link speedPad}'s fading cap immediately and
   * queues the one-shot velocity write for the very next
   * {@link beginCapsuleTick} (one tick behind, like every other Surface-style
   * effect resolved from this tick's already-computed ground contact).
   */
  triggerSpeedPad(capMultiplier: number): void {
    this.speedPadEpoch += 1;
    this.speedPad.trigger(capMultiplier);
    this.pendingSpeedPadCapMultiplier = capMultiplier;
  }

  /**
   * Fire a launch pad (M3.7 ticket 02) — called by `RapierSimulation` exactly
   * once per crossing, same rising-edge timing as {@link triggerSpeedPad}.
   * Queues the one-shot full-velocity write for the very next
   * {@link beginCapsuleTick}; unlike a speed pad there is no ongoing decay
   * state to arm — the launch's whole effect is this one write.
   */
  triggerLaunchPad(velocity: Vec3): void {
    this.launchPadEpoch += 1;
    this.pendingLaunchVelocity = { ...velocity };
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

  /**
   * React to a Fall (M5 ticket 03, ADR 0042): losing control always happens
   * — a Fall never varies, only what follows it does. `respawnPoint` is
   * `null` for a Round type with no Respawn (Survival): the Character is
   * eliminated ({@link eliminateNow}) rather than queued a Respawn. A
   * Respawn is queued for `point`, applied at the top of the next
   * {@link beginTick} — unchanged, and still the only branch that needs the
   * state machine's own deferred {@link CharacterStateMachine.forceRagdoll},
   * since a respawning Character keeps being stepped afterward.
   * `RapierSimulation`'s own `detectFall` decides which to pass, from
   * `RoundRules.fallBehavior`.
   */
  fall(respawnPoint: Vec3 | null, fallCount: number): void {
    if (respawnPoint) {
      this.pendingCause = "Fall";
      this.resetMovementControllers();
      this.machine.forceRagdoll();
      this.pendingRespawn = { point: { ...respawnPoint }, fallCount };
    } else {
      this.eliminateNow("Fall");
    }
  }

  /**
   * Eliminate this Character directly, outside a Fall — a mid-Round
   * disconnect (M5 ticket 04, ADR 0042). Same permanent "down, collider
   * disabled, never stepped again" freeze as an eliminating Fall, without
   * Fall's own bookkeeping (`fallCount`, a queued Respawn): a disconnect
   * ends a Character's part in any Round type, not only an eliminating one.
   * Its own cause (`"Disconnect"`, not `"Fall"`) — nothing fell.
   */
  eliminate(): void {
    this.eliminateNow("Disconnect");
  }

  /**
   * Immediate, synchronous Ragdoll entry — unlike an ordinary Impact or a
   * Checkpoint respawn, both of which land on the *next* {@link beginTick}
   * via the state machine's own deferred `forceRagdoll`/`impact` queue, this
   * has no next `beginTick` to land on: an eliminated Character is never
   * stepped again (M5 ticket 04, ADR 0042), so it must reach `Ragdoll` and
   * activate the ragdoll body in this same call if it isn't already down.
   *
   * Guarded by `isDownMotionState` — code review, ticket 04 — the same guard
   * `beginTick` (`prevState !== "Ragdoll"`) and `reconcileTo`
   * (`!isDownMotionState(...)`) already apply to every *other* Ragdoll-entry
   * path: without it, eliminating a Character already Ragdolling from an
   * unrelated Impact (a Bump off a ledge, mid-tumble) would re-snap every
   * bone to a fresh standing flop, discard its real tumbling velocity for
   * `this.velocity` (zeroed since that earlier Impact began), overwrite its
   * true `ragdollCause`, and double-bump `ragdollEpoch` for one knockdown.
   * Already-down just needs to stop being stepped — `RapierSimulation`'s own
   * `progress.eliminated` flag (set by the caller regardless) handles that
   * on its own; there is nothing left for this method to do.
   *
   * Mirrors exactly what `beginTick` itself does on an ordinary Ragdoll
   * entry (`ragdollEpoch`, `ragdollCause`, {@link beginRagdoll}), which is
   * what disables the capsule collider — {@link beginRagdoll} reads
   * `velocity` *before* resetting it, so a Fall's own momentum still
   * carries into the launch, exactly like an ordinary Impact-triggered one.
   */
  private eliminateNow(cause: RagdollCause): void {
    if (isDownMotionState(this.machine.state)) return;
    this.pendingCause = cause;
    this.machine.snapTo("Ragdoll");
    this.ragdollEpoch += 1;
    this.ragdollCause = cause;
    this.beginRagdoll();
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
    const grabPressed = input.grabHeld && !this.grabHeldLastTick;
    this.jumpHeldLastTick = input.jumpHeld;
    this.dashHeldLastTick = input.dashHeld;
    this.grabHeldLastTick = input.grabHeld;
    this.currentFacing = input.facing;
    // Reset every tick, unconditionally — never stale across a tick where
    // `beginCapsuleTick` (below) doesn't run at all (pure Ragdoll).
    this.pendingHitFired = false;
    this.pendingHitChargeFraction = 0;
    this.pendingGrabFired = false;

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
      this.beginCapsuleTick(input, jumpPressed, dashPressed, grabPressed);
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

  /**
   * Consumes {@link pendingSpeedPadCapMultiplier} if a pad fired last tick,
   * returning the boosted horizontal velocity to SET this tick (M3.7 ticket
   * 01), or `undefined` if no pad is pending. Checked from BOTH the Sliding
   * and the ordinary walking branch of {@link beginCapsuleTick} (code
   * review: an earlier version only checked the latter, so a pad triggered
   * right before/during a slide stayed queued — undischarged — for the
   * entire slide, landing long after its own fade window at a slide-driven
   * speed/heading unrelated to the pad).
   *
   * Scaled by `surfaceTopSpeedMultiplier` (matching every other tick's own
   * walk target — code review: an earlier version boosted to a flat
   * `WALK_SPEED * capMultiplier`, ignoring a pad's own Surface entirely) and
   * `machine.inputScale` (code review: matching Stagger's/Sliding's own
   * damping of every other movement contributor this tick — an earlier
   * version gave a Staggered Character the full, undamped boost). `dashBurst`
   * is added on top rather than discarded (code review: an earlier version
   * silently zeroed an in-flight Dash's contribution for the boost tick
   * while `dashSpeed`/`dashing` kept reporting it at full strength — ADR
   * 0035's "Dash is one contributor to the same velocity" model says it
   * should still contribute here exactly like everywhere else, and the
   * project's own research doc treats a pad feeding a live Dash into the
   * wall-Impact check as a deliberately desirable interaction, not a bug).
   */
  private consumePendingSpeedPadBoost(move: Vec3, dashBurst: Vec3): Vec3 | undefined {
    if (this.pendingSpeedPadCapMultiplier === undefined) return undefined;
    const capMultiplier = this.pendingSpeedPadCapMultiplier;
    this.pendingSpeedPadCapMultiplier = undefined;
    // Boosts along the *current* heading (velocity if moving, else this
    // tick's own input direction) — never a pad-authored direction, so a
    // Character standing dead still with no input isn't flung anywhere; it
    // still gets the fading cap (`speedPad.capMultiplier`, folded into `walk`
    // above) for whenever it does move.
    const heading = lengthVec3(vec3(this.velocity.x, 0, this.velocity.z)) > 0.01 ? this.velocity : move;
    const boostDir = normalizeVec3(vec3(heading.x, 0, heading.z));
    if (lengthVec3(boostDir) === 0) return undefined;
    const speed = WALK_SPEED * this.surfaceTopSpeedMultiplier * capMultiplier * this.machine.inputScale;
    return addVec3(scaleVec3(boostDir, speed), dashBurst);
  }

  /** Controlled / Stagger / Sliding / GettingUp: queue the kinematic capsule's movement, input scaled by the state. */
  private beginCapsuleTick(
    input: SimInputs,
    jumpPressed: boolean,
    dashPressed: boolean,
    grabPressed: boolean,
  ): void {
    // Stagger/Sliding both dampen *all* movement input — walk, jump and dash
    // — not just walk.
    const fullControl = this.machine.inputScale >= 1;
    const move = scaleVec3(input.moveDirection, this.machine.inputScale);
    const sliding = this.machine.state === "Sliding";
    // M6 ticket 04: engaged in a Grab hold, either role — sits alongside
    // `fullControl` as its own independent gate, since a hold doesn't touch
    // `machine.inputScale` at all (it's not a state-machine state, just a
    // per-tick multiplier `RapierSimulation` pushes in).
    const notGrabbing = this.grabSpeedMultiplier >= 1;

    const takeoff = this.jump.beginTick(this.grounded, fullControl && jumpPressed);
    if (takeoff !== null) this.velocity.y = takeoff;
    // Dash only starts while grounded and in full control (a walking burst,
    // not an air dash, and never while Sliding); an already-active burst's
    // own remaining duration still ticks down here even while Sliding, it
    // just doesn't contribute to velocity below (ticket 03 simplification —
    // ADR 0035's persistent-velocity model, not yet built, is what would
    // unify how a burst's momentum carries across a state change). M6 ticket
    // 04: also never while engaged in a Grab hold — CONTEXT.md's own Grab
    // definition: "the grabber cannot run while holding."
    const dashBurst = this.dash.beginTick(move, fullControl && dashPressed && this.grounded && notGrabbing);
    this.dashSpeed = sliding ? 0 : lengthVec3(dashBurst);
    // M6.1: Dash locks Hit and Grab out entirely while a burst is playing —
    // "dash locks everything until it finishes." Design correction
    // superseding M6.1 ticket 01's original approach-speed scaling, which let
    // a swing be thrown FROM a Dash and, as a side effect, left the dash-run
    // locomotion clip still at full weight underneath the Punch/HitReact
    // overlay (fixed separately in `HitReactionPlayer`, but firing mid-Dash
    // is what exposed it). Read right after `dash.beginTick` above has
    // already advanced this same tick, so it reflects whether a burst is
    // STILL playing out now, not last tick's stale value.
    const dashActive = this.dash.isActive;
    // M6.1 hold-to-charge: hold Hit to charge a stronger swing, release to
    // fire — the striker's own commitment now comes from how long they held
    // it, not from how fast a Dash happened to have them moving (which can no
    // longer overlap a swing at all). `fullControl` alone already excludes
    // Sliding/Stagger (both scale `inputScale` below 1) and Ragdoll/GettingUp
    // (0). `HitController` tracks the charge/release edges itself from the
    // raw held state — no external press-edge needed here anymore, unlike
    // Dash/Grab, which still fire on a rising edge only.
    const hitResult = this.hit.beginTick(input.hitHeld, fullControl && !dashActive);
    this.pendingHitFired = hitResult !== null;
    this.pendingHitChargeFraction = hitResult ?? 0;
    if (this.pendingHitFired) this.hitEpoch += 1;
    // M6 ticket 04, M6.1: same shape as Hit above — "may I attempt to grab,"
    // not "did it connect" (RapierSimulation's job, cross-Character). Also
    // gated on not already being engaged (so pressing Grab again mid-hold
    // neither starts a second one nor wastes the cooldown early) and, like
    // Hit, never while Dashing.
    this.pendingGrabFired = this.grab.beginTick(fullControl && grabPressed && notGrabbing && !dashActive);
    // Ticks down (and, while active, decides this tick's own {@link
    // SpeedPadController.capMultiplier}) regardless of Sliding/Stagger —
    // mirrors Dash's own cooldown, which likewise only advances whenever this
    // method runs at all (which it does even during GettingUp — only true
    // Ragdoll skips it, per {@link beginTick}'s `tickingRagdoll` gate).
    this.speedPad.beginTick();
    // Surface-scaled, but not yet slope-scaled (below) — the Sliding branch
    // uses this as-is for its steering blend, deliberately never applying
    // the slope-angle multiplier (ticket 04): that model is for walking
    // only, per ADR 0037/CONTEXT.md's split between the two. `speedPad`'s
    // fading cap (M3.7 ticket 01) stacks with the Surface's own multiplier —
    // orthogonal concerns, same slot in the pipeline Surface already proved.
    // M6 ticket 04: `grabSpeedMultiplier` folds in the same way — 1 (no
    // effect) unless this Character is currently engaged in a hold.
    const walk = scaleVec3(
      move,
      WALK_SPEED * this.surfaceTopSpeedMultiplier * this.speedPad.capMultiplier * this.grabSpeedMultiplier,
    );
    // Consumed (at most once) by whichever branch below runs this tick — a
    // pad can fire while Sliding just as easily as while walking (code
    // review: an earlier version only ever checked this inside the `else`
    // branch, so a pad triggered right as Sliding began stayed queued,
    // undischarged, for the entire slide — landing long after its own fade
    // window and at a slide-driven speed/heading with no relation to the
    // pad at all).
    const speedPadBoost = this.consumePendingSpeedPadBoost(move, dashBurst);

    if (sliding && this.currentGroundNormal) {
      // ADR 0037: the one place gravity is projected onto the slope plane and
      // integrated tick over tick, rather than the direct `velocity.xz =
      // target` assignment every other Controlled/Stagger tick uses below —
      // ADR 0035 rejects that accelerating model for ordinary walking, but
      // adopts it here.
      const gravity = vec3(0, GRAVITY_Y, 0);
      const normal = this.currentGroundNormal;
      const slopeGravity = subVec3(gravity, scaleVec3(normal, dotVec3(gravity, normal)));
      if (speedPadBoost) {
        // The one-shot write still applies underneath the slide's own
        // gravity accumulation — it overrides only the steered-toward-target
        // horizontal contribution `SLIDE_STEER_BLEND` would otherwise supply,
        // exactly mirroring the non-Sliding branch's own SET-then-fall-
        // through semantics below.
        this.velocity.x = speedPadBoost.x + slopeGravity.x * TICK_DT;
        this.velocity.z = speedPadBoost.z + slopeGravity.z * TICK_DT;
      } else {
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
        this.velocity.z = horizontal.z + slopeGravity.z * TICK_DT;
      }
      this.velocity.y += slopeGravity.y * TICK_DT;
    } else {
      const gravityScale = this.jump.gravityScale(fullControl && input.jumpHeld, this.velocity.y);
      this.velocity.y += GRAVITY_Y * gravityScale * TICK_DT;
      // M3.7 ticket 02: tracks the TRUE peak fall speed across an entire
      // fall, independent of the ordinary ground-stick clamp below —
      // resets the instant velocity.y is non-negative (a jump/bounce/launch
      // apex, or simply not falling), so it always reflects "how fast has
      // this Character been falling since it was last not falling," never
      // contaminated by an intervening clamp. Exists because `surfaceBounce`
      // (like every Surface field) can take several ticks to resolve after
      // a fast landing — Rapier's own snap-to-ground correction can report
      // `computedGrounded()` true for multiple ticks without ever producing
      // a `computedCollision()` entry (`resolveCollisions`'s own documented
      // caveat) — and reading `-this.velocity.y` directly at the ground-
      // stick check, once Surface finally does resolve, would by then only
      // see whatever the ordinary clamp had already reduced it to on the
      // ticks in between (empirically confirmed: a bounce Surface bounced
      // back at exactly its own `minSpeed` floor regardless of fall height,
      // because the real impact speed was already destroyed before the
      // bounce math ever ran). Tracking the peak here, decoupled from
      // `this.velocity.y`'s own clamped value, fixes this without changing
      // the ground-stick clamp's own timing for every other (non-bounce)
      // landing at all.
      this.airbornePeakFallSpeed = this.velocity.y < 0 ? Math.max(this.airbornePeakFallSpeed, -this.velocity.y) : 0;

      if (speedPadBoost) {
        // M3.7 ticket 01: the one-shot velocity *write* — Quake's jump-pad
        // model (`BG_TouchJumpPad`: `VectorCopy`, not an add — "your incoming
        // speed is discarded"). A direct SET, bypassing `accelerateVelocity`
        // below entirely for this one tick: it must land exactly on the
        // boosted target regardless of Surface grip (an icy pad must still
        // feel instant), and a SET is trivially idempotent under prediction
        // replay — the same pre-boost velocity/move always produces the same
        // result, unlike an ADD which would stack on retry. See
        // {@link consumePendingSpeedPadBoost} for what it's built from.
        this.velocity.x = speedPadBoost.x;
        this.velocity.z = speedPadBoost.z;
      } else {
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
        // Ticket 05, ADR 0035: Dash is now a contributor to the same wish
        // velocity the persistent-velocity pipeline chases, rather than an
        // addition tacked directly onto the final velocity outside any model
        // — the structural change that later lets a wall-Impact rule (ADR
        // 0037) read "how fast is this Character going" without asking "was
        // this a Dash?" At today's saturating MOVE_ACCEL_FACTOR/
        // MOVE_FRICTION_FACTOR (full grip), `accelerateVelocity` reaches
        // `wish` exactly within this same tick — numerically identical to the
        // direct `velocity.xz = wish` assignment it replaces. `surfaceGrip`
        // (ticket 06) multiplies both factors together — Source's own
        // one-scalar-does-both model — so ice's near-zero grip alone is
        // exactly what turns this from "identical" into "a genuine, gradual
        // ramp," with no other code path change needed.
        const wish = addVec3(slopedWalk, dashBurst);
        const newVelocity = accelerateVelocity(
          this.velocity,
          wish,
          MOVE_ACCEL_FACTOR * this.surfaceGrip,
          MOVE_FRICTION_FACTOR * this.surfaceGrip,
        );
        this.velocity.x = newVelocity.x;
        this.velocity.z = newVelocity.z;
      }
    }

    if (this.pendingLaunchVelocity) {
      // M3.7 ticket 02: a launch pad's SET overrides EVERYTHING computed
      // above this tick — gravity, Sliding's slope-gravity integration, the
      // Surface/Dash/accelerate model, all of it — not just the horizontal
      // wish velocity a speed pad's boost touches. Quake's "your incoming
      // speed is discarded" taken to its full conclusion: a launch pad cares
      // where you're going, not how you got there.
      this.velocity = { ...this.pendingLaunchVelocity };
      this.pendingLaunchVelocity = undefined;
    }

    if (this.activeVolume) {
      // M3.7 ticket 04: unconditional, on top of everything above (including
      // a launch pad's own SET this same tick) — a Volume is a continuous
      // force, not a one-shot effect competing for the same "what is this
      // tick's velocity" slot the way a launch pad's SET does. No flight
      // mode: this never touches `motionState`, controls, or the camera —
      // the Character just gets pushed and otherwise behaves exactly as it
      // already would (walks, staggers, ragdolls) while inside.
      this.velocity = applyVolumeForce(this.velocity, this.activeVolume.force, this.activeVolume.maxInducedSpeed);
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
      // M3.7 ticket 02: a bounce Surface takes this exact branch instead of
      // the ordinary ground-stick clamp — the research doc's own words:
      // "on the tick where computedGrounded() becomes true on a bouncy
      // collider, set velocity.y = max(bounceMin, -velocity.y * restitution)
      // and suppress the ground-stick that would otherwise clamp it." Uses
      // {@link airbornePeakFallSpeed} rather than reading `-this.velocity.y`
      // directly — see that field's own comment for why: `surfaceBounce`
      // can take several ticks to resolve after landing, by which point an
      // ordinary (non-bounce) clamp may already have run on the ticks in
      // between, and reading the instantaneous value here would see that
      // clamp's own residue instead of the real impact speed. A launch pad
      // never reaches this branch with a negative Y in practice (a launch's
      // own Y is virtually always positive), so it needs no corresponding
      // handling here.
      this.velocity.y = this.surfaceBounce
        ? Math.max(this.surfaceBounce.minSpeed, this.airbornePeakFallSpeed * this.surfaceBounce.restitution)
        : -GROUND_STICK_SPEED;
      // Reset the peak once the ground handle has genuinely resolved,
      // whether bounce or not — NOT merely "consumed by a bounce" (an
      // earlier version, code review): `surfaceBounce`/`currentGroundColliderHandle`
      // can still be stale on the very first landing tick(s) after a fast
      // fall (see `airbornePeakFallSpeed`'s own comment), so resetting
      // unconditionally on every ground-stick tick would re-introduce the
      // original bug (the peak gone before a genuine bounce ever reads it).
      // But resetting ONLY when a bounce consumes it left a stale peak from
      // an unrelated, long-past fall sitting around indefinitely through
      // ordinary walking on non-bounce ground — confirmed empirically: a
      // Character that fell once, landed normally, then walked flatly for
      // over a minute still launched to the ORIGINAL fall's full bounce
      // height the instant it later stepped onto an actual bounce Surface,
      // with no real fall behind it at all. `currentGroundColliderHandle`
      // (checked here before `resolveCollisions` below updates it, so it
      // still reflects whether Surface was ALREADY known going into this
      // tick) is the same one-tick-lag signal `surfaceBounce` itself is
      // derived from — once it's resolved, Surface is no longer in doubt,
      // so it's always safe to let go of a peak nothing has consumed by then.
      if (this.surfaceBounce || this.currentGroundColliderHandle !== undefined) {
        this.airbornePeakFallSpeed = 0;
      }
      this.jump.land();
    }

    this.resolveCollisions();

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
   * Walk this tick's `computeColliderMovement` collisions (ticket 06;
   * re-expressed as a speed threshold, M3.7 ticket 03, ADR 0037): a
   * Character closing on a near-vertical surface at or above
   * {@link WALL_IMPACT_MIN_SPEED} knocks it down (wall or Spinner or Prop —
   * whatever it hit), magnitude scaling with that same closing speed — a
   * slow build-up or late-release Dash, or simply walking into a wall, is
   * just a blocked walk. Closing speed is `this.velocity`'s own component
   * *into* the surface along its normal, whatever gave the Character that
   * velocity — Dash, a bounce, a launch pad, an updraft, all qualify
   * identically; there is deliberately no second, parallel "is this
   * Character Dashing/launched" check (two rules for one event drift apart
   * under tuning, and then neither can be blamed). Another Character is the
   * exception: crashing into a player never knocks the *mover* down (ticket
   * 04 — Bump is one-sided, only the one bumped goes down), so this check
   * skips Character colliders. Every collision is still forwarded to
   * {@link onCollision} so `RapierSimulation` can resolve the contact —
   * Spinner Knockback, a shoved Prop, or a Bump delivered to the other
   * Character.
   */
  private resolveCollisions(): void {
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

      if (!hitCharacter && Math.abs(normal.y) < WALL_NORMAL_MAX_Y) {
        // `normal` points away from the wall, toward the Character (Rapier's
        // own convention — see `wallImpactKnockback`'s doc comment) — moving
        // *into* the wall is moving opposite to it, so the closing speed is
        // the negated dot product, not the raw one.
        const closingSpeed = -dotVec3(this.velocity, normal);
        if (closingSpeed >= WALL_IMPACT_MIN_SPEED) {
          this.applyImpact(wallImpactKnockback(normal, closingSpeed), "WallImpact");
        }
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
    // M6 ticket 03 (code review): Hit mirrors Dash's own cooldown idiom, so
    // it must also mirror Dash's own reset-on-knockdown behavior — without
    // this, a Character's Hit stayed locked out for whatever was left of its
    // cooldown after getting up, while Dash always came back instantly, a
    // surprising inconsistency between two verbs deliberately built the same way.
    this.hit.reset();
    // M6 ticket 04: same reasoning as Hit just above — a knockdown resets
    // Grab's cooldown too, and drops this Character's own view of being
    // engaged in a hold (`RapierSimulation`'s own grab-relationship map ends
    // the hold from its side independently; this is the same "safest fallback
    // until the next real check" treatment `activeVolume`/`surfaceBounce`
    // already get on reconcile).
    this.grab.reset();
    this.grabSpeedMultiplier = 1;
    this.speedPad.reset();
    this.pendingSpeedPadCapMultiplier = undefined;
    this.pendingLaunchVelocity = undefined;
    this.airbornePeakFallSpeed = 0;
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
      hitEpoch: this.hitEpoch,
      hitReactEpoch: this.hitReactEpoch,
      ragdollCause: this.ragdollCause,
      dashCooldownMs: this.dash.cooldownMs,
      dashing: this.dash.isActive,
      dashSpeed: this.dashSpeed,
      hitCooldownMs: this.hit.cooldownMs,
      hitChargeMs: this.hit.chargeMs,
      grabCooldownMs: this.grab.cooldownMs,
      speedPadEpoch: this.speedPadEpoch,
      speedPadMsLeft: this.speedPad.msLeft,
      speedPadCapMultiplier: this.speedPad.peak,
      launchPadEpoch: this.launchPadEpoch,
      facing: this.currentFacing,
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
   *   still happening. A speed/slow pad's fading cap is restored the same
   *   way (`speedPadMsLeft`/`speedPadCapMultiplier` →
   *   {@link SpeedPadController.restoreFromMs}) — never re-fires the one-shot
   *   write, only the decay curve.
   */
  reconcileTo(base: ReconcileBase): void {
    const serverDown = isDownMotionState(base.motionState);

    if (serverDown) {
      if (this.machine.state !== base.motionState) {
        if (!isDownMotionState(this.machine.state)) {
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

    if (isDownMotionState(this.machine.state)) this.returnToControlled();
    this.body.setTranslation({ ...base.position }, false);
    this.velocity = { ...base.velocity };
    this.grounded = base.grounded;
    // The correction can move the capsule across a Surface boundary (mud/ice
    // vs default) that a mispredicting client had no way to see coming — the
    // snapshot carries no Surface of its own (ADR 0036: it's a pure function
    // of position, never replicated), so the safest thing this can do is
    // fall back to full grip / no cap and let the very next real ground
    // sweep recompute the true Surface, exactly like the existing one-tick
    // lag already does after a normal landing. Without this the first tick
    // replayed from here
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
    this.surfaceGrip = 1;
    this.surfaceBounce = undefined;
    // Same reasoning, same ADR 0036 "pure function of position" — a Volume
    // isn't in the snapshot either, so the safest fallback is "not in one"
    // until the very next real containment check (below, same tick's own
    // sweep already refreshed the ground handle by then) recomputes it.
    this.activeVolume = undefined;
    // Same reasoning again (M6 ticket 04): whether this Character is
    // currently engaged in a Grab hold is cross-Character state, never
    // replicated on the snapshot — "not engaged" until `RapierSimulation`'s
    // own per-tick push refreshes it, same as `activeVolume` just above.
    this.grabSpeedMultiplier = 1;
    // Re-derived fresh from `base.velocity` starting the very next tick's
    // own gravity-integration line — a reconciliation landing mid-fall onto
    // a bounce Surface loses whatever higher peak a mispredicting client saw
    // before the correction, the same one-off precision trade every other
    // Surface-adjacent field here already accepts.
    this.airbornePeakFallSpeed = 0;
    this.machine.snapTo(base.motionState);
    this.dash.restoreCooldownMs(base.dashCooldownMs, base.dashing);
    this.hit.restoreCooldownMs(base.hitCooldownMs);
    this.hit.restoreCharge(base.hitChargeMs);
    this.grab.restoreCooldownMs(base.grabCooldownMs);
    this.speedPad.restoreFromMs(base.speedPadMsLeft, base.speedPadCapMultiplier);
    // The one-shot write itself is never replayed here — only the decay
    // curve above. Whether the replay that follows fires a *fresh* one-shot
    // write is entirely up to `RapierSimulation`'s own rising-edge check
    // against the replayed position, exactly like every other tick.
    this.pendingSpeedPadCapMultiplier = undefined;
    // A launch pad has no decay curve to restore (M3.7 ticket 02) — its
    // whole effect already lives in `base.velocity` above. Only the pending
    // one-shot write itself needs clearing, for the same reason as the speed
    // pad's own: never replayed here, only ever re-derived fresh by
    // `RapierSimulation`'s rising-edge check against the replayed position.
    this.pendingLaunchVelocity = undefined;
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

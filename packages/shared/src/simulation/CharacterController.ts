import RAPIER from "@dimforge/rapier3d-compat";
import { wrapAngle } from "../math/angle.js";
import { dotVec3, lengthVec3, normalizeVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  CHARACTER_TOUCH_MARGIN,
  FACING_TURN_SPEED_MAX,
  WALL_NORMAL_MAX_Y,
} from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { GRAB_CARRY_DISTANCE, GRAB_CARRY_LIFT, GRAB_TURN_SPEED_MULTIPLIER } from "../tuning/fight.js";
import { IMPACT_RAGDOLL_MIN, IMPACT_STAGGER_MIN, STAGGER_TICKS, WALL_IMPACT_LIFT_RATIO, WALL_IMPACT_MIN_SPEED, WALL_IMPACT_SCALE } from "../tuning/knockdown.js";
import { SHOVING_IMPACT_CAUSES, type HeldPhase, type ReconcileBase, type RagdollCause } from "../state/SimState.js";
import { createCapsule, type Capsule } from "./character/Capsule.js";
import { InteractionController, type HoldRole, type Hurl } from "./character/InteractionController.js";
import { MovementController, type Ride } from "./character/MovementController.js";
import { RagdollController } from "./character/RagdollController.js";
import { SurfaceController, type GroundContact, type GroundContext } from "./character/SurfaceController.js";
import { CharacterStateMachine, isDownMotionState, type CharacterMotionState, type MotionMode } from "./CharacterStateMachine.js";
import { CHARACTER_GROUPS, collisionGroups, GROUP_CHARACTER } from "./collisionGroups.js";
import type { BoneSnapshot } from "./ragdollSkeleton.js";
import type { SimInputs } from "./SimInputs.js";
import { forwardOf, spinAngleAt } from "./spin.js";

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

/** A query that sees other Characters' capsules and nothing else. */
const CHARACTERS_ONLY = collisionGroups(GROUP_CHARACTER, GROUP_CHARACTER);

/** Whether `collider` is anything but a Character's capsule. */
const isNotCharacter = (collider: RAPIER.Collider): boolean =>
  ((collider.collisionGroups() >>> 16) & GROUP_CHARACTER) === 0;

/**
 * The most a grabber's facing may turn in one tick (ADR 0104): the body's top
 * turn speed (ADR 0085), slowed by what it is carrying.
 */
const CARRY_TURN_STEP = FACING_TURN_SPEED_MAX * GRAB_TURN_SPEED_MULTIPLIER * TICK_DT;

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
  /** Rises every time this Character's own grab attempt fires, catching anyone or not (ADR 0071). */
  grabEpoch: number;
  dashCooldownMs: number;
  /** Whether a Dash burst is currently playing out (for the renderer to speed up the movement animation). */
  dashing: boolean;
  /** Milliseconds left on the Hit cooldown; 0 means a swing is ready (M6 ticket 03). */
  hitCooldownMs: number;
  /** Ms charged so far on an in-progress Hit hold; 0 while not charging (M6.1: hold-to-charge). Drives the HUD's charge tell. */
  hitChargeMs: number;
  /** Milliseconds left on the Grab cooldown; 0 means a grab is ready (M6 ticket 04). Counts from the moment a hold this Character initiated last *ended*, not from when it started. */
  grabCooldownMs: number;
  /** The id of whoever this Character is currently grabbing, or `null` (M6.1) — drives the renderer's own arm-reach pose. `null` for the HELD side of a hold too; only the grabber's own row is ever non-null. */
  grabbingId: string | null;
  /** The id of whoever is currently grabbing this Character, or `null` (M6.1) — the reverse of {@link grabbingId}. Lets a client tell "am I involved in a hold at all, as either role." */
  heldByGrabberId: string | null;
  /** Which part of its hold this Character is in, or `null` while nobody holds it (ADR 0104). */
  heldPhase: HeldPhase | null;
  /** The Tick the current part of this Character's hold runs out, or `null` (ADR 0104). */
  holdEndsTick: number | null;
  /** The Struggle's escape meter, 0..1 (ADR 0104). */
  escapeProgress: number;
  /** What the next move input has to reverse to count as a wiggle (ADR 0104). */
  lastWiggleYaw: number | null;
  /** How long this Character has been Spinning someone, in ms (ADR 0104). */
  spinMs: number;
  /** Current horizontal speed (units/s) contributed by an active Dash burst; 0 when not dashing. Drives the speed-lines effect directly — no noisy derivation from position needed. */
  dashSpeed: number;
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
 *
 * Since the 2026-09 audit's ticket 10 (ADR 0101) this class says the order of
 * a tick and nothing else. The work is in four parts under `character/`, each
 * the one place its kind of change goes:
 *
 * - {@link MovementController} — velocity, jump, Dash, the two velocity
 *   models, what rides on top of them, the Ride, the sweep, landing;
 * - {@link SurfaceController} — what is underfoot and what it does, including
 *   the hazards a Surface can have (a landing that takes your feet, the speed
 *   a crash knocks you down at, a run or a turn that does — ADR 0102);
 * - {@link InteractionController} — Hit and Grab, from this Character's side;
 * - {@link RagdollController} — every down episode, and the Respawn.
 *
 * What each motion state *does* is read off its `MotionMode`
 * (`CharacterStateMachine`'s `MOTION_MODES`), never by asking which state it is.
 */
export class CharacterController {
  private readonly capsule: Capsule;
  private readonly onCollision: CollisionListener | undefined;
  /**
   * Whether this Character decides for itself when a knockdown ends (the
   * Ragdoll body's own physics settle-check). `false` for the client's
   * local-prediction Character — see `SimulationConfig.authoritative` /
   * ADR 0015.
   */
  private readonly authoritative: boolean;

  private tickCount = 0;
  /** Set by {@link beginTick}, read by {@link endTick} once the shared `world.step()` has run. */
  private tickingRagdoll = false;
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

  private readonly machine = new CharacterStateMachine();
  private readonly movement: MovementController;
  private readonly surface: SurfaceController;
  private readonly interaction: InteractionController;
  private readonly ragdolls: RagdollController;
  /** {@link slipOnLanding}, bound once — `MovementController.settleOnGround` calls it at the landing. */
  private readonly landed = (): void => this.slipOnLanding();
  /** The capsule, fattened by {@link CHARACTER_TOUCH_MARGIN} — what {@link crashIntoCharacters} asks the world with. */
  private readonly touchProbe = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS + CHARACTER_TOUCH_MARGIN);

  constructor(world: RAPIER.World, spawn: Vec3, onCollision?: CollisionListener, authoritative = true) {
    this.onCollision = onCollision;
    this.authoritative = authoritative;
    this.capsule = createCapsule(world, spawn);
    this.movement = new MovementController(this.capsule);
    this.surface = new SurfaceController(this.capsule);
    this.interaction = new InteractionController();
    this.ragdolls = new RagdollController(
      this.capsule,
      this.machine,
      this.movement,
      () => this.resetMovementControllers(),
      () => this.currentFacing,
    );
  }

  /** The camera-follow point: capsule centre while upright, ragdoll pelvis while down. */
  get position(): Vec3 {
    const t = this.capsule.body.translation();
    return vec3(t.x, t.y, t.z);
  }

  /** This tick's capsule velocity (units/s). Used by `RapierSimulation` to compute a Bump's closing speed against another Character (ticket 04). */
  get currentVelocity(): Vec3 {
    return { ...this.movement.velocity };
  }

  /** This Character's current facing, world-space yaw in radians (M6, ADR 0045). Used by `RapierSimulation` for Hit's own targeting (ticket 03). */
  get facing(): number {
    return this.currentFacing;
  }

  /** Handle of this Character's capsule collider, so `RapierSimulation` can recognise it as the thing another Character bumped into (ticket 04). */
  get colliderHandle(): number {
    return this.capsule.collider.handle;
  }

  /** Handle of the floor collider this tick's ground contact was against, or `undefined` if not grounded (ticket 01) — see `SurfaceController.currentGroundColliderHandle`. */
  get groundColliderHandle(): number | undefined {
    return this.surface.currentGroundColliderHandle;
  }

  /** Whether the capsule's last sweep ended on standable ground. */
  get isGrounded(): boolean {
    return this.movement.grounded;
  }

  /**
   * Queue a push out of a Moving Segment that moved into this capsule (ADR
   * 0061), swept with the next tick's own movement so a push never carries it
   * through a wall. Two bodies pushing in one tick: the deeper push wins.
   */
  queuePush(push: Vec3): void {
    this.movement.queuePush(push);
  }

  /** Set this tick's Ride (ADR 0061) — `RapierSimulation` calls it for every Character before `beginTick`. */
  setRide(ride: Ride | undefined): void {
    this.movement.setRide(ride);
  }

  /** Whether a swing fired THIS tick (M6 ticket 03) — see `InteractionController.pendingHitFired`. */
  get hitFiredThisTick(): boolean {
    return this.interaction.pendingHitFired;
  }

  /** The charge fraction (0..1) the swing that just fired THIS tick was released at — meaningless unless {@link hitFiredThisTick} is true (M6.1 hold-to-charge). */
  get hitChargeFraction(): number {
    return this.interaction.pendingHitChargeFraction;
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
    this.movement.dash.cancelBurst();
  }

  /** Registers that this Character was just on the receiving end of a landed Hit (M6 ticket 03) — bumps its `hitReactEpoch`, called by `RapierSimulation.resolveHit`. */
  registerHitReceived(): void {
    this.interaction.registerHitReceived();
  }

  /** Whether a grab attempt fired THIS tick (M6 ticket 04) — see `InteractionController.pendingGrabFired`. */
  get grabFiredThisTick(): boolean {
    return this.interaction.pendingGrabFired;
  }

  /** Whether the Player asked to let go this tick (ADR 0093), consumed by the caller that owns the hold. */
  takeGrabRelease(): boolean {
    return this.interaction.takeGrabRelease();
  }

  /** The Spin let go of this tick, or `null` (ADR 0104) — consumed by `GrabHolds`. */
  takeHurl(): Hurl | null {
    return this.interaction.takeHurl();
  }

  /** Whether this tick's Spin ran too long (ADR 0104) — consumed by `GrabHolds`. */
  takeDizzy(): boolean {
    return this.interaction.takeDizzy();
  }

  /** How many ticks this Character has been Spinning the one it holds, 0 while not (ADR 0104). */
  get spinTicks(): number {
    return this.interaction.spinning ? this.interaction.spinTicks : 0;
  }

  /** The Struggle's escape meter, 0..1 (ADR 0104). */
  get escapeProgress(): number {
    return this.interaction.escapeProgress;
  }

  /**
   * How fast the body is actually moving (units/s): the capsule's velocity
   * while upright or carried, the ragdoll's own while down — what a hurled
   * body hits the Characters it reaches with (ADR 0104).
   */
  get bodyVelocity(): Vec3 {
    return this.ragdolls.ragdoll.isActive ? this.ragdolls.ragdoll.rootVelocity() : { ...this.movement.velocity };
  }

  /** Starts this Character's own Grab cooldown (M6 ticket 04) — called once a hold it initiated has ended, however it ended. See `GrabController.release`. */
  registerGrabReleased(): void {
    this.interaction.registerGrabReleased();
  }

  /** Sets who this Character is currently grabbing, or `null` (M6.1) — see `InteractionController.grabbingId`. */
  setGrabbingId(id: string | null): void {
    this.interaction.grabbingId = id;
  }

  /**
   * What the snapshot says about the hold this Character is held in (M6.1,
   * ADR 0104): by whom, which part of it, and until which Tick — all `null`
   * while nobody holds it. See `InteractionController.heldByGrabberId`.
   */
  reportHeld(grabberId: string | null, phase: HeldPhase | null = null, endsTick: number | null = null): void {
    this.interaction.heldByGrabberId = grabberId;
    this.interaction.reportedHeldPhase = phase;
    this.interaction.holdEndsTick = endsTick;
  }

  /** Everything the world under this Character says about the coming tick, in one call — see `SurfaceController.apply`. */
  applyGroundContext(ground: GroundContext): void {
    this.surface.apply(ground, this.movement.grounded);
  }

  /** Nobody is holding this Character, until proven otherwise this tick — see `InteractionController.clearHold`. */
  clearHold(): void {
    this.interaction.clearHold();
  }

  /** This Character is at `role`'s end of a hold this tick — see `InteractionController.holdAs`. */
  holdAs(role: HoldRole, phase: HeldPhase | null = null): void {
    this.interaction.holdAs(role, phase);
  }

  /**
   * Picked up by a Grab (ADR 0104) — see `RagdollController.beginHeld`. The
   * hold places the body from here on ({@link placeHeld}).
   */
  beginHeld(): void {
    this.ragdolls.beginHeld();
    this.surface.leaveGround();
  }

  /**
   * Where a Character this one carries is held this tick (ADR 0104): arm's
   * length straight ahead, lifted — on a spring arm, as the camera's is. A
   * capsule-shaped cast from just above this one toward that point stops at
   * the first thing in the way (never a Character), so a body swung into a
   * wall is pulled in rather than put inside it, and a release never starts a
   * Ragdoll inside the geometry.
   */
  carryPoint(): Vec3 {
    const at = this.capsule.body.translation();
    const from = vec3(at.x, at.y + GRAB_CARRY_LIFT, at.z);
    const ahead = forwardOf(this.currentFacing);
    const hit = this.capsule.world.castShape(
      from,
      this.capsule.body.rotation(),
      ahead,
      this.capsule.collider.shape,
      CHARACTER_CONTROLLER_OFFSET,
      GRAB_CARRY_DISTANCE,
      false,
      undefined,
      CHARACTER_GROUPS,
      this.capsule.collider,
      undefined,
      isNotCharacter,
    );
    const reach = hit ? hit.time_of_impact : GRAB_CARRY_DISTANCE;
    return vec3(from.x + ahead.x * reach, from.y, from.z + ahead.z * reach);
  }

  /**
   * Put a Held Character where its grabber carries it this tick (ADR 0104),
   * turned to `facing`, moving at `velocity` — which is what a release that
   * keeps the body's momentum leaves with.
   */
  placeHeld(point: Vec3, facing: number, velocity: Vec3): void {
    this.capsule.body.setTranslation({ ...point }, false);
    this.currentFacing = facing;
    this.movement.velocity = { ...velocity };
  }

  /**
   * Let go of on its feet (ADR 0104): a Struggle won, or set down before it
   * was lost — sent off at `fling`, Staggering on landing if `wobble`.
   */
  releaseOnFeet(fling: Vec3, wobble: boolean): void {
    this.interaction.forgetStruggle();
    this.ragdolls.leaveHeldOnFeet(wobble ? STAGGER_TICKS : null);
    this.movement.velocity = vec3();
    this.movement.fling(fling);
  }

  /** The Struggle is over, whichever way it went (ADR 0104) — the meter empties for the next hold. */
  forgetStruggle(): void {
    this.interaction.forgetStruggle();
  }

  /** Let go of into a knockdown with a fresh clock (ADR 0104) — see `RagdollController.knockDownFromHold`. */
  releaseKnockedDown(cause: RagdollCause, launch: Vec3, tumble: Vec3): void {
    this.interaction.forgetStruggle();
    // A hanging body is already a flying ragdoll: it keeps the pose and the
    // tumble the carry gave it, and only its throw is replaced
    // (`.scratch/physical-ragdoll` ticket 04).
    if (this.ragdolls.isHanging) this.ragdolls.releaseHang(cause, launch);
    else this.ragdolls.knockDownFromHold(cause, launch, tumble);
  }

  /**
   * The Struggle was lost (ticket 04): the Limp body hangs from the grabber's
   * grip as a real ragdoll. The capsule is still placed by the hold every
   * tick — it stays the authority for where the body is and what a swing
   * reaches — and the bones are what is drawn and replicated.
   */
  beginLimpHang(carryPoint: Vec3, gripAboveChest: number, velocity: Vec3): void {
    this.ragdolls.beginLimpHang(carryPoint, gripAboveChest, velocity);
  }

  /** Carry this tick's hang, if this body is hanging at all. */
  moveLimpHang(carryPoint: Vec3): void {
    this.ragdolls.moveLimpHang(carryPoint);
  }

  /** Whether a hold is carrying this body as a hanging ragdoll. */
  get isHanging(): boolean {
    return this.ragdolls.isHanging;
  }

  /** How fast a hanging body is really travelling — what a Hurl's throw is measured from. */
  hangVelocity(): Vec3 {
    return this.ragdolls.hangVelocity();
  }

  /** Down on the next tick, for `cause`, with nothing hitting it (ADR 0104: a dizzy grabber) — see `RagdollController.knockDown`. */
  knockDown(cause: RagdollCause): void {
    this.ragdolls.knockDown(cause);
  }

  /** The current motion state — a cheap read (no bone/pose computation), for transition detection. */
  get motionState(): CharacterMotionState {
    return this.machine.state;
  }

  /** Whether a Fall-triggered respawn is queued for the top of the next tick. */
  get hasPendingRespawn(): boolean {
    return this.ragdolls.hasPendingRespawn;
  }

  /** Fire a launch pad (M3.7 ticket 02, ADR 0069) — see `MovementController.triggerLaunchPad`. */
  triggerLaunchPad(velocity: Vec3): void {
    this.movement.triggerLaunchPad(velocity);
  }

  /**
   * A landing the Surface may not let the Character keep (ADR 0092) — asked
   * of the Surface at the one point in the landing where the peak fall speed
   * it is judged against is still known. See `SurfaceController.landingImpact`.
   */
  private slipOnLanding(): void {
    const impulse = this.surface.landingImpact(this.movement.velocity, this.movement.airbornePeakFallSpeed);
    if (impulse) this.applyImpact(impulse, "Slip");
  }

  /**
   * A run or a turn the Surface may not let the Character keep its feet
   * through (ADR 0102) — asked once the movement model has decided this
   * tick's velocity, from `brought`, and before anything rides on top of it.
   * See `SurfaceController.runningImpact`.
   */
  private slipWhileRunning(brought: Vec3): void {
    const impulse = this.surface.runningImpact(brought, this.movement.velocity);
    if (impulse) this.applyImpact(impulse, "Slip");
  }

  /**
   * Deliver an Impact to the Character (a shove from the Spinner, a wall dash,
   * another player…). The magnitude decides Stagger vs Ragdoll (ADR 0006); the
   * vector is the shove applied to the ragdoll. If the Character is already down,
   * the shove flails it right away.
   */
  applyImpact(impulse: Vec3, cause: RagdollCause = "Bump"): void {
    // ADR 0104: a Held body is the hold's to put down. Queued here, a shove
    // would sit on the capsule and fire the moment the hold let go.
    if (this.machine.state === "Held") return;
    const magnitude = lengthVec3(impulse);
    this.machine.impact(magnitude);
    // Only an impact big enough to change state names the cause of the knockdown
    // it will trigger — a sub-threshold nudge from lingering contact must not
    // overwrite a real cause latched earlier (ADR 0023).
    this.ragdolls.queueImpact(impulse, magnitude, magnitude >= IMPACT_STAGGER_MIN ? cause : undefined);
    if (this.machine.state === "Ragdoll") this.ragdolls.ragdoll.applyImpulse(impulse);
    // ADR 0093: a Hit that is felt but not enough to put the Character down
    // still moves it. Skipped once down — the capsule is off, and
    // `beginRagdoll` throws the whole body with this same impulse instead.
    else if (magnitude >= IMPACT_STAGGER_MIN && SHOVING_IMPACT_CAUSES.has(cause)) this.movement.shove(impulse, magnitude);
  }

  /** React to a Fall (M5 ticket 03, ADR 0042) — see `RagdollController.fall`. */
  fall(respawnPoint: Vec3 | null, fallCount: number): void {
    this.ragdolls.fall(respawnPoint, fallCount);
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
    this.ragdolls.eliminate("Disconnect");
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
    this.movement.latchButtons(input);
    this.interaction.latchButtons(input);
    this.currentFacing = this.interaction.holding ? this.carryTurn(input.facing) : input.facing;

    // Order matters: read prevState before the machine ticks; compute `settled`
    // from last tick's physics before this tick's world.step().
    const prevState = this.machine.state;
    const settled = this.ragdolls.settled(this.authoritative);
    const tooSteepToWalk = this.surface.tooSteepToWalk(this.movement.grounded);
    const state = this.machine.tick(settled, tooSteepToWalk);
    this.ragdolls.enter(prevState, state, this.tickCount);

    const mode = this.machine.mode;
    this.tickingRagdoll = mode.body === "ragdoll";
    // The get-up's opening sweep (.scratch/physical-ragdoll ticket 03): the
    // bones are kinematic here, so their targets are set before the step
    // that carries them, exactly as a Moving Segment's are.
    if (mode.pose === "gettingUp") this.ragdolls.advanceGetUp(this.tickCount);
    // ADR 0104: a Held body is placed by its hold after the step, and its
    // Player's input does one thing — the Struggle.
    if (mode.body === "held") this.interaction.struggle(input.moveDirection);
    else if (!this.tickingRagdoll) this.beginCapsuleTick(input, mode);
    // A Spin turns the body, whatever the Player's own body turn says.
    if (this.interaction.spinning) this.currentFacing = this.interaction.spinFacing;
  }

  /**
   * A grabber's facing this tick (ADR 0104): toward where its Player turned
   * it, but no further in one tick than {@link CARRY_TURN_STEP} — the owning
   * client turns the body that slowly itself, so this only ever bites on a
   * client that does not.
   */
  private carryTurn(wanted: number): number {
    const turn = wrapAngle(wanted - this.currentFacing);
    return this.currentFacing + Math.max(-CARRY_TURN_STEP, Math.min(CARRY_TURN_STEP, turn));
  }

  /** The other half of {@link beginTick}, run after the shared `world.step()`. */
  endTick(): void {
    if (this.tickingRagdoll) {
      this.capsule.body.setTranslation(this.ragdolls.ragdoll.rootPosition(), false); // camera continuity
      this.movement.grounded = false;
      this.surface.leaveGround();
    }
    this.tickCount += 1;
  }

  /** Single-Character convenience: {@link beginTick}, step this Character's own world, {@link endTick}. */
  tick(input: SimInputs): void {
    this.beginTick(input);
    this.capsule.world.step();
    this.endTick();
  }

  /**
   * Controlled / Stagger / Sliding / GettingUp: queue the kinematic capsule's
   * movement for this tick, input scaled by the state.
   *
   * Read top to bottom this is the tick's story: which verbs fired, what the
   * movement model makes of them, what is added on top of that outright, how
   * far the sweep can actually go, and what the floor does about the arrival.
   * Each step is a method on one of the parts; this one says only the order,
   * which is the part that matters — several of these are correct only where
   * they are (a launch overrides the model, so it must follow it; the bounce
   * reads a peak the gravity integration is what keeps).
   */
  private beginCapsuleTick(input: SimInputs, mode: MotionMode): void {
    const { movement, surface, interaction } = this;
    // Stagger/Sliding both dampen *all* movement input — walk, jump and dash —
    // not just walk.
    const fullControl = mode.inputScale >= 1;
    const move = scaleVec3(input.moveDirection, mode.inputScale);
    const slides = mode.velocity === "slide";

    // ADR 0104: a grabber's hands are full — no jump while carrying anyone.
    const takeoff = movement.beginJump(fullControl && movement.jumpPressed && !interaction.holding, surface);
    movement.leaveRide();
    const dashBurst = this.beginActionVerbs(input, move, fullControl, slides);

    const walk = movement.walkWish(move, surface, interaction.carrySpeedMultiplier);
    const brought = { ...movement.velocity };
    if (slides && surface.currentGroundNormal) movement.slideDownSlope(walk, surface.currentGroundNormal);
    else movement.accelerateTowardWish(input, move, walk, dashBurst, fullControl, surface);
    this.slipWhileRunning(brought);
    movement.applyImpulses(surface);
    this.crashIntoCharacters();

    const corrected = movement.sweepCapsule();
    movement.settleOnGround(corrected, takeoff, slides, surface, this.landed);
    this.resolveCollisions();
    movement.commitMovement(corrected);
  }

  /**
   * Dash, Hit and Grab, in the order their gates depend on each other — a Dash
   * burst started here locks the other two out for as long as it plays.
   * Returns this tick's Dash contribution to the wish velocity.
   */
  private beginActionVerbs(input: SimInputs, move: Vec3, fullControl: boolean, slides: boolean): Vec3 {
    // M6 ticket 04: engaged in a Grab hold — its own independent gate beside
    // `fullControl`. Only the grabber's end ever gets here: a Held Character
    // runs no capsule tick at all (ADR 0104).
    const notGrabbing = !this.interaction.grabEngaged;
    // Dash only starts while grounded and in full control (a walking burst,
    // not an air dash, and never while Sliding); an already-active burst's
    // own remaining duration still ticks down here even while Sliding, it
    // just doesn't contribute to velocity below (ticket 03 simplification —
    // ADR 0035's persistent-velocity model, not yet built, is what would
    // unify how a burst's momentum carries across a state change). M6 ticket
    // 04: also never while engaged in a Grab hold — CONTEXT.md's own Grab
    // definition: "the grabber cannot run while holding."
    const dashBurst = this.movement.beginDash(
      move,
      fullControl && this.movement.dashPressed && this.movement.grounded && notGrabbing && !this.surface.surfaceNoDash,
      slides,
    );
    // M6.1: Dash locks Hit and Grab out entirely while a burst is playing —
    // "dash locks everything until it finishes." Design correction
    // superseding M6.1 ticket 01's original approach-speed scaling, which let
    // a swing be thrown FROM a Dash and, as a side effect, left the dash-run
    // locomotion clip still at full weight underneath the Punch/HitReact
    // overlay (fixed separately in `HitReactionPlayer`, but firing mid-Dash
    // is what exposed it). Read right after `dash.beginTick` above has
    // already advanced this same tick, so it reflects whether a burst is
    // STILL playing out now, not last tick's stale value.
    this.interaction.beginVerbs(input, fullControl, this.movement.dash.isActive, this.currentFacing);
    return dashBurst;
  }

  private resolveCollisions(): void {
    const controller = this.capsule.controller;
    const count = controller.numComputedCollisions();
    let ground: GroundContact | undefined;
    for (let i = 0; i < count; i += 1) {
      const collision = controller.computedCollision(i);
      if (!collision?.collider) continue;
      const normal = vec3(collision.normal1.x, collision.normal1.y, collision.normal1.z);
      // Another Character is neither floor nor wall here. Two overlapping
      // Characters on a tilted deck (ADR 0034) can produce a contact normal
      // steeper than the deck's own, which would outrank the real floor and
      // report the wrong Surface (code review); and crashing into a Player
      // never knocks the *mover* down — Bump is one-sided, only the one
      // bumped goes down (ticket 04). Ice is the exception, and asks the
      // world rather than this list (`crashIntoCharacters`, ADR 0102).
      if (((collision.collider.collisionGroups() >>> 16) & GROUP_CHARACTER) === 0) {
        ground = this.surface.betterGroundContact(ground, collision.collider.handle, normal);
        this.applyWallImpact(normal, false);
      }
      // Every collision is still reported, whatever it was, so
      // `RapierSimulation` can resolve the contact — Motion Knockback, a
      // shoved Prop, or a Bump delivered to the other Character.
      if (this.onCollision) {
        const point = vec3(collision.witness1.x, collision.witness1.y, collision.witness1.z);
        this.onCollision(collision.collider.handle, point, { ...this.movement.velocity }, normal);
      }
    }
    this.surface.adoptGroundContact(this.movement.grounded, ground);
  }

  /**
   * A Character closing on a near-vertical surface at or above the crash
   * speed — {@link WALL_IMPACT_MIN_SPEED}, or whatever the Surface underfoot
   * says instead (`SurfaceController.crashMinSpeed`) — is knocked down by it
   * (ticket 06, re-expressed as a speed threshold in M3.7 ticket 03, ADR
   * 0037) — wall or Moving Segment or Prop, whatever it hit, and on ice
   * another Character too (ADR 0102) — with the magnitude scaling off that
   * same closing speed, so a slow build-up, a late-release Dash or simply
   * walking into a wall is just a blocked walk.
   *
   * Closing speed is `velocity`'s own component *into* the surface, whatever
   * gave the Character that velocity: Dash, a bounce, a launch pad, an updraft
   * all qualify identically. There is deliberately no second, parallel "is
   * this Character Dashing" check — two rules for one event drift apart under
   * tuning, and then neither can be blamed.
   */
  private applyWallImpact(normal: Vec3, intoCharacter: boolean): void {
    if (Math.abs(normal.y) >= WALL_NORMAL_MAX_Y) return;
    const minSpeed = this.surface.crashMinSpeed(intoCharacter);
    if (minSpeed === undefined) return;
    // `normal` points away from the wall, toward the Character (Rapier's own
    // convention — see `wallImpactKnockback`), so moving *into* the wall is
    // moving opposite to it: the closing speed is the negated dot product.
    const closingSpeed = -dotVec3(this.movement.velocity, normal);
    if (closingSpeed >= minSpeed) {
      this.applyImpact(wallImpactKnockback(normal, closingSpeed), "WallImpact");
    } else if (this.surface.surfaceCrashKnockdown) {
      // ADR 0102: where any crash takes your feet, a crash is the speed you
      // *arrive* at. Ice's grip lets velocity keep building against whatever
      // blocks it, so a Character leaning into a rail went down after a
      // quarter of a second without having moved (measured) — what it is
      // only touching, it stops moving into.
      this.movement.stopAgainst(normal);
    }
  }

  /**
   * Running into another Character, on a Surface where anything is a crash
   * (ice, ADR 0102) — asked of the world, not of the sweep's contacts.
   * Rapier's character controller can stop one capsule against another
   * without reporting the contact: measured at 3 approaches in 50 on ice,
   * each of which then pushed the other Character across the ice with no
   * crash at all, where a wall went down 50 times in 50. A rule that holds
   * 94% of the time reads as a bug.
   *
   * Run once this tick's velocity is final and before the sweep, so a touch
   * too slow to count takes the velocity into the other Character out
   * exactly as a wall does. The normal runs between the two capsules'
   * nearest points, so one Character standing on another's head is not a
   * side-on crash.
   */
  private crashIntoCharacters(): void {
    if (!this.surface.surfaceCrashKnockdown) return;
    const at = this.capsule.body.translation();
    this.capsule.world.intersectionsWithShape(
      at,
      this.capsule.body.rotation(),
      this.touchProbe,
      (other) => {
        const o = other.translation();
        const dy = at.y - o.y;
        const apart = Math.sign(dy) * Math.max(0, Math.abs(dy) - 2 * CAPSULE_HALF_HEIGHT);
        const between = vec3(at.x - o.x, apart, at.z - o.z);
        if (lengthVec3(between) > 0) this.applyWallImpact(normalizeVec3(between), true);
        return true;
      },
      undefined,
      CHARACTERS_ONLY,
      this.capsule.collider,
      undefined,
      (collider) => collider.isEnabled(),
    );
  }

  /** Everything this Character was doing upright, stopped: its movement, and its verbs and holds. */
  private resetMovementControllers(): void {
    this.movement.reset();
    this.interaction.reset();
  }

  snapshot(): CharacterState {
    const state = this.machine.state;
    const pose = this.machine.mode.pose;
    const t = this.capsule.body.translation();
    const capsuleCentre = vec3(t.x, t.y, t.z);

    let position = capsuleCentre;
    let velocity = this.movement.velocity;
    let bones: BoneSnapshot[] = [];
    if (pose !== "capsule") {
      ({ position, velocity, bones } = this.ragdolls.pose(pose, capsuleCentre, this.tickCount, velocity));
    } else if (this.ragdolls.isHanging) {
      // A Limp body hangs as a real ragdoll (ticket 04), so its bones travel
      // even though the hold, not the ragdoll, says where the body is.
      bones = this.ragdolls.ragdoll.readBones();
    }

    return {
      position,
      velocity: { ...velocity },
      grounded: this.movement.grounded,
      motionState: state,
      respawnCount: this.ragdolls.respawnCount,
      ragdollEpoch: this.ragdolls.ragdollEpoch,
      hitEpoch: this.interaction.hitEpoch,
      hitReactEpoch: this.interaction.hitReactEpoch,
      grabEpoch: this.interaction.grabEpoch,
      ragdollCause: this.ragdolls.ragdollCause,
      dashCooldownMs: this.movement.dash.cooldownMs,
      dashing: this.movement.dash.isActive,
      dashSpeed: this.movement.dashSpeed,
      hitCooldownMs: this.interaction.hit.cooldownMs,
      hitChargeMs: this.interaction.hit.chargeMs,
      grabCooldownMs: this.interaction.grab.cooldownMs,
      grabbingId: this.interaction.grabbingId,
      heldByGrabberId: this.interaction.heldByGrabberId,
      heldPhase: this.interaction.reportedHeldPhase,
      holdEndsTick: this.interaction.holdEndsTick,
      escapeProgress: this.interaction.escapeProgress,
      lastWiggleYaw: this.interaction.lastWiggleYaw,
      spinMs: this.interaction.spinning ? this.interaction.spinMs : 0,
      launchPadEpoch: this.movement.launchPadEpoch,
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
   *   out (see `DashController.restoreCooldownMs`) —
   *   reconciliation must not silently truncate a burst the server agrees is
   *   still happening.
   */
  reconcileTo(base: ReconcileBase): void {
    if (isDownMotionState(base.motionState)) {
      this.ragdolls.syncDown(base, this.tickCount);
      return;
    }

    if (isDownMotionState(this.machine.state)) this.ragdolls.returnToControlled();
    this.capsule.body.setTranslation({ ...base.position }, false);
    this.movement.reconcile(base);
    this.surface.reconcile(base.motionState === "Sliding");
    this.interaction.reconcile(base);
    this.machine.snapTo(base.motionState);
    // ADR 0104: a Held body collides with nothing; any other is solid again —
    // whichever way round the correction went.
    this.capsule.collider.setEnabled(base.motionState !== "Held");
    // A grabber's turn is clamped against the tick before, and a Spin turns
    // from where the server had it, so the replay starts from its facing. For
    // everyone else the next input overwrites it anyway.
    this.currentFacing = base.facing;
    if (this.interaction.spinTicks > 0) this.interaction.spinStartFacing = base.facing - spinAngleAt(this.interaction.spinTicks);
    this.ragdolls.forgetRespawn(); // a Fall the client predicted but the server (this base) hasn't seen
  }

  /** Remove this Character's capsule body, character controller and ragdoll bones from the world (ticket 01: `removeCharacter`). */
  dispose(): void {
    this.ragdolls.ragdoll.dispose();
    this.capsule.world.removeCharacterController(this.capsule.controller);
    this.capsule.world.removeRigidBody(this.capsule.body);
  }
}

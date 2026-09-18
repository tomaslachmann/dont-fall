import { addVec3, lengthVec3, lerpVec3, scaleVec3, vec3, type Vec3 } from "../../math/vec3.js";
import { GETUP_CAPSULE_LIFT, GETUP_TICKS, KNOCKDOWN_LAUNCH_SCALE, RAGDOLL_IMPACT_VELOCITY_SCALE, RAGDOLL_SETTLE_SPEED, RESPAWN_WOBBLE_TICKS } from "../../tuning/knockdown.js";
import { THROWING_RAGDOLL_CAUSES, type RagdollCause, type ReconcileBase } from "../../state/SimState.js";
import { isDownMotionState, type CharacterMotionState, type CharacterStateMachine } from "../CharacterStateMachine.js";
import { Ragdoll } from "../Ragdoll.js";
import { blendGettingUpBones, type BoneSnapshot } from "../ragdollSkeleton.js";
import type { Capsule } from "./Capsule.js";
import type { MovementController } from "./MovementController.js";

interface PendingImpact {
  magnitude: number;
  impulse: Vec3;
}

interface PendingRespawn {
  point: Vec3;
  fallCount: number;
}

/** Where the snapshot says the body is while down — see {@link RagdollController.pose}. */
export interface DownPose {
  position: Vec3;
  velocity: Vec3;
  bones: BoneSnapshot[];
}

/**
 * A Character's down episodes (ADR 0006/0015/0023/0072): the Ragdoll body
 * itself, every way into it (an Impact, an elimination, a correction the
 * client never predicted) and out of it (getting up, a correction that says
 * it never happened), the Respawn that puts a fallen Character back on its
 * feet, and what the snapshot reports for the body while it is down.
 */
export class RagdollController {
  readonly ragdoll: Ragdoll;
  /**
   * Monotonic count of Respawn teleports (ADR 0023 / Q9). The renderer holds the
   * last value it saw and snaps (no interpolation) when it changes — robust
   * against the interpolation buffer skipping the exact respawn tick, which a
   * one-tick boolean was not.
   */
  respawnCount = 0;
  /** Rises on every entry to `Ragdoll` (ADR 0023). */
  ragdollEpoch = 0;
  /** Cause latched on the last Ragdoll entry; `pendingCause` is what the next entry will latch. */
  ragdollCause: RagdollCause = "Fall";
  pendingCause: RagdollCause = "Fall";
  /** Strongest Impact queued since the last tick, with the shove to apply if it ragdolls. */
  private pendingImpact: PendingImpact | null = null;
  /** Set by {@link fall}; consumed at the top of the next tick. */
  private pendingRespawn: PendingRespawn | null = null;

  private getupBones: readonly BoneSnapshot[] = [];
  private getupStartTick = 0;
  private getupStartRoot: Vec3 = vec3();

  /**
   * `resetMotion` stops everything the Character was doing upright — its
   * movement and its verbs and holds — which every way into or out of a down
   * episode has to do.
   */
  constructor(
    private readonly capsule: Capsule,
    private readonly machine: CharacterStateMachine,
    private readonly movement: MovementController,
    private readonly resetMotion: () => void,
  ) {
    this.ragdoll = new Ragdoll(capsule.world);
  }

  /** Whether a Fall-triggered respawn is queued for the top of the next tick. */
  get hasPendingRespawn(): boolean {
    return this.pendingRespawn !== null;
  }

  /**
   * Whether the ragdoll has come to rest, so the state machine may stand it
   * up. A non-authoritative (client-prediction) Character never trusts its own
   * settle-check to end a knockdown — only a server snapshot can (ADR 0015).
   * Without this it could recover *ahead* of the server, which is exactly
   * what reopens the double-knockdown bug ADR 0014 fixed: a later, slower
   * snapshot still reporting the old episode would read as a fresh one.
   */
  settled(authoritative: boolean): boolean {
    return authoritative && this.ragdoll.isActive && this.ragdoll.maxSpeed() < RAGDOLL_SETTLE_SPEED;
  }

  /**
   * Whatever the state machine's tick from `prevState` to `state` means for
   * the body. `tickCount` is the Character's own, for the get-up clock.
   */
  enter(prevState: CharacterMotionState, state: CharacterMotionState, tickCount: number): void {
    // Every entry to Ragdoll is a new down episode (ADR 0023) — whether it came
    // from an Impact, a forced Fall, or the Respawn flop.
    if (state === "Ragdoll" && prevState !== "Ragdoll") {
      this.ragdollEpoch += 1;
      this.ragdollCause = this.pendingCause;
    }

    if (this.pendingRespawn) {
      this.respawnAtCheckpoint(this.pendingRespawn);
      // The respawn supersedes whatever transition this tick was making —
      // it may have snapped the machine out of a down state itself, and a
      // `beginGettingUp` after it would re-teleport the capsule back to the
      // abandoned ragdoll's root.
      return;
    }
    if (state === "Ragdoll" && prevState !== "Ragdoll") this.beginRagdoll();
    if (prevState === "Ragdoll" && state === "GettingUp") this.beginGettingUp(tickCount);
    if (prevState === "GettingUp" && state === "Controlled") this.getupBones = [];
  }

  /**
   * An Impact's part in the next knockdown (ADR 0006/0023): the cause it
   * would latch, when it is big enough to change state at all, and the
   * strongest shove queued since the last tick.
   */
  queueImpact(impulse: Vec3, magnitude: number, cause: RagdollCause | undefined): void {
    if (cause !== undefined) this.pendingCause = cause;
    if (!this.pendingImpact || magnitude > this.pendingImpact.magnitude) {
      this.pendingImpact = { magnitude, impulse: { ...impulse } };
    }
  }

  /**
   * React to a Fall (M5 ticket 03, ADR 0042): losing control always happens
   * — a Fall never varies, only what follows it does. `respawnPoint` is
   * `null` for a Round type with no Respawn (Survival): the Character is
   * eliminated ({@link eliminate}) rather than queued a Respawn. A
   * Respawn is queued for `point`, applied at the top of the next
   * tick — unchanged, and still the only branch that needs the
   * state machine's own deferred {@link CharacterStateMachine.forceRagdoll},
   * since a respawning Character keeps being stepped afterward.
   * `RapierSimulation`'s own `detectFall` decides which to pass, from
   * `RoundRules.fallBehavior`.
   */
  fall(respawnPoint: Vec3 | null, fallCount: number): void {
    if (respawnPoint) {
      // No knockdown any more (ADR 0072): a Fall used to force a Ragdoll and
      // cost one to four and a half seconds of zero input on the way back.
      // The Character now simply drops out of the world and is put back on
      // its feet, wobbling — see `respawnAtCheckpoint`.
      this.resetMotion();
      this.pendingRespawn = { point: { ...respawnPoint }, fallCount };
    } else {
      this.eliminate("Fall");
    }
  }

  /**
   * Immediate, synchronous Ragdoll entry — unlike an ordinary Impact or a
   * Checkpoint respawn, both of which land on the *next* tick
   * via the state machine's own deferred `forceRagdoll`/`impact` queue, this
   * has no next tick to land on: an eliminated Character is never
   * stepped again (M5 ticket 04, ADR 0042), so it must reach `Ragdoll` and
   * activate the ragdoll body in this same call if it isn't already down.
   *
   * Guarded by `isDownMotionState` — code review, ticket 04 — the same guard
   * `beginTick` (`prevState !== "Ragdoll"`) and `reconcileTo`
   * (`!isDownMotionState(...)`) already apply to every *other* Ragdoll-entry
   * path: without it, eliminating a Character already Ragdolling from an
   * unrelated Impact (a Bump off a ledge, mid-tumble) would re-snap every
   * bone to a fresh standing flop, discard its real tumbling velocity for
   * `velocity` (zeroed since that earlier Impact began), overwrite its
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
  eliminate(cause: RagdollCause): void {
    if (isDownMotionState(this.machine.state)) return;
    this.pendingCause = cause;
    this.machine.snapTo("Ragdoll");
    this.ragdollEpoch += 1;
    this.ragdollCause = cause;
    this.beginRagdoll();
  }

  /**
   * Picked up by a Grab (ADR 0104): whatever this Character was doing, on its
   * feet or down, it is carried now. A body that was down stops being one —
   * the ragdoll freezes and the knockdown it was in ends here, because nothing
   * gets up while Held; being let go of starts a fresh one. The capsule's
   * collider goes off, as an eliminated Character's does (M5 ticket 04): the
   * body is placed by the hold, and nothing collides with it.
   */
  beginHeld(): void {
    if (this.ragdoll.isActive) this.ragdoll.deactivate();
    this.getupBones = [];
    this.pendingImpact = null;
    this.capsule.collider.setEnabled(false);
    this.resetMotion();
    this.movement.grounded = false;
    this.machine.snapTo("Held");
  }

  /**
   * Let go of on its feet (ADR 0104) — a Struggle won, or set down before it
   * was lost. `wobbleTicks` Staggers it on landing, or not at all.
   */
  leaveHeldOnFeet(wobbleTicks: number | null): void {
    this.capsule.collider.setEnabled(true);
    this.machine.snapTo("Controlled");
    if (wobbleTicks !== null) this.machine.wobble(wobbleTicks);
  }

  /**
   * Let go of into a knockdown (ADR 0104) — a Hurl, a Limp body put down, or
   * a dizzy grabber's weak fling. Always a whole knockdown with a fresh clock,
   * starting now: the ragdoll leaves from where the hold had the body, at
   * `launch`, tumbling from `tumble` on the chest.
   */
  knockDownFromHold(cause: RagdollCause, launch: Vec3, tumble: Vec3): void {
    this.pendingCause = cause;
    this.machine.snapTo("Ragdoll");
    this.ragdollEpoch += 1;
    this.ragdollCause = cause;
    const at = this.capsule.body.translation();
    this.capsule.collider.setEnabled(false);
    this.resetMotion();
    this.ragdoll.activate(vec3(at.x, at.y, at.z), launch, tumble);
  }

  /**
   * Down on the next tick, for `cause` — a knockdown nothing hit it into (ADR
   * 0104: a grabber that Spun too long). Lands through the state machine's own
   * deferred `forceRagdoll`, exactly as a Respawn's used to.
   */
  knockDown(cause: RagdollCause): void {
    this.pendingCause = cause;
    this.machine.forceRagdoll();
  }

  private beginRagdoll(): void {
    const at = this.capsule.body.translation();
    const impulse = this.takeImpactImpulse();
    // A crash (dash into a wall/Prop, a Bump, a Spinner — anything carrying an
    // Impact impulse) absorbs most forward momentum: the ragdoll tumbles, it
    // doesn't keep full dash speed and rocket through what it hit (ticket 08).
    // A Fall carries no impulse and keeps its velocity.
    const magnitude = lengthVec3(impulse);
    const scale = magnitude > 0 ? RAGDOLL_IMPACT_VELOCITY_SCALE : 1;
    // Knocked down while riding, or in the air after leaving a Ride: the
    // body keeps what it was being carried at (ADR 0061).
    const carried = this.movement.carriedVelocity();
    // ADR 0093: a knockdown another Player caused throws the whole body, not
    // just the chest. The chest impulse below is what makes a knockdown
    // *tumble*; on its own it barely travels, so a Character knocked down
    // standing still used to drop where it stood. Every bone leaves at this
    // velocity, and the tumble still comes from the chest. Scenery throws
    // nobody — see `THROWING_RAGDOLL_CAUSES`.
    const thrown =
      magnitude > 0 && THROWING_RAGDOLL_CAUSES.has(this.pendingCause)
        ? scaleVec3(impulse, KNOCKDOWN_LAUNCH_SCALE)
        : vec3();
    const kept = addVec3(addVec3(scaleVec3(this.movement.velocity, scale), carried), thrown); // captured before resetMotion zeroes it
    // The kept velocity must not still point THROUGH whatever the body
    // crashed into (found live 2026-09-18: a Dash into a wall kept its
    // scaled forward momentum, so the pelvis flew INTO the wall, the body
    // crumpled against it and the fall was drawn lying through the
    // geometry). The queued impulse always points away from the collision —
    // a wall's contact normal, a Moving Segment's push, a Bump's shove — so
    // the component of the kept velocity against its horizontal direction
    // is, by the collision's own angle, motion into the obstacle: stripped,
    // for every collision-caused knockdown alike. The vertical part stays (a
    // fall ONTO something still falls), and a knockdown with no impulse (a
    // plain Fall) is untouched.
    const launch = magnitude > 0 ? stripIntoImpact(kept, impulse) : kept;
    this.capsule.collider.setEnabled(false);
    this.resetMotion();
    this.ragdoll.activate(vec3(at.x, at.y, at.z), launch, impulse);
  }

  private beginGettingUp(tickCount: number): void {
    this.getupBones = this.ragdoll.readBones();
    this.getupStartTick = tickCount + 1; // this tick's snapshot is t = 0
    this.getupStartRoot = this.ragdoll.rootPosition();
    this.ragdoll.deactivate();
    this.pendingImpact = null;
    this.capsule.body.setTranslation(
      { x: this.getupStartRoot.x, y: this.getupStartRoot.y + GETUP_CAPSULE_LIFT, z: this.getupStartRoot.z },
      false,
    );
    this.capsule.collider.setEnabled(true);
    this.movement.velocity = vec3();
  }

  /**
   * Put a fallen Character back on the Checkpoint — on its feet and unsteady
   * (ADR 0072), where it used to arrive as a flopping ragdoll.
   *
   * The ragdoll is not activated at all: the collider stays on, the capsule is
   * simply moved, and the Character comes back wobbling for
   * {@link RESPAWN_WOBBLE_TICKS}. That wobble is the whole cost of a Fall now,
   * and it is both gentler and more predictable than the knockdown it
   * replaces — a Track author placing a gap can count on it.
   */
  private respawnAtCheckpoint(respawn: PendingRespawn): void {
    this.pendingRespawn = null;
    this.respawnCount += 1;
    this.getupBones = [];
    this.pendingImpact = null;
    // A Fall taken while DOWN — a body hurled or thrown off the course (ADR
    // 0093/0104) — ends the down episode here and now (found live
    // 2026-09-18). Before this, the teleport below ran while the machine
    // stayed `Ragdoll`: `endTick`'s per-tick root follow immediately dragged
    // the capsule back to the still-flying body, the kill plane then fired
    // again every tick (~60 falls per hurl on the Results screen), and after
    // the knockdown clock the body Got Up in the void and visibly lerped
    // back onto the course. Deactivating the ragdoll and snapping to
    // `Controlled` makes the wobble below actually take — a knocked-down
    // Character that falls off the world comes back exactly like a standing
    // one: on its feet, at its Checkpoint, unsteady (ADR 0072).
    if (isDownMotionState(this.machine.state)) {
      if (this.ragdoll.isActive) this.ragdoll.deactivate();
      this.machine.snapTo("Controlled");
    }
    this.capsule.collider.setEnabled(true);
    this.capsule.body.setTranslation({ ...respawn.point }, true);
    this.resetMotion();
    this.machine.wobble(RESPAWN_WOBBLE_TICKS);
  }

  /** The queued Impact shove, consumed. Zero if none. */
  private takeImpactImpulse(): Vec3 {
    const impulse = this.pendingImpact?.impulse ?? vec3();
    this.pendingImpact = null;
    return impulse;
  }

  /** The GettingUp blend's current position — shared by `pose()` and `reconcileTo`'s position-tracking correction. */
  private getupBlendedPosition(elapsed: number, capsuleCentre: Vec3): Vec3 {
    const getupT = Math.min(1, Math.max(0, elapsed / GETUP_TICKS));
    return lerpVec3(this.getupStartRoot, capsuleCentre, getupT);
  }

  /**
   * Where the snapshot says the body is while down: the ragdoll's own root,
   * velocity and bones, or — getting up — a position rising smoothly from the
   * settled pelvis to the standing capsule, so there is no jump at the
   * Ragdoll → GettingUp boundary.
   */
  pose(pose: "ragdoll" | "gettingUp", capsuleCentre: Vec3, tickCount: number, capsuleVelocity: Vec3): DownPose {
    if (pose === "ragdoll") {
      // The capsule's own velocity was zeroed the moment Ragdoll began
      // (`resetMotion`); report the ragdoll body's real velocity
      // instead so a reconciling client has a real launch to hand its own
      // ragdoll on a forced Bump snap (ticket 08 follow-up), not zero.
      return { position: this.ragdoll.rootPosition(), velocity: this.ragdoll.rootVelocity(), bones: this.ragdoll.readBones() };
    }
    const elapsed = tickCount - this.getupStartTick;
    // position rises smoothly from the settled pelvis to the standing capsule,
    // so there is no jump at the Ragdoll → GettingUp boundary
    return {
      position: this.getupBlendedPosition(elapsed, capsuleCentre),
      velocity: capsuleVelocity,
      bones: blendGettingUpBones(this.getupBones, capsuleCentre, elapsed),
    };
  }

  /**
   * **Server reports a down state:** always synced, unconditionally — enter
   * `Ragdoll` now if we weren't already down, then advance to `GettingUp`
   * too if the server has and we haven't, then re-anchor the pelvis to the
   * server's position. See `CharacterController.reconcileTo` for why this is
   * safe (ADR 0015).
   */
  syncDown(base: ReconcileBase, tickCount: number): void {
    if (this.machine.state !== base.motionState) {
      if (!isDownMotionState(this.machine.state)) {
        // A knockdown the client never predicted at all (or already wrongly
        // recovered from — which can't happen once `authoritative` is
        // false, but stays correct either way): flop now, at the server's
        // real position, not wherever we last predicted.
        this.capsule.body.setTranslation({ ...base.position }, false);
        this.movement.velocity = { ...base.velocity };
        this.machine.snapTo("Ragdoll");
        this.beginRagdoll();
      }
      if (base.motionState === "GettingUp" && this.machine.state !== "GettingUp") {
        this.machine.snapTo("GettingUp");
        this.beginGettingUp(tickCount);
      }
    }
    if (this.ragdoll.isActive) this.ragdoll.snapRootTo(base.position);
  }

  /** Undo a local Ragdoll/GettingUp the server says never happened (or is already over): freeze and hide the bones, re-enable the capsule. */
  returnToControlled(): void {
    if (this.ragdoll.isActive) this.ragdoll.deactivate();
    this.capsule.collider.setEnabled(true);
    this.getupBones = [];
    this.pendingImpact = null;
    this.resetMotion();
  }

  /** A Fall the client predicted but the server (this base) hasn't seen. */
  forgetRespawn(): void {
    this.pendingRespawn = null;
  }
}

/**
 * `kept` with its horizontal component against `away` removed — the launch
 * of a collision-caused knockdown may not keep moving into the thing it
 * collided with (see `beginRagdoll`'s call site). `away` is the queued
 * Impact's impulse; one with no horizontal part (a squash from above) names
 * no obstacle direction and strips nothing.
 */
export const stripIntoImpact = (kept: Vec3, away: Vec3): Vec3 => {
  const horizontal = Math.hypot(away.x, away.z);
  if (horizontal < 1e-6) return kept;
  const dx = away.x / horizontal;
  const dz = away.z / horizontal;
  const into = kept.x * dx + kept.z * dz;
  return into < 0 ? vec3(kept.x - dx * into, kept.y, kept.z - dz * into) : kept;
};

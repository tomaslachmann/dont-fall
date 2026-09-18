import { dotVec3, lengthVec3, type Vec3 } from "../../math/vec3.js";
import type { HeldPhase, ReconcileBase } from "../../state/SimState.js";
import { TICK_DT, TICK_MS } from "../../tuning/clock.js";
import {
  GRAB_CARRY_SPEED_MULTIPLIER,
  GRAB_ESCAPE_DECAY_PER_S,
  GRAB_ESCAPE_WIGGLES,
  GRAB_WIGGLE_REVERSAL_DOT_MAX,
  SPIN_OVERSPIN_TICKS,
  SPIN_WINDUP_TICKS,
} from "../../tuning/fight.js";
import { GrabController } from "../GrabController.js";
import { HitController } from "../HitController.js";
import type { SimInputs } from "../SimInputs.js";
import { forwardOf, spinAngleAt, spinWindup } from "../spin.js";

/** Which end of a Grab hold a Character is at this tick (ADR 0104), or neither. */
export type HoldRole = "grabbing" | "held";

/** A Spin let go of this tick (ADR 0104): how far it had wound up, and the facing it was let go at. */
export interface Hurl {
  windup: number;
  facing: number;
}

/**
 * What a Character does to other Characters, from its own side (M6, ADR
 * 0093, ADR 0104): the Hit it charges and throws, the Grab it reaches with,
 * and the hold it is part of — in either role: carrying and Spinning someone,
 * or Struggling to get free. Who a swing or a reach actually lands on, and
 * where a hold puts both bodies, is a cross-Character question
 * `RapierSimulation` and `GrabHolds` answer; this is the half that belongs to
 * one Character, and the half its own client can predict.
 */
export class InteractionController {
  /** Hit's cooldown and charge (M6 ticket 03) — see {@link HitController}. */
  readonly hit = new HitController();
  /** Grab's cooldown (M6 ticket 04) — see {@link GrabController}. */
  readonly grab = new GrabController();

  /**
   * Whether a swing actually fired THIS tick — set fresh at the top of every
   * `beginTick` (never stale across a tick where the capsule tick
   * doesn't run, e.g. pure Ragdoll) and read once by `RapierSimulation`,
   * right after every Character's `beginTick` has run and before
   * `world.step()`, to resolve who (if anyone) it actually landed on — a
   * cross-Character question only `RapierSimulation` can answer.
   */
  pendingHitFired = false;
  /** The charge fraction (0..1) a swing fired with THIS tick; 0 whenever {@link pendingHitFired} is false (M6.1 hold-to-charge). */
  pendingHitChargeFraction = 0;
  /** Same "fresh this tick only" treatment as {@link pendingHitFired}, for a grab attempt instead of a swing. */
  pendingGrabFired = false;
  /** This tick's rising edge of Grab, latched by {@link latchButtons}. */
  grabPressed = false;
  private grabHeldLastTick = false;

  /** Rises every time this Character's own Hit swing fires (M6 ticket 03) — the Epoch idiom, same as `ragdollEpoch`. */
  hitEpoch = 0;
  /** See `CharacterState.grabEpoch` — the Grab's own counterpart of {@link hitEpoch}. */
  grabEpoch = 0;
  /** Rises every time this Character is on the receiving end of a landed Hit (M6 ticket 03) — set by `RapierSimulation` via {@link registerHitReceived}. */
  hitReactEpoch = 0;

  /**
   * Which end of a hold this Character is at this tick, or `null` (ADR 0104)
   * — set by {@link holdAs} before the step and cleared by {@link clearHold},
   * which every Character gets every tick before the live holds re-assert
   * themselves. On the server `GrabHolds` says it; on a client, for its own
   * Character only, the latest snapshot does (`RapierSimulation.syncOwnHold`),
   * since no hold is ever resolved there.
   */
  holdRole: HoldRole | null = null;
  /** Which part of its hold a Held Character is in this tick — only meaningful while {@link holdRole} is `"held"`. */
  heldPhase: HeldPhase | null = null;
  /**
   * A press of Grab while already holding (ADR 0093) — the Player letting go
   * on purpose. Read and cleared by `GrabHolds`, which owns the hold; same
   * "fresh this tick only" treatment as {@link pendingGrabFired}.
   */
  private pendingGrabRelease = false;
  /** Who this Character is currently grabbing, or `null` (M6.1) — see `CharacterState.grabbingId`. Set from outside by `GrabHolds`, which alone knows the cross-Character hold relationship. */
  grabbingId: string | null = null;
  /** Who is currently grabbing this Character, or `null` (M6.1) — the reverse of {@link grabbingId}, see `CharacterState.heldByGrabberId`. */
  heldByGrabberId: string | null = null;
  /** See `CharacterState.heldPhase` — set from outside by `GrabHolds` after the step, for the snapshot only. */
  reportedHeldPhase: HeldPhase | null = null;
  /** See `CharacterState.holdEndsTick` — set from outside by `GrabHolds`, for the snapshot only. */
  holdEndsTick: number | null = null;

  /** See `CharacterState.escapeProgress` — the Struggle's meter, 0..1 (ADR 0104). */
  escapeProgress = 0;
  /** See `CharacterState.lastWiggleYaw` — what the next move input has to reverse to count as a wiggle. */
  lastWiggleYaw: number | null = null;

  /** How many ticks the current Spin has run, 0 while not Spinning (ADR 0104). */
  spinTicks = 0;
  /** The facing the current Spin started from — its angle is this plus `spinAngleAt(spinTicks)`. */
  spinStartFacing = 0;
  /** This tick's Hurl, or `null` — read and cleared by `GrabHolds`. */
  private pendingHurl: Hurl | null = null;
  /** Whether this tick's Spin ran past its overspin limit — read and cleared by `GrabHolds`. */
  private pendingDizzy = false;

  /** Whether this Character is part of a Grab hold right now, either role (ADR 0093). */
  get grabEngaged(): boolean {
    return this.holdRole !== null;
  }

  /** Whether this Character is carrying someone this tick (ADR 0104). */
  get holding(): boolean {
    return this.holdRole === "grabbing";
  }

  /** Whether this Character is Spinning the Character it holds (ADR 0104). */
  get spinning(): boolean {
    return this.holding && this.spinTicks > 0;
  }

  /**
   * Multiplies `WALK_SPEED` this tick (ADR 0104): a grabber walks at
   * {@link GRAB_CARRY_SPEED_MULTIPLIER} of its pace, and stands where it is
   * while Spinning. 1 for everyone not carrying anybody.
   */
  get carrySpeedMultiplier(): number {
    if (!this.holding) return 1;
    return this.spinning ? 0 : GRAB_CARRY_SPEED_MULTIPLIER;
  }

  /** See `CharacterState.spinMs`. */
  get spinMs(): number {
    return this.spinTicks * TICK_MS;
  }

  /** Where the current Spin has turned this Character to — only meaningful while {@link spinning}. */
  get spinFacing(): number {
    return this.spinStartFacing + spinAngleAt(this.spinTicks);
  }

  /**
   * Latch this tick's Grab press and forget last tick's verbs — reset every
   * tick, unconditionally, so never stale across a tick where the capsule
   * tick doesn't run at all (pure Ragdoll).
   */
  latchButtons(input: SimInputs): void {
    this.grabPressed = input.grabHeld && !this.grabHeldLastTick;
    this.grabHeldLastTick = input.grabHeld;
    this.pendingHitFired = false;
    this.pendingHitChargeFraction = 0;
    this.pendingGrabFired = false;
    // A let-go asked for on a tick whose hold then ended some other way must
    // not wait for the next hold and end that one on its first tick.
    this.pendingGrabRelease = false;
  }

  /**
   * Hit and Grab for this tick, after Dash has had its turn (`dashActive`):
   * a Dash burst locks both out for as long as it plays.
   *
   * ADR 0104: while carrying someone, Hit's button Spins instead
   * ({@link spinTick}) and nothing charges a swing — the grabber's hands are
   * full. `facing` is this tick's, before any Spin turns it: where a Spin
   * that starts now starts from.
   */
  beginVerbs(input: SimInputs, fullControl: boolean, dashActive: boolean, facing: number): void {
    const notGrabbing = !this.grabEngaged;
    // M6.1 hold-to-charge: hold Hit to charge a stronger swing, release to
    // fire — the striker's own commitment now comes from how long they held
    // it, not from how fast a Dash happened to have them moving (which can no
    // longer overlap a swing at all). `fullControl` alone already excludes
    // Sliding/Stagger (both scale `inputScale` below 1) and Ragdoll/GettingUp
    // (0). `HitController` tracks the charge/release edges itself from the
    // raw held state — no external press-edge needed here anymore, unlike
    // Dash/Grab, which still fire on a rising edge only.
    const hitResult = this.hit.beginTick(input.hitHeld, fullControl && !dashActive && notGrabbing);
    this.pendingHitFired = hitResult !== null;
    this.pendingHitChargeFraction = hitResult ?? 0;
    if (this.pendingHitFired) this.hitEpoch += 1;
    this.spinTick(input.hitHeld, facing);
    // M6 ticket 04, M6.1: same shape as Hit above — "may I attempt to grab,"
    // not "did it connect" (RapierSimulation's job, cross-Character). Also
    // gated on not already being engaged (so pressing Grab again mid-hold
    // neither starts a second one nor wastes the cooldown early) and, like
    // Hit, never while Dashing.
    // ADR 0093: the same button lets go. A press while engaged is never a
    // new grab (there is nothing to reach for — your hands are full), so the
    // two readings of the press can't collide.
    if (this.grabPressed && this.grabEngaged) this.pendingGrabRelease = true;
    this.pendingGrabFired = this.grab.beginTick(fullControl && this.grabPressed && notGrabbing && !dashActive);
    // Like `hitEpoch`: the attempt, not the catch — a grab at nobody is still
    // a reach the player (and everyone watching) should see.
    if (this.pendingGrabFired) this.grabEpoch += 1;
  }

  /**
   * The Spin, one tick (ADR 0104): Hit held while carrying someone winds it
   * up; letting go Hurls, with however far it had wound up; holding on past
   * full speed for `SPIN_OVERSPIN_TICKS` makes the grabber dizzy instead. The
   * facing it turns ({@link spinFacing}) is `CharacterController`'s to apply
   * — this only counts.
   */
  private spinTick(hitHeld: boolean, facing: number): void {
    this.pendingHurl = null;
    this.pendingDizzy = false;
    if (!this.holding) {
      this.spinTicks = 0;
      return;
    }
    if (hitHeld) {
      if (this.spinTicks === 0) this.spinStartFacing = facing;
      this.spinTicks += 1;
      if (this.spinTicks > SPIN_WINDUP_TICKS + SPIN_OVERSPIN_TICKS) {
        this.pendingDizzy = true;
        this.spinTicks = 0;
      }
      return;
    }
    if (this.spinTicks > 0) {
      // The facing it was let go at is the last one the Spin turned to — the
      // tick before this one, since nothing turns on the tick of release.
      this.pendingHurl = { windup: spinWindup(this.spinTicks), facing: this.spinFacing };
      this.spinTicks = 0;
    }
  }

  /**
   * The Struggle, one tick (ADR 0104): a Held Character's movement input
   * reversing against the last non-zero one is a wiggle, and fills the escape
   * meter by `1 / GRAB_ESCAPE_WIGGLES`, while the meter drains every tick at
   * `GRAB_ESCAPE_DECAY_PER_S` — so it only fills while the Player keeps at
   * it. The drain is continuous rather than waiting for a pause, because a
   * pause is a timer, and a timer is one more thing a reconcile would have to
   * carry for the replay to agree with the server. Whether a full meter frees
   * the Character is `GrabHolds`' call — it takes both of them.
   */
  struggle(moveDirection: Vec3): void {
    if (this.holdRole !== "held" || this.heldPhase !== "struggle") return;
    this.escapeProgress = Math.max(0, this.escapeProgress - GRAB_ESCAPE_DECAY_PER_S * TICK_DT);
    if (lengthVec3(moveDirection) === 0) return;
    const yaw = Math.atan2(moveDirection.x, -moveDirection.z);
    if (this.lastWiggleYaw !== null && dotVec3(forwardOf(yaw), forwardOf(this.lastWiggleYaw)) <= GRAB_WIGGLE_REVERSAL_DOT_MAX) {
      this.escapeProgress = Math.min(1, this.escapeProgress + 1 / GRAB_ESCAPE_WIGGLES);
    }
    this.lastWiggleYaw = yaw;
  }

  /** Registers that this Character was just on the receiving end of a landed Hit (M6 ticket 03) — bumps {@link hitReactEpoch}, called by `RapierSimulation.resolveHit`. */
  registerHitReceived(): void {
    this.hitReactEpoch += 1;
  }

  /** Whether the Player asked to let go this tick (ADR 0093), consumed by the caller that owns the hold. */
  takeGrabRelease(): boolean {
    const asked = this.pendingGrabRelease;
    this.pendingGrabRelease = false;
    return asked;
  }

  /** The Spin let go of this tick, or `null` (ADR 0104) — consumed by `GrabHolds`. */
  takeHurl(): Hurl | null {
    const hurl = this.pendingHurl;
    this.pendingHurl = null;
    return hurl;
  }

  /** Whether this tick's Spin ran too long (ADR 0104) — consumed by `GrabHolds`. */
  takeDizzy(): boolean {
    const dizzy = this.pendingDizzy;
    this.pendingDizzy = false;
    return dizzy;
  }

  /** Starts this Character's own Grab cooldown (M6 ticket 04) — called once a hold it initiated has ended, however it ended. See `GrabController.release`. */
  registerGrabReleased(): void {
    this.grab.release();
  }

  /**
   * Nobody is holding this Character, until proven otherwise this tick (ADR
   * 0093) — the default half of {@link holdAs}, applied to every Character
   * before the live holds re-assert themselves.
   *
   * Being engaged used to be a flag left out of this reset while the values
   * beside it were cleared every tick. Because nothing else ever cleared it
   * outside a knockdown, a Character stayed "engaged" forever after its first
   * hold ended — and being engaged gates the verb, so you could Grab exactly
   * once per life, with later presses reading as "let go" and not even
   * playing the reach.
   */
  clearHold(): void {
    this.holdRole = null;
    this.heldPhase = null;
  }

  /** This Character is at `role`'s end of a hold this tick, in `phase` if it is the one held (ADR 0104). */
  holdAs(role: HoldRole, phase: HeldPhase | null = null): void {
    this.holdRole = role;
    this.heldPhase = role === "held" ? phase : null;
  }

  /** The Struggle is over, whichever way it went — the meter empties for the next hold. */
  forgetStruggle(): void {
    this.escapeProgress = 0;
    this.lastWiggleYaw = null;
  }

  /**
   * A knockdown, a Respawn or a correction ends every verb and every hold on
   * this Character's side.
   *
   * M6 ticket 03 (code review): Hit mirrors Dash's own cooldown idiom, so
   * it must also mirror Dash's own reset-on-knockdown behavior — without
   * this, a Character's Hit stayed locked out for whatever was left of its
   * cooldown after getting up, while Dash always came back instantly, a
   * surprising inconsistency between two verbs deliberately built the same way.
   *
   * M6 ticket 04: same reasoning as Hit just above — a knockdown resets
   * Grab's cooldown too, and drops this Character's own view of being
   * engaged in a hold (`GrabHolds` ends the hold from its side independently;
   * this is the same "safest fallback until the next real check" treatment
   * `activeVolume`/`surfaceBounce` already get on reconcile).
   */
  reset(): void {
    this.hit.reset();
    this.grab.reset();
    this.clearHold();
    this.pendingGrabRelease = false;
    this.grabbingId = null;
    this.heldByGrabberId = null;
    this.reportedHeldPhase = null;
    this.holdEndsTick = null;
    this.spinTicks = 0;
    this.pendingHurl = null;
    this.pendingDizzy = false;
    this.forgetStruggle();
  }

  /** This side of a reconciliation (ticket 05, ADR 0013) — see `CharacterController.reconcileTo`. */
  reconcile(base: ReconcileBase): void {
    // Same reasoning again (M6 ticket 04): whether this Character is
    // currently engaged in a Grab hold is cross-Character state — "not
    // engaged" until the very next tick's own push refreshes it
    // (`RapierSimulation.syncOwnHold` on a client), same as `activeVolume`.
    this.clearHold();
    this.pendingGrabRelease = false;
    this.grabbingId = null;
    this.heldByGrabberId = null;
    this.reportedHeldPhase = null;
    this.holdEndsTick = null;
    this.hit.restoreCooldownMs(base.hitCooldownMs);
    this.hit.restoreCharge(base.hitChargeMs);
    this.grab.restoreCooldownMs(base.grabCooldownMs);
    // ADR 0104: the two halves of a hold its own client predicts.
    this.escapeProgress = base.escapeProgress;
    this.lastWiggleYaw = base.lastWiggleYaw;
    this.spinTicks = Math.max(0, Math.round(base.spinMs / TICK_MS));
    this.pendingHurl = null;
    this.pendingDizzy = false;
  }
}

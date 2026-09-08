import {
  HIT_CHARGE_IMPACT_BONUS,
  HIT_CHARGE_MAX_TICKS,
  HIT_COOLDOWN_TICKS,
  HIT_IMPACT_MAGNITUDE,
  HIT_IMPACT_MAX,
  TICK_MS,
} from "../tuning.js";
import { CooldownController } from "./CooldownController.js";

/**
 * How hard a connecting Hit lands, from how fully it was charged before
 * release (M6.1: hold-to-charge — supersedes the original M6.1 ticket 01
 * design, which read the striker's own approach speed; Dash now locks Hit
 * out entirely while a burst plays, so a swing can never overlap one, and
 * needs its own source of "how committed was this").
 *
 * `chargeFraction` is 0..1 — clamped here rather than trusted, since a caller
 * could in principle pass a raw ratio computed from a since-changed tuning
 * constant. Nothing downstream branches on "was this a good hit": this feeds
 * the same `applyImpact` pipeline every other Impact uses, and
 * `IMPACT_STAGGER_MIN` / `IMPACT_RAGDOLL_MIN` decide the outcome exactly as
 * they do for a Bump, a Spinner or a wall.
 */
export const hitImpactMagnitude = (chargeFraction: number): number =>
  Math.min(HIT_IMPACT_MAX, HIT_IMPACT_MAGNITUDE + Math.max(0, Math.min(1, chargeFraction)) * HIT_CHARGE_IMPACT_BONUS);

/**
 * Hit's bookkeeping (M6 ticket 03; hold-to-charge added M6.1): hold the
 * button to charge, release to swing. Charging only ever advances while
 * `allowed` (this Character has full control and isn't Dashing — M6.1:
 * "dash locks everything until it finishes") and the cooldown is clear;
 * losing either mid-charge discards it outright rather than swinging on an
 * involuntary release (a forced Stagger is not a punch).
 *
 * Whether a fired swing actually *connects* with anyone is a separate,
 * cross-Character question only `RapierSimulation` can answer (it alone
 * knows every Character's position) — this class only ever answers "may I
 * charge" and "how charged was it when released."
 */
export class HitController extends CooldownController {
  private chargeTicks = 0;
  private charging = false;

  override reset(): void {
    super.reset();
    this.chargeTicks = 0;
    this.charging = false;
  }

  /** Ms charged so far on an in-progress hold; 0 while not charging. */
  get chargeMs(): number {
    return this.chargeTicks * TICK_MS;
  }

  /**
   * Advance charge/cooldown bookkeeping one tick. `held` is the raw Hit
   * button state; `allowed` is whether this Character may charge or swing at
   * all right now (full control, not Dashing — the cooldown itself is
   * checked internally, same as every other verb).
   *
   * Returns the charge fraction (0..1) to swing with, the instant `held`
   * goes false after a real charge — `null` on every other tick (mid-charge,
   * not held, on cooldown, or `allowed` dropped out from under an in-progress
   * charge).
   */
  beginTick(held: boolean, allowed: boolean): number | null {
    this.tickDown();

    if (!allowed || !this.ready) {
      this.charging = false;
      this.chargeTicks = 0;
      return null;
    }

    if (held) {
      this.charging = true;
      this.chargeTicks = Math.min(this.chargeTicks + 1, HIT_CHARGE_MAX_TICKS);
      return null;
    }

    if (this.charging) {
      const fraction = this.chargeTicks / HIT_CHARGE_MAX_TICKS;
      this.charging = false;
      this.chargeTicks = 0;
      this.startCooldown(HIT_COOLDOWN_TICKS);
      return fraction;
    }

    return null;
  }

  /** Restore the cooldown from a reconciliation base (M6 ticket 03) — the server's `hitCooldownMs`, rounded back to whole ticks. */
  restoreCooldownMs(ms: number): void {
    this.cooldownTicks = this.cooldownTicksFromMs(ms);
  }

  /** Restore an in-progress charge from a reconciliation base (M6.1) — the server's `hitChargeMs`, rounded back to whole ticks. No phase-offset subtlety like Dash's own restore: charge and cooldown never overlap, so this is a direct round-trip. */
  restoreCharge(ms: number): void {
    this.chargeTicks = Math.max(0, Math.round(ms / TICK_MS));
    this.charging = this.chargeTicks > 0;
  }
}

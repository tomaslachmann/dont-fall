import {
  HIT_COOLDOWN_TICKS,
  HIT_IMPACT_MAGNITUDE,
  HIT_IMPACT_MAX,
  HIT_MOMENTUM_SCALE,
} from "../tuning.js";
import { CooldownController } from "./CooldownController.js";

/**
 * How hard a connecting Hit lands, from how fast the striker was closing on
 * the target (M6.1 ticket 01) — their own approach speed along the line to
 * the target, in units/s, negative or zero if they were not moving in.
 *
 * The striker's *own* commitment, deliberately, not the closing speed
 * between the two the way `resolveBump` measures it: a target running onto
 * a stationary fist is already a Bump, and counting it here would pay the
 * striker twice for standing still.
 *
 * Nothing downstream branches on "was this a good hit". This feeds the same
 * `applyImpact` pipeline every other Impact uses, and `IMPACT_STAGGER_MIN` /
 * `IMPACT_RAGDOLL_MIN` decide the outcome exactly as they do for a Bump, a
 * Spinner or a wall.
 */
export const hitImpactMagnitude = (approachSpeed: number): number =>
  Math.min(HIT_IMPACT_MAX, HIT_IMPACT_MAGNITUDE + Math.max(0, approachSpeed) * HIT_MOMENTUM_SCALE);

/**
 * Hit's cooldown bookkeeping (M6 ticket 03). A swing either fires this tick
 * (cooldown was 0) or it doesn't, with no ongoing effect of its own to
 * advance afterward — unlike Dash, there is no burst/duration/direction to
 * also track, so this is `CooldownController` with nothing added beyond the
 * fire decision itself.
 *
 * Whether a fired swing actually *connects* with anyone is a separate,
 * cross-Character question only `RapierSimulation` can answer (it alone
 * knows every Character's position) — this class only ever answers "may I
 * swing right now."
 */
export class HitController extends CooldownController {
  /** Advance cooldown bookkeeping; returns whether a swing actually fires this tick. */
  beginTick(hitPressed: boolean): boolean {
    this.tickDown();
    if (hitPressed && this.ready) {
      this.startCooldown(HIT_COOLDOWN_TICKS);
      return true;
    }
    return false;
  }

  /** Restore the cooldown from a reconciliation base (M6 ticket 03) — the server's `hitCooldownMs`, rounded back to whole ticks. */
  restoreCooldownMs(ms: number): void {
    this.cooldownTicks = this.cooldownTicksFromMs(ms);
  }
}
